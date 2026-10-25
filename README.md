# Mua hàng tự động

Hỗ trợ quy trình mua hàng: nhập tên, model hoặc ảnh sản phẩm, app tự tìm hiểu trên **Google**, hỏi lại bạn các câu hỏi dựng từ dữ liệu vừa đọc, so sánh giá nhà cung cấp (NCC), đề xuất NCC, tìm hiểu giá, ưu nhược điểm, công nghệ, phân loại, lưu ý khi mua, tóm tắt bài viết bạn đưa vào, rồi xuất Excel.

## Cài đặt (tiện ích Chrome / Cốc Cốc / Brave / Edge)

App chạy trong trình duyệt của bạn dưới dạng tiện ích, vì cần mở google.com và đọc các website khác mà trang web thường không được phép (CORS). Cài bằng cùng một cách trên mọi trình duyệt Chromium:

1. Mở trang tiện ích: `chrome://extensions` (Chrome), `coccoc://extensions` (Cốc Cốc), `brave://extensions` (Brave), `edge://extensions` (Edge).
2. Bật **Chế độ nhà phát triển** (Developer mode).
3. Bấm **Tải tiện ích đã giải nén** (Load unpacked), chọn thư mục `docs` của dự án.
4. Bấm biểu tượng **Mua hàng tự động** để mở app. Sau khi sửa mã hoặc cập nhật, **bấm nút tải lại** ở tiện ích (nếu không, tiện ích chạy bản cũ và app báo banner đỏ).
5. Vào **Cài đặt**, bấm **Thử Google** để kiểm tra.

Yêu cầu Chrome từ bản 110. Safari không cài thẳng được (cần macOS và Xcode: `xcrun safari-web-extension-converter docs/`), chưa thử.

**Điện thoại:** giao diện co giãn theo màn hình (bảng NCC và lịch sử thành thẻ xếp dọc). Nhưng Chrome trên điện thoại không cài được tiện ích nên không mở được Google và đọc trang NCC; trên điện thoại chỉ xem lại lịch sử và kết quả đã có, sửa bảng, xuất file. Muốn tìm kiếm trên điện thoại thì cần trình duyệt điện thoại hỗ trợ tiện ích (như Kiwi Browser hoặc Firefox cho Android, tôi chưa thử).

## Luồng dùng

**Tab Yêu cầu mới**
1. **Dữ liệu đầu vào:** nhập tên, model, số lượng, mục đích, hoặc chỉ cung cấp ảnh. Nếu chỉ có ảnh, app đọc chữ trong ảnh rồi tự điền tên, model và từ khóa tìm kiếm (cần khóa Anthropic ở Cài đặt, hoặc trình duyệt có bộ đọc chữ sẵn).
2. **Cấu hình:** số trang Google cần research (1-5, mỗi trang mở hết các link), số ảnh vào album (1-20), thời gian chờ giữa hai lần mở trang (mặc định 3 giây; gửi lệnh xong có phản hồi mới chờ rồi gửi lệnh kế, không dồn dập).
3. **Tìm hiểu:** tick hoặc bỏ 5 chủ đề (giá trung bình, ưu nhược điểm, công nghệ sử dụng, phân loại, lưu ý khi mua); gõ thêm từ khóa/câu hỏi (app đọc bài ở trang 1-2 của Google để trả lời); nhập link hoặc nhập từ Excel/CSV các bài viết tham khảo (app đọc và tóm tắt).
4. **Tiến trình:** hiện từng bước và chi tiết "trang Google 2/3, đọc link 4/10". Có nút Dừng; dừng sớm thì tổng hợp phần đã có.
5. **10 câu hỏi, trong một khối, trả lời xong tự sang câu kế:** 5 câu cố định (tên sản phẩm, model, số lượng, mục đích sử dụng, hãng sản xuất = tên hãng trên sản phẩm, không phải tên website/NCC) và 5 câu dựng từ dữ liệu crawl (thông số, ngân sách, bảo hành, chất liệu, VAT, ưu tiên...). Mỗi lựa chọn kèm "thấy ở n/N trang"; chọn sẵn giá trị khi có từ 2 trang trở lên đồng ý; không có dữ liệu web thì dùng gợi ý chung và ghi rõ.
6. **Kết quả:**
   - **Bảng so sánh giá và đề xuất:** Tên NCC, Tên sản phẩm / model, Số lượng, Đơn giá, VAT, Thông tin sản phẩm (thông số kỹ thuật), Liên hệ. Bấm tên sản phẩm mở đúng trang bán sản phẩm đó (không phải trang chủ NCC). Chỉ trang bán một sản phẩm, đúng model, mới vào bảng; giá phải đọc chắc chắn từ dữ liệu của trang (JSON-LD, thẻ giá, hoặc số sau chữ "giá"), nếu không thì để trống và báo "Chưa có giá chính xác". Liên hệ lấy từ trang sản phẩm và trang Liên hệ của NCC. Xuất Excel .xlsx.
   - Tìm hiểu theo chủ đề đã chọn, trả lời cho câu hỏi bạn gõ thêm, tóm tắt từng bài tham khảo (đề mục, ý chính, số liệu, câu hỏi liên quan theo ngành hàng), đều có link nguồn; album ảnh Google Hình ảnh đặt theo tên + model để so khớp; kịch bản đàm phán, luận điểm thuyết phục sếp, soạn email.

**Tab Lịch sử tìm kiếm:** bảng STT, Tiêu đề, Số lượng, Từ khóa đã tìm, Các trang đã tìm; bấm một dòng để xem chỉ tiêu chi tiết và mở lại từng lần tìm; xuất Excel.

**Tab Cài đặt:** thử Google, giá trị mặc định (số trang, số ảnh, thời gian chờ), khóa Anthropic, email sếp, sao lưu và khôi phục.

## Cách app đọc và trả lời (tối ưu số lần mở trang)

- **Mỗi trang chỉ mở một lần.** Khi mở một trang, app xử lý ngay thành "tài liệu" trong kho dữ liệu của yêu cầu (câu đã chuẩn hóa, giá, hãng/model, thông số, liên hệ, đề mục) rồi bỏ HTML. Trang đã có trong kho thì dùng lại, không mở lại và không phải chờ.
- **Một lượt quét trả lời nhiều câu hỏi.** Các chủ đề (giá, ưu nhược điểm, công nghệ, phân loại, lưu ý khi mua) và các câu hỏi gõ thêm được chấm cùng lúc trên cùng kho, nên thêm câu hỏi không làm tăng số trang phải mở.
- **Chỉ tìm thêm cho phần còn thiếu.** Câu nào kho đã trả lời được (từ 2 câu trích trở lên) thì không tìm. Các chủ đề còn thiếu được gộp thành **một** lượt tìm Google (tối đa 2 lượt); câu hỏi gõ thêm còn thiếu mới tìm riêng.
- **Kho được lưu bền vững** trong trình duyệt (giữ kho của 10 yêu cầu gần nhất). Sau khi có kết quả, ô "Hỏi thêm" ở khối câu hỏi bổ sung trả lời ngay từ kho, không mở lại trang; chỉ khi kho chưa đủ mới tìm thêm.
- Mô phỏng cùng kịch bản (2 trang tìm sản phẩm, 2 trang tìm NCC, 5 chủ đề, 3 câu hỏi gõ thêm): cách cũ 20 lượt tải trang Google và 95 lần mở trang web; cách mới 10 lượt và 58 lần, không mở lại trang nào. Số liệu thật phụ thuộc kết quả Google.

## Giới hạn cần biết

- Google có thể hiện trang xác minh hoặc báo 403 khi truy cập tự động. App báo rõ và **không vượt qua**; hãy tăng thời gian chờ, giảm số trang, hoặc mở google.com xác minh rồi thử lại.
- Mỗi trang Google mở hết các link nên chạy lâu (vài phút); thời gian chờ càng lớn càng chậm nhưng càng ít bị chặn.
- Câu trả lời tìm hiểu là câu trích nguyên văn từ bài viết bằng quy tắc từ khóa, không phải AI viết; hãy mở nguồn để kiểm tra. Giá chỉ để tham khảo vì trang có thể có nhiều phiên bản, khuyến mãi.
- Dữ liệu và khóa chỉ lưu trong trình duyệt; ảnh album lưu thu nhỏ và không nằm trong file sao lưu.

## Kiểm thử

```bash
node --test tests-js/core.test.mjs tests-js/flow.test.mjs tests-js/corpus.test.mjs
```

Chạy thử giao diện như trang web thường (không có Google và crawl): `python tools/serve_docs.py` rồi mở http://localhost:8080.

---

**Bản Python (Flask) dưới đây không còn được cập nhật, chỉ giữ để tham khảo.**

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
