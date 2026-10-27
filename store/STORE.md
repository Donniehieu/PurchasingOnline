# Đăng tiện ích lên Chrome Web Store (để Chrome tự cập nhật)

Chrome chỉ tự cập nhật tiện ích cài từ Web Store (hoặc bằng chính sách doanh nghiệp). Tiện ích nạp từ thư mục thì không, nên đăng lên Store là cách duy nhất để **mọi người dùng khỏi cập nhật tay**. Edge dùng được cùng file zip (Edge Add-ons).

## Làm một lần
1. Tạo tài khoản nhà phát triển: chrome.google.com/webstore/devconsole (phí 5 USD một lần, bạn tự thanh toán).
2. Chạy `npm run build:ext`, tải `dist/mua-hang-extension-v<phiên bản>.zip` lên *New item*.
3. Điền mục Store listing bằng nội dung bên dưới. **Visibility: Unlisted** (chỉ ai có link mới cài được) là đủ cho dùng nội bộ.
4. Privacy policy URL: `https://<địa-chỉ-app-của-bạn>/privacy.html` (trang có sẵn trong app).
5. Gửi duyệt. Quyền “đọc mọi trang web” (`<all_urls>`) thường bị xem xét kỹ, có thể mất vài ngày hoặc bị yêu cầu giải trình; dùng đoạn *Justification* bên dưới.
6. Lấy ID tiện ích (chuỗi 32 ký tự) từ trang Developer Dashboard.

## Tự đăng mỗi lần có bản mới (GitHub Actions, `.github/workflows/publish-extension.yml`)
1. Bật *Chrome Web Store API* trong Google Cloud, tạo OAuth client (Desktop), lấy **refresh token** (hướng dẫn: github.com/fregante/chrome-webstore-upload-keys).
2. Thêm 4 secret vào repository GitHub: `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`.
3. Mỗi lần phát hành: tăng `version` trong `extension/manifest.json`, commit, rồi:
```bash
git tag ext-v1.2.0
git push origin ext-v1.2.0
```
Workflow chạy test, đóng gói, đăng lên Store. Sau khi Google duyệt, Chrome của mọi người dùng tự cập nhật (thường trong vài giờ), kể cả khi chưa mở app.

## Nội dung điền vào Store listing
- **Tên**: Mua hàng thông minh — cầu nối Google Chrome
- **Mô tả ngắn (≤132 ký tự)**: Cho app Mua hàng thông minh dùng Google Chế độ AI trong Chrome của bạn và đọc trang web có giới hạn tốc độ.
- **Danh mục**: Productivity / Shopping. **Ngôn ngữ**: Tiếng Việt.
- **Mô tả chi tiết**: Tiện ích làm cầu nối cho ứng dụng web “Mua hàng thông minh” do bạn tự triển khai. Khi ứng dụng yêu cầu, tiện ích mở Google (kể cả Chế độ AI) trong tab nền để đọc kết quả, và tải các trang bán hàng bằng kết nối của bạn. Giãn cách giữa các yêu cầu, tự ngừng khi bị chặn, không giải CAPTCHA, không đọc cookie hay nội dung các trang bạn đang xem. Chỉ nhận lệnh từ các trang bạn đã bấm “Cho phép”.
- **Single purpose**: Cho phép một ứng dụng web đã được người dùng cho phép đọc kết quả Google và tải trang sản phẩm công khai để so sánh giá.
- **Giải trình quyền**:
  - `tabs`, `scripting`: mở tab Google nền và đọc chữ hiển thị trên trang kết quả.
  - `storage`: lưu danh sách trang được phép, trạng thái tạm ngừng tên miền, cache kết quả Google 24 giờ.
  - `alarms`: kiểm tra định kỳ (chỉ bản cài từ thư mục) để tự tải lại khi file đổi.
  - `host_permissions` `<all_urls>`: tải các trang bán hàng công khai mà người dùng yêu cầu so sánh (không biết trước tên miền); mọi địa chỉ nội bộ bị chặn, không gửi cookie.
  - `content_scripts` trên `localhost:8787` và `*.workers.dev`: nhận lệnh từ chính ứng dụng web; mọi lệnh vẫn phải qua danh sách “Cho phép”.
- **Ảnh chụp màn hình**: cần ít nhất 1 ảnh 1280×800 (chụp app khi dùng tiện ích).
