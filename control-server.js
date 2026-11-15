const http = require('http');
const { URL } = require('url');
const config = require('./config');
const Utils = require('./utils');
const Ai = require('./ai');

/**
 * HTTP control API (localhost) để Cursor/Claude/Grok điều khiển userbot.
 * Auth: Authorization: Bearer <CONTROL_API_TOKEN>
 */
function createControlServer(bot) {
  const host = config.controlApiHost || '127.0.0.1';
  const port = Number(config.controlApiPort) || 3847;
  const token = String(config.controlApiToken || '').trim();

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(bot, token, req, res);
    } catch (err) {
      Utils.log(`❌ Control API error: ${err.message}`);
      if (!res.headersSent) {
        json(res, 500, { ok: false, error: err.message || 'internal error' });
      }
    }
  });

  return {
    host,
    port,
    tokenConfigured: Boolean(token),
    start() {
      return new Promise((resolve, reject) => {
        if (!token) {
          Utils.log(
            '⚠️ Control API TẮT — đặt CONTROL_API_TOKEN trong .env để bật (ý 2: AI điều khiển userbot)'
          );
          resolve(false);
          return;
        }
        server.once('error', reject);
        server.listen(port, host, () => {
          Utils.log(`🛰️ Control API lắng nghe http://${host}:${port}`);
          Utils.log('   Auth: Authorization: Bearer <CONTROL_API_TOKEN>');
          resolve(true);
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}

async function handleRequest(bot, token, req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/health' && req.method === 'GET') {
    json(res, 200, {
      ok: true,
      running: Boolean(bot?.isRunning),
      ai: Ai.describeAiSetup(bot?.settings),
    });
    return;
  }

  if (!authorize(req, token)) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  if (path === '/status' && req.method === 'GET') {
    json(res, 200, {
      ok: true,
      running: Boolean(bot?.isRunning),
      me: summarizeMe(bot?.me),
      ai: Ai.describeAiSetup(bot?.settings),
      aiEnabledChats: listAiEnabledChats(bot),
      uptimeSec: Math.floor(process.uptime()),
    });
    return;
  }

  if (path === '/chats' && req.method === 'GET') {
    const limit = clampInt(url.searchParams.get('limit'), 1, 500, 100);
    const chats = await bot.listControlChats(limit);
    json(res, 200, { ok: true, chats });
    return;
  }

  const chatMessages = path.match(/^\/chats\/(-?\d+)\/messages$/);
  if (chatMessages && req.method === 'GET') {
    const chatId = chatMessages[1];
    const limit = clampInt(url.searchParams.get('limit'), 1, 100, 30);
    const messages = await bot.getControlMessages(chatId, limit);
    json(res, 200, { ok: true, chatId, messages });
    return;
  }

  const chatSend = path.match(/^\/chats\/(-?\d+)\/send$/);
  if (chatSend && req.method === 'POST') {
    const chatId = chatSend[1];
    const body = await readJson(req);
    const text = String(body.text || body.message || '').trim();
    if (!text) {
      json(res, 400, { ok: false, error: 'text is required' });
      return;
    }
    const replyTo = body.replyTo || body.reply_to || null;
    const result = await bot.controlSendMessage(chatId, text, replyTo);
    json(res, 200, { ok: true, ...result });
    return;
  }

  const aiChat = path.match(/^\/ai\/(-?\d+)$/);
  if (aiChat && req.method === 'GET') {
    const chatId = aiChat[1];
    json(res, 200, { ok: true, chatId, ...bot.getAiChatState(chatId) });
    return;
  }

  if (aiChat && req.method === 'POST') {
    const chatId = aiChat[1];
    const body = await readJson(req);
    const state = bot.setAiChatState(chatId, body);
    json(res, 200, { ok: true, chatId, ...state });
    return;
  }

  if (path === '/ai/provider' && req.method === 'POST') {
    const body = await readJson(req);
    const provider = Ai.normalizeProvider(body.provider);
    if (!provider) {
      json(res, 400, {
        ok: false,
        error: 'provider must be openai | claude | grok',
      });
      return;
    }
    bot.settings.aiProvider = provider;
    if (body.model) bot.settings.aiModel = String(body.model).trim();
    Utils.saveSettings(bot.settings);
    json(res, 200, { ok: true, ai: Ai.describeAiSetup(bot.settings) });
    return;
  }

  if (path === '/command' && req.method === 'POST') {
    const body = await readJson(req);
    const chatId = String(body.chatId || body.chat_id || '').trim();
    const text = String(body.text || body.command || '').trim();
    if (!chatId || !text) {
      json(res, 400, { ok: false, error: 'chatId and text are required' });
      return;
    }
    const result = await bot.controlRunCommand(chatId, text);
    json(res, 200, { ok: true, ...result });
    return;
  }

  json(res, 404, {
    ok: false,
    error: 'not found',
    endpoints: [
      'GET /health',
      'GET /status',
      'GET /chats?limit=100',
      'GET /chats/:id/messages?limit=30',
      'POST /chats/:id/send { text, replyTo? }',
      'GET /ai/:chatId',
      'POST /ai/:chatId { enabled?, prompt? }',
      'POST /ai/provider { provider, model? }',
      'POST /command { chatId, text }',
    ],
  });
}

function authorize(req, token) {
  if (!token) return false;
  const header = String(req.headers.authorization || '');
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() === token;
  }
  const alt = String(req.headers['x-api-token'] || '').trim();
  return alt === token;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Api-Token',
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function summarizeMe(me) {
  if (!me) return null;
  return {
    id: me.id?.toString?.() || String(me.id || ''),
    username: me.username || null,
    firstName: me.firstName || null,
  };
}

function listAiEnabledChats(bot) {
  const gs = bot?.settings?.groupSettings || {};
  return Object.entries(gs)
    .filter(([, v]) => v && v.aiEnabled === true)
    .map(([id, v]) => ({
      chatId: id,
      prompt: v.aiPrompt || null,
    }));
}

module.exports = { createControlServer };
