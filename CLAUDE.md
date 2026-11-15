# Userbot — Claude Code pilot

Bạn đang ở repo userbot Telegram trên VPS.

## Điều khiển bot

Chạy trong thư mục này:

```bash
node control-cli.js status
node control-cli.js chats
node control-cli.js messages <chatId> 20
node control-cli.js send <chatId> nội dung
node control-cli.js ai-on <chatId>
node control-cli.js ai-off <chatId>
```

Control API chỉ listen localhost (có `CONTROL_API_TOKEN` trong `.env`). `control-cli.js` đã đọc token giúp bạn.

## Telegram pilot

Admin nhắn `/cc on` hoặc `/cc …` trên Telegram; stdout của bạn được gửi lại cho họ. Chỉ hành động khi họ yêu cầu rõ.
