/**
 * Workflow WF2 — gửi lần lượt các lệnh /bdsd lên bot đã cấu hình.
 *
 * Cấu hình bot: /wf2bot @bot  (hoặc /wf2 bot @bot)
 * Chạy: dán list /bdsd…  hoặc  /wf2 + list  hoặc  /wf2 rồi tin tiếp theo là list
 * Hủy: /wf2 off
 */

const Utils = require('./utils');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BDSD_LINE = /^\s*\/bdsd\s+\S+/i;

function extractBdsdLines(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    // Bỏ dòng lệnh điều khiển /wf2…
    if (/^\/wf2(bot)?(\s|$|@)/i.test(line) && !BDSD_LINE.test(line)) continue;
    if (BDSD_LINE.test(line)) out.push(line.replace(/^\s+/, ''));
  }
  return out;
}

function isPureBdsdList(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  // Cho phép dòng đầu là /wf2 rồi toàn /bdsd
  let start = 0;
  if (/^\/wf2(\s|$|@)/i.test(lines[0]) && !BDSD_LINE.test(lines[0])) start = 1;
  const body = lines.slice(start);
  if (!body.length) return false;
  return body.every((l) => BDSD_LINE.test(l));
}

class Wf2BdsdRunner {
  constructor(bot) {
    this.bot = bot;
    this.id = 'wf2';
    this.label = 'WF2';
    this.sessions = new Map();
    this.replyWaitMs = 45000;
    this.gapMs = 1500;
  }

  getSettings() {
    if (!this.bot.settings.workflow) this.bot.settings.workflow = {};
    return this.bot.settings.workflow;
  }

  getBotPeerConfig() {
    return String(this.getSettings().wf2BotPeer || '').trim();
  }

  setBotPeerConfig(peer) {
    this.getSettings().wf2BotPeer = String(peer || '').trim();
    Utils.saveSettings(this.bot.settings);
  }

  getSession(controlChatId) {
    return this.sessions.get(String(controlChatId));
  }

  clearSession(controlChatId) {
    this.sessions.delete(String(controlChatId));
  }

  isAwaitingUserInput(controlChatId) {
    const s = this.getSession(controlChatId);
    return s && s.phase === 'await_list';
  }

  isBusy(controlChatId) {
    const s = this.getSession(controlChatId);
    return s && s.phase === 'sending';
  }

  async resolvePeer(peerStr) {
    const raw = String(peerStr || '').trim();
    if (!raw) throw new Error('Chưa cấu hình bot — dùng /wf2bot @bot hoặc chat id');
    let target = raw;
    if (target.startsWith('@')) target = target.slice(1);
    if (/^-?\d+$/.test(target)) {
      return await this.bot.client.getEntity(Number(target));
    }
    return await this.bot.client.getEntity(target);
  }

  async notify(controlChatId, text, replyTo = null) {
    try {
      await this.bot.client.sendMessage(controlChatId, {
        message: text,
        replyTo: replyTo || undefined,
      });
    } catch (e) {
      Utils.log(`⚠️ WF2 notify: ${e.message}`);
    }
  }

  async handleWfBotCommand(args, chatId, messageId) {
    if (!args.length) {
      const cur = this.getBotPeerConfig() || '(chưa đặt)';
      await this.bot.sendReply(
        chatId,
        messageId,
        [
          `🤖 WF2 bot hiện tại: \`${cur}\``,
          '',
          'Đặt bot: `/wf2bot @tenbot` hoặc `/wf2bot <chatId>`',
          'Chạy: dán list `/bdsd …` (hoặc `/wf2` + list)',
        ].join('\n')
      );
      return;
    }
    const peer = args.join(' ').trim();
    try {
      const entity = await this.resolvePeer(peer);
      const label =
        entity.username
          ? `@${entity.username}`
          : `${entity.firstName || entity.title || ''}`.trim() || peer;
      const id = entity.id != null ? String(entity.id) : peer;
      const store = entity.username ? `@${entity.username}` : id;
      this.setBotPeerConfig(store);
      await this.bot.sendReply(
        chatId,
        messageId,
        `✅ Đã đặt WF2 bot: ${label} (\`${store}\` / id \`${id}\`)`
      );
    } catch (e) {
      await this.bot.sendReply(chatId, messageId, `❌ Không resolve được bot: ${e.message}`);
    }
  }

  /**
   * /wf2 [off|status|bot @x|help]  hoặc  /wf2 + các dòng /bdsd
   * rawText = full message (giữ xuống dòng)
   */
  async handleWfCommand(args, chatId, messageId, rawText = '') {
    const raw = String(rawText || '');
    const first = String(args[0] || '').toLowerCase();

    if (first === 'off' || first === 'stop' || first === 'cancel') {
      const s = this.getSession(chatId);
      if (s && s.phase === 'sending') s.cancel = true;
      else this.clearSession(chatId);
      await this.bot.sendReply(chatId, messageId, '🛑 Đã tắt / hủy WF2.');
      return;
    }

    if (first === 'status') {
      const s = this.getSession(chatId);
      const bot = this.getBotPeerConfig() || '(chưa đặt)';
      const progress =
        s && s.total
          ? `Tiến độ: ${s.sent || 0}/${s.total} · lỗi ${s.errors || 0}`
          : '';
      await this.bot.sendReply(
        chatId,
        messageId,
        [
          `WF2: ${s ? `🟢 ${s.phase}` : '🔴 idle'}`,
          `Bot: \`${bot}\``,
          progress,
        ]
          .filter(Boolean)
          .join('\n')
      );
      return;
    }

    if (first === 'bot') {
      await this.handleWfBotCommand(args.slice(1), chatId, messageId);
      return;
    }

    // Có list /bdsd trong tin này
    const lines = extractBdsdLines(raw);
    if (lines.length) {
      await this.startBatch(lines, chatId, messageId);
      return;
    }

    if (!first || first === 'help' || first === 'on' || first === 'run' || first === 'start') {
      if (!this.getBotPeerConfig()) {
        await this.bot.sendReply(
          chatId,
          messageId,
          '❌ Chưa đặt bot. Dùng: `/wf2bot @bot` rồi dán list `/bdsd …`.'
        );
        return;
      }
      // Chờ tin tiếp theo chứa list
      this.sessions.set(String(chatId), {
        phase: 'await_list',
        replyTo: messageId,
      });
      await this.bot.sendReply(
        chatId,
        messageId,
        [
          '📥 WF2 sẵn sàng — **dán list `/bdsd …` vào tin tiếp theo**.',
          `Bot: \`${this.getBotPeerConfig()}\``,
          'Hủy: `/wf2 off`',
        ].join('\n')
      );
      return;
    }

    // /wf2 @bot — đặt bot nhanh
    if (first.startsWith('@') || /^-?\d+$/.test(first)) {
      await this.handleWfBotCommand(args, chatId, messageId);
      return;
    }

    await this.bot.sendReply(
      chatId,
      messageId,
      [
        '**WF2** — gửi lần lượt lệnh `/bdsd` lên bot khác',
        '',
        '`/wf2bot @bot` — đặt bot nhận lệnh',
        '`/wf2` — chờ dán list',
        '`/wf2` + list `/bdsd …` trong cùng tin — chạy ngay',
        'Hoặc dán thuần list các dòng `/bdsd …` (khi đã đặt bot)',
        '`/wf2 off` — hủy',
        '`/wf2 status`',
      ].join('\n')
    );
  }

  /** Tin thường / tin list khi đang await_list, hoặc list thuần /bdsd */
  async handleIncomingList(chatId, messageText, messageId) {
    if (this.isBusy(chatId)) {
      await this.notify(chatId, '⏳ WF2 đang gửi list trước — đợi xong hoặc `/wf2 off`.', messageId);
      return true;
    }

    const awaiting = this.isAwaitingUserInput(chatId);
    const pure = isPureBdsdList(messageText);
    if (!awaiting && !pure) return false;

    const lines = extractBdsdLines(messageText);
    if (!lines.length) {
      if (awaiting) {
        await this.notify(
          chatId,
          '❗ Không thấy dòng `/bdsd …`. Dán lại list hoặc `/wf2 off`.',
          messageId
        );
        return true;
      }
      return false;
    }

    await this.startBatch(lines, chatId, messageId);
    return true;
  }

  async startBatch(lines, controlChatId, replyTo) {
    if (!this.getBotPeerConfig()) {
      await this.bot.sendReply(
        controlChatId,
        replyTo,
        '❌ Chưa đặt bot. Dùng: `/wf2bot @bot`'
      );
      return;
    }
    if (this.isBusy(controlChatId)) {
      await this.bot.sendReply(
        controlChatId,
        replyTo,
        '⏳ WF2 đang chạy — `/wf2 off` để hủy.'
      );
      return;
    }

    let peer;
    try {
      peer = await this.resolvePeer(this.getBotPeerConfig());
    } catch (e) {
      await this.bot.sendReply(controlChatId, replyTo, `❌ Bot: ${e.message}`);
      return;
    }

    this.sessions.set(String(controlChatId), {
      phase: 'sending',
      peer,
      lines,
      total: lines.length,
      sent: 0,
      errors: 0,
      replyTo,
      cancel: false,
    });

    await this.bot.sendReply(
      controlChatId,
      replyTo,
      `🚀 WF2: sẽ gửi **${lines.length}** lệnh /bdsd → \`${this.getBotPeerConfig()}\``
    );

    this.runBatch(controlChatId).catch(async (err) => {
      this.clearSession(controlChatId);
      await this.notify(controlChatId, `❌ WF2 lỗi: ${err.message}`, replyTo);
    });
  }

  async getLatestBotMsgId(peer) {
    const msgs = await this.bot.client.getMessages(peer, { limit: 5 });
    return msgs && msgs[0] ? msgs[0].id : 0;
  }

  async waitForBotReply(peer, afterId, timeoutMs, controlChatId) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = this.getSession(controlChatId);
      if (!s || s.cancel || s.phase !== 'sending') return null;
      const msgs = await this.bot.client.getMessages(peer, { limit: 8 });
      if (msgs && msgs.length) {
        const newer = msgs.filter((m) => m && m.id > afterId && !m.out);
        if (newer.length) {
          return newer.reduce((a, b) => (a.id > b.id ? a : b));
        }
      }
      await sleep(1200);
    }
    return null;
  }

  async runBatch(controlChatId) {
    const session = this.getSession(controlChatId);
    if (!session || session.phase !== 'sending') return;

    const { peer, lines, replyTo } = session;
    const total = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const s = this.getSession(controlChatId);
      if (!s || s.phase !== 'sending' || s.cancel) {
        await this.notify(controlChatId, '🛑 WF2 đã hủy.', replyTo);
        this.clearSession(controlChatId);
        return;
      }

      const line = lines[i];
      const preview = line.length > 120 ? line.slice(0, 117) + '…' : line;
      let beforeId = 0;
      try {
        beforeId = await this.getLatestBotMsgId(peer);
      } catch (_) {
        beforeId = 0;
      }

      try {
        await this.bot.client.sendMessage(peer, { message: line });
        s.sent = i + 1;
        Utils.log(`WF2 [${i + 1}/${total}] → bot: ${preview}`);

        const reply = await this.waitForBotReply(
          peer,
          beforeId,
          this.replyWaitMs,
          controlChatId
        );
        if (reply) {
          const body = String(reply.message || reply.text || '').trim();
          const short = body.length > 350 ? body.slice(0, 347) + '…' : body;
          await this.notify(
            controlChatId,
            `✅ [${i + 1}/${total}]\n\`${preview}\`\n→ ${short || '(bot trả lời, không text)'}`,
            replyTo
          );
        } else {
          await this.notify(
            controlChatId,
            `⚠️ [${i + 1}/${total}] đã gửi, chưa thấy reply bot trong ${Math.round(this.replyWaitMs / 1000)}s\n\`${preview}\``,
            replyTo
          );
        }
      } catch (e) {
        s.errors = (s.errors || 0) + 1;
        await this.notify(
          controlChatId,
          `❌ [${i + 1}/${total}] ${e.message}\n\`${preview}\``,
          replyTo
        );
      }

      if (i < lines.length - 1) await sleep(this.gapMs);
    }

    const done = this.getSession(controlChatId);
    const sent = done?.sent || total;
    const errors = done?.errors || 0;
    this.clearSession(controlChatId);
    await this.notify(
      controlChatId,
      `🏁 WF2 xong: gửi ${sent}/${total} · lỗi ${errors}`,
      replyTo
    );
  }
}

module.exports = {
  Wf2BdsdRunner,
  extractBdsdLines,
  isPureBdsdList,
  BDSD_LINE,
};
