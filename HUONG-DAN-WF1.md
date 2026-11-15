# WF1 — Điều khiển bot khác + sửa thời gian giao dịch

## Cấu hình bot

Trong chat với userbot (admin):

```text
/wfbot @ten_bot
```

hoặc

```text
/wfbot <chatId>
```

## Chạy

```text
/wf1 on
```

Bot sẽ:

1. Vào bot đã cấu hình, gửi `/start`
2. Bấm **button đầu tiên**
3. Bấm **button thứ 2**
4. Bấm **Tài khoản còn hạn**
5. **Liệt kê** các button tài khoản trong chat này → bạn chọn (gõ `1` hoặc tên button)
6. Bấm **Chỉnh sửa giao dịch** → **Chỉnh giao dịch**
7. Lặp từng giao dịch:
   - Đọc `Nội dung:` (lấy ngày giờ) và `Thời gian:`
   - Hỗ trợ compact trong Nội dung: `151126-18:34:26` = **15/11/2026 18:34** (DDMMYY-HH:mm:ss, **bỏ giây** khi chỉnh)
   - Trùng (và không còn giây) → bỏ qua
   - Khác / còn giây → chỉnh mục thời gian (gửi `dd/mm/yyyy HH:mm`)
   - Sau khi chỉnh: **chờ tin mới** → **Quay lại** → **Quay lại** lần nữa → về list
   - Hết trang: bấm button **loạt giao dịch tiếp theo**
   - Báo cáo từng bước trong chat
8. Dừng khi không còn GD lệch / còn giây (và hết trang)

Hủy giữa chừng: `/wf1 off`

## Lưu ý

- Userbot phải từng chat / Start với bot đích (không bị chặn).
- Tên button khớp gần đúng tiếng Việt; nếu bot đích đổi nhãn, báo để chỉnh regex.
- Phần chỉnh thời gian giả định bot có button liên quan “thời gian” / “chỉnh” rồi nhận tin nhắn text.
