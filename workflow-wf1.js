/**
 * Workflow WF1 — điều khiển bot Telegram khác qua inline/reply keyboard.
 *
 * Cấu hình: /wfbot @bot|chatId
 * Chạy: /wf1 on  (trong chat điều khiển)
 *
 * Luồng:
 * 1) /start → bấm button đầu → button thứ 2 → "tài khoản còn hạn"
 * 2) Liệt kê button tài khoản → user chọn
 * 3) "chỉnh sửa giao dịch" → "chỉnh giao dịch"
 * 4) Lặp từng giao dịch: so sánh thời gian trong Nội dung vs mục thời gian;
 *    trùng → bỏ qua; khác → chỉnh thời gian theo Nội dung; báo cáo về chat.
 */

const { Api } = require('telegram');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BTN = {
  accountValid: /t[aà]i\s*kho[aả]n\s*c[oò]n\s*h[aạ]n/i,
  // Một số bot: "Chỉnh sửa giao dịch"; bot này: "✏️ Chỉnh Giao Dịch"
  editTxMenu: /ch[iỉ]nh\s*s[uử]a\s*giao\s*d[iị]ch/i,
  editTx: /ch[iỉ]nh\s*giao\s*d[iị]ch/i,
  editTime: /th[oờ]i\s*gian|ch[iỉ]nh.*gi[oờ]|s[uử]a.*th[oờ]i/i,
  back: /quay\s*l[aạ]i|back|tr[oờ]|h[uủ]y|cancel|«|‹|⬅️/i,
  nextPage: /ti[eế]p|next|sau|»|›|➡️|xem\s*th[eê]m/i,
};

/** dd/mm/yyyy HH:mm:ss và biến thể */
const DT_RE =
  /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?)/;

function normalizeDateTime(datePart, timePart) {
  const d = datePart.replace(/[.\-]/g, '/');
  const [a, b, c] = d.split('/');
  let day;
  let month;
  let year;
  if (String(c).length === 4) {
    // dd/mm/yyyy or mm/dd/yyyy — ưu tiên dd/mm (VN)
    day = a.padStart(2, '0');
    month = b.padStart(2, '0');
    year = c;
  } else if (String(a).length === 4) {
    year = a;
    month = b.padStart(2, '0');
    day = c.padStart(2, '0');
  } else {
    day = a.padStart(2, '0');
    month = b.padStart(2, '0');
    year = c.length === 2 ? `20${c}` : c;
  }
  let [hh, mm, ss] = timePart.split(':');
  hh = hh.padStart(2, '0');
  mm = mm.padStart(2, '0');
  ss = (ss || '00').padStart(2, '0');
  return `${day}/${month}/${year} ${hh}:${mm}:${ss}`;
}

function extractDateTimeFromText(text, labelRe) {
  const raw = String(text || '');
  if (labelRe) {
    const m = raw.match(labelRe);
    if (m) {
      const chunk = m[1] || m[0];
      const dt = chunk.match(DT_RE);
      if (dt) return normalizeDateTime(dt[1], dt[2]);
    }
  }
  const all = [...raw.matchAll(new RegExp(DT_RE.source, 'g'))];
  if (!all.length) return null;
  return normalizeDateTime(all[0][1], all[0][2]);
}

function extractContentTime(text) {
  return (
    extractDateTimeFromText(
      text,
      /n[oộ]i\s*dung\s*:\s*([^\n]+)/i
    ) || extractDateTimeFromText(text, null)
  );
}

function extractFieldTime(text) {
  return extractDateTimeFromText(
    text,
    /th[oờ]i\s*gian\s*:\s*([^\n]+)/i
  );
}

function flattenButtons(rows) {
  if (!rows) return [];
  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const b = row[c];
      const text = b?.text || b?.button?.text || '';
      if (text) out.push({ row: r, col: c, text: String(text), button: b });
    }
  }
  return out;
}

function findButton(flat, predicate) {
  if (typeof predicate === 'number') return flat[predicate] || null;
  if (predicate instanceof RegExp) {
    return flat.find((b) => predicate.test(b.text)) || null;
  }
  const q = String(predicate).toLowerCase();
  return (
    flat.find((b) => b.text.toLowerCase() === q) ||
    flat.find((b) => b.text.toLowerCase().includes(q)) ||
    null
  );
}

class Wf1Runner {
  constructor(bot) {
    this.bot = bot;
    this.sessions = new Map(); // controlChatId → session
  }

  getSettings() {
    if (!this.bot.settings.workflow) {
      this.bot.settings.workflow = {};
    }
    return this.bot.settings.workflow;
  }

  getBotPeerConfig() {
    return String(this.getSettings().wfBotPeer || '').trim();
  }

  setBotPeerConfig(peer) {
    const wf = this.getSettings();
    wf.wfBotPeer = String(peer || '').trim();
    const Utils = require('./utils');
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
    return s && s.phase === 'await_account';
  }

  async resolvePeer(peerStr) {
    const raw = String(peerStr || '').trim();
    if (!raw) throw new Error('Chưa cấu hình bot — dùng /wfbot @bot hoặc chat id');
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
      const Utils = require('./utils');
      Utils.log(`⚠️ WF1 notify: ${e.message}`);
    }
  }

  async getLatestMessage(peer) {
    const msgs = await this.bot.client.getMessages(peer, { limit: 8 });
    return msgs && msgs[0] ? msgs[0] : null;
  }

  async getButtons(msg) {
    if (!msg) return [];
    const rows = await msg.getButtons();
    return flattenButtons(rows);
  }

  async clickButton(msg, target, peer) {
    const flat = await this.getButtons(msg);
    const btn = findButton(flat, target);
    if (!btn) {
      const labels = flat.map((b, i) => `${i + 1}. ${b.text}`).join('\n') || '(không có)';
      throw new Error(`Không tìm thấy button.\nHiện có:\n${labels}`);
    }
    await msg.click({ i: btn.row, j: btn.col });
    await sleep(1800);
    return this.getLatestMessage(peer);
  }

  async clickIndex(msg, index, peer) {
    return this.clickButton(msg, index, peer);
  }

  /**
   * /wfbot [@user|id]
   */
  async handleWfBotCommand(args, chatId, messageId) {
    if (!args.length) {
      const cur = this.getBotPeerConfig() || '(chưa đặt)';
      await this.bot.sendReply(
        chatId,
        messageId,
        [
          `🤖 WF bot hiện tại: \`${cur}\``,
          '',
          'Đặt bot: `/wfbot @tenbot` hoặc `/wfbot <chatId>`',
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
      // Prefer username if available for stability
      const store = entity.username ? `@${entity.username}` : id;
      this.setBotPeerConfig(store);
      await this.bot.sendReply(
        chatId,
        messageId,
        `✅ Đã đặt WF bot: ${label} (\`${store}\` / id \`${id}\`)`
      );
    } catch (e) {
      await this.bot.sendReply(chatId, messageId, `❌ Không resolve được bot: ${e.message}`);
    }
  }

  /**
   * /wf1 on|off|status|help
   */
  async handleWf1Command(args, chatId, messageId) {
    const action = String(args[0] || 'help').toLowerCase();
    if (action === 'off' || action === 'stop' || action === 'cancel') {
      this.clearSession(chatId);
      await this.bot.sendReply(chatId, messageId, '🛑 Đã tắt / hủy WF1.');
      return;
    }
    if (action === 'status') {
      const s = this.getSession(chatId);
      const bot = this.getBotPeerConfig() || '(chưa đặt)';
      await this.bot.sendReply(
        chatId,
        messageId,
        [
          `WF1: ${s ? `🟢 ${s.phase}` : '🔴 idle'}`,
          `Bot: \`${bot}\``,
          s?.stats
            ? `Đã sửa: ${s.stats.fixed} · Bỏ qua: ${s.stats.skipped} · Lỗi: ${s.stats.errors}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      );
      return;
    }
    if (action === 'on' || action === 'start' || action === 'run') {
      if (this.getSession(chatId)?.phase === 'processing') {
        await this.bot.sendReply(chatId, messageId, '⏳ WF1 đang chạy — /wf1 off để hủy.');
        return;
      }
      if (!this.getBotPeerConfig()) {
        await this.bot.sendReply(
          chatId,
          messageId,
          '❌ Chưa đặt bot. Dùng: `/wfbot @bot` hoặc `/wfbot <chatId>` rồi `/wf1 on`.'
        );
        return;
      }
      await this.bot.sendReply(chatId, messageId, '🚀 Bắt đầu WF1…');
      // fire-and-forget async run
      this.runUntilAccountPick(chatId, messageId).catch(async (err) => {
        this.clearSession(chatId);
        await this.notify(chatId, `❌ WF1 lỗi: ${err.message}`, messageId);
      });
      return;
    }

    await this.bot.sendReply(
      chatId,
      messageId,
      [
        '**WF1** — tự động thao tác bot khác',
        '',
        '`/wfbot @bot` — đặt bot sẽ điều khiển',
        '`/wf1 on` — chạy: /start → button 1 → button 2 → tài khoản còn hạn → chờ bạn chọn account',
        'Sau khi chọn account: chỉnh sửa giao dịch → chỉnh giao dịch → sửa thời gian từng GD',
        '`/wf1 off` — hủy',
        '`/wf1 status`',
      ].join('\n')
    );
  }

  async runUntilAccountPick(controlChatId, replyTo) {
    const peerCfg = this.getBotPeerConfig();
    const peer = await this.resolvePeer(peerCfg);
    this.sessions.set(String(controlChatId), {
      phase: 'processing',
      peerCfg,
      peer,
      controlChatId: String(controlChatId),
      replyTo,
      stats: { fixed: 0, skipped: 0, errors: 0 },
      accountButtons: [],
    });

    await this.notify(controlChatId, `📤 Gửi /start tới ${peerCfg}…`, replyTo);
    await this.bot.client.sendMessage(peer, { message: '/start' });
    await sleep(2000);
    let msg = await this.getLatestMessage(peer);
    if (!msg) throw new Error('Không nhận được tin từ bot sau /start');

    await this.notify(controlChatId, '👆 Bấm button đầu tiên…', replyTo);
    msg = await this.clickIndex(msg, 0, peer);

    await this.notify(controlChatId, '👆 Bấm button thứ 2…', replyTo);
    msg = await this.clickIndex(msg, 1, peer);

    await this.notify(controlChatId, '👆 Chọn “tài khoản còn hạn”…', replyTo);
    msg = await this.clickButton(msg, BTN.accountValid, peer);

    const flat = await this.getButtons(msg);
    if (!flat.length) throw new Error('Không thấy danh sách button tài khoản');

    const session = this.getSession(controlChatId);
    session.phase = 'await_account';
    session.botMsgId = msg.id;
    session.accountButtons = flat.map((b, i) => ({
      index: i,
      text: b.text,
      row: b.row,
      col: b.col,
    }));
    session.lastMsg = msg;

    const list = session.accountButtons
      .map((b) => `${b.index + 1}. ${b.text}`)
      .join('\n');
    await this.notify(
      controlChatId,
      [
        '📋 Chọn tài khoản (reply số hoặc tên button):',
        list,
        '',
        'Ví dụ: `1` hoặc dán đúng tên button.',
        'Hủy: /wf1 off',
      ].join('\n'),
      replyTo
    );
  }

  /**
   * User chọn account trong chat điều khiển.
   * @returns {boolean} true nếu đã xử lý
   */
  async handleUserAccountPick(controlChatId, messageText, messageId) {
    const session = this.getSession(controlChatId);
    if (!session || session.phase !== 'await_account') return false;

    const text = String(messageText || '').trim();
    if (!text || text.startsWith('/')) return false;

    let pick = null;
    if (/^\d+$/.test(text)) {
      const n = parseInt(text, 10) - 1;
      pick = session.accountButtons[n];
    } else {
      const q = text.toLowerCase();
      pick =
        session.accountButtons.find((b) => b.text.toLowerCase() === q) ||
        session.accountButtons.find((b) => b.text.toLowerCase().includes(q));
    }
    if (!pick) {
      await this.notify(
        controlChatId,
        '❗ Không khớp button. Gửi số thứ tự hoặc tên button trong danh sách.',
        messageId
      );
      return true;
    }

    session.phase = 'processing';
    session.chosenAccount = pick.text;
    await this.notify(
      controlChatId,
      `✅ Đã chọn: ${pick.text}\nTiếp tục chỉnh giao dịch…`,
      messageId
    );

    this.continueAfterAccount(controlChatId).catch(async (err) => {
      this.clearSession(controlChatId);
      await this.notify(controlChatId, `❌ WF1 lỗi: ${err.message}`, messageId);
    });
    return true;
  }

  async continueAfterAccount(controlChatId) {
    const session = this.getSession(controlChatId);
    if (!session) return;
    const { peer, replyTo } = session;

    let msg = session.lastMsg || (await this.getLatestMessage(peer));
    // Click account button
    msg = await this.clickButton(msg, session.chosenAccount, peer);

    // Có bot có 2 bước (menu rồi chỉnh); bot test chỉ có "✏️ Chỉnh Giao Dịch"
    const flatAfterAccount = await this.getButtons(msg);
    if (findButton(flatAfterAccount, BTN.editTxMenu)) {
      await this.notify(controlChatId, '👆 Chỉnh sửa giao dịch…', replyTo);
      msg = await this.clickButton(msg, BTN.editTxMenu, peer);
    }

    await this.notify(controlChatId, '👆 Chỉnh giao dịch…', replyTo);
    msg = await this.clickButton(msg, BTN.editTx, peer);

    await this.processTransactionLoop(controlChatId, msg);
  }

  isLikelyTransactionButton(text) {
    const t = String(text || '');
    if (BTN.back.test(t) || BTN.nextPage.test(t)) return false;
    if (BTN.editTxMenu.test(t) || BTN.editTx.test(t)) return false;
    if (BTN.accountValid.test(t)) return false;
    if (/t[aạ]o\s*giao\s*d[iị]ch/i.test(t)) return false;
    // Prefer buttons that look like tx rows (have money/date/id) — else any remaining
    return true;
  }

  async processTransactionLoop(controlChatId, listMsg) {
    const session = this.getSession(controlChatId);
    if (!session) return;
    const { peer, replyTo } = session;
    let msg = listMsg;
    let pass = 0;
    const maxPass = 15;

    while (pass < maxPass) {
      pass += 1;
      if (!this.getSession(controlChatId)) {
        await this.notify(controlChatId, '🛑 WF1 đã hủy.', replyTo);
        return;
      }

      let flat = await this.getButtons(msg);
      let txButtons = flat.filter((b) => this.isLikelyTransactionButton(b.text));
      if (!txButtons.length) {
        const next = findButton(flat, BTN.nextPage);
        if (next) {
          msg = await this.clickButton(msg, BTN.nextPage, peer);
          continue;
        }
        break;
      }

      await this.notify(
        controlChatId,
        `📄 Lượt ${pass}: ${txButtons.length} button giao dịch — quét…`,
        replyTo
      );

      let fixedThisPass = 0;
      // Snapshot texts — list may change after edits
      const labels = txButtons.map((b) => b.text);

      for (const label of labels) {
        if (!this.getSession(controlChatId)) return;

        // Refresh list message buttons each time
        flat = await this.getButtons(msg);
        if (!findButton(flat, label)) {
          continue;
        }

        await this.notify(
          controlChatId,
          `🔎 Mở: ${label.slice(0, 100)}`,
          replyTo
        );
        let detail = await this.clickButton(msg, label, peer);
        const body = String(detail?.message || detail?.text || '');
        const contentTime = extractContentTime(body);
        const fieldTime = extractFieldTime(body);

        if (!contentTime) {
          session.stats.errors += 1;
          await this.notify(
            controlChatId,
            `⚠️ Không parse được thời gian Nội dung — bỏ qua.\n${body.slice(0, 350)}`,
            replyTo
          );
          msg = await this.tryBack(detail, peer);
          continue;
        }

        if (fieldTime && fieldTime === contentTime) {
          session.stats.skipped += 1;
          await this.notify(
            controlChatId,
            `⏭️ Trùng (${contentTime}) — bỏ qua.`,
            replyTo
          );
          msg = await this.tryBack(detail, peer);
          continue;
        }

        await this.notify(
          controlChatId,
          `✏️ Sửa: \`${fieldTime || '(trống)'}\` → \`${contentTime}\``,
          replyTo
        );
        try {
          detail = await this.editTimeOnDetail(detail, peer, contentTime);
          session.stats.fixed += 1;
          fixedThisPass += 1;
          await this.notify(
            controlChatId,
            `✅ Đã chỉnh → ${contentTime} (sửa ${session.stats.fixed} / bỏ qua ${session.stats.skipped})`,
            replyTo
          );
        } catch (e) {
          session.stats.errors += 1;
          await this.notify(controlChatId, `⚠️ Không chỉnh được: ${e.message}`, replyTo);
        }
        msg = await this.tryBack(detail, peer);
      }

      // Hết trang? thử next rồi quét tiếp
      flat = await this.getButtons(msg);
      if (findButton(flat, BTN.nextPage) && fixedThisPass === 0) {
        // Cùng lượt: sang trang nếu trang này không còn gì để sửa
        const stillMismatchPossible = true;
        if (stillMismatchPossible && findButton(flat, BTN.nextPage)) {
          msg = await this.clickButton(msg, BTN.nextPage, peer);
          continue;
        }
      }

      // Một lượt không sửa gì → coi như không còn GD lệch trên các trang đã quét
      if (fixedThisPass === 0) {
        break;
      }
    }

    const s = this.getSession(controlChatId);
    const stats = s?.stats || { fixed: 0, skipped: 0, errors: 0 };
    this.clearSession(controlChatId);
    await this.notify(
      controlChatId,
      [
        '🏁 WF1 xong — không còn giao dịch lệch thời gian (hoặc hết danh sách).',
        `Đã sửa: ${stats.fixed}`,
        `Bỏ qua (đã trùng): ${stats.skipped}`,
        `Lỗi: ${stats.errors}`,
      ].join('\n'),
      replyTo
    );
  }

  async tryBack(msg, peer) {
    try {
      const flat = await this.getButtons(msg);
      if (findButton(flat, BTN.back)) {
        return await this.clickButton(msg, BTN.back, peer);
      }
    } catch {
      /* ignore */
    }
    // Fallback: sometimes need to re-open list — return latest
    await sleep(800);
    return this.getLatestMessage(peer);
  }

  async editTimeOnDetail(detailMsg, peer, newTime) {
    let msg = detailMsg;
    const flat = await this.getButtons(msg);
    const timeBtn = findButton(flat, BTN.editTime);
    if (timeBtn) {
      msg = await this.clickButton(msg, BTN.editTime, peer);
    } else {
      // Một số bot yêu cầu bấm "chỉnh" rồi chọn field — thử button chứa "sửa" / "edit"
      const editBtn = findButton(flat, /ch[iỉ]nh|s[uử]a|edit/i);
      if (!editBtn) {
        throw new Error(
          `Không thấy button chỉnh thời gian. Buttons: ${flat.map((b) => b.text).join(' | ')}`
        );
      }
      msg = await this.clickButton(msg, editBtn.text, peer);
      const flat2 = await this.getButtons(msg);
      const timeBtn2 = findButton(flat2, BTN.editTime) || findButton(flat2, /th[oờ]i\s*gian/i);
      if (timeBtn2) {
        msg = await this.clickButton(msg, timeBtn2.text, peer);
      }
    }
    // Gửi giá trị thời gian đúng format
    await this.bot.client.sendMessage(peer, { message: newTime });
    await sleep(2000);
    return this.getLatestMessage(peer);
  }
}

module.exports = {
  Wf1Runner,
  extractContentTime,
  extractFieldTime,
  normalizeDateTime,
};
