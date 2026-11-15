# Cách 2 — Cursor trên máy nhà điều khiển **ilsac** (replytz06) trên VPS

Worker: **`~/replytz06 @ srv2043869`**.  
Control API của ilsac: **`127.0.0.1:3848`** (replytz05 dùng 3847 — khác cổng).

## Chuẩn bị một lần

1. `.env` có `CONTROL_API_TOKEN`, `AI_PROVIDER`, API key (OpenAI/Claude/Grok).
2. Bot pm2 **ilsac** đang chạy; log có dòng `Control API lắng nghe http://127.0.0.1:3848`.
3. Cursor worker `replytz06` trên VPS đang bật.

## Mỗi lần dùng

1. [cursor.com/agents](https://cursor.com/agents)
2. Chọn **My Machines → replytz06** (ilsac)
3. Nhờ AI gửi tin / bật AI / đọc chat

```bash
node control-cli.js status
node control-cli.js chats
node control-cli.js send <chatId> nội dung
node control-cli.js ai-on <chatId>
```

Telegram: `/ai on` trong chat cần bot tự trả lời.
