const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const DEFAULT_APPEND_SYSTEM = `Bạn là Claude Code đang điều khiển userbot Telegram trên VPS này.
- Thư mục làm việc là repo userbot. Dùng Bash để chạy: node control-cli.js <lệnh>
- Lệnh có sẵn: health | status | chats | messages <chatId> [limit] | send <chatId> <nội dung> | ai-on <chatId> | ai-off <chatId> | ai <chatId> | cmd <chatId> </lệnh>
- Chỉ điều khiển userbot khi người dùng yêu cầu rõ. Không gửi tin lung tung.
- Trả lời người dùng bằng tiếng Việt, ngắn gọn. Phần stdout của bạn sẽ được gửi lại cho họ trên Telegram.
- Không sửa code trừ khi được hỏi. Ưu tiên control-cli.js.`;

function resolveBin() {
  const fromEnv = String(config.claudeCodeBin || '').trim();
  if (fromEnv) return fromEnv;
  const candidates = [
    '/usr/local/bin/claude',
    '/root/.local/bin/claude',
    'claude',
  ];
  for (const c of candidates) {
    if (c === 'claude') return c;
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return 'claude';
}

function describeSetup() {
  const bin = resolveBin();
  let binaryOk = bin === 'claude';
  if (!binaryOk) {
    try {
      binaryOk = fs.existsSync(bin);
    } catch {
      binaryOk = false;
    }
  }
  return {
    bin,
    binaryOk,
    timeoutMs: Number(config.claudeCodeTimeoutMs) || 180000,
    enabled: config.claudeCodeEnabled !== false,
  };
}

function runOnce({ prompt, cwd, continueSession, timeoutMs, bin, systemPrompt }) {
  const args = [
    '-p',
    '--output-format',
    'text',
    '--dangerously-skip-permissions',
    '--append-system-prompt',
    systemPrompt,
  ];
  if (continueSession) args.push('--continue');
  args.push(prompt);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(bin, args, {
        cwd: path.resolve(cwd),
        env: {
          ...process.env,
          CI: '1',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      finish({
        ok: false,
        error: `Không chạy được Claude Code (${bin}): ${err.message}`,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf8');
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf8');
    });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        error: `Claude Code hết thời gian chờ (${Math.round(timeoutMs / 1000)}s)`,
        text: stdout.trim() || undefined,
      });
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        error: `Claude Code lỗi spawn: ${err.message}. Cài: npm i -g @anthropic-ai/claude-code && claude auth login`,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const text = stdout.trim();
      const errText = stderr.trim();
      if (code === 0 && text) {
        finish({ ok: true, text, code });
        return;
      }
      const combined = [text, errText].filter(Boolean).join('\n').trim();
      const lower = combined.toLowerCase();
      let error = combined || `Claude Code thoát code ${code}`;
      if (
        lower.includes('not logged in') ||
        lower.includes('please run /login') ||
        lower.includes('authentication') ||
        lower.includes('unauthorized')
      ) {
        error =
          'Claude Code chưa đăng nhập trên VPS. SSH vào VPS chạy: claude auth login';
      }
      finish({
        ok: Boolean(text) && code === 0,
        text: text || undefined,
        error: code === 0 && text ? undefined : error,
        code,
        noSession:
          lower.includes('no conversation') ||
          lower.includes('nothing to continue') ||
          lower.includes('no previous'),
      });
    });
  });
}

/**
 * Chạy Claude Code print-mode (non-interactive).
 * @returns {Promise<{ ok: boolean, text?: string, error?: string, code?: number }>}
 */
async function runPrompt({
  prompt,
  cwd = process.cwd(),
  continueSession = true,
  timeoutMs,
} = {}) {
  const setup = describeSetup();
  if (!setup.enabled) {
    return {
      ok: false,
      error: 'Claude Code pilot đang tắt (CLAUDE_CODE_ENABLED=0)',
    };
  }
  const userPrompt = String(prompt || '').trim();
  if (!userPrompt) {
    return { ok: false, error: 'Prompt trống' };
  }

  const ms = Number(timeoutMs) || setup.timeoutMs;
  const systemPrompt = String(
    config.claudeCodeSystemPrompt || DEFAULT_APPEND_SYSTEM
  );
  const bin = setup.bin;

  let result = await runOnce({
    prompt: userPrompt,
    cwd,
    continueSession,
    timeoutMs: ms,
    bin,
    systemPrompt,
  });

  // Lần đầu chưa có session: --continue có thể fail → chạy session mới
  if (!result.ok && continueSession && result.noSession) {
    result = await runOnce({
      prompt: userPrompt,
      cwd,
      continueSession: false,
      timeoutMs: ms,
      bin,
      systemPrompt,
    });
  }

  return result;
}

module.exports = {
  describeSetup,
  runPrompt,
  DEFAULT_APPEND_SYSTEM,
};
