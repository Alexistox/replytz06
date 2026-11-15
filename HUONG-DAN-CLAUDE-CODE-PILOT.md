# Claude Code cầm userbot — chat từ iPhone qua Telegram

## Mục tiêu

- Claude Code chạy **trên VPS**, điều khiển userbot bằng `control-cli.js`
- Bạn dùng **iPhone → Telegram** (DM với tài khoản userbot / admin) để nói chuyện với Claude Code đó
- App Claude trên iPhone **không** gắn trực tiếp session Claude Code trên VPS — dùng Telegram

## Chuẩn bị một lần (VPS)

```bash
npm i -g @anthropic-ai/claude-code
claude auth login
# làm theo link đăng nhập (cùng tài khoản Claude Pro/Max của bạn)
claude auth status   # loggedIn: true
```

Bot (pm2 `replytz05` / `ilsac`) đã có Control API + lệnh `/cc`.

## Mỗi lần dùng (iPhone)

1. Mở Telegram → chat với **Kei (tz05)** hoặc **ilsac (tz06)** (nên dùng Saved Messages / DM)
2. Gửi (với tài khoản admin):

```text
/cc on
```

3. Nhắn bình thường, ví dụ:

```text
Xem status bot rồi liệt kê chats
Gửi "xin chào" vào chatId …
```

4. Tắt:

```text
/cc off
```

Một lần lẻ (không bật mode):

```text
/cc liệt kê chats
```

## Lưu ý

- Chỉ **admin** (`PERMANENT_ADMIN_USER_IDS` / admin list) dùng được `/cc`
- Một lúc chỉ một yêu cầu Claude Code (tránh spam)
- Gói Claude Code dùng qua CLI theo điều khoản Anthropic — chỉ dùng cho chính bạn, không share bot công khai
