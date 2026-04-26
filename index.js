const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage, Raw } = require('telegram/events');
const readline = require('readline');

const config = require('./config');
const Utils = require('./utils');

class BankTransactionUserbot {
  constructor() {
    this.client = null;
    this.settings = Utils.loadSettings();
    this.isRunning = false;
    this.processedMessages = new Map(); // Store timestamp with message
    this.processingMessages = new Set(); // Track currently processing messages
    this.eventHandlerRegistered = false; // Prevent duplicate event handlers
    
    // Migrate old settings format if needed
    this.migrateOldSettings();
    this.migrateCalToGlobal();
    this.migratePic2Settings();
    this.migrateCopyAllWatermark();
    
    Utils.log('🤖 Bank Transaction Userbot khởi tạo');
    Utils.log(`📊 Chế độ: Reply theo từng nhóm`);
  }

  // Migrate từ format cũ (global replyEnabled) sang format mới (group-specific)
  migrateOldSettings() {
    if (this.settings.hasOwnProperty('replyEnabled')) {
      Utils.log('🔄 Phát hiện settings format cũ, đang migrate...');
      
      // Initialize groupSettings if not exists
      if (!this.settings.groupSettings) {
        this.settings.groupSettings = {};
      }
      
      // Remove old global setting
      delete this.settings.replyEnabled;
      
      // Save migrated settings
      Utils.saveSettings(this.settings);
      Utils.log('✅ Đã migrate settings sang format mới (group-specific)');
    }
  }

  /** /cal từng nhóm (cũ) → calEnabled toàn cục ở root settings */
  migrateCalToGlobal() {
    if (this.settings.hasOwnProperty('calEnabled')) {
      return;
    }
    let anyOn = false;
    const gs = this.settings.groupSettings;
    if (gs && typeof gs === 'object') {
      for (const id of Object.keys(gs)) {
        const g = gs[id];
        if (g && g.calEnabled === true) {
          anyOn = true;
        }
        if (g && Object.prototype.hasOwnProperty.call(g, 'calEnabled')) {
          const { calEnabled: _drop, ...rest } = g;
          gs[id] = Object.keys(rest).length ? rest : { replyEnabled: !!g.replyEnabled };
        }
      }
    }
    this.settings.calEnabled = anyOn;
    Utils.saveSettings(this.settings);
    Utils.log(
      `✅ Đã migrate /cal sang toàn bot (calEnabled=${anyOn}); đã bỏ calEnabled trong groupSettings`
    );
  }

  migratePic2Settings() {
    if (Utils.normalizePic2Settings(this.settings)) {
      Utils.saveSettings(this.settings);
      Utils.log('✅ Đã migrate pic2Settings (nhiều rule / nhóm)');
    }
  }

  migrateCopyAllWatermark() {
    if (!this.settings.copyAllWatermark || typeof this.settings.copyAllWatermark !== 'object') {
      this.settings.copyAllWatermark = {};
      Utils.saveSettings(this.settings);
      Utils.log('✅ Đã khởi tạo copyAllWatermark');
    }
  }

  resolveSessionFilePath() {
    const path = require('path');
    const rel = config.sessionFile || './telegram.session';
    return path.isAbsolute(rel) ? rel : path.join(__dirname, rel);
  }

  /** Đọc session: ưu tiên file session, sau đó config.sessionString */
  loadSessionStringFromDisk() {
    const fs = require('fs');
    let loaded = (config.sessionString || '').trim();
    const sessionPath = this.resolveSessionFilePath();
    try {
      if (fs.existsSync(sessionPath)) {
        const fromFile = fs.readFileSync(sessionPath, 'utf8').trim();
        if (fromFile.length > 10) {
          loaded = fromFile;
          Utils.log(`🔑 Đã đọc session từ file: ${sessionPath}`);
        }
      }
    } catch (e) {
      Utils.log(`⚠️ Không đọc được session file: ${e.message}`);
    }
    return loaded;
  }

  /** Lưu session sau đăng nhập: ghi file + đồng bộ dòng sessionString trong config.js (JSON.stringify, tránh lỗi ký tự đặc biệt) */
  async persistSession(sessionString) {
    const fsp = require('fs').promises;
    const path = require('path');
    const sessionPath = this.resolveSessionFilePath();
    try {
      await fsp.mkdir(path.dirname(sessionPath), { recursive: true });
    } catch (e) {
      Utils.log(`⚠️ mkdir session: ${e.message}`);
    }
    try {
      await fsp.writeFile(sessionPath, sessionString, 'utf8');
      Utils.log(`💾 Đã lưu session vào file: ${sessionPath}`);
    } catch (e) {
      Utils.log(`❌ Không ghi được file session: ${e.message}`);
    }
    config.sessionString = sessionString;
    const patched = this.patchConfigSessionLine(sessionString);
    if (patched) {
      Utils.log('💾 Đã đồng bộ session vào config.js');
    }
  }

  patchConfigSessionLine(sessionString) {
    try {
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(__dirname, 'config.js');
      let content = fs.readFileSync(configPath, 'utf8');
      const line = `sessionString: ${JSON.stringify(sessionString)},`;
      if (/^\s*sessionString:\s*.+$/m.test(content)) {
        content = content.replace(/^\s*sessionString:\s*.+$/m, line);
      } else {
        Utils.log('⚠️ Không tìm thấy dòng sessionString trong config.js để cập nhật');
        return false;
      }
      fs.writeFileSync(configPath, content, 'utf8');
      return true;
    } catch (e) {
      Utils.log(`⚠️ Không ghi config.js (volume chỉ đọc?): ${e.message}`);
      return false;
    }
  }

  // Khởi tạo client Telegram
  async initializeClient() {
    try {
      // Kiểm tra API credentials
      if (config.apiId === 'YOUR_API_ID' || config.apiHash === 'YOUR_API_HASH') {
        throw new Error('Vui lòng cập nhật API credentials trong config.js');
      }

      // Kiểm tra số điện thoại
      if (config.phoneNumber === 'YOUR_PHONE_NUMBER') {
        throw new Error('Vui lòng cập nhật số điện thoại trong config.js');
      }

      const loadedSession = this.loadSessionStringFromDisk();
      const stringSession = new StringSession(loadedSession);

      this.client = new TelegramClient(stringSession, parseInt(config.apiId), config.apiHash, {
        connectionRetries: 5,
      });

      Utils.log('🔗 Đang kết nối tới Telegram...');

      const hasValidSession = loadedSession.length > 10;
      if (hasValidSession) {
        Utils.log('🔑 Sử dụng session có sẵn - không cần OTP/2FA');
      } else {
        Utils.log('🆕 Lần đăng nhập đầu tiên - cần nhập mã xác nhận');
      }
      
      await this.client.start({
        phoneNumber: async () => {
          // Sử dụng số từ config, hoặc hỏi nếu không có
          if (config.phoneNumber && config.phoneNumber !== 'YOUR_PHONE_NUMBER') {
            Utils.log(`📱 Sử dụng số điện thoại từ config: ${config.phoneNumber}`);
            return config.phoneNumber;
          } else {
            return await this.askInput('Nhập số điện thoại (với mã quốc gia): ');
          }
        },
        password: async () => {
          if (hasValidSession) {
            Utils.log('🔐 Sử dụng 2FA từ session...');
          }
          return await this.askInput('Nhập mật khẩu 2FA (nếu có): ');
        },
        phoneCode: async () => {
          if (hasValidSession) {
            Utils.log('⚠️  Session có thể đã expired, cần mã xác nhận mới');
          }
          return await this.askInput('Nhập mã xác nhận: ');
        },
        onError: (err) => {
          Utils.log(`❌ Lỗi đăng nhập: ${err.message}`);
          throw err;
        },
      });

      // Tự lưu session sau đăng nhập (lần đầu hoặc khi session đổi so với file/config)
      const currentSession = this.client.session.save();
      if (currentSession && currentSession.length > 10 && currentSession !== loadedSession) {
        Utils.log('💾 Session mới — đang lưu tự động (file + config.js)...');
        await this.persistSession(currentSession);
      }

      Utils.log('✅ Kết nối thành công!');
      return true;

    } catch (error) {
      Utils.log(`❌ Lỗi khởi tạo client: ${error.message}`);
      return false;
    }
  }

  // Helper để nhập input từ console
  askInput(question) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  // Đăng ký event handlers
  setupEventHandlers() {
    // Đảm bảo không đăng ký handler nhiều lần
    if (this.eventHandlerRegistered) {
      Utils.log('📱 Event handlers đã được đăng ký trước đó');
      return;
    }

    // Lắng nghe tin nhắn mới
    this.client.addEventHandler(async (event) => {
      try {
        await this.handleNewMessage(event);
      } catch (error) {
        Utils.log(`❌ Lỗi xử lý tin nhắn: ${error.message}`);
      }
    }, new NewMessage({}));

    // Lắng nghe reactions via Raw events
    this.client.addEventHandler(async (event) => {
      try {
        // 🔍 DEBUG: Log tất cả raw events để debug
        if (event.className && (
          event.className === 'UpdateMessageReactions' || 
          event.className === 'UpdateChatUserTyping' ||
          event.className === 'UpdateUserStatus' ||
          event.className.includes('Reaction') ||
          event.className.includes('Message')
        )) {
          Utils.log(`🔍 [RAW-EVENT] ${event.className}:`, JSON.stringify(event, null, 2));
        }

        // Filter cho UpdateMessageReactions (chính)
        if (event.className === 'UpdateMessageReactions') {
          await this.handleMessageReaction(event);
        }
        
        // Thử các event types khác có thể chứa reaction info
        else if (event.className === 'UpdateEditMessage' && event.message && event.message.reactions) {
          Utils.log(`🔍 [FALLBACK] Tìm thấy reactions trong UpdateEditMessage`);
          await this.handleAlternativeReaction(event);
        }
        
        // Fallback cho regular groups - thử UpdateShort
        else if (event.className === 'UpdateShort' && event.update && event.update.className === 'UpdateMessageReactions') {
          Utils.log(`🔍 [FALLBACK] Tìm thấy UpdateMessageReactions trong UpdateShort`);
          await this.handleMessageReaction(event.update);
        }
        
      } catch (error) {
        Utils.log(`❌ Lỗi xử lý reaction: ${error.message}`);
      }
    }, new Raw({}));

    // Đăng ký periodic check cho regular groups (fallback)
    this.setupRegularGroupReactionPolling();
    
    this.eventHandlerRegistered = true;
    Utils.log('📱 Đã đăng ký event handlers với fallback cho regular groups');
  }

  // Thiết lập polling cho regular groups reactions
  setupRegularGroupReactionPolling() {
    // Track recent messages để check reactions
    this.recentMessages = new Map(); // messageKey -> {chatId, messageId, timestamp}
    
    // Cleanup old messages every 5 minutes
    setInterval(() => {
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      for (const [key, data] of this.recentMessages.entries()) {
        if (data.timestamp < fiveMinutesAgo) {
          this.recentMessages.delete(key);
        }
      }
      Utils.log(`🧹 Cleaned up old message tracking. Current count: ${this.recentMessages.size}`);
    }, 5 * 60 * 1000);
  }

  // Xử lý tin nhắn mới
  async handleNewMessage(event) {
    const message = event.message;
    if (!message) return;

    const messageText = message.message || message.text || '';
    const chatId = message.chatId;
    const messageId = message.id;
    const currentTime = Date.now();

    // Tạo unique key để track message
    const messageKey = `${chatId}_${messageId}`;
    
    // Track messages cho regular groups (để check reactions sau)
    if (chatId.toString().match(/^-\d{10}$/)) { // Regular group format
      this.recentMessages.set(messageKey, {
        chatId: chatId,
        messageId: messageId,
        timestamp: currentTime
      });
      Utils.log(`📝 [TRACK] Tracking message in regular group: ${messageKey}`);
    }
    
    // Skip nếu đã xử lý message này rồi (trong 30 giây qua)
    if (this.processedMessages.has(messageKey)) {
      const processedTime = this.processedMessages.get(messageKey);
      if (currentTime - processedTime < 30000) { // 30 seconds
        Utils.log(`🔄 Skip duplicate message: ${messageKey}`);
        return;
      }
    }

    // Skip nếu đang process message này
    if (this.processingMessages.has(messageKey)) {
      Utils.log(`⏳ Message đang được xử lý: ${messageKey}`);
      return;
    }

    // Mark as processing
    this.processingMessages.add(messageKey);

    try {
      // Kiểm tra commands trước (cho phép chính mình sử dụng commands)
      if (messageText.startsWith('/')) {
        // Mark as processed cho commands
        this.processedMessages.set(messageKey, currentTime);
        await this.handleCommand(messageText, chatId, messageId, message);
        return;
      }

      // Kiểm tra pic2 settings trước (không phụ thuộc vào replyEnabled)
      await this.checkPic2Message(message);

      // Kiểm tra auto-forward trước (không phụ thuộc vào replyEnabled)
      if (message.replyTo) {
        await this.checkAutoForwardMessage(message);
      }

      const groupId = chatId.toString();
      const groupSettings = this.settings.groupSettings?.[groupId] || { replyEnabled: false };

      // Máy tính /cal toàn bot (độc lập reply giao dịch; chỉ kết quả + quote tin gốc)
      if (this.settings.calEnabled && messageText.trim() && !Utils.isTransactionMessage(messageText)) {
        const calBlocked =
          this.settings.calAdminOnly === true && !this.isOwnerOrAdmin(message);
        if (!calBlocked) {
          const calResult = Utils.tryEvaluateCal(messageText);
          if (calResult.ok) {
            this.processedMessages.set(messageKey, currentTime);
            await this.sendReply(chatId, messageId, calResult.text);
            return;
          }
        }
      }

      // Kiểm tra nếu chức năng reply đã bật cho group này
      if (!groupSettings.replyEnabled) return;

      // Kiểm tra xem có phải tin nhắn giao dịch không
      if (Utils.isTransactionMessage(messageText)) {
        // Mark as processed trước khi xử lý
        this.processedMessages.set(messageKey, currentTime);
        
        // Cho phép reply cả tin nhắn từ chính mình nếu là tin nhắn giao dịch
        await this.handleTransactionMessage(message, messageText);
      }
      // Skip các tin nhắn khác từ chính mình (outgoing)
      else if (message.out) {
        return;
      }

    } finally {
      // Remove from processing set
      this.processingMessages.delete(messageKey);
    }

    // Cleanup old processed messages (giữ 1000 messages gần nhất)
    if (this.processedMessages.size > 1000) {
      const oldEntries = Array.from(this.processedMessages.entries()).slice(0, 500);
      oldEntries.forEach(([key]) => this.processedMessages.delete(key));
    }
  }

  // Xử lý message reactions
  async handleMessageReaction(event) {
    try {
      // 🐛 DEBUG: Log raw reaction event
      Utils.log(`🔍 [DEBUG] Phát hiện reaction event:`, JSON.stringify(event, null, 2));
      
      // Parse UpdateMessageReactions event structure
      let chatId;
      if (event.peer && event.peer.channelId) {
        // For channels/supergroups
        chatId = `-100${event.peer.channelId}`;
      } else if (event.peer && event.peer.chatId) {
        // For regular groups  
        chatId = `-${event.peer.chatId}`;
      } else if (event.peer && event.peer.userId) {
        // For private chats
        chatId = event.peer.userId;
      } else {
        Utils.log(`❌ Không thể parse chatId từ peer: ${JSON.stringify(event.peer)}`);
        return;
      }

      const messageId = event.msgId;
      const reactions = event.reactions;
      
      // 🐛 DEBUG: Log parsed info
      Utils.log(`🔍 [DEBUG] Parsed - ChatId: ${chatId}, MessageId: ${messageId}`);
      Utils.log(`🔍 [DEBUG] Reactions:`, JSON.stringify(reactions, null, 2));
      
      if (!reactions || !reactions.recentReactions) {
        Utils.log(`🔍 [DEBUG] Không có reactions hoặc recentReactions`);
        return;
      }

      // Lấy user ID của người react
      const latestReaction = reactions.recentReactions[0];
      if (!latestReaction) {
        Utils.log(`❌ Không tìm thấy latestReaction từ reactions`);
        return;
      }

      // 🐛 DEBUG: Log reaction details
      Utils.log(`🔍 [DEBUG] Latest reaction:`, JSON.stringify(latestReaction, null, 2));

      // Parse userId from reaction structure
      let reactorUserId;
      if (latestReaction.userId) {
        reactorUserId = latestReaction.userId.toString();
        Utils.log(`🔍 [DEBUG] User ID from userId: ${reactorUserId}`);
      } else if (latestReaction.peerId && latestReaction.peerId.userId) {
        reactorUserId = latestReaction.peerId.userId.toString();
        Utils.log(`🔍 [DEBUG] User ID from peerId.userId: ${reactorUserId}`);
      } else if (latestReaction.peer_id && latestReaction.peer_id.user_id) {
        reactorUserId = latestReaction.peer_id.user_id.toString();
        Utils.log(`🔍 [DEBUG] User ID from peer_id.user_id: ${reactorUserId}`);
      } else {
        Utils.log(`❌ Không thể parse userId từ reaction:`, JSON.stringify(latestReaction));
        return;
      }
      
      // 🐛 DEBUG: Log emoji detection
      let reactionEmoji = '';
      if (latestReaction.reaction) {
        if (latestReaction.reaction._ === 'ReactionEmoji') {
          reactionEmoji = latestReaction.reaction.emoticon;
        } else if (latestReaction.reaction.className === 'ReactionEmoji') {
          reactionEmoji = latestReaction.reaction.emoticon;
        }
        Utils.log(`🔍 [DEBUG] Detected emoji: ${reactionEmoji}, reaction type: ${latestReaction.reaction._ || latestReaction.reaction.className}`);
      }
      
      // 🐛 DEBUG: Admin check
      const isAdmin = this.isOwnerOrAdmin(reactorUserId);
      const adminList = Utils.getAdminList(this.settings);
      Utils.log(`🔍 [DEBUG] User ${reactorUserId} admin check: ${isAdmin}`);
      Utils.log(`🔍 [DEBUG] Current admin list: [${adminList.join(', ')}]`);
      
      // Kiểm tra quyền admin
      if (!isAdmin) {
        Utils.log(`🚫 User ${reactorUserId} không phải admin - bỏ qua reaction`);
        return;
      }

      Utils.log(`👑 Admin ${reactorUserId} đã react - tiếp tục xử lý`);

      const currentTime = Date.now();

      // Tạo unique key để track reaction
      const reactionKey = `reaction_${chatId}_${messageId}`;
      
      // Skip nếu đã xử lý reaction này rồi (trong 10 giây qua)
      if (this.processedMessages.has(reactionKey)) {
        const processedTime = this.processedMessages.get(reactionKey);
        if (currentTime - processedTime < 10000) { // 10 seconds
          return;
        }
      }

      // Mark reaction as processed
      this.processedMessages.set(reactionKey, currentTime);

      Utils.log(`👍 Nhận reaction từ admin: ${chatId}_${messageId}`);
      
      // Lấy tin nhắn gốc để forward
      const originalMessage = await this.client.getMessages(chatId, { ids: [messageId] });
      if (!originalMessage || originalMessage.length === 0) {
        Utils.log(`❌ Không tìm thấy tin nhắn gốc: ${messageId}`);
        return;
      }

      const targetMessage = originalMessage[0];
      await this.checkAutoForwardReaction(event, targetMessage, reactorUserId);

    } catch (error) {
      Utils.log(`❌ Lỗi xử lý reaction: ${error.message}`);
    }
  }

  // Xử lý alternative reaction events (fallback cho regular groups)
  async handleAlternativeReaction(event) {
    try {
      Utils.log(`🔍 [ALTERNATIVE] Processing alternative reaction event`);
      Utils.log(`🔍 [ALTERNATIVE] Original event:`, JSON.stringify(event, null, 2));
      
      // Tìm peer từ nhiều nguồn khác nhau
      let peer = null;
      
      if (event.peer) {
        peer = event.peer;
      } else if (event.message && event.message.peer) {
        peer = event.message.peer;
      } else if (event.message && event.message.peerId) {
        peer = event.message.peerId;
      } else if (event.message && event.message.chatId) {
        // Tạo peer từ chatId
        const chatId = event.message.chatId;
        if (chatId.toString().startsWith('-100')) {
          // Supergroup/channel
          const channelId = chatId.toString().substring(4);
          peer = { channelId: channelId, className: 'PeerChannel' };
        } else if (chatId.toString().startsWith('-')) {
          // Regular group
          const groupId = chatId.toString().substring(1);
          peer = { chatId: groupId, className: 'PeerChat' };
        } else {
          // Private chat
          peer = { userId: chatId, className: 'PeerUser' };
        }
      }
      
      Utils.log(`🔍 [ALTERNATIVE] Detected peer:`, JSON.stringify(peer, null, 2));
      
      // Tạo fake reaction event từ alternative source
      const fakeReactionEvent = {
        peer: peer,
        msgId: event.message ? event.message.id : event.msgId,
        reactions: event.message ? event.message.reactions : event.reactions,
        className: 'UpdateMessageReactions'
      };
      
      Utils.log(`🔍 [ALTERNATIVE] Created fake reaction event:`, JSON.stringify(fakeReactionEvent, null, 2));
      
      // Sử dụng hàm xử lý reaction chính
      await this.handleMessageReaction(fakeReactionEvent);
      
    } catch (error) {
      Utils.log(`❌ Lỗi xử lý alternative reaction: ${error.message}`);
    }
  }

  // Xử lý tin nhắn giao dịch
  async handleTransactionMessage(message, messageText) {
    try {
      const messageKey = `${message.chatId}_${message.id}`;
      
      Utils.log(`🔥 Bắt đầu xử lý giao dịch: ${messageKey}`);
      
      const amount = Utils.formatAmount(messageText);
      const accountInfo = Utils.extractAccountInfo(messageText);
      
      // Check if message is from self
      const fromSelf = message.out ? " (từ chính mình)" : "";
      
      Utils.log(`💰 Phát hiện giao dịch${fromSelf}: +${amount}đ từ ${accountInfo.bank} - ${accountInfo.account}`);
      
      // Double-check để tránh reply duplicate
      const replyKey = `reply_${messageKey}`;
      if (this.processedMessages.has(replyKey)) {
        Utils.log(`🚫 Đã reply message này rồi: ${messageKey}`);
        return;
      }
      
      // Mark reply as processed
      this.processedMessages.set(replyKey, Date.now());
      
      // Reply với số "1"
      await this.client.sendMessage(message.chatId, {
        message: this.settings.replyMessage,
        replyTo: message.id
      });

      Utils.log(`✅ Đã reply tin nhắn giao dịch với: "${this.settings.replyMessage}" cho ${messageKey}`);

    } catch (error) {
      Utils.log(`❌ Lỗi khi reply tin nhắn giao dịch: ${error.message}`);
    }
  }

  // Xử lý commands
  async handleCommand(messageText, chatId, messageId, originalMessage = null) {
    const commandData = Utils.parseCommand(messageText);
    if (!commandData) return;

    const { command, args } = commandData;

    switch (command) {
      case '/1':
        await this.handleReplyCommand(args, chatId, messageId);
        break;
      
      case '/status':
        await this.handleStatusCommand(chatId, messageId);
        break;
      
      case '/help2':
        if (!this.isOwnerOrAdmin(originalMessage)) {
          await this.sendReply(
            chatId,
            messageId,
            '❌ Chỉ admin mới có thể sử dụng lệnh này'
          );
          return;
        }
        await this.handleHelp2Command(chatId, messageId);
        break;

      // /help 2 (có khoảng trắng) — tương đương /help2
      case '/help':
        if (args[0] === '2' || (args.length === 1 && String(args[0]).trim() === '2')) {
          if (!this.isOwnerOrAdmin(originalMessage)) {
            await this.sendReply(
              chatId,
              messageId,
              '❌ Chỉ admin mới có thể sử dụng lệnh này'
            );
            return;
          }
          await this.handleHelp2Command(chatId, messageId);
        } else {
          await this.sendReply(
            chatId,
            messageId,
            'ℹ️ Hướng dẫn đầy đủ (admin): gõ **/help2** hoặc **/help 2**'
          );
        }
        break;

      case '/id':
        await this.handleIdCommand(chatId, messageId, originalMessage);
        break;
      
      case '/pic2':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
        await this.handlePic2Command(args, chatId, messageId);
        break;
      
      case '/setforward':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
        await this.handleSetForwardCommand(args, chatId, messageId, originalMessage);
        break;
      
      case '/removeforward':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
        await this.handleRemoveForwardCommand(args, chatId, messageId);
        break;
      
              case '/listforward':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
          await this.handleListForwardCommand(chatId, messageId);
          break;
      
      case '/setforward2':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
        await this.handleSetForward2Command(args, chatId, messageId, originalMessage);
        break;
      
      case '/removeforward2':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
        await this.handleRemoveForward2Command(args, chatId, messageId);
        break;
      
      case '/listforward2':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
        await this.handleListForward2Command(chatId, messageId);
        break;
        case '/groups':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
          await this.handleGroupsCommand(chatId, messageId);
          break;
        case '/ad':
          await this.handleAdminCommand(args, chatId, messageId, originalMessage);
          break;
        case '/adlist':
          if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
            await this.sendReply(chatId, messageId, '');
            return;
          }
          await this.handleAdminListCommand(chatId, messageId);
          break;
        case '/adremove':
          if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
            await this.sendReply(chatId, messageId, '');
            return;
          }
          await this.handleAdminRemoveCommand(args, chatId, messageId);
          break;

      case '/copyall':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
        await this.handleCopyAllCommand(args, chatId, messageId, originalMessage);
        break;

      case '/newcopy':
        if (!this.isOwnerOrAdmin(originalMessage.senderId?.toString())) {
          await this.sendReply(chatId, messageId, '');
          return;
        }
        await this.handleNewCopyCommand(args, chatId, messageId, originalMessage);
        break;

      case '/cal':
        if (!this.isOwnerOrAdmin(originalMessage)) {
          await this.sendReply(
            chatId,
            messageId,
            '❌ Chỉ admin mới có thể sử dụng lệnh này'
          );
          return;
        }
        await this.handleCalCommand(args, chatId, messageId);
        break;

      // Một số client/ghi nhớ lệnh dính chữ: /calon ≈ /cal on
      case '/calon':
        if (!this.isOwnerOrAdmin(originalMessage)) {
          await this.sendReply(
            chatId,
            messageId,
            '❌ Chỉ admin mới có thể sử dụng lệnh này'
          );
          return;
        }
        await this.handleCalCommand(['on'], chatId, messageId);
        break;

      case '/caloff':
        if (!this.isOwnerOrAdmin(originalMessage)) {
          await this.sendReply(
            chatId,
            messageId,
            '❌ Chỉ admin mới có thể sử dụng lệnh này'
          );
          return;
        }
        await this.handleCalCommand(['off'], chatId, messageId);
        break;
    }
  }

  // Xử lý command /1 on/off (theo từng group)
  async handleReplyCommand(args, chatId, messageId) {
    const groupId = chatId.toString();
    
    // Initialize groupSettings if not exists
    if (!this.settings.groupSettings) {
      this.settings.groupSettings = {};
    }
    
    const currentGroupSettings = this.settings.groupSettings[groupId] || { replyEnabled: false };

    if (args.length === 0) {
      const status = currentGroupSettings.replyEnabled ? 'BẬT' : 'TẮT';
      await this.sendReply(chatId, messageId, `⚙️ Trạng thái reply cho nhóm này: ${status}\nDùng /1 on để bật, /1 off để tắt`);
      return;
    }

    const action = args[0].toLowerCase();

    if (action === 'on') {
      this.settings.groupSettings[groupId] = { ...currentGroupSettings, replyEnabled: true };
      Utils.saveSettings(this.settings);
      Utils.log(`🟢 Chức năng reply đã BẬT cho group ${groupId}`);
      await this.sendReply(chatId, messageId, '✅ Đã BẬT chức năng reply giao dịch cho nhóm này');
    } else if (action === 'off') {
      this.settings.groupSettings[groupId] = { ...currentGroupSettings, replyEnabled: false };
      Utils.saveSettings(this.settings);
      Utils.log(`🔴 Chức năng reply đã TẮT cho group ${groupId}`);
      await this.sendReply(chatId, messageId, '❌ Đã TẮT chức năng reply giao dịch cho nhóm này');
    } else {
      await this.sendReply(chatId, messageId, '❗ Sử dụng: /1 on hoặc /1 off');
    }
  }

  // /cal on|on admin|off — chỉ admin; toàn bot: mọi nhóm/chat khi calEnabled
  async handleCalCommand(args, chatId, messageId) {
    if (typeof this.settings.calEnabled !== 'boolean') {
      this.settings.calEnabled = false;
    }
    if (this.settings.calAdminOnly !== true) {
      this.settings.calAdminOnly = false;
    }

    if (args.length === 0) {
      const calOn = this.settings.calEnabled ? 'BẬT' : 'TẮT';
      const who =
        this.settings.calEnabled && this.settings.calAdminOnly
          ? '**chỉ admin** mới gửi biểu thức được tính'
          : this.settings.calEnabled
            ? '**mọi người** gửi biểu thức đều được tính'
            : '—';
      await this.sendReply(
        chatId,
        messageId,
        `⚙️ Máy tính (/cal) **toàn bot**: ${calOn}\n${this.settings.calEnabled ? `Chế độ: ${who}.\n` : ''}Áp dụng mọi nhóm/kênh/chat. Hậu tố: k/n = nghìn, tr = triệu, tỷ/ty = tỷ\n**Admin:** /cal on | /cal on admin | /cal off`
      );
      return;
    }

    const action = args[0].toLowerCase();
    if (action === 'on') {
      const onlyAdmin = args.length >= 2 && args[1].toLowerCase() === 'admin';
      if (args.length >= 2 && !onlyAdmin) {
        await this.sendReply(
          chatId,
          messageId,
          '❗ Sau **on** chỉ hợp lệ: **admin** (vd: `/cal on admin`) — hoặc dùng `/cal on` để mọi người tính được'
        );
        return;
      }
      this.settings.calEnabled = true;
      this.settings.calAdminOnly = onlyAdmin;
      Utils.saveSettings(this.settings);
      if (onlyAdmin) {
        Utils.log('🟢 /cal BẬT (toàn bot, chỉ admin)');
        await this.sendReply(
          chatId,
          messageId,
          '✅ Đã BẬT máy tính **toàn bot** — **chỉ admin** mới gửi biểu thức (vd: 5tr+10k) thì bot trả kết quả. Dùng `/cal on` để cho mọi người tính; `/cal off` để tắt.'
        );
      } else {
        Utils.log('🟢 /cal BẬT (toàn bot, mọi người)');
        await this.sendReply(
          chatId,
          messageId,
          '✅ Đã BẬT máy tính **toàn bot** (mọi nhóm): mọi người gửi biểu thức (vd: 5tr+10k) — bot trả kết quả + quote tin gốc. `/cal on admin` nếu chỉ muốn admin; `/cal off` để tắt.'
        );
      }
    } else if (action === 'off') {
      this.settings.calEnabled = false;
      this.settings.calAdminOnly = false;
      Utils.saveSettings(this.settings);
      Utils.log('🔴 /cal TẮT (toàn bot)');
      await this.sendReply(chatId, messageId, '❌ Đã TẮT máy tính **toàn bot** (mọi nhóm)');
    } else {
      await this.sendReply(
        chatId,
        messageId,
        '❗ Dùng: /cal on | /cal on admin | /cal off (hoặc /cal để xem trạng thái)'
      );
    }
  }

  // Xử lý command /status
  async handleStatusCommand(chatId, messageId) {
    const groupId = chatId.toString();
    const groupSettings = this.settings.groupSettings?.[groupId] || { replyEnabled: false };
    const status = groupSettings.replyEnabled ? '🟢 BẬT' : '🔴 TẮT';
    const calGlobal =
      this.settings.calEnabled !== true
        ? '🔴 TẮT'
        : this.settings.calAdminOnly === true
          ? '🟢 BẬT (chỉ admin tính)'
          : '🟢 BẬT (mọi người tính)';
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    // Đếm số group đã bật reply
    const groupReplyCount = this.settings.groupSettings ?
      Object.values(this.settings.groupSettings).filter((g) => g.replyEnabled).length : 0;
    const groupReplyStatus = groupReplyCount > 0 ? `🟢 ${groupReplyCount} groups` : '🔴 TẮT';
    // Đếm số pic2 rules (tất cả nhóm)
    const pic2RuleCount = Utils.countPic2Rules(this.settings);
    const pic2Status = pic2RuleCount > 0 ? `🟢 ${pic2RuleCount} rules` : '🔴 TẮT';
    
    // Đếm số forward rules
    const forwardCount = Utils.getActiveForwardRules(this.settings).length;
    const forwardStatus = forwardCount > 0 ? `🟢 ${forwardCount} rules` : '🔴 TẮT';
    
    // Đếm số forward2 rules
    const forward2Count = Utils.getActiveForward2Rules(this.settings).length;
    const forward2Status = forward2Count > 0 ? `🟢 ${forward2Count} rules` : '🔴 TẮT';
    
    // Đếm số admin users
    const adminCount = Utils.getAdminList(this.settings).length;
    const adminStatus = adminCount > 0 ? `🟢 ${adminCount} admins` : '🔴 NONE';

    const wmKeys = this.settings.copyAllWatermark
      ? Object.keys(this.settings.copyAllWatermark).length
      : 0;
    const copyWmStatus = wmKeys > 0 ? `🟢 ${wmKeys} cặp nguồn/đích` : '🔴 chưa dùng';
    
    const statusMessage = `
📊 **Trạng thái UserBot**

🤖 Bot: Đang hoạt động
⚙️ Reply giao dịch (nhóm này): ${status}
🔢 Máy tính /cal (toàn bot): ${calGlobal}
🌐 Reply giao dịch (tổng): ${groupReplyStatus}
💬 Tin nhắn reply: "${this.settings.replyMessage}"
📸 Pic2 auto reply: ${pic2Status}
🔄 Auto forward: ${forwardStatus}
🌐 Global forward2: ${forward2Status}
📋 Copyall watermark: ${copyWmStatus}
👑 Admin users: ${adminStatus}
👍 Reaction support: 🟢 BẬT (reply + admin reaction modes)
⏱️ Uptime: ${hours}h ${minutes}m

📝 Commands:
/1 on - Bật reply cho nhóm này
/1 off - Tắt reply cho nhóm này
/cal on - Bật máy tính toàn bot, mọi người gõ biểu thức (admin) 👑
/cal on admin - Bật máy tính, chỉ admin gõ biểu thức (admin) 👑
/cal off - Tắt máy tính toàn bot (admin) 👑
/status - Xem trạng thái  
/id - Xem ID chat/user
/ad - Admin management 👑
/groups - Danh sách groups 👑
/pic2 - Cấu hình pic2 👑
/setforward - Thiết lập auto-forward 👑
/setforward2 - Thiết lập global forward 👑
/listforward - Xem forward rules 👑
/listforward2 - Xem global forward rules 👑
/copyall - Copy lịch sử vào nhóm này 👑
/newcopy - Copy tin mới (sau /copyall) 👑
/help2 hoặc /help 2 - Hướng dẫn đầy đủ (admin) 👑

👑 = Admin only commands
    `.trim();

    await this.sendReply(chatId, messageId, statusMessage);
  }

  // Xử lý command /help2 (chỉ admin — kiểm tra trong handleCommand)
  async handleHelp2Command(chatId, messageId) {
    const helpMessage = `
🤖 **Bank Transaction UserBot**

**Chức năng chính:**
1. Tự động phát hiện tin nhắn giao dịch ngân hàng và reply bằng số "1"
2. Tự động reply hình ảnh từ user cụ thể trong group cụ thể
3. Chuyển tiếp tự động tin nhắn (text, ảnh, video, file, albums) với emoji/text triggers

**Commands - Máy tính (/cal, 👑 chỉ admin bật/tắt — toàn bot):**
/cal on - Bật: **mọi nhóm/kênh** — **mọi người** gửi biểu thức; bot trả **chỉ kết quả** (quote tin gốc)
/cal on admin - Bật: chỉ **admin** gửi biểu thức mới được tính
/cal off - Tắt máy tính trên toàn bot
/cal - Xem trạng thái /cal
Telegram menu đôi khi gửi \`/cal@TenBot on\` — bot tự bỏ phần \`@...\`.
/calon — tương đương \`/cal on\` (gõ dính chữ; mọi người tính được)
/caloff — tương đương \`/cal off\`
Hậu tố sau số: \`k\` hoặc \`n\` = nghìn, \`tr\` = triệu, \`tỷ\`/\`ty\` = tỷ. Ví dụ: \`5tr+10k\`, \`sqrt(16)+2*3\`
Tin định dạng giao dịch ngân hàng không dùng làm biểu thức.

**Commands - Pic2 (auto reply khi gửi ảnh, 👑 admin):**
/pic2 — Hướng dẫn Pic2 (gõ riêng lệnh này)
/pic2 on [groupId] [userId hoặc @username] [nội dung reply] — Thêm rule mới (cùng nhóm có thể nhiều rule, không ghi đè rule cũ)
/pic2 list — Liệt kê tất cả rule (mỗi dòng có # thứ tự và \`ruleId\`)
/pic2 list [groupId] — Chỉ các rule của nhóm đó
/pic2 off [groupId] hoặc /pic2 off all [groupId] — Xóa hết rule của nhóm
/pic2 off [groupId] [ruleId] — Xóa đúng một rule (copy \`ruleId\` từ tin bot trả lời sau \`on\` hoặc từ list)
/pic2 off [groupId] [số] — Xóa theo số # trong list (1, 2, …; nên \`/pic2 list\` lại sau khi đã xóa)

**Ví dụ Pic2:**
/pic2 on -1001234567890 @username Xin chào!
/pic2 on -1001234567890 123456789 Hello world!
/pic2 list
/pic2 list -1001234567890
/pic2 off -1001234567890 a1b2c3d4
/pic2 off -1001234567890 1
/pic2 off all -1001234567890

**Lưu ý Pic2:** chỉ chạy khi user gửi **ảnh** (không tính sticker). Nhiều rule cùng khớp một user → dùng rule **đầu tiên** trong list (một reply cho một tin ảnh).

**Commands - Copy hàng loạt (👑 admin, gõ trong nhóm/kênh đích):**
/copyall [thời gian] [id nguồn] — Copy lịch sử từ nhóm/kênh nguồn vào **chat đang gõ lệnh**. Thời gian: \`24h\`, \`7d\`, \`2w\` hoặc ngày \`YYYY-MM-DD\` (UTC 00:00). Một tham số là ID (số), một tham số là mốc thời gian (thứ tự tùy ý).
/newcopy [id nguồn] — Copy các tin **mới hơn** watermark lần copy gần nhất (sau khi đã chạy /copyall ít nhất một lần cho cặp nguồn + đích này).

**Giới hạn & lưu ý:** số tin tối đa mỗi lần quét/gửi cấu hình trong \`config.js\` (\`copyAllMaxCollect\`, \`copyAllMaxCopy\`) hoặc env \`COPYALL_MAX_COLLECT\` / \`COPYALL_MAX_COPY\`; mặc định 5000 / 3000. Có delay chống flood — tăng quá cao dễ FLOOD_WAIT. Một số loại (poll, v.v.) có thể chỉ forward. Album rất lớn có thể không gom đủ. Hết cap thì dùng /newcopy, không chạy lại /copyall cùng mốc.

**Lọc khi copy:** bỏ dòng caption/chữ có dấu hiệu quảng cáo hoặc cờ bạc (tên nhà cái, đăng ký nhận thưởng, link lạ, từ khóa tiếng Trung/emoji spam cờ bạc…). Tin chỉ chữ mà toàn nội dung lọc hết thì không gửi; forward giữ caption gốc nên có thể bỏ qua nếu caption toàn QC/cờ bạc. Tắt lọc: env \`COPY_POLICY_FILTER=0\`.

**Commands - Forward (Chuyển tiếp tự động):**
/setforward [groupA] [groupB] [trigger] - Thiết lập auto-forward
/removeforward [groupA] [groupB] [trigger] - Xóa rule forward
/listforward - Xem danh sách rules forward

**Commands - Forward2 (Chuyển tiếp toàn cầu):**
/setforward2 [groupDích] [trigger] - Thiết lập global forward
/removeforward2 [groupDích] [trigger] - Xóa rule forward2
/listforward2 - Xem danh sách rules forward2

**Cách sử dụng Forward:**
🔹 **Reply method:** Reply tin nhắn + gõ trigger
🔹 **Reaction method:** Admin react emoji trigger vào tin nhắn (👑 chỉ admin!)

**Khác biệt Forward vs Forward2:**
🔹 **Forward:** Nhóm A → Nhóm B (cụ thể, mọi user)
🔹 **Forward2:** Bất kỳ nhóm → Nhóm đích (toàn cầu, chỉ admin)

**Ví dụ Forward:**
/setforward -1001234567890 -987654321 📋
/setforward -1001234567890 -987654321 🔄
/setforward -1001234567890 -987654321 copy

**Ví dụ Forward2:**
/setforward2 -1001234567890 🌐
/setforward2 -987654321 global
/setforward2 -555666777 📡

**Commands - Admin:**
/ad @username - Thêm admin
/adlist - Xem danh sách admin
/adremove user_id - Xóa admin

**Commands - Khác:**
/cal - Máy tính toàn bot (👑 admin: /cal on | /cal on admin | /cal off; xem mục /cal phía trên)
/status - Xem thông tin chi tiết bot
/id - Xem ID nhóm hiện tại
/id (reply) - Xem ID của user được reply
/groups - Xem danh sách groups bot tham gia (admin only)
/pic2 - Hướng dẫn Pic2 (admin, xem thêm mục Pic2 phía trên)
/copyall - Copy lịch sử từ nguồn vào nhóm này (admin)
/newcopy - Copy tin mới sau watermark (admin)
/help2 hoặc /help 2 - Hiển thị hướng dẫn này (admin)

⚠️ **Lưu ý chung:** 
- Bot chỉ reply tin nhắn có đầy đủ thông tin giao dịch (chế độ /1)
- Auto-forward hỗ trợ albums (nhiều ảnh/video cùng lúc)
- Emoji triggers: 📋🔄⭐🎯💫🚀📤📥💬📸
    `.trim();

    const chunks = Utils.splitTelegramMessageChunks(helpMessage, 4000);
    for (let p = 0; p < chunks.length; p++) {
      try {
        await this.client.sendMessage(chatId, {
          message: chunks[p],
          ...(p === 0 ? { replyTo: messageId } : {}),
        });
      } catch (error) {
        Utils.log(
          `❌ Lỗi gửi /help2 phần ${p + 1}/${chunks.length}: ${error.message}`
        );
        break;
      }
      if (p < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  // Xử lý command /pic2
  async handlePic2Command(args, chatId, messageId) {
    if (args.length === 0) {
      const helpText = `
📸 **Pic2** (👑 admin — auto reply khi user gửi **ảnh**)

Mỗi \`/pic2 on\` **thêm** rule mới trong nhóm (không ghi đè). Sau khi thêm, bot gửi \`Rule ID\` — giữ để xóa từng rule.

**Lệnh**
/pic2 on [groupId] [userId hoặc @username] [nội dung reply]
/pic2 list  |  /pic2 list [groupId]
/pic2 off [groupId]  hoặc  /pic2 off all [groupId]  → xóa hết rule nhóm
/pic2 off [groupId] [ruleId]  → xóa một rule
/pic2 off [groupId] [số]  → xóa theo # trong list (1, 2, …)

**Ví dụ**
/pic2 on -1001234567890 @username Hello world!
/pic2 on -1001234567890 123456789 Xin chào!
/pic2 list
/pic2 list -1001234567890
/pic2 off -1001234567890 a1b2c3d4
/pic2 off -1001234567890 1
/pic2 off all -1001234567890

**Ghi chú:** Không tính sticker. Nhiều rule cùng user → rule **đầu tiên** trong list được dùng (một reply / một ảnh).
      `.trim();
      
      await this.sendReply(chatId, messageId, helpText);
      return;
    }

    const action = args[0].toLowerCase();

    switch (action) {
      case 'on':
        await this.handlePic2OnCommand(args.slice(1), chatId, messageId);
        break;
      
      case 'off':
        await this.handlePic2OffCommand(args.slice(1), chatId, messageId);
        break;
      
      case 'list':
        await this.handlePic2ListCommand(args.slice(1), chatId, messageId);
        break;
      
      default:
        await this.sendReply(chatId, messageId, '❗ Gõ /pic2 để xem hướng dẫn, hoặc: /pic2 on | off | list');
    }
  }

  // Xử lý /pic2 on
  async handlePic2OnCommand(args, chatId, messageId) {
    if (args.length < 3) {
      await this.sendReply(chatId, messageId, '❗ Sử dụng: /pic2 on [groupId] [userId/username] [message]');
      return;
    }

    const groupId = args[0];
    const targetUser = args[1];
    const replyMessage = args.slice(2).join(' ');

    try {
      // Validate groupId
      if (!groupId.match(/^-?\d+$/)) {
        await this.sendReply(chatId, messageId, '❌ Group ID không hợp lệ (phải là số)');
        return;
      }

      // Validate targetUser (userId hoặc username)
      let validUser = false;
      if (targetUser.startsWith('@')) {
        // Username format
        validUser = targetUser.length > 1;
      } else if (targetUser.match(/^\d+$/)) {
        // User ID format
        validUser = true;
      }

      if (!validUser) {
        await this.sendReply(chatId, messageId, '❌ User ID/Username không hợp lệ');
        return;
      }

      // Initialize pic2Settings if not exists
      if (!this.settings.pic2Settings) {
        this.settings.pic2Settings = {};
      }
      Utils.normalizePic2Settings(this.settings);
      if (!this.settings.pic2Settings[groupId]) {
        this.settings.pic2Settings[groupId] = [];
      }
      const rules = this.settings.pic2Settings[groupId];
      if (!Array.isArray(rules)) {
        await this.sendReply(chatId, messageId, '❌ Cấu hình pic2 group bị lỗi định dạng');
        return;
      }

      const ruleId = Utils.newPic2RuleId();
      rules.push({
        id: ruleId,
        enabled: true,
        targetUser: targetUser,
        replyMessage: replyMessage
      });

      Utils.saveSettings(this.settings);
      
      const userDisplay = targetUser.startsWith('@') ? targetUser : `ID: ${targetUser}`;
      const successMsg = `✅ Đã thêm rule pic2:\n📋 Group: \`${groupId}\`\n🆔 Rule ID: \`${ruleId}\`\n👤 User: ${userDisplay}\n💬 Message: "${replyMessage}"`;
      
      await this.sendReply(chatId, messageId, successMsg);
      Utils.log(`🟢 Pic2 thêm rule ${ruleId} cho group ${groupId}, user ${targetUser}`);

    } catch (error) {
      Utils.log(`❌ Lỗi khi bật pic2: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi cấu hình pic2');
    }
  }

  // Xử lý /pic2 off
  async handlePic2OffCommand(args, chatId, messageId) {
    if (args.length < 1) {
      await this.sendReply(chatId, messageId, '❗ Sử dụng: /pic2 off [groupId] | /pic2 off all [groupId] | /pic2 off [groupId] [ruleId|số]');
      return;
    }

    try {
      if (!this.settings.pic2Settings) {
        this.settings.pic2Settings = {};
      }
      Utils.normalizePic2Settings(this.settings);

      const isAll = args[0].toLowerCase() === 'all';
      let groupId;
      let selector;

      if (isAll) {
        if (args.length < 2) {
          await this.sendReply(chatId, messageId, '❗ Sử dụng: /pic2 off all [groupId]');
          return;
        }
        groupId = args[1];
      } else {
        groupId = args[0];
        selector = args.length >= 2 ? args[1] : null;
      }

      if (!groupId.match(/^-?\d+$/)) {
        await this.sendReply(chatId, messageId, '❌ Group ID không hợp lệ (phải là số)');
        return;
      }

      const rules = this.settings.pic2Settings[groupId];
      const hasRules = Array.isArray(rules) && rules.length > 0;

      if (isAll || selector === null) {
        if (!hasRules) {
          await this.sendReply(chatId, messageId, `❌ Không tìm thấy cấu hình pic2 cho group: \`${groupId}\``);
          return;
        }
        delete this.settings.pic2Settings[groupId];
        Utils.saveSettings(this.settings);
        await this.sendReply(chatId, messageId, `✅ Đã xóa toàn bộ pic2 cho group: \`${groupId}\``);
        Utils.log(`🔴 Pic2 xóa hết cho group ${groupId}`);
        return;
      }

      if (!hasRules) {
        await this.sendReply(chatId, messageId, `❌ Không tìm thấy cấu hình pic2 cho group: \`${groupId}\``);
        return;
      }

      let idx = rules.findIndex((r) => r.id === selector);
      if (idx === -1 && /^\d+$/.test(selector)) {
        const n = parseInt(selector, 10);
        if (n >= 1 && n <= rules.length) {
          idx = n - 1;
        }
      }

      if (idx === -1) {
        await this.sendReply(chatId, messageId, `❌ Không tìm thấy rule \`${selector}\` trong group \`${groupId}\``);
        return;
      }

      rules.splice(idx, 1);
      if (rules.length === 0) {
        delete this.settings.pic2Settings[groupId];
      }
      Utils.saveSettings(this.settings);
      await this.sendReply(chatId, messageId, `✅ Đã xóa rule pic2 trong group: \`${groupId}\``);
      Utils.log(`🔴 Pic2 xóa rule tại index ${idx} cho group ${groupId}`);

    } catch (error) {
      Utils.log(`❌ Lỗi khi tắt pic2: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi tắt pic2');
    }
  }

  // Xử lý /pic2 list [groupId]
  async handlePic2ListCommand(listArgs, chatId, messageId) {
    try {
      if (Utils.normalizePic2Settings(this.settings)) {
        Utils.saveSettings(this.settings);
      }

      if (!this.settings.pic2Settings || Object.keys(this.settings.pic2Settings).length === 0) {
        await this.sendReply(chatId, messageId, '📝 Chưa có cấu hình pic2 nào');
        return;
      }

      let entries = Object.entries(this.settings.pic2Settings);
      if (listArgs.length >= 1) {
        const filterGid = listArgs[0];
        if (!filterGid.match(/^-?\d+$/)) {
          await this.sendReply(chatId, messageId, '❌ Group ID không hợp lệ (phải là số)');
          return;
        }
        entries = entries.filter(([g]) => g === filterGid);
        if (entries.length === 0) {
          await this.sendReply(chatId, messageId, `📝 Không có rule pic2 cho group \`${filterGid}\``);
          return;
        }
      }

      let listMsg = '📸 **Danh sách Pic2 Settings**\n\n';
      let listedAny = false;

      for (const [groupId, rules] of entries) {
        if (!Array.isArray(rules) || rules.length === 0) {
          continue;
        }
        listedAny = true;
        listMsg += `**Group:** \`${groupId}\`\n`;
        rules.forEach((config, i) => {
          const status = config.enabled ? '🟢 BẬT' : '🔴 TẮT';
          const userDisplay = config.targetUser.startsWith('@') ? config.targetUser : `ID: ${config.targetUser}`;
          const rid = config.id || '(no id)';
          listMsg += `  **#${i + 1}** id: \`${rid}\` ${status}\n`;
          listMsg += `  **User:** ${userDisplay}\n`;
          listMsg += `  **Message:** "${config.replyMessage}"\n`;
        });
        listMsg += '\n';
      }

      if (!listedAny) {
        await this.sendReply(chatId, messageId, '📝 Chưa có cấu hình pic2 nào');
        return;
      }

      await this.sendReply(chatId, messageId, listMsg.trim());

    } catch (error) {
      Utils.log(`❌ Lỗi khi xem danh sách pic2: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi xem danh sách');
    }
  }

  // Xử lý command /id
  async handleIdCommand(chatId, messageId, originalMessage = null) {
    try {
      // Kiểm tra xem có phải là reply không
      if (originalMessage && originalMessage.replyTo) {
        // Đây là reply vào tin nhắn khác, lấy thông tin user được reply
        await this.handleUserIdCommand(chatId, messageId, originalMessage);
      } else {
        // Không phải reply, hiển thị thông tin chat/nhóm
        await this.handleChatIdCommand(chatId, messageId);
      }
    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý command /id: ${error.message}`);
      await this.sendReply(chatId, messageId, `❌ Có lỗi xảy ra khi lấy thông tin ID`);
    }
  }

  // Xử lý lệnh /id khi reply vào tin nhắn của user khác
  async handleUserIdCommand(chatId, messageId, originalMessage) {
    try {
      // Lấy tin nhắn được reply
      const replyToMsgId = originalMessage.replyTo.replyToMsgId;
      const messages = await this.client.getMessages(chatId, {
        ids: [replyToMsgId]
      });

      if (messages && messages.length > 0) {
        const repliedMessage = messages[0];
        const sender = repliedMessage.sender;
        
        if (sender) {
          let userInfo = `👤 **Thông tin User**\n\n`;
          userInfo += `🆔 User ID: \`${sender.id.toString()}\`\n`;
          
          // Tên người dùng
          if (sender.firstName) {
            let fullName = sender.firstName;
            if (sender.lastName) {
              fullName += ` ${sender.lastName}`;
            }
            userInfo += `📝 Tên: ${fullName}\n`;
          }
          
          // Username
          if (sender.username) {
            userInfo += `🔗 Username: @${sender.username}\n`;
          }
          
          // Phone (nếu có và public)
          if (sender.phone) {
            userInfo += `📞 Phone: +${sender.phone}\n`;
          }
          
          // Trạng thái
          if (sender.bot) {
            userInfo += `🤖 Bot: Có\n`;
          }
          
          if (sender.verified) {
            userInfo += `✅ Verified: Có\n`;
          }
          
          if (sender.premium) {
            userInfo += `⭐ Premium: Có\n`;
          }

          await this.sendReply(chatId, messageId, userInfo);
        } else {
          await this.sendReply(chatId, messageId, `❌ Không thể lấy thông tin người gửi tin nhắn được reply`);
        }
      } else {
        await this.sendReply(chatId, messageId, `❌ Không tìm thấy tin nhắn được reply`);
      }
    } catch (error) {
      Utils.log(`❌ Lỗi khi lấy thông tin user: ${error.message}`);
      await this.sendReply(chatId, messageId, `❌ Không thể lấy thông tin user được reply`);
    }
  }

  // Xử lý lệnh /id khi không reply (hiển thị thông tin chat)
  async handleChatIdCommand(chatId, messageId) {
    try {
      // Lấy thông tin về chat hiện tại
      const chat = await this.client.getEntity(chatId);
      
      let chatInfo = `🆔 **ID Chat hiện tại**\n\n`;
      chatInfo += `📋 Chat ID: \`${chatId.toString()}\`\n`;
      
      // Thêm thông tin chi tiết về chat nếu có thể
      if (chat.title) {
        chatInfo += `📝 Tên nhóm: ${chat.title}\n`;
      }
      
      if (chat.username) {
        chatInfo += `🔗 Username: @${chat.username}\n`;
      }
      
      // Xác định loại chat
      let chatType = 'Chat cá nhân';
      if (chat.broadcast) {
        chatType = 'Kênh (Channel)';
      } else if (chat.megagroup) {
        chatType = 'Siêu nhóm (Supergroup)';
      } else if (chat.title && !chat.megagroup) {
        chatType = 'Nhóm thường';
      }
      
      chatInfo += `📂 Loại: ${chatType}`;
      
      await this.sendReply(chatId, messageId, chatInfo);
      
    } catch (error) {
      Utils.log(`❌ Lỗi khi lấy thông tin chat: ${error.message}`);
      await this.sendReply(chatId, messageId, `❌ Không thể lấy thông tin chat\n\n📋 Chat ID: \`${chatId.toString()}\``);
    }
  }

  // ================= FORWARD COMMANDS HANDLERS =================

  // Xử lý command /setforward2 (forward từ bất kỳ nhóm nào đến 1 nhóm cụ thể)
  async handleSetForward2Command(args, chatId, messageId, originalMessage) {
    try {
      if (args.length < 2) {
        const helpText = `❗ **Cú pháp:**
/setforward2 [ID_nhóm_đích] [trigger]

**Chức năng:**
Khi admin reply trigger ở BẤT KỲ nhóm nào có userbot, tin nhắn sẽ được chuyển đến nhóm đích được set.

**Ví dụ Text Trigger:**
/setforward2 -1001234567890 global
/setforward2 -987654321 broadcast

**Ví dụ Emoji Trigger:**
/setforward2 -1001234567890 🌐
/setforward2 -987654321 📡

**Khác biệt với /setforward:**
- /setforward: Nhóm A → Nhóm B (cụ thể)  
- /setforward2: Bất kỳ nhóm → Nhóm đích (toàn cầu)`;
        
        await this.sendReply(chatId, messageId, helpText);
        return;
      }

      const destGroupId = args[0];
      const trigger = args[1].toLowerCase();

      // Validate Group ID
      if (!Utils.isValidGroupId(destGroupId)) {
        await this.sendReply(chatId, messageId, '❌ ID nhóm đích không hợp lệ (phải bắt đầu bằng -)');
        return;
      }

      // Lấy thông tin người tạo
      const sender = originalMessage?.sender;
      const createdBy = sender?.username ? `@${sender.username}` : 
                      sender?.firstName ? sender.firstName : 
                      'Unknown';

      // Thêm forward2 rule
      const result = Utils.addForward2Rule(this.settings, destGroupId, trigger, createdBy);
      
      if (result.success) {
        Utils.saveSettings(this.settings);
        
        // Lấy tên nhóm để hiển thị
        const destGroupInfo = await this.formatGroupInfo(destGroupId);
        
        const successMsg = `✅ **Đã thiết lập Forward2 (Global):**

🌐 **Từ:** Bất kỳ nhóm nào có userbot
📥 **Đến nhóm:** ${destGroupInfo}
🔤 **Trigger:** ${Utils.hasEmoji(trigger) ? trigger : `\`${trigger}\``}
👤 **Tạo bởi:** ${createdBy}

**Cách sử dụng:**
Admin reply vào tin nhắn bất kỳ và nhập ${Utils.hasEmoji(trigger) ? `emoji ${trigger}` : `"${trigger}"`} ở bất kỳ nhóm nào có userbot`;

        await this.sendReply(chatId, messageId, successMsg);
        Utils.log(`🟢 Forward2 rule added: ANY_GROUP -> ${destGroupId} (trigger: ${trigger})`);
      } else {
        await this.sendReply(chatId, messageId, `❌ ${result.message}`);
      }

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý /setforward2: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi thiết lập forward2 rule');
    }
  }

  // Xử lý command /removeforward2
  async handleRemoveForward2Command(args, chatId, messageId) {
    try {
      if (args.length < 2) {
        const helpText = `❗ **Cú pháp:**
/removeforward2 [ID_nhóm_đích] [trigger]

**Ví dụ:**
/removeforward2 -1001234567890 global`;
        
        await this.sendReply(chatId, messageId, helpText);
        return;
      }

      const destGroupId = args[0];
      const trigger = args[1].toLowerCase();

      // Xóa forward2 rule
      const result = Utils.removeForward2Rule(this.settings, destGroupId, trigger);
      
      if (result.success) {
        Utils.saveSettings(this.settings);
        
        const destGroupInfo = await this.formatGroupInfo(destGroupId);
        
        const successMsg = `✅ **Đã xóa Forward2 rule:**

📥 **Nhóm đích:** ${destGroupInfo}
🔤 **Trigger:** ${Utils.hasEmoji(trigger) ? trigger : `\`${trigger}\``}`;

        await this.sendReply(chatId, messageId, successMsg);
        Utils.log(`🔴 Forward2 rule removed: ANY_GROUP -> ${destGroupId} (trigger: ${trigger})`);
      } else {
        await this.sendReply(chatId, messageId, `❌ ${result.message}`);
      }

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý /removeforward2: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi xóa forward2 rule');
    }
  }

  // Xử lý command /listforward2
  async handleListForward2Command(chatId, messageId) {
    try {
      const activeRules = Utils.getActiveForward2Rules(this.settings);
      
      if (activeRules.length === 0) {
        await this.sendReply(chatId, messageId, '📝 Chưa có Forward2 rule nào được thiết lập.');
        return;
      }

      let message = '🌐 **Danh sách Forward2 rules (Global):**\n\n';
      
      for (let index = 0; index < activeRules.length; index++) {
        const rule = activeRules[index];
        const createdDate = Utils.formatDate(rule.createdTime);
        const triggerDisplay = Utils.hasEmoji(rule.trigger) ? rule.trigger : `\`${rule.trigger}\``;
        
        // Lấy tên nhóm đích
        const destGroupInfo = await this.formatGroupInfo(rule.destGroupId);
        
        message += `**${index + 1}.** 🌐 Từ: **Bất kỳ nhóm nào**\n`;
        message += `   📥 Đến: ${destGroupInfo}\n`;
        message += `   🔤 Trigger: ${triggerDisplay}\n`;
        message += `   👤 Tạo bởi: ${rule.createdBy}\n`;
        message += `   📅 Ngày tạo: ${createdDate}\n\n`;
      }

      await this.sendReply(chatId, messageId, message.trim());

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý /listforward2: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi xem danh sách forward2 rules');
    }
  }

  // Xử lý command /setforward
  async handleSetForwardCommand(args, chatId, messageId, originalMessage) {
    try {
      if (args.length < 3) {
        const helpText = `❗ **Cú pháp:**
/setforward [ID_nhóm_A] [ID_nhóm_B] [trigger]

**Ví dụ Text Trigger:**
/setforward -1001234567890 -987654321 forward
/setforward -1001111111111 -1002222222222 copy

**Ví dụ Emoji Trigger:**
/setforward -1001234567890 -987654321 📋
/setforward -1001111111111 -1002222222222 🔄
/setforward -1001111111111 -1002222222222 ⭐

**Chú ý:**
- ID nhóm phải bắt đầu bằng dấu "-"
- Trigger có thể là text hoặc emoji 
- Khi ai đó reply tin nhắn và nhập trigger, tin nhắn sẽ được tự động copy`;
        
        await this.sendReply(chatId, messageId, helpText);
        return;
      }

      const sourceGroupId = args[0];
      const destGroupId = args[1];
      const trigger = args[2].toLowerCase();

      // Validate Group IDs
      if (!Utils.isValidGroupId(sourceGroupId)) {
        await this.sendReply(chatId, messageId, '❌ ID nhóm nguồn không hợp lệ (phải bắt đầu bằng -)');
        return;
      }

      if (!Utils.isValidGroupId(destGroupId)) {
        await this.sendReply(chatId, messageId, '❌ ID nhóm đích không hợp lệ (phải bắt đầu bằng -)');
        return;
      }

      if (sourceGroupId === destGroupId) {
        await this.sendReply(chatId, messageId, '❌ Nhóm nguồn và nhóm đích không thể giống nhau');
        return;
      }

      // Lấy thông tin người tạo
      const sender = originalMessage?.sender;
      const createdBy = sender?.username ? `@${sender.username}` : 
                      sender?.firstName ? sender.firstName : 
                      'Unknown';

      // Thêm rule
      const result = Utils.addForwardRule(this.settings, sourceGroupId, destGroupId, trigger, createdBy);
      
      if (result.success) {
        Utils.saveSettings(this.settings);
        
        // Lấy tên nhóm để hiển thị
        const sourceGroupInfo = await this.formatGroupInfo(sourceGroupId);
        const destGroupInfo = await this.formatGroupInfo(destGroupId);
        
        const successMsg = `✅ **Đã thiết lập chuyển tiếp tự động:**

📤 **Từ nhóm:** ${sourceGroupInfo}
📥 **Đến nhóm:** ${destGroupInfo}
🔤 **Trigger:** ${Utils.hasEmoji(trigger) ? trigger : `\`${trigger}\``}
👤 **Tạo bởi:** ${createdBy}

**Cách sử dụng:**
Reply vào tin nhắn cần chuyển và nhập ${Utils.hasEmoji(trigger) ? `emoji ${trigger}` : `"${trigger}"`}`;

        await this.sendReply(chatId, messageId, successMsg);
        Utils.log(`🟢 Forward rule added: ${sourceGroupId} -> ${destGroupId} (trigger: ${trigger})`);
      } else {
        await this.sendReply(chatId, messageId, `❌ ${result.message}`);
      }

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý /setforward: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi thiết lập forward rule');
    }
  }

  // Xử lý command /removeforward
  async handleRemoveForwardCommand(args, chatId, messageId) {
    try {
      if (args.length < 3) {
        const helpText = `❗ **Cú pháp:**
/removeforward [ID_nhóm_A] [ID_nhóm_B] [trigger]

**Ví dụ:**
/removeforward -1001234567890 -987654321 forward`;
        
        await this.sendReply(chatId, messageId, helpText);
        return;
      }

      const sourceGroupId = args[0];
      const destGroupId = args[1];
      const trigger = args[2].toLowerCase();

      // Xóa rule
      const result = Utils.removeForwardRule(this.settings, sourceGroupId, destGroupId, trigger);
      
      if (result.success) {
        Utils.saveSettings(this.settings);
        
        const successMsg = `✅ **Đã xóa rule chuyển tiếp:**

📤 **Từ nhóm:** \`${sourceGroupId}\`
📥 **Đến nhóm:** \`${destGroupId}\`
🔤 **Trigger:** ${Utils.hasEmoji(trigger) ? trigger : `\`${trigger}\``}`;

        await this.sendReply(chatId, messageId, successMsg);
        Utils.log(`🔴 Forward rule removed: ${sourceGroupId} -> ${destGroupId} (trigger: ${trigger})`);
      } else {
        await this.sendReply(chatId, messageId, `❌ ${result.message}`);
      }

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý /removeforward: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi xóa forward rule');
    }
  }

  // Helper function để lấy tên nhóm từ ID
  async getGroupName(groupId) {
    try {
      const chat = await this.client.getEntity(groupId);
      return chat.title || 'Không có tên';
    } catch (error) {
      Utils.log(`⚠️ Không thể lấy tên nhóm ${groupId}: ${error.message}`);
      return 'Không xác định';
    }
  }

  // Helper function để format group info với tên
  async formatGroupInfo(groupId) {
    const groupName = await this.getGroupName(groupId);
    return `\`${groupId}\` | ${groupName}`;
  }

  // Xử lý command /listforward
  async handleListForwardCommand(chatId, messageId) {
    try {
      const activeRules = Utils.getActiveForwardRules(this.settings);
      
      if (activeRules.length === 0) {
        await this.sendReply(chatId, messageId, '📝 Chưa có rule chuyển tiếp nào được thiết lập.');
        return;
      }

      let message = '📋 **Danh sách rules chuyển tiếp tự động:**\n\n';
      
      for (let index = 0; index < activeRules.length; index++) {
        const rule = activeRules[index];
        const createdDate = Utils.formatDate(rule.createdTime);
        const triggerDisplay = Utils.hasEmoji(rule.trigger) ? rule.trigger : `\`${rule.trigger}\``;
        
        // Lấy tên nhóm cho source và destination
        const sourceGroupInfo = await this.formatGroupInfo(rule.sourceGroupId);
        const destGroupInfo = await this.formatGroupInfo(rule.destGroupId);
        
        message += `**${index + 1}.** 📤 Từ: ${sourceGroupInfo}\n`;
        message += `   📥 Đến: ${destGroupInfo}\n`;
        message += `   🔤 Trigger: ${triggerDisplay}\n`;
        message += `   👤 Tạo bởi: ${rule.createdBy}\n`;
        message += `   📅 Ngày tạo: ${createdDate}\n\n`;
      }

      await this.sendReply(chatId, messageId, message.trim());

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý /listforward: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi xem danh sách forward rules');
    }
  }

  // Xử lý command /groups
  async handleGroupsCommand(chatId, messageId) {
    try {
      Utils.log('🏢 Lấy danh sách groups...');
      
      // Lấy tất cả dialogs (chats) với limit cao hơn
      const dialogs = await this.client.getDialogs({ limit: 500 });
      
      // Filter chỉ groups và supergroups
      const groups = dialogs.filter(dialog => {
        const entity = dialog.entity;
        return entity.className === 'Chat' || entity.className === 'Channel';
      });
      
      if (groups.length === 0) {
        await this.sendReply(chatId, messageId, '❌ Không tìm thấy group nào');
        return;
      }

      // Chia groups thành chunks để tránh vượt quá giới hạn 4096 ký tự
      const chunkSize = 25; // Mỗi chunk 25 groups
      const chunks = [];
      
      for (let i = 0; i < groups.length; i += chunkSize) {
        chunks.push(groups.slice(i, i + chunkSize));
      }

      Utils.log(`📊 Tổng ${groups.length} groups, chia thành ${chunks.length} parts`);

      // Gửi header message
      const headerMsg = `🏢 **Tìm thấy ${groups.length} Groups/Channels**\n📄 Sẽ gửi ${chunks.length} tin nhắn\n\n⏳ Đang gửi...`;
      await this.sendReply(chatId, messageId, headerMsg);

      // Gửi từng chunk
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const partNumber = chunkIndex + 1;
        
        let groupsList = `📋 **Part ${partNumber}/${chunks.length}** (Groups ${chunkIndex * chunkSize + 1}-${Math.min((chunkIndex + 1) * chunkSize, groups.length)}):\n\n`;
        
        chunk.forEach((dialog, index) => {
          const entity = dialog.entity;
          const groupName = entity.title || 'Không có tên';
          const groupId = entity.id.toString();
          
          // Format group ID với prefix phù hợp
          let formattedId;
          if (entity.className === 'Channel') {
            formattedId = `-100${groupId}`;
          } else {
            formattedId = `-${groupId}`;
          }
          
          const globalIndex = chunkIndex * chunkSize + index + 1;
          groupsList += `${globalIndex}. **${groupName}**\n`;
          groupsList += `   ID: \`${formattedId}\`\n\n`;
        });
        
        // Delay nhỏ giữa các tin nhắn để tránh flood
        if (chunkIndex > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        await this.client.sendMessage(chatId, { message: groupsList.trim() });
      }
      
    } catch (error) {
      Utils.log(`❌ Lỗi khi lấy danh sách groups: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi khi lấy danh sách groups');
    }
  }

  // Xử lý command /ad (add admin)
  async handleAdminCommand(args, chatId, messageId, originalMessage) {
    try {
      // Chỉ owner hoặc admin hiện tại mới có thể add admin
      const senderId = originalMessage.senderId?.toString();
      if (!this.isOwnerOrAdmin(senderId)) {
        await this.sendReply(chatId, messageId, '❌ Chỉ admin mới có thể sử dụng lệnh này');
        return;
      }

      if (args.length === 0) {
        const helpText = `👑 **Admin Management:**

/ad @username - Thêm admin bằng username
/ad user_id - Thêm admin bằng user ID
/adlist - Xem danh sách admin
/adremove user_id - Xóa admin

**Ví dụ:**
/ad @john_doe
/ad 123456789`;
        await this.sendReply(chatId, messageId, helpText);
        return;
      }

      let targetUserId;
      const input = args[0];

      // Xử lý username (@username)
      if (input.startsWith('@')) {
        const username = input.substring(1);
        try {
          const user = await this.client.getEntity(username);
          targetUserId = user.id.toString();
        } catch (error) {
          await this.sendReply(chatId, messageId, `❌ Không tìm thấy user: ${input}`);
          return;
        }
      } 
      // Xử lý user ID
      else if (/^\d+$/.test(input)) {
        targetUserId = input;
      } else {
        await this.sendReply(chatId, messageId, '❌ Format không hợp lệ. Sử dụng @username hoặc user_id');
        return;
      }

      const result = Utils.addAdmin(this.settings, targetUserId);
      
      if (result.success) {
        Utils.saveSettings(this.settings);
        await this.sendReply(chatId, messageId, `✅ ${result.message}\n👤 User ID: \`${targetUserId}\``);
        Utils.log(`👑 Added admin: ${targetUserId} by ${senderId}`);
      } else {
        await this.sendReply(chatId, messageId, `❌ ${result.message}`);
      }

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý /ad: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi thêm admin');
    }
  }

  // Xử lý command /adlist
  async handleAdminListCommand(chatId, messageId) {
    try {
      const adminList = Utils.getAdminList(this.settings);
      
      if (adminList.length === 0) {
        await this.sendReply(chatId, messageId, '📝 Chưa có admin nào được thiết lập');
        return;
      }

      let message = `👑 **Danh sách Admin (${adminList.length}):**\n\n`;
      
      // Fetch user info for each admin
      for (let i = 0; i < adminList.length; i++) {
        const userId = adminList[i];
        try {
          const user = await this.client.getEntity(parseInt(userId));
          const firstName = user.firstName || '';
          const lastName = user.lastName || '';
          const username = user.username || '';
          
          let displayName = `${firstName} ${lastName}`.trim();
          if (!displayName) displayName = 'Unknown User';
          
          message += `${i + 1}. **${displayName}**\n`;
          if (username) {
            message += `   @${username}\n`;
          }
          message += `   ID: \`${userId}\`\n\n`;
          
        } catch (userError) {
          // Fallback if can't fetch user info
          message += `${i + 1}. **Unknown User**\n`;
          message += `   ID: \`${userId}\` (info not available)\n\n`;
          Utils.log(`⚠️ Không thể lấy thông tin user ${userId}: ${userError.message}`);
        }
      }

      await this.sendReply(chatId, messageId, message.trim());

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý /adlist: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi xem danh sách admin');
    }
  }

  // Xử lý command /adremove
  async handleAdminRemoveCommand(args, chatId, messageId) {
    try {
      if (args.length === 0) {
        await this.sendReply(chatId, messageId, '❌ Vui lòng nhập user ID để xóa\n\n**Ví dụ:** /adremove 123456789');
        return;
      }

      const targetUserId = args[0];
      
      if (!/^\d+$/.test(targetUserId)) {
        await this.sendReply(chatId, messageId, '❌ User ID phải là số');
        return;
      }

      const result = Utils.removeAdmin(this.settings, targetUserId);
      
      if (result.success) {
        Utils.saveSettings(this.settings);
        await this.sendReply(chatId, messageId, `✅ ${result.message}\n👤 User ID: \`${targetUserId}\``);
        Utils.log(`👑 Removed admin: ${targetUserId}`);
      } else {
        await this.sendReply(chatId, messageId, `❌ ${result.message}`);
      }

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý /adremove: ${error.message}`);
      await this.sendReply(chatId, messageId, '❌ Có lỗi xảy ra khi xóa admin');
    }
  }

  // Check if user is owner or admin (userId: chuỗi ID hoặc object tin nhắn có senderId)
  isOwnerOrAdmin(userId) {
    let uid = '';
    if (userId != null && typeof userId === 'object' && 'senderId' in userId) {
      uid = Utils.getMessageSenderUserId(userId);
    } else if (userId !== undefined && userId !== null) {
      uid = String(userId).trim();
    }
    if (!uid) return false;

    // Check admin list
    if (Utils.isAdmin(this.settings, uid)) {
      return true;
    }
    
    // First-time setup: if no admins exist, anyone can become admin
    const adminList = Utils.getAdminList(this.settings);
    if (adminList.length === 0) {
      Utils.log(`🏃‍♂️ First-time setup: Auto-adding first admin: ${uid}`);
      Utils.addAdmin(this.settings, uid);
      Utils.saveSettings(this.settings);
      return true;
    }

    return false;
  }

  // Kiểm tra và xử lý auto-forward message
  async checkAutoForwardMessage(message) {
    try {
      const messageText = message.message || message.text || '';
      if (!messageText.trim()) return;

      const chatId = message.chatId.toString();
      const trigger = Utils.normalizeTrigger(messageText);
      const senderId = message.senderId?.toString();

      // 1. Kiểm tra Forward rule thường trước (nhóm A → nhóm B)
      const rule = Utils.findForwardRule(this.settings, chatId, trigger);
      
      // 2. Kiểm tra Forward2 rule (bất kỳ nhóm → nhóm đích, chỉ admin)
      const forward2Rule = Utils.findForward2Rule(this.settings, trigger);
      
      // Nếu không có rule nào thì return
      if (!rule && !forward2Rule) return;
      
      // Nếu có forward2 rule nhưng user không phải admin thì chỉ xử lý forward thường
      let activeRule = rule;
      let isForward2 = false;
      
      if (forward2Rule && this.isOwnerOrAdmin(senderId)) {
        activeRule = forward2Rule;
        isForward2 = true;
      } else if (!rule) {
        // Nếu chỉ có forward2 rule mà user không phải admin thì return
        return;
      }

      // Lấy tin nhắn được reply
      const replyToMsgId = message.replyTo.replyToMsgId;
      const messages = await this.client.getMessages(chatId, {
        ids: [replyToMsgId]
      });

      if (!messages || messages.length === 0) {
        Utils.log(`❌ Không tìm thấy tin nhắn được reply`);
        return;
      }

      const originalMessage = messages[0];
      
      // Kiểm tra xem có thể copy tin nhắn không
      if (!Utils.canCopyMessage(originalMessage)) {
        await this.sendReply(message.chatId, message.id, 
          `❌ Loại tin nhắn này không được hỗ trợ để copy`);
        return;
      }

      // Tạo unique key để tránh duplicate auto-forward
      const forwardType = isForward2 ? 'forward2' : 'forward';
      const autoForwardKey = `${forwardType}_${chatId}_${replyToMsgId}_${trigger}`;
      if (this.processedMessages.has(autoForwardKey)) {
        return;
      }

      // Mark as processed
      this.processedMessages.set(autoForwardKey, Date.now());

      // Copy tin nhắn
      const result = await this.copyMessage(originalMessage, activeRule.destGroupId);
      
      if (result.success) {
        const messageType = Utils.getMessageType(originalMessage);
        const originalSender = originalMessage.sender?.username ? 
          `@${originalMessage.sender.username}` : 
          originalMessage.sender?.firstName || 'Unknown';
        
        const forwardPrefix = isForward2 ? '🌐 Forward2' : '🤖 Forward';
        Utils.log(`${forwardPrefix}: ${messageType} từ ${originalSender} (${chatId} -> ${activeRule.destGroupId}, trigger: ${trigger})`);
        
        // Thông báo thành công với thông tin album nếu có
        let successMessage = isForward2 ? `` : ``;
        
        if (result.albumSize) {
          successMessage += ``;
          if (result.method === 'forward') {
            successMessage += ` (forwarded album)`;
          } else if (result.method === 'sendFile') {
            successMessage += ` (sendFile method)`;
          } else if (result.fallback) {
            successMessage += ` (individual files)`;
          } else {
            successMessage += ` (true album)`;
          }
        }
        
        await this.sendReply(message.chatId, message.id, successMessage);
      } else {
        await this.sendReply(message.chatId, message.id, 
          `❌ Không thể tự động chuyển tiếp: ${result.error}`);
      }

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý auto-forward: ${error.message}`);
    }
  }

  // Kiểm tra và xử lý auto-forward reaction (chỉ admin)
  async checkAutoForwardReaction(reactionEvent, originalMessage, reactorUserId) {
    try {
      const chatId = originalMessage.chatId.toString();

      // Lấy reactions từ event
      const reactions = reactionEvent.reactions;
      if (!reactions || !reactions.recentReactions || reactions.recentReactions.length === 0) return;

      // Lọc reactions mới nhất (chỉ lấy reaction đầu tiên)
      const latestReaction = reactions.recentReactions[0];
      if (!latestReaction || !latestReaction.reaction) return;

      let reactionEmoji = '';
      if (latestReaction.reaction._ === 'ReactionEmoji') {
        reactionEmoji = latestReaction.reaction.emoticon;
      } else if (latestReaction.reaction.className === 'ReactionEmoji') {
        reactionEmoji = latestReaction.reaction.emoticon;  
      } else {
        // Skip custom emoji reactions for now
        Utils.log(`⚠️ Admin ${reactorUserId} used custom emoji - skipping`);
        return;
      }

      Utils.log(`🎯 Admin ${reactorUserId} reaction emoji: ${reactionEmoji} in chat ${chatId}`);

      // 1. Kiểm tra Forward rule thường trước (nhóm A → nhóm B)
      const rule = Utils.findForwardRule(this.settings, chatId, reactionEmoji);
      
      // 2. Kiểm tra Forward2 rule (bất kỳ nhóm → nhóm đích, chỉ admin)
      const forward2Rule = Utils.findForward2Rule(this.settings, reactionEmoji);
      
      // Nếu không có rule nào thì return
      if (!rule && !forward2Rule) {
        Utils.log(`❌ Không tìm thấy forward/forward2 rule cho emoji: ${reactionEmoji} trong chat ${chatId}`);
        return;
      }
      
      // Ưu tiên forward2 rule nếu admin, nếu không thì dùng forward thường
      let activeRule = rule;
      let isForward2 = false;
      
      if (forward2Rule) {
        activeRule = forward2Rule;
        isForward2 = true;
      } else if (!rule) {
        return;
      }

      const ruleType = isForward2 ? 'forward2' : 'forward';
      const sourceInfo = isForward2 ? 'ANY_GROUP' : activeRule.sourceGroupId;
      Utils.log(`✅ Tìm thấy ${ruleType} rule: ${sourceInfo} -> ${activeRule.destGroupId} với trigger: ${reactionEmoji} (triggered by admin ${reactorUserId})`);

      // Kiểm tra xem tin nhắn có thể copy không
      if (!Utils.canCopyMessage(originalMessage)) {
        Utils.log(`❌ Tin nhắn không thể copy: ${Utils.getMessageType(originalMessage)}`);
        return;
      }

      // Thực hiện copy message
      const forwardPrefix = isForward2 ? '🌐 Admin Forward2' : '🚀 Admin Forward';
      Utils.log(`${forwardPrefix}: ${reactionEmoji} từ ${chatId} đến ${activeRule.destGroupId} by ${reactorUserId}`);
      
      const result = await this.copyMessage(originalMessage, activeRule.destGroupId);
      if (result.success) {
        const reactionType = isForward2 ? 'global reaction' : 'reaction';
        let successMessage = `${isForward2 ? '🌐' : '🤖'} Admin ${reactorUserId} đã chuyển tiếp qua ${reactionType} ${reactionEmoji} đến nhóm \`${activeRule.destGroupId}\``;
        
        if (result.albumSize) {
          successMessage += `\n📸 Album: ${result.albumSize} items`;
          if (result.method === 'forward') {
            successMessage += ` (forwarded album)`;
          } else if (result.method === 'sendFile') {
            successMessage += ` (sendFile method)`;
          } else if (result.fallback) {
            successMessage += ` (individual files)`;
          } else {
            successMessage += ` (true album)`;
          }
        }

        Utils.log(`✅ ${successMessage}`);
        // Note: Không reply lại trong reaction để tránh spam
      } else {
        Utils.log(`❌ Admin ${reactorUserId} auto-forward reaction thất bại: ${result.error}`);
      }

    } catch (error) {
      Utils.log(`❌ Lỗi auto-forward reaction: ${error.message}`);
    }
  }

  // Lấy tất cả messages trong media group (album)
  async getMediaGroupMessages(chatId, groupedId, aroundMessageId) {
    try {
      // Check if groupedId is valid
      if (groupedId === undefined || groupedId === null) {
        Utils.log(`⚠️ Bỏ qua gom album: groupedId rỗng (${groupedId})`);
        return [];
      }

      // Lấy một range messages xung quanh message hiện tại để tìm tất cả messages cùng groupedId
      const messages = await this.client.getMessages(chatId, {
        limit: 20, // Lấy 20 messages xung quanh
        offsetId: aroundMessageId,
        addOffset: -10 // Lấy 10 tin nhắn trước và sau
      });

      // Filter những messages có cùng groupedId  
      const groupMessages = messages.filter(msg => 
        msg.groupedId && groupedId && msg.groupedId.toString() === groupedId.toString()
      );

      // Sắp xếp theo thứ tự id tăng dần (chronological order)
      groupMessages.sort((a, b) => a.id - b.id);

      Utils.log(`📸 Found ${groupMessages.length} messages in media group ${groupedId}`);
      return groupMessages;

    } catch (error) {
      Utils.log(`❌ Error getting media group messages: ${error.message}`);
      return []; // Return empty array on error
    }
  }

  // ================= COPYALL / NEWCOPY (bulk) =================

  parseFloodWaitSeconds(error) {
    if (!error) return null;
    if (typeof error.seconds === 'number') return error.seconds;
    const msg = String(error.errorMessage || error.message || '');
    const m = /FLOOD_WAIT_(\d+)/i.exec(msg);
    return m ? parseInt(m[1], 10) : null;
  }

  async invokeFloodSafe(fn, context = 'request') {
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const sec = this.parseFloodWaitSeconds(e);
        if (sec != null && sec >= 0) {
          Utils.log(`⏳ FloodWait ${sec}s (${context}), thử lại...`);
          await new Promise((r) => setTimeout(r, (sec + 1) * 1000));
          continue;
        }
        throw e;
      }
    }
    throw new Error(`Quá nhiều FloodWait khi ${context}`);
  }

  isServiceMessage(msg) {
    if (!msg) return true;
    if (msg.className === 'MessageService') return true;
    if (msg.action != null && !msg.media && !(msg.message || msg.text)) return true;
    return false;
  }

  getAlbumMaxId(msg, pool) {
    if (msg.groupedId == null) return msg.id;
    const g = String(msg.groupedId);
    let max = msg.id;
    for (const m of pool) {
      if (m.groupedId != null && String(m.groupedId) === g) {
        if (m.id > max) max = m.id;
      }
    }
    return max;
  }

  async collectCopyallMessages(sourcePeer, minDateSec, maxCollect) {
    const buf = [];
    if (typeof this.client.iterMessages === 'function') {
      for await (const msg of this.client.iterMessages(sourcePeer, {
        limit: maxCollect,
      })) {
        if (msg.date < minDateSec) break;
        buf.push(msg);
        if (buf.length >= maxCollect) break;
      }
      buf.reverse();
      return buf;
    }

    let offsetId = 0;
    while (buf.length < maxCollect) {
      const batch = await this.invokeFloodSafe(
        () => this.client.getMessages(sourcePeer, { limit: 100, offsetId }),
        'getMessages copyall'
      );
      if (!batch || batch.length === 0) break;
      let allOlder = true;
      for (const msg of batch) {
        if (msg.date >= minDateSec) {
          allOlder = false;
          buf.push(msg);
          if (buf.length >= maxCollect) break;
        }
      }
      if (allOlder) break;
      const minBatchId = Math.min(...batch.map((m) => m.id));
      if (minBatchId === offsetId && offsetId !== 0) break;
      offsetId = minBatchId;
      if (batch.length < 100) break;
    }
    buf.sort((a, b) => a.id - b.id);
    return buf;
  }

  async collectNewcopyMessages(sourcePeer, watermark, maxCollect) {
    const buf = [];
    const wm = Number(watermark) || 0;
    if (typeof this.client.iterMessages === 'function') {
      for await (const msg of this.client.iterMessages(sourcePeer, {
        minId: wm,
        limit: maxCollect,
      })) {
        buf.push(msg);
        if (buf.length >= maxCollect) break;
      }
      return this._finalizeNewcopyBuffer(buf, wm);
    }

    let offsetId = 0;
    while (buf.length < maxCollect) {
      const batch = await this.invokeFloodSafe(
        () =>
          this.client.getMessages(sourcePeer, {
            limit: 100,
            offsetId,
            minId: wm,
          }),
        'getMessages newcopy'
      );
      if (!batch || batch.length === 0) break;
      for (const msg of batch) {
        if (msg.id > wm) buf.push(msg);
      }
      const minBatchId = Math.min(...batch.map((m) => m.id));
      if (minBatchId === offsetId && offsetId !== 0) break;
      offsetId = minBatchId;
      if (batch.length < 100) break;
    }
    return this._finalizeNewcopyBuffer(buf, wm);
  }

  _finalizeNewcopyBuffer(buf, wm) {
    const seen = new Set();
    const out = [];
    for (const m of buf) {
      if (m.id <= wm || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  buildCopyLogicalList(sortedMessages) {
    const seenAlbum = new Set();
    const out = [];
    let skipped = 0;
    for (const msg of sortedMessages) {
      if (this.isServiceMessage(msg)) {
        skipped++;
        continue;
      }
      if (msg.groupedId != null) {
        const g = String(msg.groupedId);
        if (seenAlbum.has(g)) {
          skipped++;
          continue;
        }
        seenAlbum.add(g);
      }
      out.push(msg);
    }
    return { logical: out, skippedServiceOrAlbumDup: skipped };
  }

  async runBulkCopyJob({
    sourcePeer,
    destPeer,
    sortedMessages,
    watermarkKey,
    maxCopy,
    delayMs,
    progressEvery,
    progressMsgId,
  }) {
    const { logical, skippedServiceOrAlbumDup } = this.buildCopyLogicalList(sortedMessages);
    let copied = 0;
    let failed = 0;
    let skippedUnsupported = 0;
    let skippedPolicy = 0;
    let watermark = Number(this.settings.copyAllWatermark[watermarkKey]) || 0;

    const slice = logical.slice(0, maxCopy);
    const hitCap = logical.length > maxCopy;

    for (let i = 0; i < slice.length; i++) {
      const msg = slice[i];
      if (!Utils.canCopyMessage(msg)) {
        skippedUnsupported++;
        watermark = Math.max(watermark, this.getAlbumMaxId(msg, sortedMessages));
        continue;
      }
      try {
        const result = await this.invokeFloodSafe(
          () => this.copyMessage(msg, destPeer),
          'copyMessage'
        );
        if (result && result.success) {
          if (result.skippedPolicy) {
            skippedPolicy++;
          } else {
            copied++;
          }
          watermark = Math.max(
            watermark,
            this.getAlbumMaxId(msg, sortedMessages)
          );
        } else {
          failed++;
        }
      } catch (e) {
        Utils.log(`❌ Bulk copy lỗi tại msg ${msg.id}: ${e.message}`);
        failed++;
      }

      if (
        progressMsgId &&
        (copied + failed + skippedUnsupported + skippedPolicy) % progressEvery === 0
      ) {
        try {
          await this.client.editMessage(destPeer, {
            message: progressMsgId,
            text:
            `📋 Đang copy…\n` +
            `Đã gửi: ${copied} | Lỗi: ${failed} | Bỏ qua: ${skippedUnsupported} | QC/cờ bạc: ${skippedPolicy}\n` +
            `Tiến độ: ${i + 1}/${slice.length}`,
          });
        } catch (e) {
          Utils.log(`⚠️ Không sửa được tin tiến độ: ${e.message}`);
        }
      }

      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    this.settings.copyAllWatermark[watermarkKey] = watermark;
    Utils.saveSettings(this.settings);

    return {
      copied,
      failed,
      skippedUnsupported,
      skippedPolicy,
      skippedServiceOrAlbumDup,
      hitCap,
      totalLogical: logical.length,
      watermark,
    };
  }

  async handleCopyAllCommand(args, chatId, messageId, originalMessage) {
    const parsedArgs = Utils.parseCopyallArgs(args);
    if (parsedArgs.error) {
      await this.sendReply(chatId, messageId, `❌ ${parsedArgs.error}`);
      return;
    }
    const timeParsed = Utils.parseCopyTimeArg(parsedArgs.timeArg);
    if (timeParsed.error) {
      await this.sendReply(chatId, messageId, `❌ ${timeParsed.error}`);
      return;
    }

    const sourceId = parsedArgs.sourceId;
    const destId = chatId.toString();
    const key = Utils.makeCopyWatermarkKey(sourceId, destId);

    try {
      await this.client.getEntity(sourceId);
    } catch (e) {
      await this.sendReply(
        chatId,
        messageId,
        `❌ Không truy cập được nguồn \`${sourceId}\`: ${e.message}`
      );
      return;
    }

    const MAX_COLLECT = Math.max(1, Number(config.copyAllMaxCollect) || 5000);
    const MAX_COPY = Math.max(1, Number(config.copyAllMaxCopy) || 3000);
    const DELAY_MS = 150;
    const PROGRESS_EVERY = 25;

    const startMsg = await this.client.sendMessage(chatId, {
      message:
        `📋 Copyall nguồn \`${sourceId}\` → nhóm này\n` +
        `Mốc: ${parsedArgs.timeArg} (date ≥ ${timeParsed.minDateSec})\n` +
        `Đang thu thập tin (tối đa ${MAX_COLLECT})…`,
      replyTo: messageId,
    });

    (async () => {
      try {
        const sourcePeer = await this.client.getEntity(sourceId);
        const raw = await this.collectCopyallMessages(
          sourcePeer,
          timeParsed.minDateSec,
          MAX_COLLECT
        );
        await this.client.editMessage(chatId, {
          message: startMsg.id,
          text:
            `📋 Thu được ${raw.length} tin trong phạm vi. Đang copy (tối đa ${MAX_COPY}/lần)…`,
        });

        const summary = await this.runBulkCopyJob({
          sourcePeer,
          destPeer: chatId,
          sortedMessages: raw,
          watermarkKey: key,
          maxCopy: MAX_COPY,
          delayMs: DELAY_MS,
          progressEvery: PROGRESS_EVERY,
          progressMsgId: startMsg.id,
        });

        const capNote = summary.hitCap
          ? `\n⚠️ Còn tin chưa copy — dùng /newcopy cùng id nguồn (không chạy lại /copyall cùng mốc để tránh trùng).`
          : '';

        await this.client.editMessage(chatId, {
          message: startMsg.id,
          text:
            `✅ Copyall xong\n` +
            `Đã gửi: ${summary.copied} | Lỗi: ${summary.failed} | Không hỗ trợ: ${summary.skippedUnsupported} | QC/cờ bạc: ${summary.skippedPolicy}\n` +
            `Bỏ qua (service/trùng album): ${summary.skippedServiceOrAlbumDup}\n` +
            `Watermark: \`${summary.watermark}\`${capNote}`,
        });
      } catch (e) {
        Utils.log(`❌ copyall job: ${e.message}`);
        try {
          await this.client.editMessage(chatId, {
            message: startMsg.id,
            text: `❌ Copyall lỗi: ${e.message}`,
          });
        } catch (e2) {
          Utils.log(`❌ ${e2.message}`);
        }
      }
    })();
  }

  async handleNewCopyCommand(args, chatId, messageId, originalMessage) {
    if (!args || args.length < 1) {
      await this.sendReply(
        chatId,
        messageId,
        '❗ Dùng: /newcopy [id nguồn nhóm/kênh]'
      );
      return;
    }
    const sourceId = args[0].trim();
    if (!/^-?\d+$/.test(sourceId)) {
      await this.sendReply(chatId, messageId, '❌ ID nguồn phải là số');
      return;
    }
    const destId = chatId.toString();
    const key = Utils.makeCopyWatermarkKey(sourceId, destId);
    const prev = Number(this.settings.copyAllWatermark[key]) || 0;

    if (prev <= 0) {
      await this.sendReply(
        chatId,
        messageId,
        `❌ Chưa có watermark cho cặp nguồn/đích này. Chạy **/copyall** trước.`
      );
      return;
    }

    try {
      await this.client.getEntity(sourceId);
    } catch (e) {
      await this.sendReply(
        chatId,
        messageId,
        `❌ Không truy cập được nguồn \`${sourceId}\`: ${e.message}`
      );
      return;
    }

    const MAX_COLLECT = Math.max(1, Number(config.copyAllMaxCollect) || 5000);
    const MAX_COPY = Math.max(1, Number(config.copyAllMaxCopy) || 3000);
    const DELAY_MS = 150;
    const PROGRESS_EVERY = 25;

    const startMsg = await this.client.sendMessage(chatId, {
      message:
        `📋 Newcopy nguồn \`${sourceId}\` → nhóm này\n` +
        `Sau message id \`${prev}\`…`,
      replyTo: messageId,
    });

    (async () => {
      try {
        const sourcePeer = await this.client.getEntity(sourceId);
        const raw = await this.collectNewcopyMessages(
          sourcePeer,
          prev,
          MAX_COLLECT
        );
        await this.client.editMessage(chatId, {
          message: startMsg.id,
          text:
            `📋 Có ${raw.length} tin mới. Đang copy (tối đa ${MAX_COPY}/lần)…`,
        });

        const summary = await this.runBulkCopyJob({
          sourcePeer,
          destPeer: chatId,
          sortedMessages: raw,
          watermarkKey: key,
          maxCopy: MAX_COPY,
          delayMs: DELAY_MS,
          progressEvery: PROGRESS_EVERY,
          progressMsgId: startMsg.id,
        });

        const capNote = summary.hitCap
          ? `\n⚠️ Còn tin — chạy lại /newcopy ${sourceId}.`
          : '';

        await this.client.editMessage(chatId, {
          message: startMsg.id,
          text:
            `✅ Newcopy xong\n` +
            `Đã gửi: ${summary.copied} | Lỗi: ${summary.failed} | Không hỗ trợ: ${summary.skippedUnsupported} | QC/cờ bạc: ${summary.skippedPolicy}\n` +
            `Watermark: \`${summary.watermark}\`${capNote}`,
        });
      } catch (e) {
        Utils.log(`❌ newcopy job: ${e.message}`);
        try {
          await this.client.editMessage(chatId, {
            message: startMsg.id,
            text: `❌ Newcopy lỗi: ${e.message}`,
          });
        } catch (e2) {
          Utils.log(`❌ ${e2.message}`);
        }
      }
    })();
  }

  // Copy tin nhạn đa dạng
  async copyMessage(originalMessage, destChatId) {
    try {
      const rawText = originalMessage.message || originalMessage.text || '';

      if (Utils.shouldSkipTextOnlyCopyDueToPolicy(originalMessage)) {
        Utils.log('⏭️ Bỏ qua copy: tin chỉ chữ — nội dung QC/cờ bạc đã lọc hết');
        return { success: true, skippedPolicy: true };
      }

      const messageText = Utils.sanitizeCopyText(rawText);

      // ========== HANDLE MEDIA GROUPS (ALBUMS) ==========
      if (Utils.isMediaGroup(originalMessage)) {
        Utils.log(`📸 Detecting media group (album), getting all messages...`);
        
        // Lấy tất cả messages trong media group
        const groupMessages = await this.getMediaGroupMessages(
          originalMessage.chatId, 
          originalMessage.groupedId, 
          originalMessage.id
        );
        
        if (groupMessages.length > 1) {
          Utils.log(`📋 Copying album with ${groupMessages.length} items`);
          
          // Tạo array media files để send as album
          const mediaFiles = [];
          let albumCaption = '';
          
          for (const msg of groupMessages) {
            const msgText = msg.message || msg.text || '';
            if (msgText && !albumCaption) {
              albumCaption = msgText; // Lấy caption từ tin nhắn đầu tiên có text
            }
            
            // Collect media files
            if (msg.media) {
              if (msg.media.className === 'MessageMediaPhoto') {
                mediaFiles.push({
                  file: msg.media.photo,
                  type: 'photo'
                });
              } else if (msg.media.className === 'MessageMediaDocument') {
                mediaFiles.push({
                  file: msg.media.document,
                  type: 'document'
                });
              }
            }
          }

          albumCaption = Utils.sanitizeCopyText(albumCaption);
          
          if (mediaFiles.length > 0) {
            try {
              // Method 1: Send as true album using array of files
              const albumFiles = mediaFiles.map(media => media.file);
              
              await this.client.sendMessage(destChatId, {
                file: albumFiles, // Send array of files - creates true album
                message: albumCaption || '' // Album caption
              });
              
              Utils.log(`✅ Successfully sent album with ${mediaFiles.length} items as true album`);
              return { success: true, albumSize: mediaFiles.length };
              
            } catch (albumError) {
              Utils.log(`❌ True album send failed, trying forwardMessages method: ${albumError.message}`);
              
              try {
                if (Utils.shouldSkipForwardDueToCopyPolicy(originalMessage)) {
                  Utils.log('⏭️ Bỏ qua forward album: caption gốc là QC/cờ bạc');
                  return { success: true, skippedPolicy: true, albumSize: groupMessages.length };
                }
                // Method 2: Forward entire album as a group (preserves album structure)
                const messageIds = groupMessages.map(msg => msg.id);
                
                await this.client.forwardMessages(destChatId, {
                  messages: messageIds,
                  fromPeer: originalMessage.chatId
                });
                
                Utils.log(`✅ Successfully forwarded album with ${messageIds.length} items as true album`);
                return { success: true, albumSize: messageIds.length, method: 'forward' };
                
              } catch (forwardError) {
                Utils.log(`❌ forwardMessages failed, trying sendFile method: ${forwardError.message}`);
                
                try {
                  // Method 3: Use sendFile with multiple files
                  await this.client.sendFile(destChatId, albumFiles, {
                    caption: albumCaption || '',
                    forceDocument: false
                  });
                  
                  Utils.log(`✅ Successfully sent album using sendFile method`);
                  return { success: true, albumSize: mediaFiles.length, method: 'sendFile' };
                  
                } catch (sendFileError) {
                  Utils.log(`❌ sendFile failed, falling back to individual messages: ${sendFileError.message}`);
                  
                  // Method 4: Fallback to individual files with same timestamp to group them
                const timestamp = Date.now();
                
                for (let i = 0; i < mediaFiles.length; i++) {
                  const media = mediaFiles[i];
                  const isFirst = i === 0;
                  
                  await this.client.sendMessage(destChatId, {
                    file: media.file,
                    message: isFirst ? albumCaption : '', // Only caption on first item
                    scheduleDate: timestamp // Try to group by same timestamp
                  });
                  
                  // Minimal delay to maintain order
                  if (i < mediaFiles.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                  }
                }
                
                Utils.log(`✅ Album sent as individual files with grouping attempt`);
                return { success: true, albumSize: mediaFiles.length, fallback: true };
                }
              }
            }
          }
        }
        
        // Nếu chỉ có 1 message trong group hoặc không có media, xử lý như single message
        Utils.log(`📷 Single item in media group, processing as normal message`);
      }
      
      // ========== HANDLE SINGLE MESSAGES ==========
      
      // Copy tin nhắn văn bản
      if (messageText && !originalMessage.media) {
        await this.client.sendMessage(destChatId, { message: messageText });
        return { success: true };
      }
      
      // Copy tin nhắn có media
      if (originalMessage.media) {
        const mediaType = originalMessage.media.className;
        
        switch (mediaType) {
          case 'MessageMediaPhoto':
            await this.client.sendMessage(destChatId, {
              file: originalMessage.media.photo,
              message: messageText || ''
            });
            break;
            
          case 'MessageMediaDocument':
            await this.client.sendMessage(destChatId, {
              file: originalMessage.media.document,
              message: messageText || ''
            });
            break;
            
          default:
            if (Utils.shouldSkipForwardDueToCopyPolicy(originalMessage)) {
              Utils.log('⏭️ Bỏ qua forward: caption gốc là QC/cờ bạc');
              return { success: true, skippedPolicy: true };
            }
            await this.client.forwardMessages(destChatId, {
              messages: [originalMessage.id],
              fromPeer: originalMessage.chatId
            });
        }
        
        return { success: true };
      }
      
      if (Utils.shouldSkipForwardDueToCopyPolicy(originalMessage)) {
        Utils.log('⏭️ Bỏ qua forward: caption gốc là QC/cờ bạc');
        return { success: true, skippedPolicy: true };
      }
      await this.client.forwardMessages(destChatId, {
        messages: [originalMessage.id],
        fromPeer: originalMessage.chatId
      });
      
      return { success: true };
      
    } catch (error) {
      Utils.log(`❌ Copy message error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ================= PIC2 FUNCTIONS =================

  // Kiểm tra và xử lý pic2 message
  async checkPic2Message(message) {
    try {
      // Kiểm tra có pic2Settings không
      if (!this.settings.pic2Settings || Object.keys(this.settings.pic2Settings).length === 0) {
        return;
      }

      const chatId = message.chatId.toString();
      const raw = this.settings.pic2Settings[chatId];
      const rules = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && raw.targetUser != null
          ? [raw]
          : [];

      if (rules.length === 0) {
        return;
      }

      // Kiểm tra tin nhắn có hình ảnh không
      if (!Utils.hasPhoto(message)) {
        return;
      }

      // Lấy thông tin sender
      const sender = message.sender;
      if (!sender) {
        return;
      }

      const pic2Config = rules.find(
        (r) => r && r.enabled && Utils.isTargetUser(sender, r.targetUser)
      );
      if (!pic2Config) {
        return;
      }

      // Tạo unique key để tránh duplicate
      const pic2Key = `pic2_${chatId}_${message.id}`;
      
      // Kiểm tra đã process chưa
      if (this.processedMessages.has(pic2Key)) {
        return;
      }

      // Mark as processed
      this.processedMessages.set(pic2Key, Date.now());

      // Reply với message đã cấu hình
      await this.client.sendMessage(message.chatId, {
        message: pic2Config.replyMessage,
        replyTo: message.id
      });

      const userDisplay = sender.username ? `@${sender.username}` : `ID: ${sender.id}`;
      Utils.log(`📸 Pic2 reply: ${userDisplay} gửi hình trong group ${chatId} -> reply: "${pic2Config.replyMessage}"`);

    } catch (error) {
      Utils.log(`❌ Lỗi khi xử lý pic2: ${error.message}`);
    }
  }

  // Helper để send reply
  async sendReply(chatId, messageId, text) {
    try {
      await this.client.sendMessage(chatId, {
        message: text,
        replyTo: messageId
      });
    } catch (error) {
      Utils.log(`❌ Lỗi khi send reply: ${error.message}`);
    }
  }

  // Kiểm tra instance khác
  checkSingleInstance() {
    const fs = require('fs');
    const pidFile = './bot.pid';
    
    try {
      if (fs.existsSync(pidFile)) {
        const oldPid = fs.readFileSync(pidFile, 'utf8').trim();
        
        // Kiểm tra nếu process cũ vẫn đang chạy
        try {
          process.kill(oldPid, 0); // Check if process exists
          Utils.log(`⚠️  Phát hiện bot khác đang chạy (PID: ${oldPid})`);
          Utils.log('🛑 Vui lòng dừng bot cũ trước khi chạy bot mới');
          process.exit(1);
        } catch (e) {
          // Process không tồn tại, có thể xóa file cũ
          Utils.log('🧹 Dọn dệp PID file cũ');
          fs.unlinkSync(pidFile);
        }
      }
      
      // Tạo PID file mới
      fs.writeFileSync(pidFile, process.pid.toString());
      Utils.log(`📝 Tạo PID file: ${process.pid}`);
      
    } catch (error) {
      Utils.log(`❌ Lỗi kiểm tra instance: ${error.message}`);
    }
  }

  // Cleanup khi thoát
  cleanup() {
    const fs = require('fs');
    const pidFile = './bot.pid';
    
    try {
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
        Utils.log('🧹 Đã xóa PID file');
      }
    } catch (error) {
      Utils.log(`❌ Lỗi cleanup: ${error.message}`);
    }
  }

  // Khởi chạy bot
  async start() {
    try {
      Utils.log('🚀 Khởi động Bank Transaction UserBot...');
      
      // Kiểm tra single instance
      this.checkSingleInstance();
      
      // Khởi tạo client
      const clientInitialized = await this.initializeClient();
      if (!clientInitialized) {
        throw new Error('Không thể khởi tạo Telegram client');
      }

      // Đăng ký event handlers
      this.setupEventHandlers();

      // Get thông tin user
      const me = await this.client.getMe();
      Utils.log(`👤 Đăng nhập như: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no_username'})`);

      this.isRunning = true;
      Utils.log('✅ UserBot đã sẵn sàng hoạt động!');
      Utils.log('📝 Admin: gõ /help2 để xem hướng dẫn đầy đủ');
      Utils.log(`🔄 Duplicate protection: ACTIVE`);
      Utils.log(`📊 Process ID: ${process.pid}`);

      // Keep alive
      while (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      Utils.log(`❌ Lỗi khi khởi chạy bot: ${error.message}`);
      this.cleanup();
      process.exit(1);
    }
  }

  // Dừng bot
  stop() {
    Utils.log('🛑 Đang dừng bot...');
    this.isRunning = false;
    if (this.client) {
      this.client.disconnect();
    }
    this.cleanup();
  }
}

// Khởi chạy bot
const bot = new BankTransactionUserbot();

// Handle process signals
process.on('SIGINT', () => {
  Utils.log('📤 Nhận tín hiệu SIGINT, đang dừng bot...');
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  Utils.log('📤 Nhận tín hiệu SIGTERM, đang dừng bot...');
  bot.stop();
  process.exit(0);
});

// Bắt lỗi không được handle
process.on('unhandledRejection', (reason, promise) => {
  Utils.log('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  Utils.log('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Start bot
bot.start(); 