#!/usr/bin/env node
/**
 * CLI đơn giản để Cursor agent trên VPS điều khiển userbot.
 * Đọc CONTROL_API_TOKEN từ .env — không cần nhớ curl.
 *
 * Ví dụ:
 *   node control-cli.js status
 *   node control-cli.js chats
 *   node control-cli.js messages -100123 20
 *   node control-cli.js send -100123 "xin chào"
 *   node control-cli.js ai-on -100123
 *   node control-cli.js ai-off -100123
 *   node control-cli.js cmd -100123 "/status"
 */
require('dotenv').config({ quiet: true });

const host = process.env.CONTROL_API_HOST || '127.0.0.1';
const port = process.env.CONTROL_API_PORT || '3847';
const token = (process.env.CONTROL_API_TOKEN || '').trim();
const base = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;

async function api(method, path, body) {
  if (!token) {
    throw new Error('Thiếu CONTROL_API_TOKEN trong .env — Control API chưa bật');
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '-h') {
    console.log(`Control CLI — base ${base}

  node control-cli.js health
  node control-cli.js status
  node control-cli.js chats
  node control-cli.js messages <chatId> [limit]
  node control-cli.js send <chatId> <nội dung...>
  node control-cli.js ai-on <chatId>
  node control-cli.js ai-off <chatId>
  node control-cli.js ai <chatId>
  node control-cli.js cmd <chatId> </lệnh...>
`);
    return;
  }

  let out;
  switch (cmd) {
    case 'health':
      out = await api('GET', '/health');
      break;
    case 'status':
      out = await api('GET', '/status');
      break;
    case 'chats':
      out = await api('GET', '/chats?limit=200');
      break;
    case 'messages': {
      const chatId = args[0];
      const limit = args[1] || '30';
      if (!chatId) throw new Error('Thiếu chatId');
      out = await api('GET', `/chats/${chatId}/messages?limit=${limit}`);
      break;
    }
    case 'send': {
      const chatId = args[0];
      const text = args.slice(1).join(' ').trim();
      if (!chatId || !text) throw new Error('Dùng: send <chatId> <nội dung>');
      out = await api('POST', `/chats/${chatId}/send`, { text });
      break;
    }
    case 'ai-on': {
      const chatId = args[0];
      if (!chatId) throw new Error('Thiếu chatId');
      out = await api('POST', `/ai/${chatId}`, { enabled: true });
      break;
    }
    case 'ai-off': {
      const chatId = args[0];
      if (!chatId) throw new Error('Thiếu chatId');
      out = await api('POST', `/ai/${chatId}`, { enabled: false });
      break;
    }
    case 'ai': {
      const chatId = args[0];
      if (!chatId) throw new Error('Thiếu chatId');
      out = await api('GET', `/ai/${chatId}`);
      break;
    }
    case 'cmd':
    case 'command': {
      const chatId = args[0];
      const text = args.slice(1).join(' ').trim();
      if (!chatId || !text) throw new Error('Dùng: cmd <chatId> /status');
      out = await api('POST', '/command', { chatId, text });
      break;
    }
    default:
      throw new Error(`Lệnh không biết: ${cmd} (gõ help)`);
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('❌', e.message);
  if (e.data) console.error(JSON.stringify(e.data, null, 2));
  process.exit(1);
});
