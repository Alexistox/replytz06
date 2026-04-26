const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

class Utils {
  // Load settings từ file
  static loadSettings() {
    try {
      if (fs.existsSync(config.settingsFile)) {
        const data = fs.readFileSync(config.settingsFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Lỗi khi load settings:', error);
    }
    
    // Return default settings nếu không load được
    return { ...config.defaultSettings };
  }

  // Save settings vào file
  static saveSettings(settings) {
    try {
      fs.writeFileSync(config.settingsFile, JSON.stringify(settings, null, 2));
      return true;
    } catch (error) {
      console.error('Lỗi khi save settings:', error);
      return false;
    }
  }

  // Kiểm tra xem tin nhắn có match pattern giao dịch ngân hàng không
  static isTransactionMessage(messageText) {
    if (!messageText) return false;

    // Tiếng Việt: đủ 4 trường (Tiền vào / Tài khoản / Lúc / Nội dung CK)
    const vnPatterns = [
      /Tiền vào:\s*\+[\d,]+\s*đ/i,
      /Tài khoản:\s*\d+\s*tại\s*\w+/i,
      /Lúc:\s*\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}:\d{2}/i,
      /Nội dung CK:/i,
    ];

    // Tiếng Trung (SMS/ngân hàng): 入款 / 账户 / 时间 / 备注 — hỗ trợ : hoặc ：
    const cnPatterns = [
      /入款[：:\uFF1A]\s*[+＋]?[\d,，．.\uFF0C]+\s*(?:元|块|CNY|￥)?/u,
      /账户[：:\uFF1A]\s*[\d\s*＊xXＸ\-\u2010‐]{4,}/u,
      /时间[：:\uFF1A]\s*(?:\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}(?::\d{2})?)/u,
      /备注[：:\uFF1A]/u,
    ];

    const vnOk = vnPatterns.every((p) => p.test(messageText));
    const cnOk = cnPatterns.every((p) => p.test(messageText));
    return vnOk || cnOk;
  }

  // Parse command từ tin nhắn (bỏ @BotUsername sau lệnh — Telegram hay gửi /cal@bot on)
  static parseCommand(messageText) {
    if (!messageText || !messageText.startsWith('/')) return null;

    const parts = messageText.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;

    let command = parts[0].toLowerCase();
    const at = command.indexOf('@');
    if (at !== -1) {
      command = command.slice(0, at);
    }

    return {
      command,
      args: parts.slice(1),
    };
  }

  /** Lấy user ID người gửi (chuỗi) từ tin GramJS — ổn định hơn senderId?.toString() khi senderId là object/Long */
  static getMessageSenderUserId(message) {
    if (!message) return '';
    const sid = message.senderId;
    if (sid == null) return '';
    if (typeof sid === 'bigint') return sid.toString();
    if (typeof sid === 'number') return String(sid);
    if (typeof sid === 'string') return sid.trim();
    if (typeof sid === 'object') {
      if (sid.userId != null) {
        return Utils.getMessageSenderUserId({ senderId: sid.userId });
      }
      if (typeof sid.valueOf === 'function') {
        try {
          const v = sid.valueOf();
          if (v !== sid) return Utils.getMessageSenderUserId({ senderId: v });
        } catch (_e) {
          /* ignore */
        }
      }
    }
    try {
      const t = String(sid).trim();
      return t && !t.startsWith('[object ') ? t : '';
    } catch (_e) {
      return '';
    }
  }

  // Log với timestamp
  static log(message) {
    const timestamp = new Date().toLocaleString('vi-VN');
    console.log(`[${timestamp}] ${message}`);
  }

  // Format số tiền
  static formatAmount(text) {
    const match = text.match(/\+?([\d,]+)\s*đ/);
    return match ? match[1] : null;
  }

  // Extract account info
  static extractAccountInfo(text) {
    const accountMatch = text.match(/Tài khoản:\s*(\d+)\s*tại\s*(\w+)/i);
    const timeMatch = text.match(/Lúc:\s*(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}:\d{2})/i);
    const contentMatch = text.match(/Nội dung CK:\s*(.+)/i);

    return {
      account: accountMatch ? accountMatch[1] : null,
      bank: accountMatch ? accountMatch[2] : null,
      time: timeMatch ? timeMatch[1] : null,
      content: contentMatch ? contentMatch[1].trim() : null
    };
  }

  // Kiểm tra tin nhắn có hình ảnh không
  static hasPhoto(message) {
    if (!message) return false;
    
    // Kiểm tra message có media không
    if (message.media) {
      // Kiểm tra các loại media chứa hình ảnh
      if (message.media.className === 'MessageMediaPhoto') {
        return true;
      }
      
      // Kiểm tra document (có thể là sticker, GIF, hoặc file hình ảnh)
      if (message.media.className === 'MessageMediaDocument') {
        const document = message.media.document;
        if (document && document.mimeType) {
          // Kiểm tra MIME type của hình ảnh
          return document.mimeType.startsWith('image/');
        }
      }
    }
    
    return false;
  }

  // Kiểm tra user match với target (username hoặc user ID)
  static isTargetUser(sender, targetUser) {
    if (!sender || !targetUser) return false;
    
    // Kiểm tra username
    if (targetUser.startsWith('@')) {
      const username = targetUser.slice(1); // Remove @
      return sender.username && sender.username.toLowerCase() === username.toLowerCase();
    }
    
    // Kiểm tra user ID
    if (targetUser.match(/^\d+$/)) {
      return sender.id && sender.id.toString() === targetUser;
    }
    
    return false;
  }

  // =================  FORWARD RULES FUNCTIONS =================

  // Thêm forward rule mới
  static addForwardRule(settings, sourceGroupId, destGroupId, trigger, createdBy) {
    if (!settings.forwardRules) {
      settings.forwardRules = [];
    }

    // Normalize trigger (chỉ lowercase cho text, giữ nguyên emoji)
    const normalizedTrigger = Utils.normalizeTrigger(trigger);

    // Kiểm tra rule đã tồn tại chưa
    const existingRule = settings.forwardRules.find(rule => 
      rule.sourceGroupId === sourceGroupId && 
      rule.destGroupId === destGroupId && 
      rule.trigger === normalizedTrigger
    );
    
    if (existingRule) {
      return { success: false, message: 'Rule đã tồn tại!' };
    }
    
    // Thêm rule mới
    const newRule = {
      sourceGroupId: sourceGroupId,
      destGroupId: destGroupId,
      trigger: normalizedTrigger,
      createdBy: createdBy,
      createdTime: new Date().toISOString(),
      status: "active"
    };
    
    settings.forwardRules.push(newRule);
    return { success: true, rule: newRule };
  }

  // Xóa forward rule
  static removeForwardRule(settings, sourceGroupId, destGroupId, trigger) {
    if (!settings.forwardRules) {
      return { success: false, message: 'Không tìm thấy rule nào!' };
    }

    const normalizedTrigger = Utils.normalizeTrigger(trigger);
    
    const index = settings.forwardRules.findIndex(rule => 
      rule.sourceGroupId === sourceGroupId && 
      rule.destGroupId === destGroupId && 
      rule.trigger === normalizedTrigger
    );
    
    if (index !== -1) {
      const removedRule = settings.forwardRules[index];
      settings.forwardRules.splice(index, 1);
      return { success: true, rule: removedRule };
    }
    
    return { success: false, message: 'Không tìm thấy rule này!' };
  }

  // Tìm forward rule phù hợp
  static findForwardRule(settings, sourceGroupId, trigger) {
    if (!settings.forwardRules) {
      return null;
    }

    const normalizedTrigger = Utils.normalizeTrigger(trigger);

    return settings.forwardRules.find(rule => 
      rule.sourceGroupId === sourceGroupId && 
      rule.trigger === normalizedTrigger && 
      rule.status === "active"
    );
  }

  // Lấy tất cả active forward rules
  static getActiveForwardRules(settings) {
    if (!settings.forwardRules) {
      return [];
    }

    return settings.forwardRules.filter(rule => rule.status === "active");
  }

  // =================  MESSAGE COPY FUNCTIONS =================

  // Xác định loại tin nhắn
  static getMessageType(message) {
    if (!message) return "unknown";
    
    // Kiểm tra xem có phải media group (album) không
    if (message.groupedId) {
      if (message.photo) return "album ảnh";
      if (message.video) return "album video";
      if (message.document) return "album file";
      return "album media";
    }
    
    if (message.photo) return "ảnh";
    if (message.video) return "video";
    if (message.document) return "file";
    if (message.audio) return "audio";
    if (message.voice) return "voice message";
    if (message.sticker) return "sticker";
    if (message.animation) return "animation";
    if (message.text || message.message) return "văn bản";
    
    return "nội dung khác";
  }

  // Kiểm tra xem tin nhắn có thể copy được không
  static canCopyMessage(message) {
    if (!message) return false;
    
    // GramJS: thường có .media; bot cũ kiểm tra .photo/.video từ API khác
    return !!(
      message.text ||
      message.message ||
      message.media ||
      message.groupedId ||
      message.photo ||
      message.video ||
      message.document ||
      message.audio ||
      message.voice ||
      message.sticker ||
      message.animation
    );
  }

  // Kiểm tra xem tin nhắn có phải media group (album) không
  // Lưu ý: GramJS đôi khi có groupedId: null — null !== undefined nên trước đây bị nhầm là album → "Invalid groupedId: null"
  static isMediaGroup(message) {
    if (!message) return false;
    const g = message.groupedId;
    return g !== undefined && g !== null;
  }

  // Kiểm tra loại media trong group
  static getMediaGroupType(message) {
    if (!Utils.isMediaGroup(message)) return null;
    
    if (message.photo) return 'photo';
    if (message.video) return 'video';
    if (message.document) return 'document';
    
    // Check by media class name if direct properties not available
    if (message.media) {
      if (message.media.className === 'MessageMediaPhoto') return 'photo';
      if (message.media.className === 'MessageMediaDocument') {
        // Could be video, document, or other file type
        return 'document';
      }
    }
    
    return 'mixed';
  }

  /** Tắt bộ lọc: COPY_POLICY_FILTER=0 hoặc false */
  static isCopyPolicyFilterEnabled() {
    const v = process.env.COPY_POLICY_FILTER;
    return v !== '0' && v !== 'false';
  }

  static _normalizeForPolicyMatch(s) {
    if (!s || typeof s !== 'string') return '';
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd');
  }

  /** Chuỗi con (Latin/VN): nếu một dòng caption chứa → bỏ cả dòng khi copy */
  static getCopyPolicyLineSubstrings() {
    return [
      'casino', 'slot game', 'game slot', 'no hu', 'nổ hũ', 'nohu', 'tai xiu', 'tài xỉu',
      'xoc dia', 'xóc đĩa', 'ca do', 'cá độ', 'ca cuoc', 'cá cược', 'keo nha', 'kèo nhà',
      'kubet', 'jun88', 'hi88', 'shbet', 'fb88', '789bet', 'f8bet', 'debet', 'ae88',
      'm88.com', 'w88', 'vwin', 'bk8', 'cmd368', '188bet', '12bet', 'letou',
      'dang ky nhan', 'đăng ký nhận', 'nap lan dau', 'nạp lần đầu', 'hoan tra', 'hoàn trả',
      'tang thuong', 'tặng thưởng', 'giftcode', 'gift code', 'link dang ky', 'link đăng ký',
      'game bai', 'game bài', 'baccarat', 'poker online', 'xổ số online', 'xo so online',
      'quang cao', 'quảng cáo', '#ad', 'sponsored', 'affiliate',
      'nhan thuong mien phi', 'nhận thưởng miễn phí', 'uu dai', 'ưu đãi khủng',
      'choi ngay', 'chơi ngay', 'dang ky ngay', 'đăng ký ngay', 'telegram bot game',
    ];
  }

  /**
   * Tiếng Trung (giản thể/phồn thể thường gặp) + từ la tinh trong spam cờ bạc TQ
   * So khớp trực tiếp trên chuỗi gốc (không bỏ dấu CJK).
   */
  static getCopyPolicyChineseSubstrings() {
    return [
      '博彩', '娱乐城', '线上娱乐', '真人娱乐', '电子真人', '体育真人', '真人盘',
      '赌场', '实体赌场', '线上下注', '线上博彩', '华人博彩', '博彩娱乐', '博彩平台',
      '出款', '提款', '提现', '秒出', '秒出款', '秒提款', '不限提款', '提款无上限',
      '注册就送', '注册送', '神秘彩金', '首存', '存款送', '存款天天送', '大派送',
      '福利拉满', '全网首发', '品牌铸就', '耗资百', '耗资10亿', '耗资10亿美金',
      '行业第一', '业界龙头', '顶级品牌', '全球布局', '娱乐造富', '无惧爆庄',
      '百亿任提', '华人专属', '包出款', '零审核', '0审核', '相信品牌', '值得信赖',
      '老品牌', '创造人生', '新财富', '联合双担保', '钱庄', '每日亏损', '每日返',
      '实力U台', 'U台', '柬埔寨', '东南亚', '亚太', 'PG集团', '8cc集团', 'QSTY',
      'Y3国际', 'N1国际', '2028体育', '汉城出海', '娱乐首选', '豪赌', '爆大奖',
      '提款次数', '提款额度', '全球顶级华人', '百家乐', '电子百家乐',
      '相信品牌的力量', '娱乐城点击', '最优质的博彩', '长期储备资金',
      '集团耗资', '打造全网最顶级', '线上娱乐城', '博彩娱乐城',
    ];
  }

  static countCjkIdeographs(line) {
    if (!line) return 0;
    const m = line.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    return m ? m.length : 0;
  }

  /**
   * Heuristic: dòng có nhiều chữ Hán + mẫu quảng cáo cờ bạc (khối【】, domain + từ khóa…)
   */
  static lineMatchesChineseGamblingHeuristic(line) {
    const cjk = Utils.countCjkIdeographs(line);
    if (cjk < 6) return false;

    const gamblingChars = /[博彩赌彩娱城金款注盘提送注册银亿萬万U台资]/.test(line);
    if (cjk >= 8 && gamblingChars && /【[^】]{8,}】/.test(line)) {
      return true;
    }

    if (cjk >= 10 && /\.(com|net|vip|cc|bet|top|org)\b/i.test(line) && gamblingChars) {
      return true;
    }

    if (cjk >= 14 && /(国际|集团|平台|品牌|实力|全球|顶级|专属)/.test(line) && gamblingChars) {
      return true;
    }

    if (cjk >= 6 && /(欢迎加入|点击导航|联系人：|客服)/.test(line) && gamblingChars) {
      return true;
    }

    return false;
  }

  static lineMatchesChineseCopyBlacklist(line) {
    if (!line) return false;
    if (Utils.getCopyPolicyChineseSubstrings().some((kw) => line.includes(kw))) {
      return true;
    }
    if (Utils.lineMatchesChineseGamblingHeuristic(line)) {
      return true;
    }
    return false;
  }

  static lineMatchesCopyPolicyBlacklist(line) {
    if (!line || !Utils.isCopyPolicyFilterEnabled()) return false;
    if (Utils.lineMatchesChineseCopyBlacklist(line)) {
      return true;
    }
    const n = Utils._normalizeForPolicyMatch(line);
    if (!n) return false;
    if (/https?:\/\/[^\s]*(?:kubet|jun88|hi88|shbet|fb88|789bet|f8bet|casino|88bet|debet|bk8|cmd368)[^\s]*/i.test(line)) {
      return true;
    }
    return Utils.getCopyPolicyLineSubstrings().some((kw) =>
      n.includes(Utils._normalizeForPolicyMatch(kw))
    );
  }

  /** Loại bỏ dòng chứa QC/cờ bạc; thu gọn khoảng trắng */
  static sanitizeCopyText(text) {
    if (!text || typeof text !== 'string') return '';
    if (!Utils.isCopyPolicyFilterEnabled()) return text;
    const lines = text.split(/\n/);
    const kept = lines.filter((line) => !Utils.lineMatchesCopyPolicyBlacklist(line));
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Forward giữ nguyên caption gốc — bỏ qua nếu toàn bộ chữ là QC/cờ bạc (đã lọc hết) */
  static shouldSkipForwardDueToCopyPolicy(message) {
    if (!message || !Utils.isCopyPolicyFilterEnabled()) return false;
    const raw = (message.message || message.text || '').trim();
    if (raw.length < 8) return false;
    const cleaned = Utils.sanitizeCopyText(raw);
    return cleaned.length === 0;
  }

  /** Tin chỉ chữ mà sau lọc không còn nội dung → không gửi */
  static shouldSkipTextOnlyCopyDueToPolicy(message) {
    if (!message || !Utils.isCopyPolicyFilterEnabled()) return false;
    if (message.media || message.groupedId != null) return false;
    const raw = (message.message || message.text || '').trim();
    if (raw.length < 6) return false;
    return Utils.sanitizeCopyText(raw).length === 0;
  }

  // Validate Group ID format
  static isValidGroupId(groupId) {
    // Group ID phải là số âm (bắt đầu bằng -)
    return /^-\d+$/.test(groupId);
  }

  // Format thời gian cho hiển thị
  static formatDate(dateString) {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('vi-VN');
    } catch (error) {
      return 'Unknown date';
    }
  }

  // Normalize trigger (giữ nguyên emoji, lowercase text)
  static normalizeTrigger(trigger) {
    if (!trigger) return '';
    
    // Trim whitespace
    trigger = trigger.trim();
    
    // Kiểm tra nếu trigger chỉ chứa emoji (không có chữ/số)
    const emojiRegex = /^[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]+$/u;
    
    if (emojiRegex.test(trigger)) {
      // Nếu chỉ là emoji, giữ nguyên
      return trigger;
    }
    
    // Nếu có text, chuyển thành lowercase
    return trigger.toLowerCase();
  }

  // Kiểm tra xem string có chứa emoji không
  static hasEmoji(text) {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/u;
    return emojiRegex.test(text);
  }

  // Tách emoji và text từ string
  static extractEmojis(text) {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu;
    const emojis = text.match(emojiRegex) || [];
    const textWithoutEmojis = text.replace(emojiRegex, '').trim();
    
    return {
      emojis: emojis,
      text: textWithoutEmojis,
      hasEmoji: emojis.length > 0
    };
  }

  // ================= FORWARD2 RULES FUNCTIONS =================
  
  // Thêm forward2 rule mới (forward từ bất kỳ nhóm nào đến 1 nhóm cụ thể)
  static addForward2Rule(settings, destGroupId, trigger, createdBy) {
    if (!settings.forward2Rules) {
      settings.forward2Rules = [];
    }

    // Normalize trigger
    const normalizedTrigger = Utils.normalizeTrigger(trigger);

    // Kiểm tra rule đã tồn tại chưa
    const existingRule = settings.forward2Rules.find(rule => 
      rule.destGroupId === destGroupId && 
      rule.trigger === normalizedTrigger
    );
    
    if (existingRule) {
      return { success: false, message: 'Rule forward2 đã tồn tại!' };
    }
    
    // Thêm rule mới
    const newRule = {
      destGroupId: destGroupId,
      trigger: normalizedTrigger,
      createdBy: createdBy,
      createdTime: new Date().toISOString(),
      status: "active"
    };
    
    settings.forward2Rules.push(newRule);
    return { success: true, rule: newRule };
  }

  // Xóa forward2 rule
  static removeForward2Rule(settings, destGroupId, trigger) {
    if (!settings.forward2Rules) {
      return { success: false, message: 'Không tìm thấy rule forward2 nào!' };
    }

    const normalizedTrigger = Utils.normalizeTrigger(trigger);
    
    const index = settings.forward2Rules.findIndex(rule => 
      rule.destGroupId === destGroupId && 
      rule.trigger === normalizedTrigger
    );
    
    if (index !== -1) {
      const removedRule = settings.forward2Rules[index];
      settings.forward2Rules.splice(index, 1);
      return { success: true, rule: removedRule };
    }
    
    return { success: false, message: 'Không tìm thấy rule forward2 này!' };
  }

  // Tìm forward2 rule phù hợp (forward từ bất kỳ nhóm nào)
  static findForward2Rule(settings, trigger) {
    if (!settings.forward2Rules) {
      return null;
    }

    const normalizedTrigger = Utils.normalizeTrigger(trigger);

    return settings.forward2Rules.find(rule => 
      rule.trigger === normalizedTrigger && 
      rule.status === "active"
    );
  }

  // Lấy tất cả active forward2 rules
  static getActiveForward2Rules(settings) {
    if (!settings.forward2Rules) {
      return [];
    }

    return settings.forward2Rules.filter(rule => rule.status === "active");
  }

  // ================== ADMIN MANAGEMENT ==================

  static getPermanentAdminUserIds() {
    const raw = config.permanentAdminUserIds;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((id) => String(id).trim()).filter(Boolean);
  }

  static isPermanentAdmin(userId) {
    const id = String(userId == null ? '' : userId).trim();
    if (!id) return false;
    return Utils.getPermanentAdminUserIds().includes(id);
  }

  // Add admin user
  static addAdmin(settings, userId) {
    if (!settings.adminUsers) {
      settings.adminUsers = [];
    }

    const userIdStr = userId.toString();

    if (Utils.isPermanentAdmin(userIdStr)) {
      return { success: false, message: 'User này đã là admin cố định (config)' };
    }

    if (settings.adminUsers.includes(userIdStr)) {
      return { success: false, message: 'User đã là admin rồi' };
    }

    settings.adminUsers.push(userIdStr);
    return { success: true, message: 'Đã thêm admin thành công' };
  }

  // Remove admin user
  static removeAdmin(settings, userId) {
    const userIdStr = userId.toString();
    if (Utils.isPermanentAdmin(userIdStr)) {
      return { success: false, message: 'Không thể xóa admin cố định trong config' };
    }

    if (!settings.adminUsers) {
      settings.adminUsers = [];
      return { success: false, message: 'Không có admin nào' };
    }

    const index = settings.adminUsers.indexOf(userIdStr);
    
    if (index === -1) {
      return { success: false, message: 'User không phải admin' };
    }
    
    settings.adminUsers.splice(index, 1);
    return { success: true, message: 'Đã xóa admin thành công' };
  }

  // Check if user is admin
  static isAdmin(settings, userId) {
    const userIdStr = userId.toString();
    if (Utils.isPermanentAdmin(userIdStr)) {
      return true;
    }
    if (!settings.adminUsers || settings.adminUsers.length === 0) {
      return false;
    }
    return settings.adminUsers.includes(userIdStr);
  }

  // Get all admin users (gồm admin cố định trong config + adminUsers)
  static getAdminList(settings) {
    const fromSettings = settings.adminUsers || [];
    const out = [];
    const seen = new Set();
    for (const id of Utils.getPermanentAdminUserIds()) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    for (const id of fromSettings) {
      const s = String(id).trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }

  // ================== PIC2 SETTINGS ==================

  static newPic2RuleId() {
    return crypto.randomBytes(4).toString('hex');
  }

  /** Migrate pic2Settings: mỗi group là mảng rule có id; object cũ (một rule) -> mảng một phần tử */
  static normalizePic2Settings(settings) {
    if (!settings.pic2Settings || typeof settings.pic2Settings !== 'object') {
      return false;
    }
    let changed = false;
    for (const gid of Object.keys(settings.pic2Settings)) {
      const v = settings.pic2Settings[gid];
      if (Array.isArray(v)) {
        for (const r of v) {
          if (r && typeof r === 'object' && !r.id) {
            r.id = Utils.newPic2RuleId();
            changed = true;
          }
        }
        continue;
      }
      if (v && typeof v === 'object' && v.targetUser != null) {
        settings.pic2Settings[gid] = [{ ...v, id: v.id || `legacy_${gid}` }];
        changed = true;
      }
    }
    return changed;
  }

  static countPic2Rules(settings) {
    if (!settings.pic2Settings) return 0;
    let n = 0;
    for (const v of Object.values(settings.pic2Settings)) {
      if (Array.isArray(v)) n += v.length;
    }
    return n;
  }

  // ================== COPYALL / NEWCOPY ==================

  static makeCopyWatermarkKey(sourceId, destId) {
    return `${String(sourceId)}_${String(destId)}`;
  }

  /**
   * Parse mốc thời gian cho /copyall: relative (24h, 7d, 2w) hoặc ngày UTC YYYY-MM-DD
   * @returns {{ minDateSec: number } | { error: string }}
   */
  static parseCopyTimeArg(str) {
    if (!str || typeof str !== 'string') {
      return { error: 'Thiếu mốc thời gian' };
    }
    const s = str.trim();
    const rel = /^(\d+)([hdw])$/i.exec(s);
    if (rel) {
      const n = parseInt(rel[1], 10);
      const u = rel[2].toLowerCase();
      const secPerUnit = u === 'h' ? 3600 : u === 'd' ? 86400 : 7 * 86400;
      const minDateSec = Math.floor(Date.now() / 1000) - n * secPerUnit;
      return { minDateSec };
    }
    const dateM = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (dateM) {
      const y = parseInt(dateM[1], 10);
      const mo = parseInt(dateM[2], 10) - 1;
      const d = parseInt(dateM[3], 10);
      const minDateSec = Math.floor(Date.UTC(y, mo, d, 0, 0, 0) / 1000);
      return { minDateSec };
    }
    return {
      error: 'Mốc thời gian không hợp lệ. Dùng: 24h, 7d, 2w hoặc YYYY-MM-DD (UTC 00:00)',
    };
  }

  /**
   * Tách thời gian và sourceId từ args /copyall (thứ tự bất kỳ)
   * @returns {{ timeArg: string, sourceId: string } | { error: string }}
   */
  static parseCopyallArgs(args) {
    if (!args || args.length < 2) {
      return { error: 'Thiếu tham số. Dùng: /copyall <thời gian> <id nguồn>' };
    }
    const idTokens = args.filter((t) => /^-?\d+$/.test(String(t).trim()));
    const timeTokens = args.filter((t) => !/^-?\d+$/.test(String(t).trim()));
    if (idTokens.length !== 1 || timeTokens.length !== 1) {
      return {
        error:
          'Cần đúng một ID nhóm/kênh (số) và một mốc thời gian (vd: 7d, 2025-01-15)',
      };
    }
    return { timeArg: timeTokens[0].trim(), sourceId: idTokens[0].trim() };
  }

  // ================== CAL (/cal máy tính) ==================

  static _mathCalInstance = null;

  static getMathCal() {
    if (!Utils._mathCalInstance) {
      const { create, all } = require('mathjs');
      Utils._mathCalInstance = create(all, {});
    }
    return Utils._mathCalInstance;
  }

  /** Tránh reply nhầm chat / ngày; số đơn thuần (vd 100) không coi là biểu thức */
  static isCalCandidate(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const line = raw.trim().split('\n')[0].trim();
    if (!line || line.length > 280) return false;
    if (!/\d/.test(line)) return false;
    if (/^\d{4}-\d{1,2}-\d{1,2}\b/.test(line)) return false;
    if (/\b\d{4}-\d{2}-\d{2}\b/.test(line)) return false;
    return (
      /\d\s*(tr|k|n|tỷ|ty)\b/iu.test(line) ||
      /[+*^/]/.test(line) ||
      /sqrt|sin|cos|tan|log|exp|abs|pow|floor|ceil|round|mod|\bpi\b|\be\b/i.test(line) ||
      /\(/.test(line) ||
      /\d\s*-\s*\d/.test(line)
    );
  }

  /** k,n = nghìn; tr = triệu; tỷ, ty = tỷ (sau số) */
  static preprocessCalExpression(s) {
    let t = s.trim().split('\n')[0].trim();
    if (!t) return t;
    t = t.replace(/(\d+(?:\.\d+)?)\s*(tỷ|ty)\b/gu, '($1*1e9)');
    t = t.replace(/(\d+(?:\.\d+)?)\s*tr\b/giu, '($1*1e6)');
    t = t.replace(/(\d+(?:\.\d+)?)\s*[kn]\b/giu, '($1*1e3)');
    return t;
  }

  static formatNumberDisplay(n) {
    if (typeof n !== 'number' || Number.isNaN(n) || !Number.isFinite(n)) {
      return null;
    }
    if (Math.abs(n - Math.round(n)) < 1e-9) {
      return Math.round(n).toLocaleString('vi-VN');
    }
    return n.toLocaleString('vi-VN', { maximumFractionDigits: 12 });
  }

  static formatCalResult(value, math) {
    try {
      if (value == null) return null;
      if (value.type === 'Complex') {
        const re = value.re;
        const im = value.im;
        if (Math.abs(im) < 1e-12) {
          return Utils.formatNumberDisplay(Number(re));
        }
        const a = Utils.formatNumberDisplay(Number(re));
        const b = Utils.formatNumberDisplay(Number(im));
        if (a == null || b == null) return null;
        return `${a} + ${b}i`;
      }
      if (value.type === 'Matrix' || Array.isArray(value)) {
        return null;
      }
      const n = typeof value === 'number' ? value : Number(math.number(value));
      return Utils.formatNumberDisplay(n);
    } catch (_e) {
      return null;
    }
  }

  /** @returns {{ ok: true, text: string } | { ok: false }} */
  static tryEvaluateCal(raw) {
    try {
      if (!Utils.isCalCandidate(raw)) return { ok: false };
      if (Utils.isTransactionMessage(raw)) return { ok: false };
      const math = Utils.getMathCal();
      const expr = Utils.preprocessCalExpression(raw);
      const result = math.evaluate(expr);
      const text = Utils.formatCalResult(result, math);
      if (text == null) return { ok: false };
      return { ok: true, text };
    } catch (_e) {
      return { ok: false };
    }
  }

  /**
   * Chia text thành các phần ≤ maxLen (mặc định 4000, an toàn dưới giới hạn 4096 của Telegram).
   * Ưu tiên cắt tại xuống dòng gần cuối cửa sổ.
   * @param {string} text
   * @param {number} [maxLen=4000]
   * @returns {string[]}
   */
  static splitTelegramMessageChunks(text, maxLen = 4000) {
    const s = text == null ? '' : String(text);
    if (s.length === 0) {
      return [''];
    }
    if (s.length <= maxLen) {
      return [s];
    }
    const chunks = [];
    let i = 0;
    while (i < s.length) {
      let end = Math.min(i + maxLen, s.length);
      if (end < s.length) {
        const slice = s.slice(i, end);
        const nl = slice.lastIndexOf('\n');
        if (nl > 0 && nl >= Math.floor(maxLen * 0.35)) {
          end = i + nl + 1;
        }
      }
      chunks.push(s.slice(i, end));
      i = end;
      while (i < s.length && /\s/.test(s[i])) {
        i += 1;
      }
    }
    return chunks;
  }
}

module.exports = Utils; 