module.exports = {
  // Telegram API credentials (https://my.telegram.org/apps)
  // Docker: đặt TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE_NUMBER trong docker-compose.yml
  apiId: process.env.TELEGRAM_API_ID || '30863026',
  apiHash: process.env.TELEGRAM_API_HASH || '41ddc59d6993fb9623f65f03e17cea2b',
  phoneNumber: process.env.TELEGRAM_PHONE_NUMBER || '+84384306798',

  // File lưu session sau đăng nhập (ưu tiên đọc file này nếu có). Docker: có thể TELEGRAM_SESSION_FILE
  sessionFile: process.env.TELEGRAM_SESSION_FILE || './telegram.session',

  // Session string (dự phòng / đồng bộ; bot tự ghi file + config.js sau login)
sessionString: "",

  // Settings file path
  settingsFile: './settings.json',

  // /copyall & /newcopy: giới hạn mỗi lần chạy (tăng càng cao càng dễ FLOOD_WAIT / chậm)
  copyAllMaxCollect: parseInt(process.env.COPYALL_MAX_COLLECT || '5000', 10),
  copyAllMaxCopy: parseInt(process.env.COPYALL_MAX_COPY || '5000', 10),

  // Default settings
  defaultSettings: {
    replyMessage: '1', // Tin nhắn reply
    groupSettings: {}, // Settings reply theo từng group: { [groupId]: { replyEnabled: boolean } }
    pic2Settings: {}, // Pic2: { [groupId]: [ { id, enabled, targetUser, replyMessage }, ... ] }
    forwardRules: [], // Rules cho auto forward: { sourceGroupId, destGroupId, trigger, createdBy, createdTime, status }
    copyAllWatermark: {}, // /copyall & /newcopy: { "sourceId_destId": lastMessageId }
    adminUsers: [] // Danh sách user IDs có quyền admin: [userId1, userId2, ...]
  }
}; 