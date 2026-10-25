# Mua hàng tự động

Web app hỗ trợ quy trình mua hàng: nhập tên sản phẩm hoặc upload ảnh, xác nhận thông tin bằng question card, app tìm NCC trên web, điền form duyệt báo giá (Excel), gợi ý NCC tốt nhất, soạn kịch bản đàm phán và luận điểm thuyết phục sếp.

## Chạy trên máy

```bash
pip install -r requirements.txt
```

```bash
python app.py
```

Mở http://127.0.0.1:5000. Khóa API nhập ở tab **Cài đặt** (lưu trong `data/settings.json`, đã nằm trong `.gitignore`).

Chạy test:

```bash
python -m unittest discover -s tests -v
```

## Đưa lên GitHub

1. Tạo repository mới trên github.com (nên để **Private**).
2. Trong thư mục dự án:

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Khởi tạo ứng dụng mua hàng tự động"
```

3. Liên kết và đẩy lên (thay đường dẫn bằng repository của bạn):

```bash
git remote add origin https://github.com/TEN_BAN/purchasing-app.git
```

```bash
git push -u origin main
```

GitHub Actions (`.github/workflows/ci.yml`) tự chạy test mỗi lần push.

Lưu ý bảo mật: `data/` và `jobs/` không được đưa lên. Khóa API chỉ lưu dạng văn bản trên máy chạy app. App chưa có đăng nhập, nên **không triển khai công khai lên internet** (GitHub Pages không chạy được Flask). Muốn dùng nhóm, hãy chạy trong mạng nội bộ hoặc thêm đăng nhập trước.

## Đề xuất quy trình mua hàng hiệu quả hơn

| Bước | Việc cần làm | App hỗ trợ |
|---|---|---|
| 1. Yêu cầu | Người dùng nêu nhu cầu, số lượng, mục đích | Form + question card xác nhận |
| 2. Chuẩn hóa thông số | Chốt model, dung lượng, điện áp trước khi hỏi giá | Card thông số, đọc chữ trong ảnh |
| 3. Tìm NCC | Tìm nhiều NCC, loại NCC không có VAT | Tìm theo engine, chấm điểm |
| 4. Hỏi giá (RFQ) | Gửi cùng một mẫu yêu cầu cho 3 NCC trở lên | Khối Liên hệ NCC, nút sao chép email hỏi giá |
| 5. So sánh | So sánh trên cùng điều kiện (VAT, bảo hành, giao hàng) | Bảng, biểu đồ tỷ lệ giá |
| 6. Đàm phán | Chiết khấu số lượng, kéo dài bảo hành | Kịch bản đàm phán |
| 7. Trình duyệt | Trình trưởng phòng kèm bảng so sánh | Luận điểm thuyết phục, gửi mail |
| 8. Đặt hàng, nhận hàng | Hợp đồng/PO, kiểm tra hàng mẫu, nghiệm thu | Chưa làm |

Đề xuất thêm (chưa làm, nên làm tiếp theo thứ tự này):
1. **Lưu báo giá chính thức của NCC** thay cho giá lấy từ web, vì giá web thường là giá niêm yết hoặc giá phụ kiện.
2. **Lịch sử giá theo NCC**: lưu mỗi lần tra giá để thấy xu hướng và dùng làm căn cứ đàm phán.
3. **Danh sách NCC đã duyệt**: đánh dấu NCC tin cậy, đã mua, điểm đánh giá sau giao hàng.
4. **Mua thử 1-2 sản phẩm mẫu** trước đơn lớn, ghi kết quả kiểm tra vào hồ sơ.
5. **Quy trình duyệt nhiều cấp** (trưởng phòng, giám đốc) với trạng thái và nhắc việc.
6. **Theo dõi đơn hàng**: ngày giao dự kiến, thanh toán, bảo hành.
