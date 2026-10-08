module.exports = {
  // Telegram API credentials
  // 📚 Hướng dẫn lấy API credentials:
  // 1. Truy cập: https://my.telegram.org/apps
  // 2. Đăng nhập bằng số điện thoại Telegram
  // 3. Tạo ứng dụng mới
  // 4. Điền TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE_NUMBER vào file .env
  apiId: process.env.TELEGRAM_API_ID || 'YOUR_API_ID',
  apiHash: process.env.TELEGRAM_API_HASH || 'YOUR_API_HASH',
  phoneNumber: process.env.TELEGRAM_PHONE_NUMBER || 'YOUR_PHONE_NUMBER',

  sessionFile: process.env.TELEGRAM_SESSION_FILE || './telegram.session',
  sessionString: '',
  
  // Đường dẫn file settings
  settingsFile: './settings.json',

  copyAllMaxCollect: parseInt(process.env.COPYALL_MAX_COLLECT || '5000', 10),
  copyAllMaxCopy: parseInt(process.env.COPYALL_MAX_COPY || '3000', 10),

  // Cấu hình mặc định
  defaultSettings: {
    replyEnabled: false,        // Mặc định TẮT chức năng reply
    targetChats: [],           // Danh sách chat ID cần monitor (để trống = tất cả)
    replyMessage: '1',         // Tin nhắn reply (có thể thay đổi)
    
    // Tùy chọn nâng cao
    replyDelay: 0,             // Delay trước khi reply (ms)
    logLevel: 'info',          // Level log: 'debug', 'info', 'warn', 'error'
    maxRetries: 3,             // Số lần retry khi lỗi
  }
}; 