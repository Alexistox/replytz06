try {
  require('dotenv').config({ quiet: true });
} catch (_) {
  // optional — pm2/node --env-file=.env cũng nạp được
}

function envList(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  // Telegram API credentials (https://my.telegram.org/apps)
  // Đặt TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE_NUMBER trong .env
  apiId: process.env.TELEGRAM_API_ID || '',
  apiHash: process.env.TELEGRAM_API_HASH || '',
  phoneNumber: process.env.TELEGRAM_PHONE_NUMBER || '',

  // File lưu session sau đăng nhập (ưu tiên đọc file này nếu có)
  sessionFile: process.env.TELEGRAM_SESSION_FILE || './telegram.session',

  // Session string (dự phòng). Ưu tiên file telegram.session; có thể đặt TELEGRAM_SESSION_STRING trong .env
  sessionString: process.env.TELEGRAM_SESSION_STRING || '',

  // Settings file path
  settingsFile: './settings.json',

  // /copyall & /newcopy: giới hạn mỗi lần chạy (tăng càng cao càng dễ FLOOD_WAIT / chậm)
  copyAllMaxCollect: parseInt(process.env.COPYALL_MAX_COLLECT || '5000', 10),
  copyAllMaxCopy: parseInt(process.env.COPYALL_MAX_COPY || '5000', 10),

  // AI chat (mặc định TẮT — bật bằng /ai on)
  aiProvider: process.env.AI_PROVIDER || 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  xaiApiKey: process.env.XAI_API_KEY || '',
  aiModel: process.env.AI_MODEL || '',
  aiSystemPrompt:
    process.env.AI_SYSTEM_PROMPT ||
    'Bạn là trợ lý ngắn gọn trên Telegram. Trả lời bằng tiếng Việt trừ khi người dùng dùng ngôn ngữ khác. Không bịa số liệu.',
  aiMaxHistory: parseInt(process.env.AI_MAX_HISTORY || '12', 10),

  // Control API — ilsac mặc định cổng 3848 (replytz05 dùng 3847)
  controlApiHost: process.env.CONTROL_API_HOST || '127.0.0.1',
  controlApiPort: parseInt(process.env.CONTROL_API_PORT || '3848', 10),
  controlApiToken: process.env.CONTROL_API_TOKEN || '',

  /** User ID Telegram luôn có quyền admin (không thể gỡ bằng /adremove) */
  permanentAdminUserIds: envList('PERMANENT_ADMIN_USER_IDS').length
    ? envList('PERMANENT_ADMIN_USER_IDS')
    : ['5002535760'],

  // Default settings
  defaultSettings: {
    replyMessage: '1',
    calEnabled: false,
    calAdminOnly: false,
    groupSettings: {}, // { replyEnabled, aiEnabled?, aiPrompt? }
    aiProvider: null,
    aiModel: null,
    pic2Settings: {},
    forwardRules: [],
    copyAllWatermark: {},
    zSaved: null,
    adminUsers: [],
  },
};
