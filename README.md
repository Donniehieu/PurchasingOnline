# Mua hàng tự động

## Cài làm tiện ích Chrome / Cốc Cốc (khuyến nghị)

Cách này không cần Python hay Flask. App chạy ngay trong trình duyệt của bạn nên: tìm được bằng **Cốc Cốc** và **DuckDuckGo** không cần khóa, đọc được cả trang cần JavaScript (Shopee, TikTok Shop), không bị chặn CORS, và crawl ảnh về album.

Dùng được trên **Google Chrome** (từ bản 110), **Cốc Cốc**, **Brave**, Microsoft Edge, Opera, Vivaldi (cùng nền Chromium, cùng một mã, cài bằng cùng cách; Brave vào `brave://extensions`). **Safari** không cài thẳng được: trên macOS cần chuyển bằng Xcode (`xcrun safari-web-extension-converter docs/`) rồi bật trong Safari, tôi chưa thử vì đang dùng Windows. Safari cũng không phải là một engine tìm kiếm riêng (nó dùng Google, Bing, DuckDuckGo...), nên các engine ở trên vẫn là nguồn dữ liệu. Engine "Cốc Cốc" vẫn dùng được khi bạn cài tiện ích trên Chrome: tiện ích chỉ mở trang `coccoc.com` trong một tab nền, không cần cài trình duyệt Cốc Cốc.

**Engine tìm kiếm** (thứ tự ưu tiên, ba engine đầu tick sẵn): Google qua trình duyệt, Cốc Cốc, DuckDuckGo, rồi Bing và Brave Search qua trình duyệt (không cần khóa), Brave API và Google API nếu bạn nhập khóa. Chọn engine ở tab Tư vấn hoặc Yêu cầu mới, lựa chọn dùng chung.

**"10 trang" là 10 trang kết quả của engine** (trang 1, 2, 3... như thanh phân trang cuối kết quả), không phải 10 link. Mỗi engine được crawl từ trang 1 đến trang bạn chọn (tối đa 10, có ô chọn 1/2/3/5/10); engine hết kết quả sớm thì dừng ở trang cuối. Mọi kết quả (tiêu đề, mô tả, link) được thu thập; tối đa 30 link tốt nhất (mỗi website một link) được mở ra đọc đầy đủ, các kết quả còn lại vẫn góp tiêu đề và mô tả vào phân tích. Engine API (Google, Brave) chỉ lấy tối đa 3 trang để tiết kiệm hạn mức. Mỗi trang kết quả mở trong một tab nền vài giây nên 10 trang × 3 engine mất vài phút, tiến trình hiện từng bước. Nếu engine hiện trang xác minh (CAPTCHA), app báo lỗi để bạn tự mở engine đó xác minh rồi thử lại, app không vượt qua bước đó.

**Quy trình:**
1. Nhập yêu cầu (tên/mã, số lượng, mục đích, ảnh).
2. App crawl các engine, đọc các trang, nhận diện **nhóm ngành** (gia dụng, thiết bị máy móc, sản phẩm tiêu dùng, khác) và rút tên, model, hãng, dung lượng pin, điện áp, công suất, dung tích, chất liệu, bảo hành, mục đích, khoảng giá.
3. Hiện **5 đến 10 question card** dựng từ chính dữ liệu đó, kèm "thấy ở n/N trang" và danh sách trang đã dùng. Luôn có: mã sản phẩm/model, số lượng, mục đích sử dụng. Các card còn lại (thông số, hãng, ngân sách, bảo hành, chất liệu, VAT, ưu tiên...) được chọn theo mức bằng chứng.
4. Sau khi bạn xác nhận, app tìm NCC, chấm điểm, điền form, và **tìm hiểu sản phẩm theo ngành hàng**: giá cả, hãng sản xuất, ưu nhược điểm của hãng và sản phẩm, lưu ý khi mua, công nghệ sử dụng, phân loại, ưu nhược điểm từng công nghệ, thay thế và rủi ro, cộng các câu hỏi riêng của ngành (gia dụng: công suất, an toàn, bảo trì; máy móc: thông số, tiêu chuẩn, phụ tùng, chi phí vận hành; tiêu dùng: chất liệu, hàng giả, đổi trả, đối tượng). Câu trả lời là câu trích nguyên văn từ trang web kèm link nguồn, không phải AI viết lại.

**Tab Tư vấn** (đứng đầu, mở sẵn): nhập tên sản phẩm và/hoặc ảnh, ngân sách, nhu cầu. App crawl rồi tổng hợp: mặt bằng giá và vị trí ngân sách của bạn, loại/công nghệ nên cân nhắc, hãng, các trang đúng sản phẩm gần ngân sách, lưu ý khi mua, và nút điền sẵn yêu cầu mua. Có thanh tiến trình từng bước (chuẩn bị, đọc ảnh, crawl từng engine, đọc trang, phân tích, tìm hiểu theo ngành, tổng hợp, lưu). Dữ liệu tư vấn tự lưu trong trình duyệt và tải về được thành file `.json`; ở tab **Yêu cầu mới**, nút "Nạp dữ liệu tư vấn (.json)" hoặc "Nạp tư vấn gần nhất" điền sẵn tên, nhu cầu, link gợi ý và dùng dữ liệu đó để dựng question card (kể cả ngân sách), không crawl lại.

**Điện thoại:** giao diện co giãn theo màn hình (bảng NCC thành thẻ xếp dọc, tab vuốt ngang)

**Ảnh:** crawl từ trang Hình ảnh của các engine bạn đang chọn (Google Hình ảnh trong Chrome/Cốc Cốc, Bing, Brave, DuckDuckGo), mặc định Google; ảnh lưu thu nhỏ trong trình duyệt.

**Form duyệt báo giá** (bảng trên màn hình và file Excel) có các cột: NCC, Tên sản phẩm, Số lượng, Đơn giá, VAT, Thông tin sản phẩm (pin, điện áp, bảo hành, ghi chú; bấm "Sửa thông tin"), Ngày cập nhật, Liên hệ, Điểm, Trạng thái.. Lưu ý: Chrome trên điện thoại không cài được tiện ích, nên trên điện thoại bạn chỉ dùng được giao diện (xem lại lịch sử, sửa bảng, xuất file) khi mở bản chạy trên máy tính, hoặc bản trang web (GitHub Pages) với các engine có khóa; tính năng crawl bằng trình duyệt cần máy tính.

1. Mở `chrome://extensions` (Chrome) hoặc `coccoc://extensions` (Cốc Cốc) hoặc `edge://extensions` (Edge).
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
