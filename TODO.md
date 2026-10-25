# TODO - Ứng dụng mua hàng tự động

## Yêu cầu
- Nhập tên hoặc mã sản phẩm, số lượng, mục đích sử dụng, hoặc upload ảnh sản phẩm.
- App tự tìm web theo engine đã chọn (Google, Brave, Bing, Yahoo), đọc trang NCC, điền form duyệt báo giá.
- Link NCC có thể nhập tay hoặc import từ Excel/CSV. Phần để trống thì app tự tìm và tự điền.
- Form có cột A–H như mẫu, thêm cột I "Ngày cập nhật trên web" (để trống nếu không tìm thấy).
- Có bảng so sánh giá, biểu đồ, kịch bản đàm phán NCC, luận điểm thuyết phục sếp.
- Gửi form cho sếp chỉ khi người dùng bấm xác nhận.

## Đã làm
- [x] Web app Flask: ô tên/mã sản phẩm, số lượng, mục đích, upload nhiều ảnh, chọn engine, nhập link NCC
- [x] Engine: Google (Custom Search API), Brave (API), Bing (HTML), Yahoo (HTML). Engine chưa có khóa bị mờ
- [x] Gộp kết quả nhiều engine, xen kẽ và bỏ link trùng domain. Một engine lỗi không làm hỏng các engine khác
- [x] Import link NCC từ .xlsx / .csv / .txt. Xuất link NCC ra CSV
- [x] Đọc trang NCC: giá (ưu tiên giá sau chữ "giá"), dung lượng mAh, điện áp, bảo hành, VAT, ngày cập nhật, mô tả trang
- [x] Lọc trang không đúng sản phẩm bằng cụm 2 từ khóa; mã sản phẩm nếu nhập thì bắt buộc có trên trang
- [x] Chấm điểm NCC: giá trên 1.000mAh 40%, bảo hành 25%, VAT 20%, độ phù hợp 15%; loại NCC không có VAT
- [x] Form Excel: cột A–I, tô xanh đậm NCC khuyến nghị, ghi chú nguồn và trạng thái xác minh
- [x] Sheet "Thông tin yêu cầu", "So sánh giá" (biểu đồ cột), "Đàm phán NCC", "Thuyết phục sếp", "Nguồn tham khảo", "Hình ảnh"
- [x] Giao diện: tick engine, bảng hover làm sáng dòng, kéo chuột để xem trái/phải/lên/xuống, biểu đồ tỷ lệ giá, kịch bản đàm phán, luận điểm sếp
- [x] Gửi sếp kèm luận điểm, chỉ khi bấm xác nhận
- [x] Kiểm thử: job end-to-end qua Flask test client; giao diện trên trình duyệt (render, hover, kéo bảng)

## Lỗi đã sửa
- [x] Bing trả quạt cầm tay thay vì quạt áo: kiểm tra cụm 2 từ thay vì từng từ
- [x] Giá lấy nhầm phụ kiện: ưu tiên giá đứng sau chữ "giá"
- [x] Lỗi encoding tiếng Việt trên Windows: chạy `python -X utf8`
- [x] Trang lỗi làm hỏng cả lượt tìm: bắt lỗi từng trang
- [x] Yahoo trả HTTP 500: hiển thị lỗi theo engine, không dừng job

## Luồng hai bước: xác nhận trước khi tìm
- [x] Bước 1 (`POST /api/jobs`): lưu yêu cầu và ảnh, sinh 6 question card, job ở trạng thái `awaiting_confirmation`. Chưa tìm kiếm.
- [x] Card: tên sản phẩm (có đoán từ ảnh nếu có), mã/model, dung lượng pin, điện áp, số lượng, mục đích. Mỗi card có "Khác" để nhập tay.
- [x] Bước 2 (`POST /api/jobs/<id>/confirm`): kiểm tra đầu vào (số lượng, mAh, điện áp là số, có engine hoặc link NCC), rồi mới chạy tìm kiếm.
- [x] Từ khóa tìm kiếm không lặp thông số đã có trong tên sản phẩm.
- [x] Sheet "Thông tin yêu cầu" ghi thêm "Thông số đã xác nhận".
- [x] Ghi job.json dưới khóa để tránh đọc file đang ghi dở.
- [x] Kiểm thử: API (tạo, xác nhận sai, xác nhận hai lần, chạy đầy đủ) và giao diện (hiện card, nhập "Khác" sai bị chặn, xác nhận, kết quả hiện ra).

## Đợt cập nhật: cài đặt, nghiên cứu, liên hệ NCC
- [x] Tab Cài đặt: nhập khóa Google, Brave, Anthropic, SMTP trên giao diện, lưu `data/settings.json`, che khóa khi hiển thị, nút Thử kết nối
- [x] Không có nút "đăng nhập Google/Brave": hai dịch vụ này dùng khóa API chứ không có OAuth cấp quyền cho app
- [x] Tên NCC bấm được để mở website
- [x] 3 chủ đề tick sẵn (công nghệ/ưu nhược điểm, giá trung bình, công nghệ sử dụng) thêm từ khóa cho lượt tìm kiến thức, kèm ô từ khóa thêm
- [x] Giá trung bình, trung vị, thấp nhất, cao nhất tính từ các NCC đã đọc
- [x] Đọc chữ trong ảnh (OCR) bằng Claude khi có khóa, hoặc pytesseract nếu đã cài Tesseract; chữ đọc được thành card tick để thêm vào từ khóa
- [x] Thu thập liên hệ NCC từ trang (điện thoại, Zalo, Messenger, Facebook, email, Skype) và hiển thị trong khối "Liên hệ NCC", có nút sao chép email hỏi giá
- [x] Tab Lịch sử, chế độ tối, toast, in trang, sao chép luận điểm
- [x] README (hướng dẫn GitHub, đề xuất quy trình), .gitignore, 8 unit test, GitHub Actions CI
- [x] Chặn domain rác/người lớn từ Bing HTML, yêu cầu trang nghiên cứu phải đúng sản phẩm

## Vấn đề đã biết
- Bing HTML từ máy này trả kết quả sai với truy vấn tiếng Việt dài (nhiều trang không liên quan). Phần "Kiến thức sản phẩm" chưa trích được câu nào khi thử bằng Bing. Cần Brave (hoặc Google nếu tài khoản cũ còn quyền) để phần này có kết quả.
- Google Custom Search JSON API đã đóng với khách hàng mới (ngừng hẳn 01/01/2027), dự án mới thường lỗi 403.
- Brave: các nguồn cho biết gói mới có khoảng 5 USD tín dụng/tháng và cần thẻ; xác nhận trên trang giá chính thức.
- Liên hệ lấy từ trang sản phẩm đã đọc, không đọc thêm trang "Liên hệ". Zalo suy từ số điện thoại được ghi rõ "chưa xác nhận".
- Chưa kiểm thử Google, Brave, Anthropic với khóa hợp lệ, và chưa gửi email thật.

## Đợt cập nhật: lịch sử, sửa bảng, xuất xlsx
- [x] Tab "Lịch sử tìm kiếm": gộp theo tên sản phẩm (không phân biệt hoa thường, dấu). Phiếu đóng sẵn, bấm để mở, nút Đóng để thu lại
- [x] Chỉ tiêu mỗi phiếu: số lượt tìm, từ khóa đã dùng, trang web đã thử, NCC, giá trung bình/trung vị/thấp nhất/cao nhất, biến động giá đầu-cuối, engine, tổng số lượng, số lần sửa bảng, NCC được khuyến nghị, danh sách các lần tìm
- [x] Xuất lịch sử tổng hợp ra .xlsx (2 sheet: tổng hợp, chi tiết NCC)
- [x] Sửa trực tiếp ô trong bảng (NCC, giá, pin, điện áp, bảo hành, VAT, ngày, ghi chú): tự lưu, chấm điểm lại, đổi NCC khuyến nghị, cập nhật file Excel
- [x] Tab "Lịch sử điều chỉnh": lọc theo sản phẩm/NCC/trường, ẩn/hiện cột, xuất .xlsx; mỗi file báo giá có thêm sheet "Lịch sử điều chỉnh"
- [x] Bảng kết quả: ô lọc chữ, lọc trạng thái, ẩn/hiện cột (nhớ lựa chọn), kéo chuột để xem vẫn dùng được và không chặn việc sửa ô
- [x] Kịch bản đàm phán dựa trên dữ liệu: NCC rẻ hơn, bảo hành tốt hơn, tuổi của thông tin giá, số lượng, thông số và mục đích đã xác nhận, câu trích tham khảo từ web kèm nguồn, 6 bước đàm phán theo quy trình mua hàng
- [x] Luận điểm thuyết phục sếp theo 5 phần: nhu cầu, khảo sát thị trường, vì sao đề xuất, rủi ro và cách kiểm soát, bước tiếp theo
- [x] Không có email sếp thì không tự gửi: nút gửi chuyển thành tải file .xlsx
- [x] Mọi export đều là .xlsx (link NCC, form, lịch sử, điều chỉnh)
- [x] Giao diện mới: bo góc mềm, đổ bóng nhẹ, nút dạng viên thuốc, thanh tab dạng phân đoạn, chế độ tối
- [x] Test: 12 unit test đạt, thêm kiểm thử API sửa ô, lịch sử, xuất xlsx; kiểm thử giao diện (mở/đóng phiếu, sửa ô, ẩn cột, lọc)

## Chưa làm / cần bạn quyết định
- [ ] Card dựng theo quy tắc, chưa dùng AI. Có thể soạn card bằng Claude khi có ANTHROPIC_API_KEY để gợi ý sát sản phẩm hơn
- [ ] Tìm kiếm ảnh ngược (reverse image search). Hiện ảnh chỉ được mô tả bằng Claude khi có ANTHROPIC_API_KEY
- [ ] Chưa kiểm thử với Google, Brave và ANTHROPIC_API_KEY thật (chưa có khóa)
- [ ] Chưa kiểm thử gửi email thật (chưa có SMTP)
- [ ] Yahoo hiện thường bị chặn. Nên bỏ chọn, trừ khi bạn thấy nó trả kết quả

## Hướng dẫn cấu hình

### 1. Khóa Google (Custom Search) - cần 2 giá trị
1. Vào Google Cloud Console (console.cloud.google.com), tạo project, bật **Custom Search API**, rồi tạo API key ở mục Credentials. Đó là `GOOGLE_CSE_API_KEY`.
2. Vào programmablesearchengine.google.com, tạo công cụ tìm kiếm, chọn tìm trên toàn web. Lấy **Search engine ID** (cx). Đó là `GOOGLE_CSE_ID`.
3. Hạn mức miễn phí có giới hạn và có thể thay đổi. Kiểm tra trang giá của Google trước khi dùng nhiều.

### 2. Khóa Brave Search API
1. Vào brave.com/search/api, đăng ký và lấy subscription token. Đó là `BRAVE_API_KEY`.
2. Gói miễn phí có giới hạn số lượt, kiểm tra trên trang của Brave.

### 3. Anthropic API key (tùy chọn, chỉ cho nhận diện ảnh)
- Đây là khóa để app gọi Claude, dùng để mô tả sản phẩm từ ảnh upload thành từ khóa tìm kiếm.
- Lấy tại console.anthropic.com: đăng ký, nạp tín dụng (API tính phí theo lượng dùng), mục API Keys, tạo key mới. Key bắt đầu bằng `sk-ant-`.
- Không dán key vào chat. Không có key thì app vẫn chạy, chỉ bỏ qua bước nhận diện ảnh.

### 4. Đặt biến môi trường trên Windows (PowerShell)
```bash
setx GOOGLE_CSE_API_KEY "dán-khóa-google"
```
```bash
setx GOOGLE_CSE_ID "dán-cx-google"
```
```bash
setx BRAVE_API_KEY "dán-khóa-brave"
```
```bash
setx ANTHROPIC_API_KEY "sk-ant-..."
```
Sau khi chạy `setx`, đóng và mở lại terminal rồi chạy app.

Các biến khác (tùy chọn):
- `BOSS_EMAIL`: email sếp mặc định
- `SMTP_HOST`, `SMTP_PORT` (mặc định 587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`: cấu hình gửi mail

### 5. Cài và chạy
```bash
pip install -r requirements.txt
```
```bash
python app.py
```
Mở http://127.0.0.1:5000

## Giai đoạn sau (chưa làm)
- [ ] Question card: xác nhận thông số, số lượng, mục đích trước khi tìm
- [ ] Bảng so sánh chi tiết về dịch vụ và chính sách kèm theo
- [ ] Soạn bài thuyết phục bằng AI khi có ANTHROPIC_API_KEY, thay cho đoạn văn mẫu hiện tại
- [ ] Kiểm thử tự động (pytest) cho bộ chấm điểm và bộ trích xuất giá
