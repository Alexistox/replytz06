# Bank Transaction UserBot

UserBot Telegram: phát hiện giao dịch ngân hàng, auto-forward, copy, và **AI chat theo từng nhóm/DM**.

## AI chat (mặc định TẮT)

Trong từng nhóm hoặc chat riêng (admin):

```text
/ai on          # bật AI trả lời chat này
/ai off         # tắt
/ai provider claude|grok|openai
/ai prompt ...  # system prompt riêng

# Claude Code cầm bot (từ iPhone qua Telegram — xem HUONG-DAN-CLAUDE-CODE-PILOT.md)
/cc on          # bật: tin admin → Claude Code trên VPS
/cc off
/cc <yêu cầu>   # một lần
```

Cần key trong `.env`: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `XAI_API_KEY` tùy `AI_PROVIDER`.

## Control API (Cursor / Claude / Grok điều khiển)

Đặt `CONTROL_API_TOKEN` trong `.env`. Bot lắng nghe `127.0.0.1:3847`.

### Cách 2 (khuyến nghị): Cursor agent chạy trên VPS

Hướng dẫn nontech: xem [`HUONG-DAN-CACH-2.md`](./HUONG-DAN-CACH-2.md).

Tóm tắt: vào [cursor.com/agents](https://cursor.com/agents) → chọn **My Machines → replytz05** → nhờ AI gửi tin / bật AI. Trên VPS agent dùng:

```bash
node control-cli.js status
node control-cli.js chats
node control-cli.js send <chatId> xin chào
node control-cli.js ai-on <chatId>
```

### Gọi HTTP trực tiếp (cùng VPS)

```bash
TOKEN=... # CONTROL_API_TOKEN
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3847/status
```

Endpoints: `/health`, `/status`, `/chats`, `/chats/:id/messages`, `/chats/:id/send`, `/ai/:chatId`, `/ai/provider`, `/command`.

## Chạy

```bash
cp .env.example .env   # điền credentials
npm install
npm start
```
