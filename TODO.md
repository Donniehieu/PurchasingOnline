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
