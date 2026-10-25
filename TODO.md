# TODO - Ứng dụng mua hàng tự động

## Yêu cầu hiện tại (điều chỉnh app)
- Bỏ mục Tư vấn và Lịch sử điều chỉnh. Bỏ các tính năng nhiều browser/search engine, chỉ dùng google.com. App dùng được trên PC và điện thoại.

### Tab Yêu cầu mới
- [x] **Dữ liệu đầu vào:** chữ hoặc ảnh. Chỉ có ảnh: đọc chữ trong ảnh, tự điền tên, model, từ khóa tìm kiếm (Claude khi có khóa Anthropic, hoặc bộ đọc chữ của trình duyệt)
- [x] Đủ tên + model: lấy ảnh từ Google Hình ảnh vào album đặt theo tên + model, số ảnh cấu hình 1-20 (mặc định 3); chỉ có ảnh cũng lấy ảnh vào album
- [x] Cấu hình số trang Google 1-5, mỗi trang mở hết các link để đọc
- [x] Gửi lệnh xong có phản hồi rồi mới chờ một khoảng (1-15 giây, mặc định 3, ±25% ngẫu nhiên) mới gửi lệnh kế, không dồn dập; có nút Dừng
- [x] "Thấy ở n/N trang", chọn sẵn khi có từ 2 trang đồng ý, không có dữ liệu web thì dùng gợi ý chung và ghi rõ
- [x] Điền tên sản phẩm, model, số lượng, mục đích, hãng sản xuất (tên hãng trên sản phẩm, loại tên website/NCC) rồi hỏi tổng cộng 10 câu (5 cố định + 5 từ dữ liệu crawl), nằm trong một khối, trả lời xong tự sang câu kế, có xem lại và sửa
- [x] Khối gõ thêm từ khóa/câu hỏi: tìm kèm tên sản phẩm, đọc bài ở trang 1-2 để trả lời, kèm link
- [x] 5 chủ đề tick hoặc bỏ: giá trung bình, ưu nhược điểm, công nghệ sử dụng, phân loại, lưu ý khi mua; mỗi chủ đề tìm và đọc bài liên quan, trả lời theo khối rõ ràng, có link và đoạn trả lời trích từ bài
- [x] Nhập link hoặc Excel/CSV bài tham khảo: đọc chính bài, tóm tắt bằng tiêu đề, đề mục, ý chính, số liệu; câu hỏi liên quan theo ngành hàng và câu trả lời kèm link
- [x] Bảng so sánh giá và đề xuất: Tên NCC, Tên sản phẩm / model, Số lượng, Đơn giá, VAT, Thông tin sản phẩm (thông số kỹ thuật), Liên hệ. Tên sản phẩm là link đúng trang bán sản phẩm; chỉ trang sản phẩm đúng model mới vào bảng; giá phải chắc chắn từ trang sản phẩm, không chắc thì để trống; liên hệ lấy cả trang Liên hệ của NCC
- [x] Xuất Excel .xlsx (bảng so sánh, thông tin yêu cầu, so sánh giá, đàm phán, thuyết phục, tìm hiểu, câu hỏi thêm, bài tham khảo, nguồn)

### Tab Lịch sử tìm kiếm
- [x] Giữ tính năng cũ, trình bày dạng bảng: STT, Tiêu đề, Số lượng, Từ khóa đã tìm, Các trang đã tìm (bấm dòng xem chỉ tiêu chi tiết, mở lại từng lần); xuất Excel

### Tối ưu thuật toán tìm kiếm và trả lời câu hỏi
- [x] Kho dữ liệu (`corpus.js`): mỗi trang chỉ mở một lần, xử lý ngay thành tài liệu (câu chuẩn hóa, giá, hãng/model, thông số, liên hệ, đề mục), bỏ HTML; trang đã có trong kho dùng lại không phải chờ; trang lỗi không thử lại
- [x] Trả lời nhiều câu hỏi trong một lượt quét (`answerAll`): 5 chủ đề và mọi câu hỏi gõ thêm chấm cùng lúc; kết quả giống hệt khi trả lời từng câu riêng (có test)
- [x] Chỉ tìm thêm cho câu thiếu (dưới 2 câu trích): chủ đề thiếu gộp thành một lượt Google (tối đa 2 lượt), câu gõ thêm thiếu mới tìm riêng (tối đa 4); kho đủ thì 0 lượt tìm (có test)
- [x] Kho lưu bền vững trong IndexedDB (10 yêu cầu gần nhất); ô "Hỏi thêm" trả lời ngay từ kho sau khi có kết quả, không mở lại trang
- [x] Khoảng giá của chủ đề giá lấy từ giá đọc chắc chắn của từng trang (loại phụ kiện, voucher), không quét mọi con số
- [x] Sửa lỗi mẫu nhận diện câu nói về giá không khớp "1.200.000đ" (`` sau chữ "đ"), nên chủ đề Giá trung bình trước đây thiếu câu trả lời
- [x] Mô phỏng: 20 → 10 lượt tải trang Google, 95 → 58 lần mở trang web, không mở lại trang nào; 150 bài x 300 câu trả lời 10 câu hỏi trong dưới 4 giây (có test)
- [ ] Số liệu mô phỏng chưa kiểm chứng trên Google thật

### Trả lời theo từng câu hỏi, đáp án tích lũy
- [x] Lấy ảnh trước: album ngay sau bước đọc ảnh (trước khi tìm Google), hoặc đầu giai đoạn 2 nếu lúc đầu chưa có model
- [x] Kho đáp án (`answers.js`): mỗi bài được chấm cho TẤT CẢ câu hỏi cùng lúc, đáp án bổ sung đúng block từng câu; đáp án từ bài cũ không bao giờ bị xóa (tối đa 12 mỗi câu, không trùng); lưu và nạp lại được
- [x] Tìm bài cho từng câu bằng "từ khóa câu hỏi + tên sản phẩm"; câu đã đủ đáp án từ các bài đã mở thì không tìm; mỗi câu mở tối đa 6 bài mới và dừng ngay khi đủ
- [x] Danh sách bài lấy lười từng trang kết quả (trang 2 chỉ tải khi cần); bài đã mở không mở lại; bài lỗi bỏ qua ngay (không chờ, không thử lại) và lấy bài khác
- [x] Hỏi thêm sau khi có kết quả: chấm lại kho, chỉ tìm bài mới khi chưa đủ, bài mới bổ sung cả các block khác
- [x] Từ khóa câu hỏi gõ thêm không tính các từ thuộc tên sản phẩm (trước đây câu nào nhắc sản phẩm cũng khớp)
- [x] Sửa tải thừa trang kết quả 2 khi đã đủ đáp án ở bài cuối của trang 1
- [x] Mô phỏng (5 chủ đề + 3 câu hỏi thêm): 20 → 14 lượt tải Google, 95 → 62 lần mở trang, không mở lại trang nào; 40 test JS đạt
- [ ] Chưa thử với Google thật; ngưỡng "đủ đáp án" (3 câu từ 2 bài) và tối đa 6 bài mỗi câu là giá trị chọn tạm, có thể chỉnh

### Sửa lỗi: chữ lỗi và đáp án không liên quan
- [x] Giải mã đầy đủ ký tự HTML (tên: `&ecirc;` `&aacute;`... Latin-1 và `&dstrok;`; số thập phân/thập lục phân; mã hóa hai lần `&amp;ecirc;`) cho nội dung, tiêu đề, thẻ meta; dữ liệu cũ còn ký tự thô cũng được giải mã khi hiển thị
- [x] Câu lấy từ nội dung chính (bỏ head, title, nav, header, footer, aside, form, danh sách toàn liên kết); câu giống menu (nhiều từ viết hoa nối liền không dấu câu, nhiều mục điều hướng) và câu lặp ở từ 3 bài trở lên bị bỏ
- [x] Đúng model: bài nhắc model mới cho đáp án chính (cộng điểm cho câu nhắc model); câu nhắc model khác bị loại; bài không nhắc model chỉ là "tham khảo chung" (thu gọn, ghi rõ) và không tính là đủ đáp án
- [x] Từ khóa kiểm tra bài đúng sản phẩm chỉ lấy 5 từ đầu của tên
- [x] 43 test JS đạt (giải mã chữ Việt, menu, model khác, chữ lặp, tầng đáp án)
- [ ] Nhận diện "model" dựa trên token dạng mã (chữ in hoa + số); model viết toàn chữ thường hoặc không có số (VD "Hero Light") chưa lọc được theo model
- [ ] Bài cũ đã lưu trong kho trước bản này vẫn chứa menu; hãy chạy lại yêu cầu để kho sạch

### Bỏ phần thuyết phục sếp; đúng 7 câu hỏi; đủ 2 trang thì dừng
- [x] Bỏ kịch bản đàm phán, luận điểm thuyết phục sếp, xuất file gửi sếp, soạn email (giao diện, Excel, mã, cài đặt email sếp, nút sao chép email hỏi giá). Giữ nút xuất Excel bảng so sánh
- [x] 7 câu hỏi: (1) tên sản phẩm, model + giá, (3) NCC + mã sản phẩm, (6) liên hệ NCC, (7) VAT của NCC đó nằm trong bảng, mỗi ô có link nguồn (VAT kèm câu trích); (2) ưu nhược điểm, (4) phân loại, công nghệ, (5) lưu ý khi mua là các chủ đề, có "Tóm tắt" 3 ý từ 3 bài khác nhau kèm nguồn rồi mới đến toàn bộ đáp án
- [x] Đủ đáp án = đã được trả lời từ 2 bài khác nhau đúng model thì không tìm câu đó ở trang khác (trước đây cần 3 câu từ 2 bài)
- [x] Liên hệ và VAT: trang sản phẩm đã có số điện thoại/email và VAT thì không mở trang Liên hệ; chỉ NCC còn thiếu mới thử /lien-he, /contact..., dừng ngay khi đủ; VAT còn thiếu thì đọc thêm từ trang Liên hệ
- [x] Sửa nhận diện VAT: "Không xuất hóa đơn" trước đây bị nhận thành "có" vì cụm "xuất hóa đơn"
- [x] Test: 44 test JS đạt (thêm test đủ 2 bài, tóm tắt, VAT, bỏ qua trang Liên hệ khi đã đủ)
- [ ] Chưa chạy với Google thật; VAT chỉ đọc được khi trang có chữ về hóa đơn

### Bỏ xác nhận thông số, bỏ bước liên hệ, bỏ qua trang hỏng
- [x] Sau bước tìm hiểu chạy thẳng tìm NCC và trả lời, không hỏi 10 câu xác nhận thông số (yêu cầu cũ đang chờ xác nhận vẫn mở được)
- [x] Bỏ bước mở trang Liên hệ của NCC; liên hệ và VAT chỉ lấy từ trang sản phẩm đã đọc
- [x] Trang hỏng: bỏ qua ngay, không chờ, không thử lại (trước đây ở bước mở link Google vẫn chờ sau trang lỗi)
- [x] Mọi lượt tìm NCC và câu hỏi dùng đúng từ khóa người dùng nhập (không thêm "giá mua", không thêm thông số)

### Chưa chắc / còn lại
- [ ] **Chưa chạy thử với Google thật trong trình duyệt**: mở tab nền, đọc kết quả, phân trang, Google Hình ảnh; chỉ thử với dữ liệu mẫu. Google có thể chặn (403, xác minh), app không vượt qua
- [ ] Trang bán hàng không có dữ liệu sản phẩm có cấu trúc (JSON-LD, thẻ giá) và không có nút mua sẽ bị loại khỏi bảng; Shopee, TikTok Shop vẽ giá bằng JavaScript nên dễ không đọc được giá
- [ ] Nhận diện hãng và model còn là quy tắc (dữ liệu sản phẩm, token IN HOA trong tiêu đề), có thể sai ở trang lạ
- [ ] Trên điện thoại Chrome không cài được tiện ích nên không crawl được; chưa thử Kiwi Browser, Firefox Android, Safari
- [ ] Chưa tự động hóa việc đọc chữ trong ảnh khi không có khóa Anthropic và trình duyệt không có TextDetector
- [ ] Bản Flask (`app.py`, `purchasing/`) không còn được cập nhật

---

# Lịch sử các đợt trước (tham khảo)

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

## Đợt cập nhật: album ảnh crawl từ web (bản Flask)
- [x] Sau khi xác nhận đủ dữ liệu đầu vào, app crawl ảnh theo từ khóa của yêu cầu (Bing HTML không cần khóa, Brave/Google khi có khóa) và lưu vào `jobs/<id>/album/`
- [x] Mỗi yêu cầu có album riêng: lọc ảnh hỏng/quá nhỏ/trùng nội dung, chặn tải từ địa chỉ nội bộ, giới hạn 6MB mỗi ảnh
- [x] Đối chiếu: tính độ giống (dHash) với ảnh người dùng upload, sắp xếp ảnh giống nhất lên đầu, kèm trang nguồn
- [x] Giao diện: mục "Album ảnh đối chiếu" trong kết quả, xem ảnh phóng to, xóa ảnh, ô từ khóa riêng + nút "Tìm thêm ảnh"
- [x] API: `POST /api/jobs/<id>/album`, `DELETE /api/jobs/<id>/album/<file>`, ảnh phục vụ qua `/album/<file>` và `/images/<file>`
- [x] Thêm engine DuckDuckGo (thư viện `ddgs`, không cần khóa) cho cả tìm NCC và ảnh, tick mặc định. Thử thật: trả ảnh đúng sản phẩm (Shopee, TikTok Shop, shop Việt), tải được khoảng 5/20 ảnh (còn lại bị chặn hotlink hoặc lỗi)
- [x] Bing ảnh từ máy này bỏ qua từ khóa (trả ảnh không liên quan), nên không còn là mặc định
- [x] Cốc Cốc: không dùng được, trang chặn bot bằng chuyển hướng JavaScript + cookie
- [x] Chỉ hiện nhãn "giống ảnh upload" khi từ 70% trở lên (dưới mức đó là nhiễu của dHash)
- [x] Ảnh người dùng up nằm chung album (nút "Up ảnh của bạn", dùng làm ảnh gốc tính độ giống), crawl ảnh là ô tick khi tạo yêu cầu
- [x] Nút "Tìm trên Cốc Cốc" mở kết quả trong trình duyệt của bạn để dán link shop vào ô Link NCC (app không tự đọc được Cốc Cốc vì trang chặn bot)
- [x] `run.bat` để chạy app. Đã thử cả luồng thật (tạo, xác nhận, crawl DuckDuckGo, 5 NCC, 6 ảnh album, up, tìm thêm, xóa) và giao diện trên trình duyệt
- [ ] Giá trên Shopee/TikTok Shop nằm trong JavaScript nên app thường không đọc được giá, hãy nhập tay hoặc dùng link shop riêng
- [ ] Chưa chạy thử với Brave/Google thật (chưa có khóa). Độ giống dHash chỉ gợi ý, không thay cho việc người dùng kiểm tra
- [ ] Bản web tĩnh `docs/` chưa có album (trình duyệt bị CORS khi tải ảnh từ web)

## Đợt cập nhật: chuyển sang tiện ích Cốc Cốc / Chrome
- [x] Thư mục `docs/` là tiện ích (manifest MV3, `background.js`). Cách cài: README, mục đầu
- [x] Tìm bằng Cốc Cốc: tiện ích mở tab nền cho trang tự chạy JavaScript, rồi lấy link ra ngoài (không lách CAPTCHA, đúng như người dùng tự mở)
- [x] Tìm bằng DuckDuckGo không cần khóa; Brave gọi trực tiếp, không cần proxy; trang NCC tải không bị CORS
- [x] Trang Shopee, TikTok Shop, Tiki, Lazada, Sendo đọc bằng tab nền để lấy giá do JavaScript vẽ
- [x] Album ảnh trong IndexedDB: up ảnh, crawl DuckDuckGo, lọc trùng, độ giống dHash, xóa, tìm thêm theo từ khóa
- [x] Đã kiểm thử trên trang tĩnh: nạp app, album (up, bỏ trùng, dHash, xóa), xuất Excel dưới CSP của tiện ích, 10 test JS, kiểm tra cú pháp
- [ ] **Chưa chạy thử bên trong Cốc Cốc/Chrome thật**: chưa kiểm chứng `background.js` mở tab nền, trích link Cốc Cốc, và crawl ảnh. Dùng nút "Thử Cốc Cốc", "Thử DuckDuckGo" trong tab Cài đặt để kiểm tra
- [ ] Ảnh album không nằm trong file sao lưu .json (chỉ lưu trong trình duyệt)

## Đợt cập nhật: question card dựa trên dữ liệu crawl
- [x] Thêm bước "tìm hiểu trên web" trước khi hỏi: tìm, đọc tối đa 8 trang, chỉ giữ trang đúng sản phẩm (cụm 2 từ liên tiếp)
- [x] Rút tên gọi, model (token in hoa có chữ lẫn số trong tiêu đề), dung lượng pin, điện áp, mục đích ("phù hợp/dành cho..."), khoảng giá, mỗi giá trị kèm số trang nhắc tới
- [x] Card hiển thị lựa chọn từ web kèm "thấy ở n/N trang", chọn sẵn giá trị khi có từ 2 trang trở lên đồng ý; không có dữ liệu web thì mới dùng gợi ý chung và ghi rõ
- [x] Hiện danh sách trang đã dùng để bạn kiểm tra nguồn; trang đã tải được dùng lại ở bước tìm NCC
- [x] Hỗ trợ Chrome, Cốc Cốc, Edge, Brave (cùng mã Chromium, manifest yêu cầu Chrome 110 trở lên)
- [x] Test: 11 test JS đạt, thử giao diện với 3 trang giả (card hiện 20.000 mAh thấy ở 3/3 trang, 18V, mục đích, khoảng giá)
- [ ] Chưa thử trên Chrome thật. Mục đích lấy từ web còn nhiễu nên không tự chọn sẵn
- [ ] Bản Flask (`purchasing/`) vẫn dùng card cũ, không có bước tìm hiểu này

## Đợt cập nhật: card từ dữ liệu crawl, tìm hiểu theo ngành, tư vấn, Google, mobile
- [x] Crawl tối đa 10 trang đầu mỗi engine (không đủ thì lấy hết), tối đa 30 trang mỗi lượt; log số trang theo engine
- [x] Thêm engine Google qua trình duyệt (không cần khóa), thứ tự ưu tiên Google, Cốc Cốc, DuckDuckGo rồi các engine có khóa; nút "Thử Google" ở tab Cài đặt. Google hiện CAPTCHA thì báo lỗi, không vượt qua
- [x] Card 5 đến 10 câu dựng từ dữ liệu crawl, luôn có model, số lượng, mục đích; card bổ sung chọn theo bằng chứng (pin, điện áp, công suất, dung tích, chất liệu, hãng, ngân sách, bảo hành, VAT, ưu tiên)
- [x] Nhóm ngành gia dụng, thiết bị máy móc, tiêu dùng, khác; bộ câu hỏi tìm hiểu chung (giá, hãng, ưu nhược điểm hãng và sản phẩm, lưu ý khi mua, công nghệ, phân loại, ưu nhược điểm công nghệ, thay thế, rủi ro) và câu hỏi riêng của ngành
- [x] Tab Tư vấn: tên sản phẩm/ảnh, ngân sách, nhu cầu, tổng hợp 6 phần và nút tạo yêu cầu
- [x] Bảng NCC chấm điểm theo giá trực tiếp khi sản phẩm không có mAh, cờ vượt ngân sách, VAT bắt buộc hoặc không
- [x] Giao diện mobile: thanh tab vuốt ngang, bảng thành thẻ xếp dọc, ô nhập 16px, nút cao 44px, không tràn ngang (đã thử khung 375x812)
- [x] Test: 16 test JS, 15 test Python đạt; thử giao diện với 3 trang giả (10 card, 7/13 câu tìm hiểu có đáp án)
- [ ] **Chưa thử với Google, Cốc Cốc, DuckDuckGo thật trong trình duyệt**: chất lượng nhận diện hãng, model, mục đích và câu trả lời tìm hiểu trên trang thật còn phải kiểm tra
- [ ] Nhận diện hãng còn nhiễu (VD tiền tố model như GIFV bị coi là hãng); câu trả lời lọc bằng từ khóa nên có thể bỏ sót hoặc lệch
- [ ] Tab Tư vấn đọc tên từ ảnh cần khóa Anthropic; chưa có đối chiếu ảnh với sản phẩm gợi ý
- [ ] Chrome trên điện thoại không cài được tiện ích nên crawl bằng trình duyệt chỉ chạy trên máy tính

## Đợt cập nhật: crawl theo trang kết quả, form mới, tư vấn có tiến trình và lưu JSON
- [x] Hiểu lại "10 trang" là 10 trang kết quả của engine (phân trang 1..10), dừng sớm khi hết kết quả; chọn 1/2/3/5/10 trang; tối đa 30 link đọc sâu, các kết quả còn lại góp tiêu đề và mô tả
- [x] Thêm engine Bing và Brave Search qua trình duyệt (không cần khóa); thứ tự ưu tiên Google, Cốc Cốc, DuckDuckGo; giải link bọc chuyển hướng (Google, DuckDuckGo, Bing, Cốc Cốc)
- [x] Ảnh crawl từ trang Hình ảnh của engine đang chọn (Google trong trình duyệt là mặc định), có ảnh gốc hoặc ảnh thu nhỏ
- [x] Form NCC và file Excel: NCC, Tên sản phẩm, Số lượng, Đơn giá, VAT, Thông tin sản phẩm, Ngày cập nhật, Liên hệ, Điểm, Trạng thái; sửa được tên sản phẩm, số lượng, thông tin sản phẩm
- [x] Tab Tư vấn đứng đầu, mở sẵn, có tiến trình 8 bước (thanh phần trăm chỉ tăng) và chi tiết crawl từng engine
- [x] Lưu dữ liệu tư vấn ra file .json và tự lưu trong trình duyệt; "Nạp dữ liệu tư vấn" ở Yêu cầu mới điền sẵn form, dùng dữ liệu để dựng card (ngân sách thành lựa chọn đầu tiên), không crawl lại
- [x] Test: 19 test JS (thêm giải link bọc, cột mới, ngân sách từ tư vấn), thử giao diện bằng engine giả: phân trang 4 lần gọi dừng ở trang rỗng, tiến trình, lưu/nạp JSON, bảng và Excel đúng thứ tự cột
- [ ] **Chưa chạy thử trên Google, Cốc Cốc, Bing, Brave Search thật**: cách đọc kết quả (tiêu đề, mô tả, link) và phân trang `&start=`, `&page=`, `&first=`, `&offset=` chỉ dựa trên khảo sát Cốc Cốc (đã kiểm `&page=2`) và hiểu biết về các engine còn lại; engine đổi giao diện thì cần sửa `readPage` trong `background.js`
- [ ] Safari: chưa thử (cần macOS và Xcode để chuyển tiện ích)
- [ ] 10 trang × nhiều engine mất vài phút vì mở tab thật; có thể giảm bằng ô "Số trang kết quả mỗi engine"

## Sửa lỗi: giá lấy sai
- [x] Trước đây lấy số NHỎ NHẤT giống giá trên trang hoặc trong đoạn mô tả kết quả tìm kiếm, nên dính voucher, phí ship, phụ kiện (VD máy hút bụi ra 50.000 đ)
- [x] Giờ mỗi trang một giá, ưu tiên JSON-LD, thẻ meta/itemprop, rồi số sau chữ "giá", cuối cùng mới là số xuất hiện nhiều nhất; đoạn mô tả tìm kiếm chỉ nhận số sau chữ "giá"
- [x] Loại giá lệch hẳn mặt bằng (dưới 30% hoặc trên 350% trung vị) khỏi khoảng giá, đánh dấu "Nghi sai giá"; mỗi gợi ý ghi nguồn giá; bảng NCC ghi "ước lượng" khi giá chỉ đoán
- [ ] Giá vẫn chỉ để tham khảo: trang có nhiều phiên bản, khuyến mãi, hoặc vẽ giá bằng JavaScript thì có thể lệch; nên mở link kiểm tra

## Sửa lỗi: "No tab with id" khi mở trang kết quả
- [x] Tab nền bị đóng hoặc bị trình duyệt thay giữa chừng (Memory Saver, lỡ đóng) làm engine báo lỗi: tắt tự loại bỏ cho tab đọc và tự thử lại bằng tab mới tối đa 3 lần, báo rõ nguyên nhân nếu vẫn lỗi
- [ ] Chưa tái hiện được lỗi trên máy này (chỉ suy ra nguyên nhân từ thông báo), cần bạn thử lại sau khi tải lại tiện ích 1.2.3

## Google chặn truy cập (403, udm=2)
- [x] Nhận diện trang bị chặn (403, "does not have permission", CAPTCHA, quá nhiều yêu cầu) ở cả tìm web và tìm ảnh, báo rõ engine nào bị chặn và gợi ý cách xử lý; app không tìm cách vượt qua
- [x] Giãn nhịp 1,5 đến 2,5 giây giữa các trang kết quả của engine chạy bằng trình duyệt để không gửi dồn dập
- [ ] Nếu Google vẫn chặn thì dùng Cốc Cốc, DuckDuckGo, Bing; ảnh sẽ lấy từ các nguồn còn lại

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
