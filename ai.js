const config = require('./config');

const PROVIDER_DEFAULTS = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  claude: {
    label: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
  },
  grok: {
    label: 'Grok',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-2-latest',
  },
};

function normalizeProvider(name) {
  const raw = String(name || '')
    .trim()
    .toLowerCase();
  if (raw === 'anthropic' || raw === 'claude') return 'claude';
  if (raw === 'xai' || raw === 'grok') return 'grok';
  if (raw === 'openai' || raw === 'gpt') return 'openai';
  return '';
}

function getProviderConfig(providerOverride, settings) {
  const provider =
    normalizeProvider(providerOverride) ||
    normalizeProvider(settings?.aiProvider) ||
    normalizeProvider(config.aiProvider) ||
    'openai';
  const defaults = PROVIDER_DEFAULTS[provider];
  let apiKey = '';
  if (provider === 'claude') apiKey = config.anthropicApiKey || '';
  else if (provider === 'grok') apiKey = config.xaiApiKey || '';
  else apiKey = config.openaiApiKey || '';

  return {
    provider,
    label: defaults.label,
    apiKey,
    model:
      String(settings?.aiModel || '').trim() ||
      String(config.aiModel || '').trim() ||
      defaults.model,
    baseUrl: defaults.baseUrl,
  };
}

function hasApiKey(providerOverride, settings) {
  return Boolean(getProviderConfig(providerOverride, settings).apiKey);
}

function describeAiSetup(settings) {
  const cfg = getProviderConfig(null, settings);
  return {
    provider: cfg.provider,
    label: cfg.label,
    model: cfg.model,
    configured: Boolean(cfg.apiKey),
  };
}

async function chatCompletion({
  messages,
  system,
  provider: providerOverride,
  settings,
  temperature = 0.4,
  maxTokens = 800,
} = {}) {
  const cfg = getProviderConfig(providerOverride, settings);
  if (!cfg.apiKey) {
    throw new Error(
      `Chưa cấu hình API key cho ${cfg.label}. Đặt key tương ứng trong .env`
    );
  }

  const sys =
    (system && String(system).trim()) ||
    config.aiSystemPrompt ||
    'Bạn là trợ lý ngắn gọn, trả lời bằng tiếng Việt trừ khi người dùng dùng ngôn ngữ khác.';

  if (cfg.provider === 'claude') {
    return chatClaude({
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: sys,
      messages,
      temperature,
      maxTokens,
    });
  }

  return chatOpenAiCompatible({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    system: sys,
    messages,
    temperature,
    maxTokens,
    label: cfg.label,
  });
}

async function chatOpenAiCompatible({
  baseUrl,
  apiKey,
  model,
  system,
  messages,
  temperature,
  maxTokens,
  label,
}) {
  const payloadMessages = [];
  if (system) payloadMessages.push({ role: 'system', content: system });
  for (const m of messages || []) {
    if (!m || !m.content) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    payloadMessages.push({ role, content: String(m.content) });
  }
  if (payloadMessages.filter((m) => m.role === 'user').length === 0) {
    throw new Error('Không có nội dung user để gửi AI');
  }

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: payloadMessages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) {
    throw new Error(`${label} trả về nội dung rỗng`);
  }
  return String(text).trim();
}

async function chatClaude({
  apiKey,
  model,
  system,
  messages,
  temperature,
  maxTokens,
}) {
  const claudeMessages = [];
  for (const m of messages || []) {
    if (!m || !m.content) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    // Anthropic yêu cầu xen kẽ user/assistant; gộp nếu trùng role liên tiếp
    const content = String(m.content);
    const last = claudeMessages[claudeMessages.length - 1];
    if (last && last.role === role) {
      last.content += `\n${content}`;
    } else {
      claudeMessages.push({ role, content });
    }
  }
  if (!claudeMessages.length || claudeMessages[0].role !== 'user') {
    throw new Error('Claude cần ít nhất một tin nhắn user');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: claudeMessages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const parts = Array.isArray(data?.content) ? data.content : [];
  const text = parts
    .filter((p) => p && p.type === 'text' && p.text)
    .map((p) => p.text)
    .join('\n')
    .trim();
  if (!text) {
    throw new Error('Claude trả về nội dung rỗng');
  }
  return text;
}

/** Lịch sử hội thoại trong RAM theo chat (không ghi disk). */
class ChatHistoryStore {
  constructor(maxTurns = 12) {
    this.maxTurns = Math.max(2, maxTurns);
    this.map = new Map();
  }

  get(chatId) {
    return this.map.get(String(chatId)) || [];
  }

  push(chatId, role, content) {
    const key = String(chatId);
    const list = this.map.get(key) || [];
    list.push({ role, content: String(content) });
    while (list.length > this.maxTurns * 2) {
      list.shift();
    }
    this.map.set(key, list);
  }

  clear(chatId) {
    this.map.delete(String(chatId));
  }
}

module.exports = {
  PROVIDER_DEFAULTS,
  normalizeProvider,
  getProviderConfig,
  hasApiKey,
  describeAiSetup,
  chatCompletion,
  ChatHistoryStore,
};
