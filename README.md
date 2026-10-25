# Mua hàng tự động

## Cài làm tiện ích Cốc Cốc / Chrome (khuyến nghị)

Cách này không cần Python hay Flask. App chạy ngay trong trình duyệt của bạn nên: tìm được bằng **Cốc Cốc** và **DuckDuckGo** không cần khóa, đọc được cả trang cần JavaScript (Shopee, TikTok Shop), không bị chặn CORS, và crawl ảnh về album.

1. Mở `coccoc://extensions` (Cốc Cốc) hoặc `chrome://extensions` (Chrome).
2. Bật **Chế độ nhà phát triển** (Developer mode) ở góc trên.
3. Bấm **Tải tiện ích đã giải nén** (Load unpacked), chọn thư mục `docs` của dự án này.
4. Bấm biểu tượng tiện ích **Mua hàng tự động** trên thanh công cụ để mở giao diện (ghim nó nếu không thấy).
5. Vào tab **Cài đặt**, bấm **Thử Cốc Cốc** và **Thử DuckDuckGo** để kiểm tra. Khi tìm, tiện ích mở một tab nền như bạn tự tìm rồi tự đóng, mỗi lượt vài giây.

Quyền tiện ích xin: đọc mọi website (để tải trang NCC và ảnh) và mở/đọc tab nền. Dữ liệu và khóa chỉ lưu trong trình duyệt của bạn. Sau khi sửa mã trong `docs/`, bấm nút tải lại trên trang tiện ích.

Chạy thử như trang web thường (không có Cốc Cốc, không crawl ảnh): `python tools/serve_docs.py` rồi mở http://localhost:8080.

Bản Python (Flask) bên dưới vẫn còn nhưng không còn là hướng chính.

Hỗ trợ quy trình mua hàng: nhập tên sản phẩm hoặc ảnh, xác nhận bằng question card, so sánh NCC, điền form duyệt báo giá (Excel), gợi ý NCC tốt nhất, soạn kịch bản đàm phán và luận điểm thuyết phục sếp.

Repository có **hai bản**:

| Bản | Thư mục | Chạy ở đâu | Tải trang NCC |
|---|---|---|---|
| **Web tĩnh (GitHub Pages)** | `docs/` | Trình duyệt, không cần máy chủ | Trực tiếp nếu website cho phép, hoặc qua proxy của bạn |
| Bản Python (Flask) | `app.py`, `purchasing/` | Máy của bạn | Server tải trang, không bị chặn CORS |

## Cài đặt qua GitHub Pages (bản web tĩnh)

1. Đẩy mã lên GitHub (nhánh `main`).
2. Vào repository → **Settings → Pages**.
3. Mục **Build and deployment**: Source chọn **Deploy from a branch**, Branch chọn **main**, thư mục **/docs**, bấm **Save**.
4. Đợi 1-2 phút, trang chạy tại `https://TEN_BAN.github.io/TEN_REPO/` (ở repository này: `https://donniehieu.github.io/PurchasingOnline/`).
5. Mở trang, vào tab **Cài đặt** để nhập khóa và proxy (xem bên dưới).

Lưu ý quan trọng của bản web tĩnh:
- GitHub Pages chỉ phục vụ file tĩnh, nên mọi xử lý chạy trong trình duyệt. **Dữ liệu và khóa API chỉ lưu trong trình duyệt của bạn** (localStorage), nên hãy dùng nút sao lưu ở tab Cài đặt.
- Trình duyệt chỉ đọc trực tiếp được website nào cho phép (CORS). Thử thực tế: `vuabaoho.com` đọc được, `kenkovn.com` và `baoholaodongmienbac.com` thì không. NCC không đọc được vẫn hiện trong bảng để bạn mở link và nhập tay.
- Để đọc được nhiều website hơn và dùng Brave, hãy triển khai Cloudflare Worker miễn phí của bạn từ `tools/cors-worker.js` (hướng dẫn ngay trong tab Cài đặt). Mã Worker chưa được chạy thử trên Cloudflare. Các proxy công cộng miễn phí khi thử đều không dùng được (hết thời gian hoặc đòi khóa).
- Không gửi được email trực tiếp. Nút "Soạn email" tải file xlsx và mở email nháp để bạn tự đính kèm file.
- Repository để **Private** thì GitHub Pages cần gói trả phí; repository Public thì ai cũng mở được trang (không có dữ liệu của bạn vì nó nằm trong trình duyệt).

Chạy thử bản web tĩnh trên máy:

```bash
python -m http.server 8080 --directory docs
```

Trên Windows nếu trình duyệt báo lỗi MIME của file .js, dùng một máy chủ tĩnh khác (ví dụ `npx serve docs`).

Chạy test lõi JavaScript:

```bash
node --test tests-js/core.test.mjs
```

---

# Bản Python (Flask)

## Chạy trên máy

Cách nhanh trên Windows: bấm đúp `run.bat` (tự cài thư viện, mở trình duyệt tại http://127.0.0.1:5000). Engine DuckDuckGo không cần khóa nên chạy được ngay.

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
