# TODOAPP — nhật ký triển khai, lỗi đã sửa, việc còn lại

Cập nhật: 27/10/2026. Bản hiện tại: **2.13.0** (PWA + Cloudflare Worker + tiện ích Chrome tự cập nhật).

## 1. Hiểu lại "lỗi SCOR" = lỗi CORS

Bản cũ (`docs/`, tiện ích Chrome) đọc web ngay trong trình duyệt. Trình duyệt **chặn đọc dữ liệu từ web khác** (CORS), nên trang thường không đọc được. Bản mới **không đọc web trong trình duyệt**: trình duyệt chỉ nói chuyện với Worker cùng địa chỉ (`/api/*`), Worker tải trang phía máy chủ nên không dính CORS.

Còn lại: một số web chặn cả máy chủ (HTTP 403, CAPTCHA, trang vẽ giá bằng JavaScript như Shopee/TikTok). App **bỏ qua trang đó và ghi log**, không vượt CAPTCHA.

## 2. Ba chế độ tìm (tự chọn theo cấu hình)

| Chế độ | Cần gì | Chất lượng | Ghi chú |
|---|---|---|---|
| **AI Gemini (khóa miễn phí)** — khuyên dùng | 1 khóa từ aistudio.google.com (không cần thẻ) | Tốt nhất: giá, ưu/nhược điểm, công nghệ, 4–5 hãng, kèm nguồn | Gemini tìm bằng Google Search. Hạn mức miễn phí do Google quy định, có thể đổi |
| **AI Claude** | Khóa trả phí console.anthropic.com | Tốt | Chưa thử khóa thật |
| **Miễn phí không khóa** | Không cần gì | Hạn chế: không có AI, hãng khác chỉ có giá + ảnh, ưu/nhược điểm chỉ khi trang có mục đó | Dùng DuckDuckGo; **hay bị chặn** (xem mục 4). Có thể dán thẳng link sản phẩm vào ô tìm |
| Mẫu (chỉ chạy thử) | `MOCK=1` khi `npm run dev` | Dữ liệu hư cấu | Có nhãn "Dữ liệu mẫu" |


## 2b. Ưu tiên Google trong Chrome + tránh 403 / spam (bản 2.2.0)

Thứ tự khi chọn "Tự chọn": **Google Chrome (tiện ích) → AI có khóa → tìm miễn phí DuckDuckGo**. Ở Cài đặt có thể ép "Chỉ Google trong Chrome".

Cách hoạt động: tiện ích `extension/` mở `google.com/search?udm=50` (**Chế độ AI**) trong tab nền của Chrome bạn, đọc chữ hiển thị. App phân tích thành giá / ưu điểm / nhược điểm / công nghệ / thông số (`web/js/lib/aitext.js`), mở vài nguồn được Google dẫn để lấy URL và dữ liệu thật, tìm hãng khác bằng kết quả Google thường + trang liệt kê sản phẩm, rồi hỏi Chế độ AI về từng hãng (tối đa 3).

Đã kiểm chứng:
- [x] Cấu trúc trang Chế độ AI thật (27/10/2026): mục "Các ưu điểm / nhược điểm", bảng thông số, nhãn nguồn. Hàm đọc `extension/ai-extract.js` chạy đúng trên trang thật: 27 dòng, 22 liên kết nguồn, gắn đúng nguồn cho từng ý. Nội dung thật đó là dữ liệu của test `tests/aitext.test.mjs`.
- [x] `extension/background.js` chạy trên `chrome` API giả: kiểm tra trang được phép, chặn mạng nội bộ, 403 → ngắt tên miền (theo `Retry-After`), CAPTCHA → đưa tab lên cho người dùng, cache 24 giờ, hạn mức 8 lần/10 phút.
- [x] Toàn bộ luồng trong giao diện thật với tiện ích giả lập: 6 lần mở Google (1 sản phẩm + 2 tìm hãng + 3 hãng), 4 hãng so sánh có ưu/nhược điểm.

Giới hạn / chưa kiểm chứng:
- [ ] **Chưa chạy tiện ích trong Chrome thật** (không tải được tiện ích vào trình duyệt từ môi trường dựng app). Cần bạn cài thử: README mục "Dùng Google trong Chrome".
- [ ] **Liên kết nguồn của Chế độ AI là `/goto?url=<mã hóa>`**, chỉ biết trang đích khi mở. Tiện ích mở tối đa 5 nguồn được dẫn nhiều nhất bằng `fetch` không cookie; chưa kiểm chứng Google có cho `/goto` chạy như vậy không. Nếu không, các ý vẫn có nguồn là chính trang Google Chế độ AI, chỉ thiếu trang đích.
- [ ] Google đã cho một trình duyệt tự động ra trang "lưu lượng bất thường" (CAPTCHA) ở lần mở đầu khi mình thăm dò, rồi tự qua. Không bao giờ tự giải: tiện ích để bạn tự xác minh.
- [ ] Giao diện Google có thể đổi: bộ đọc dựa trên chữ hiển thị (tiêu đề "Câu trả lời của Chế độ AI", dòng "AI có thể mắc sai sót", liên kết `/goto`), không dựa tên lớp CSS, nhưng vẫn có thể hỏng; khi đó app tự chuyển nguồn dự phòng và ghi log.
- [ ] Chỉ chạy trên Chrome/Cốc Cốc/Edge/Brave máy tính (điện thoại không có tiện ích).
- [ ] Nội dung Chế độ AI do Google tổng hợp, có thể sai: luôn mở nguồn kiểm tra.

Chống 403 / spam (đã có test):
| Biện pháp | Chi tiết |
|---|---|
| Đọc bằng IP của bạn | Tiện ích tải trang bằng Chrome thật, không cookie; IP nhà không bị coi là trung tâm dữ liệu |
| Giãn cách theo tên miền | ≥ 2,5 giây (tiện ích) và ≥ 2,2 giây (app) giữa hai yêu cầu cùng tên miền; tối đa 2–3 trang cùng lúc |
| Hạn mức Google | ≤ 8 lần mở / 10 phút, cách nhau ≥ 4 giây, nhớ kết quả 24 giờ |
| Tự ngắt | 403/429/503/CAPTCHA → ngừng tên miền 30 phút (hoặc `Retry-After`, tối đa 2 giờ), nhớ qua lần mở app; nút "Xóa chặn" |
| Không gửi thừa | cache trang 7 ngày; mỗi tên miền ≤ 2 trang mỗi lần; đủ dữ liệu (≥4 trang, ≥4 giá, ≥4 ưu, ≥3 nhược, ≥3 ảnh) thì dừng; mặc định ≤ 8 trang |
| Đường máy chủ | thêm tiêu đề trình duyệt (Accept-Language, Sec-Fetch-*, Referer Google), đọc `Retry-After`, trang chặn thì bỏ qua và ghi log |

## 2c. Tự động cập nhật tiện ích (bản 2.3.0, tiện ích 1.1.0)

Ràng buộc của Chrome: **chỉ tiện ích cài từ Chrome Web Store mới được Chrome tự cập nhật** (cách khác như `update_url` riêng chỉ chạy trên máy do tổ chức quản lý). Vì vậy làm hai lớp:

- [x] **Tự tải lại khi file đổi** (bản nạp từ thư mục): tiện ích kiểm tra mỗi phút mã băm 6 file của chính nó; đổi thì `chrome.runtime.reload()`; đang xử lý yêu cầu thì hoãn; bản Web Store (có `update_url`) bỏ qua. Nút "Kiểm tra cập nhật" ở biểu tượng tiện ích. Có test.
- [x] **Đóng gói và phát hành cùng app**: `npm run build:ext` tạo `web/ext/mua-hang-extension.zip` + `version.json` (mã băm từng file), chạy tự động trước `dev`/`deploy`; zip kiểm tra hợp lệ và tái tạo giống hệt (có test).
- [x] **App báo bản mới**: so phiên bản tiện ích đang cài với `ext/version.json`; khác nhau theo cách cài (Store / thư mục), có nút Ẩn, link tải .zip; chưa cài thì gợi ý tải (chỉ máy tính). Đã thử trong giao diện thật với 3 trường hợp.
- [x] **Chuẩn bị Chrome Web Store**: `store/STORE.md` (nội dung listing, giải trình quyền, cách lấy khóa API), `web/privacy.html` (chính sách riêng tư, bắt buộc khi xin quyền rộng), `.github/workflows/publish-extension.yml` (đẩy tag `ext-vX.Y.Z` → test → đóng gói → đăng).
- [ ] **Việc của bạn để Chrome tự cập nhật hoàn toàn**: tạo tài khoản Chrome Web Store (5 USD), tải gói lần đầu và gửi duyệt, thêm 4 secret GitHub (`CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`). Mình không tạo tài khoản và không thanh toán hộ.
- [ ] Quyền "đọc mọi trang web" (`<all_urls>`) thường bị Google xem xét kỹ, có thể chậm hoặc bị từ chối; nếu vậy chuyển sang `optional_host_permissions` (người dùng cấp lúc dùng).
- [ ] Quy trình đăng tự động (`chrome-webstore-upload-cli`) chưa chạy thật vì chưa có tài khoản/khóa; cú pháp lấy theo hiểu biết, cần chạy thử lần đầu.
- [ ] Edge Add-ons dùng được cùng file zip nhưng chưa thiết lập.
- [ ] Hot-reload dựa trên việc tiện ích đọc lại file của chính nó từ thư mục; chưa chạy trong Chrome thật (chỉ thử với chrome API giả).

## 2d. Mỗi lần tìm lấy thêm trang MỚI, gộp vào cache cũ (bản 2.4.0)

Yêu cầu: dữ liệu cũ đôi khi chưa đủ, nên sau mỗi phiên tìm phải tìm trang mới và bổ sung vào cache cũ. Trước đây cache hợp lệ được dùng nguyên trạng (không tìm), còn "tìm mới" thì thay cả mục cache.

- [x] **Chế độ mặc định "tìm thêm"**: hiện dữ liệu cũ ngay → tìm bổ sung → gộp. Ô chọn "Khi đã có trong cache": tìm thêm / chỉ xem cache / làm lại từ đầu. Nút "Tìm thêm dữ liệu mới" trong kết quả.
- [x] **Ra nguồn khác mỗi lần**: biến thể từ khóa theo số lần tìm (Google Chế độ AI 4 cách hỏi, DuckDuckGo 3 bộ, tìm hãng 3 bộ); gửi kèm nguồn/ý đã có (AI máy chủ được yêu cầu bỏ qua nguồn đã đọc và không lặp ý; DuckDuckGo loại trang đã đọc khỏi kết quả).
- [x] **Chỉ mở trang chưa đọc** (tối đa 5 trang mới mỗi lần, vẫn giãn cách và cache trang); đã đủ 5 hãng thì không tìm thêm hãng, chỉ bổ sung ưu/nhược điểm hãng còn thiếu (Chrome).
- [x] **Gộp không mất dữ liệu**: ý trùng (cùng câu, cùng nguồn) không nhân đôi, cùng câu nguồn mới thì tăng độ tin cậy; giá cùng nguồn lấy giá mới; mã nguồn [n] cũ giữ nguyên; giá quá 45 ngày bị bỏ khi đã có giá mới.
- [x] **Ghi nhận từng lần**: Nhật ký → "Các lần tìm" (+trang, +ưu điểm...); huy hiệu "n lần tìm". Lỗi giữa chừng: dữ liệu cũ nguyên vẹn, mục vẫn xem được.
- [x] 7 test mới (`tests/enrich.test.mjs`), đã thử trong giao diện (bấm nút "Tìm thêm" → hiện dữ liệu cũ ngay, "đang bổ sung", ghi nhận lần 2).
- [x] **Đã thử trên bản online** (chế độ miễn phí): mục Sunhouse SHD4030 đã có (8 trang, 6 ưu điểm) → tìm lại 12 giây → thêm 5 trang MỚI (mediamart, dienmaycholon, ireview, fptshop...), +2 giá, +2 ưu điểm → 13 trang, 12 ưu điểm; dữ liệu cũ còn nguyên. Bước tìm hãng khác bị DuckDuckGo chặn tạm thời (vừa bị gọi nhiều lần trước đó), app ghi log và đi tiếp.
- [ ] Chưa thử với AI/Chrome thật: hiệu quả "ra nguồn khác" phụ thuộc Google/AI có thật sự trả nguồn khác với cách hỏi khác. Nếu nhiều lần liền không thêm gì thì log ghi "không có dữ liệu mới".
- [ ] Mỗi lần tìm bổ sung tốn thêm lượt gọi AI/Google (Google trong Chrome: tối đa 8 lần mở / 10 phút, đã tính trong hạn mức).

## 2e. Tóm tắt so sánh công nghệ giữa các hãng (bản 2.5.0)

Yêu cầu: với máy móc, thiết bị, gia dụng, điện tử, tóm tắt so sánh các hãng **cùng công nghệ** và **ưu/nhược điểm của từng loại công nghệ**. Hàng tiêu dùng không có mục này (đúng yêu cầu trước).

- [x] Tab mới **Công nghệ** (ẩn với hàng tiêu dùng) + hỏi nhanh "So sánh công nghệ".
- [x] **Gom theo công nghệ** (`technologyComparison` trong `web/js/lib/aggregate.js`): "Công nghệ Rapid Air 360 độ (Đối lưu khí nóng)", "Rapid Air", "RAPID AIR" gộp một nhóm; mỗi nhóm cho biết hãng dùng chung / riêng.
- [x] **Ưu/nhược điểm của công nghệ** lấy từ (1) mô tả lợi ích/hạn chế AI nêu cho từng công nghệ của từng hãng, (2) các câu ưu/nhược điểm của sản phẩm có nhắc tên công nghệ (nên chế độ Chrome/miễn phí vẫn có dữ liệu); mọi ý kèm nguồn và tên hãng.
- [x] **Tóm tắt** ở đầu tab: số công nghệ/số hãng, công nghệ dùng chung, công nghệ riêng từng hãng, hạn chế cần lưu ý, điểm mạnh nổi bật, công nghệ còn thiếu thông tin.
- [x] Prompt so sánh yêu cầu AI gọi tên công nghệ thống nhất giữa các hãng; công nghệ hãng khác nay có nguồn.
- [x] 5 test mới (`tests/tech.test.mjs`: gom nhóm, dùng chung/riêng, nguồn, hàng tiêu dùng, thoát ký tự, hỏi đáp). Đã xem trong giao diện (dữ liệu mẫu).
- [ ] Việc gom nhóm dựa trên tên công nghệ: hai tên khác hẳn nhau cho cùng một công nghệ (vd tên tiếng Việt vs tên thương mại) sẽ bị tách; công nghệ chỉ được nhắc trong câu ưu/nhược điểm mà hãng không liệt kê thì chỉ được tính khi tên công nghệ ≥ 4 ký tự.
- [ ] Chất lượng ưu/nhược điểm của công nghệ phụ thuộc AI/Google; chế độ miễn phí không AI thường không có hãng khác nên mục này ít nội dung.
- [ ] Chưa thử với AI/Chrome thật.

## 2f. Bảng so sánh NCC + xuất Excel (bản 2.6.0)

Yêu cầu: scrawl Google → trang web thật + dùng cache → bảng so sánh NCC theo mẫu (STT, Tên sản phẩm/mã model, Đơn giá, VAT, Thông tin kỹ thuật bổ sung, NCC/hãng sản xuất, Link truy vấn thông tin); xuất .xlsx; xem trên web: ẩn/hiện, lọc, sắp xếp, giữ chuột kéo trái/phải.

- [x] **Mô hình "offer"** (`web/js/lib/offers.js`): mỗi dòng = một trang NCC + một model; tạo khi đọc trang (giá, VAT, thông số, tên NCC, link), khi AI/Google nêu giá có nguồn (đánh dấu "chưa xác nhận" cho tới khi đọc trang), và từ trang liệt kê (hãng khác). Gộp qua các lần tìm (không nhân đôi, giá đọc từ trang thay giá AI). Cache cũ chưa có offers vẫn ra bảng (suy ra từ giá và hãng khác đã lưu).
- [x] **Trích xuất từ trang thật** (`web/js/lib/extract.js`): thông số từ 3 kiểu markup (JSON-LD `additionalProperty`, bảng `<tr>`/`<dt><dd>`, `<li>` hai ô) — thử trên dienmayxanh.com, sunhouse.com.vn, dienmaycholon.com; VAT (đã gồm / chưa gồm / VAT x% / không ghi; dữ liệu cấu trúc thắng chữ); tên NCC (người bán > og:site_name ngắn > tên miền).
- [x] **Google → trang bán hàng thật**: ngoài câu hỏi Chế độ AI, thêm một lượt Google thường ("<hãng> <model> giá bán / mua ở đâu giá tốt / báo giá nhà cung cấp", đổi theo lần tìm) để lấy các cửa hàng; giá trong đoạn trích Google vào bảng với nhãn "trích từ kết quả tìm kiếm". Tổng lượt mở Google mỗi lần tìm: 7 (hạn mức 8/10 phút).
- [x] **Bảng trên web** (`web/js/table-ui.js`, `web/table.css`): ẩn/hiện cột (× và menu "Cột", nhớ lựa chọn), lọc nhanh + lọc từng cột (giá `<3tr`, `2tr-3tr`, `>2000000`; VAT; NCC/hãng; thông số), lọc cùng sản phẩm/hãng khác, sắp xếp (giá thiếu luôn ở cuối), STT đánh lại, giữ chuột kéo trái/phải (và lên/xuống), tiêu đề cố định, bấm ô thông số để mở rộng, nút "Tìm thêm NCC".
- [x] **Xuất Excel** (`web/js/lib/xlsx-export.js`, ExcelJS tải khi bấm): đúng cột đang hiện và dòng đã lọc/sắp xếp, giá là số định dạng ₫, link bấm được, bộ lọc Excel, cố định dòng đầu, ghi chú ở ô giá chưa xác nhận, sheet "Thông tin" (nguồn, VAT, lưu ý). Đã đọc lại file bằng ExcelJS (test) và kiểm tra mọi phần XML hợp lệ trong trình duyệt.
- [x] 11 test mới (`tests/offers.test.mjs`). Lỗi tìm thấy khi thử giao diện: bảng bị trùng dòng hãng khác (suy ra offer từ cache cũ so khớp sai khóa) → đã sửa + test.
- [x] **Đã thử trên bản online (27/10/2026)**: tìm miễn phí "Nồi chiên không dầu Sunhouse SHD4030" → 13 trang đọc được, 8 dòng NCC thật (dienmaycholon, sunhouseviet, meta.vn, dienmayxanh, shopee...) với giá đọc từ trang, xuất Excel 8 dòng; không lỗi CPU. Dán 3 link (dienmayxanh, sunhouse.com.vn, dienmaycholon) → 3 dòng, mỗi dòng 12 thông số đúng (công suất 1700 W, dung tích, điện áp, xuất xứ...), hãng Sunhouse. Lần đầu cột thông số trống vì cache trang 7 ngày của trình duyệt còn bản cũ → đã thêm số phiên bản vào khóa cache trang (cache cũ tự bị bỏ qua). Sau đó DuckDuckGo chặn tạm thời vì mình tìm 2 lần liền (giới hạn đã biết).
- [ ] **Chưa mở file .xlsx bằng Microsoft Excel/LibreOffice thật** (không có trong môi trường dựng); đã dùng ExcelJS (thư viện phổ biến) và kiểm tra cấu trúc, nhưng bạn nên mở thử một lần.
- [ ] **VAT thường "Chưa rõ"**: trang bán lẻ ít khi ghi VAT; app không đoán. Trang B2B thường ghi "chưa VAT": sẽ được nhận ra.
- [ ] **Thông số có thể khác nhau giữa các trang** (tên/cách viết); mỗi trang giữ nguyên chữ của trang đó, tối đa 12 dòng thông số ưu tiên công suất, dung tích, điện áp, kích thước...
- [ ] **Giá Shopee/TikTok (vẽ bằng JavaScript)** không đọc được: dòng đó hiện "Liên hệ".
- [ ] CPU Cloudflare Free: đọc thông số thêm khoảng 1 ms mỗi trang; tổng thời gian trích xuất mỗi trang ~7–11 ms trên máy dựng app, sát giới hạn ~10 ms; nếu gặp lỗi CPU ở trang nặng, trang đó bị bỏ qua và ghi log.
- [ ] Chưa thử với Google/AI thật; chưa kiểm tra bảng trên điện thoại thật (đã thiết kế cuộn ngang).
- [x] Sửa: giao diện không cập nhật khi tab/khung ở nền vì `requestAnimationFrame` bị tạm dừng → thêm `setTimeout` dự phòng.

## 2g. Sửa "không load được dữ liệu NCC": mở đúng các trang trong Google (bản 2.7.0, tiện ích 1.2.0)

**Nguyên nhân tìm được** (kiểm tra trực tiếp trên trang Google thật):
1. **Kết quả Google không phải địa chỉ trực tiếp mà là liên kết `/goto?url=<mã hóa>`** (mở thì dẫn thẳng tới trang đích, đã thử: ra đúng trang linhkienlamphat.com). Bộ đọc cũ coi đó là "trang Google" nên bỏ hết → **không có trang cửa hàng nào được mở**. Đây là lỗi gốc.
2. Phần chọn trang chỉ có 4 chỗ cho sản phẩm chính và các chỗ này bị nguồn AI trích dẫn chiếm hết, nên dù có kết quả cửa hàng cũng không được mở.
3. Không có tiện ích: công cụ tìm miễn phí (DuckDuckGo) thường bị chặn → bảng trống, không giải thích gì.

**Đã sửa**
- [x] `extension/ai-extract.js`: nhận liên kết `/goto` của kết quả Google (kèm tên website, đoạn trích). Đã chạy thử trên trang Google thật: 8 kết quả.
- [x] `web/js/lib/hybrid.js`: mở từng kết quả (tiện ích đi theo chuyển hướng), đọc trang thật, lấy **địa chỉ trang đích thật** làm link; bỏ Facebook/TikTok/YouTube (không có giá), mỗi website tối đa 2 link, Google chặn thì dừng, không mở trùng một liên kết.
- [x] `pickPages`: trang cửa hàng từ Google/tìm kiếm được mở **trước** (ưu tiên trang có mã model), tối đa ~60% số trang; vẫn mở bài đánh giá được trích dẫn; mặc định 10 trang (6 khi tìm bổ sung). Chỉ dừng sớm khi đã đọc ≥ 5 NCC.
- [x] **Dữ liệu chỉ từ đúng link**: mỗi dòng có cờ "đã đọc từ đúng trang"; giá AI/Google/trang danh sách là "chưa xác nhận" và **mặc định bị ẩn** (có lựa chọn "Gồm cả dữ liệu chưa xác nhận"). **Tên sản phẩm là link tới đúng trang đã lấy dữ liệu**.
- [x] **NCC theo website hoặc hãng**: cột "NCC / hãng sản xuất" ghi cả hai; chọn **nhóm theo NCC (website)** hoặc **theo hãng** (có dòng tiêu đề nhóm, số dòng, giá thấp nhất).
- [x] **Scrawl liên hệ** (`web/js/lib/contact.js`): SĐT/hotline, email, Zalo, địa chỉ, link trang "Liên hệ" — từ `tel:`/`mailto:`/`zalo.me`, dữ liệu cấu trúc Organization, header/footer; gộp theo website; NCC nào thiếu SĐT/email thì mở trang "Liên hệ" của họ (một lần, tối đa 3 trang mỗi lần tìm). Đã thử trên 5 trang thật (dienmayxanh, sunhouse.com.vn, dienmaycholon, meta.vn, linhkienlamphat): ra hotline, SĐT, email, địa chỉ. Cột "Liên hệ NCC" (lọc được, ẩn/hiện được, có trong Excel; SĐT/email/Zalo bấm được trên web).
- [x] **Khi ít/không có dữ liệu, bảng nói rõ vì sao và cách làm** (`diagnose`): DuckDuckGo chặn → cài tiện ích Chrome / dán link / khóa Gemini; Google CAPTCHA → xác minh rồi "Tìm thêm NCC"; có dòng chưa xác nhận bị ẩn; trang khác model; trang chặn 403.
- [x] 9 test mới (`tests/contact.test.mjs`) + test pipeline Chrome kiểm tra bảng ra nhiều NCC từ kết quả Google (link /goto), đọc từ đúng trang, có liên hệ.

**Đã thử trên bản online (27/10/2026, dán link bán hàng thật vì DuckDuckGo đang chặn)**: dán 5 link → 5 dòng NCC (dienmaycholon, meta.vn, dienmayxanh, sunhouse.com.vn, linhkienlamphat), mỗi dòng giá + 12 thông số đọc từ đúng link, SĐT/hotline, email, địa chỉ, Zalo; NCC thiếu email/địa chỉ (dienmayxanh) được mở trang "Liên hệ" tự động và bổ sung. Không lỗi CPU. Lỗi gặp khi thử: cache trang cũ thiếu trường liên hệ (→ thêm số phiên bản cache trang, hiện là v4), chỉ nhận 3 link dán (→ nâng lên 8), Zalo lấy nhầm "plugins" và địa chỉ lấy nhầm "Điện thoại:" (→ đã lọc, có test). Một link tự đoán (linhkienlamphat) trả giá 109.000 ₫ có vẻ không đúng sản phẩm: giá luôn cần kiểm tra ở trang gốc.

**Chưa kiểm chứng / giới hạn**
- [ ] **Chưa chạy tiện ích trong Chrome thật**: việc tiện ích tải liên kết `/goto` bằng `fetch` (không cookie) và đi theo chuyển hướng chưa kiểm chứng (đã kiểm chứng khi mở bằng trình duyệt). Nếu Google chặn thì các dòng sẽ không ra và nhật ký ghi rõ.
- [ ] Hạn mức Google: mỗi lần tìm ~6 lượt mở Google + ~10 lần mở liên kết `/goto` (giãn cách ≥ 2,5 giây, tổng ~40 giây). Nếu Google hỏi CAPTCHA, tiện ích đưa tab lên cho bạn xác minh.
- [ ] Shopee/TikTok vẽ giá bằng JavaScript: dòng có link và liên hệ nhưng "Liên hệ" báo giá.
- [ ] CPU Cloudflare Free: trích xuất mỗi trang ~8–12 ms trên máy dựng app, sát giới hạn ~10 ms; đã giảm cửa sổ đọc HTML còn 240 KB. Trang nặng có thể bị bỏ qua (có log).
- [ ] Số điện thoại/địa chỉ đọc bằng quy tắc: có thể lấy nhầm hoặc thiếu; luôn kiểm tra ở trang gốc.

## 2h. Từ khóa tìm sản phẩm: giữ nguyên chuỗi gõ + cụm hỏi (bản 2.7.3)

**Yêu cầu:** không cắt tên/mã sản phẩm; vẫn sinh từ khóa theo dạng [chuỗi sản phẩm nguyên vẹn] + giá / ưu điểm / nhược điểm / thông số…

**Quy tắc hiện tại:**
- Mọi từ khóa tìm = **chuỗi bạn gõ nguyên văn** (chỉ gom khoảng trắng thừa, không cắt độ dài, không bỏ chữ) + cụm hỏi phía sau. Ví dụ: `<chuỗi gõ> giá bán`, `<chuỗi gõ> đánh giá ưu điểm nhược điểm`, `<chuỗi gõ> thông số kỹ thuật công nghệ tính năng` (thiết bị), `<chuỗi gõ> mua ở đâu giá tốt`.
- Áp dụng cho Google Chế độ AI, Google thường (tìm cửa hàng) và DuckDuckGo. Các lần tìm bổ sung đổi **cụm hỏi** (không đổi chuỗi sản phẩm) để ra nguồn khác.
- Tên sản phẩm (`plan.name`) không còn bị cắt 14 từ. Nhận diện model không lấy thông số linh kiện (`i5-1235U`, `RTX4060`, `DDR5`, `R32`...) và chỉ dùng để kiểm tra trang đúng sản phẩm, không dùng để thay chuỗi gõ khi tìm.
- Bước "tìm hãng khác" (so sánh 4–5 hãng) tìm theo **loại sản phẩm**, hỏi riêng từng hãng bằng tên hãng đó: không phải tìm sản phẩm bạn nhập.

## 2i. Giao diện mới, tư vấn chọn sản phẩm/NCC, danh bạ NCC (bản 2.8.0)

**Yêu cầu của bạn → đã làm**
- **Ảnh chỉ lấy 5 ảnh**: mỗi sản phẩm/hãng giữ tối đa 5 ảnh điểm cao nhất (cache cũ cũng chỉ hiện 5).
- **Tab lên đầu trang, không mất khi kéo thanh cuộn**: các tab (Tổng hợp, Tư vấn chọn, Nhà cung cấp, Bảng NCC, So sánh…) nằm ngay trong thanh đầu trang dính trên cùng, luôn thấy khi cuộn.
- **Lưu tên NCC + thông tin của mọi trang đã đọc**: trước đây chỉ trang khớp model mới có dòng NCC. Nay mọi trang đọc được đều ghi tên NCC, các trang đã đọc, liên hệ vào `entry.suppliers` / `entry.contacts`, hiện ở tab **Nhà cung cấp**, và lưu vào **danh bạ NCC dùng chung** (IndexedDB `suppliers`, không mất khi cache kết quả bị dọn; NCC đã có liên hệ thì không mở lại trang liên hệ; xuất/nạp cache kèm theo danh bạ).
- **Lọc thông tin kỹ thuật đúng**: bộ lọc thông số ở Bảng NCC khớp theo từ/số trọn (150 không khớp 1500), hỗ trợ `công suất: 1500`, `công suất>=1500`, `dung tích<=6 lít`, nhiều điều kiện cách nhau bằng `;`.
- **Dán ảnh**: Ctrl+V ở bất kỳ đâu trong trang, nút **Dán ảnh**, hoặc kéo thả ảnh vào ô tìm (có ảnh xem trước). Đọc chữ trên ảnh vẫn cần khóa dịch vụ (Gemini miễn phí).
- **Nhu cầu / mục đích / ngân sách**: mục “Nhu cầu của bạn” dưới ô tìm, tự điền từ chữ bạn gõ (vd “dưới 5 triệu cho gia đình 4 người”), sửa được, lưu theo từng lần tìm. **Chỉ dùng để gợi ý, không dùng để tìm**: từ khóa tìm vẫn là đúng chữ bạn gõ.
- **Tab Tư vấn chọn**: bước 1 hướng dẫn chọn sản phẩm khi chưa rõ mã model hoặc chỉ có khoảng giá (danh sách sản phẩm xếp theo độ hợp ngân sách/mục đích, kèm câu hỏi để thu hẹp, ví dụ “khác nhau ở Công suất…”); bước 2 xếp hạng NCC của sản phẩm đã chọn (giá, ngân sách, đọc từ đúng trang, VAT, liên hệ) kèm lý do và cảnh báo. Điểm tính theo quy tắc cố định, không phải đánh giá chất lượng tuyệt đối.
- **Bỏ chữ “AI” trên giao diện**: nhãn, banner, cài đặt, nhật ký, thông báo lỗi đều đổi sang “Google”, “dịch vụ”, “tìm nâng cao”.
- **Giao diện mềm, hiện đại**: nền gradient nhẹ, thẻ bo tròn, thanh đầu mờ kính, nút gradient, bố cục gọn trên điện thoại, tự theo chế độ tối.
- **Link ngắn**: Worker đổi tên thành `muahangthongminh` → **https://muahangthongminh.purchasing-online.workers.dev**. Dữ liệu cache lưu theo từng địa chỉ, nên địa chỉ mới bắt đầu trống: ở địa chỉ cũ bấm “Xuất file cache”, ở địa chỉ mới bấm “Nạp file cache”. Worker cũ (`mua-hang-thong-minh`) vẫn chạy, xóa trong Cloudflare dashboard khi không cần nữa. (Link ngắn hơn nữa cần tên miền riêng.)

**Chưa kiểm chứng**: đọc chữ trên ảnh dán với khóa thật; nút “Dán ảnh” trên iPhone/Safari (trình duyệt có thể chặn đọc clipboard: dùng giữ ô nhập → Dán); tiện ích Chrome với địa chỉ mới (`*.workers.dev` đã nằm trong danh sách cho phép, cần bấm “Cho phép trang này” lần đầu).

## 2j. NCC bị loại oan do nhận sai "mã model" (bản 2.8.1)

**Triệu chứng:** tìm "Đồng Hồ Đo Áp LIGI Inox 316, Chân Sau Có Vành D63mm Ren 13mm" ra nhiều NCC trong kết quả nhưng nhiều trang bị loại.

**Nguyên nhân (không liên quan hình ảnh):** ứng dụng KHÔNG so ảnh. Ảnh chỉ được lấy từ trang đã được coi là đúng sản phẩm. Lý do loại là nhận sai: `D63mm` (đường kính) bị coi là mã model, nên chỉ trang nào viết đúng "D63mm" mới được nhận; trang viết "D63", "Ø63", "phi 63" bị loại. Hãng cũng bị nhận sai thành "Vành", tên loại thành "đồng".

**Đã sửa:**
- Quy cách kích thước/ren/áp suất (`D63mm`, `Ø63`, `phi63`, `DN15`, `PN16`, `G1/4`...) không còn bị coi là mã model. Hãng viết HOA giữa câu ("LIGI") được nhận là hãng. Tên loại không bị cắt thành "đồng" khi gõ Viết Hoa Mỗi Chữ.
- So khớp trang theo **từ** (tách chữ và số): "D63mm" khớp "D63", "Ø63"; cần khớp phần lớn các từ đặc trưng của tên (≥ 60% khi không có model).
- Có mã model: khớp mã **hoặc** gần hết tên (≥ 75%) kèm phần số của mã, vì nhà bán hay viết mã khác đi.
- Trang có giá nhưng tên chỉ giống một phần (≥ 34%) **không còn bị bỏ**: vào Bảng NCC với dấu "tương tự" (không tính vào giá trung bình, bị trừ điểm khi tư vấn) để bạn tự mở link kiểm tra. Trang không liên quan vẫn không có dòng nhưng NCC vẫn được lưu ở tab Nhà cung cấp.
- Cache trang cũ tự đọc lại (FACTS_VERSION 5).

## 2k. Hết "giá đồng", thẻ câu hỏi, đọc thêm nguồn (bản 2.9.0)

**Lỗi báo cáo:** tìm "đồng hồ đo dầu" nhưng danh sách nguồn có "Giá đồng thế giới, giá đồng tấm...".
**Nguyên nhân:** bước "tìm hãng khác để so sánh" vẫn tự cắt một "tên loại" từ chuỗi gõ (`genericName`), và cắt sai thành "đồng" (từ đầu tiên), rồi tìm "đồng giá". Đây đúng là việc cắt chuỗi bạn đã yêu cầu không làm.
**Đã sửa:** bước so sánh hãng cũng dùng **đúng chuỗi bạn gõ** + cụm hỏi (`<chuỗi gõ> so sánh các hãng`, `… bán chạy nhất`, `… nên mua hãng nào`), cả ở Google (Chrome) lẫn DuckDuckGo (máy chủ). Không còn đường nào tìm bằng chuỗi cắt/đoán. Tên loại cắt ra chỉ còn để hiển thị.

**Thẻ câu hỏi (tab Tư vấn chọn):** 3–5 thẻ, tạo từ chính dữ liệu đã đọc của từ khóa đó: đối tượng (gia đình / cửa hàng / nhà xưởng / văn phòng), 2–3 đặc điểm đang khác nhau giữa các sản phẩm tìm được (kích thước mm, áp suất bar/psi, chất liệu, ren, công suất, dung tích), ngân sách (mốc chia theo giá thực tế đã đọc, chỉ hỏi khi bạn chưa nhập), ưu tiên. Chọn thẻ sẽ **lọc và xếp hạng** sản phẩm/NCC đã có (dòng không ghi đặc điểm đó vẫn giữ, ghi "chưa rõ"); không dùng để tìm. Bấm lại để bỏ chọn.

**Đọc thêm nguồn (bù đắp), Cloudflare vẫn là đường chính:**
- Khi dùng tiện ích Chrome: ngoài Google, tiện ích đọc thêm kết quả **DuckDuckGo + Bing** (bằng IP của bạn, không tốn hạn mức Google, không bị chặn như IP máy chủ), lấy tối đa 10 kết quả mỗi nơi làm nguồn cửa hàng. Bị chặn thì bỏ qua, phần còn lại vẫn chạy. Việc trích xuất trang diễn ra trong trình duyệt nên không tốn CPU Cloudflare.
- Số trang mở mỗi lần mặc định 12 (thanh trượt Cài đặt tới 30), lần tìm bổ sung 10; chỉ dừng sớm khi đã đọc ≥ 8 trang và ≥ 8 NCC.
- Không có tiện ích: vẫn chạy như cũ qua Cloudflare (DuckDuckGo/Bing, đọc trang từng cái).

**Chưa kiểm chứng:** DuckDuckGo/Bing qua tiện ích trong Chrome thật (đã có test với tiện ích giả); nếu tiện ích bị DuckDuckGo hỏi xác minh thì bỏ qua nguồn đó.

## 2l. Link tìm thấy nhưng không có trong Bảng NCC (bản 2.9.1)

**Ví dụ:** từ khóa "sữa vinamilk growplus pha sẵn 110ml" tìm ra https://suachobeyeu.vn/san-pham/sua-bot-pha-san-dielac-grow-plus-hop-110ml.html (có giá) nhưng Bảng NCC không có dòng đó.

**Đã kiểm tra trực tiếp trang đó:** máy chủ đọc được trang (HTTP 200, khớp tên 83%), nhưng **không lấy được giá**: trang tự viết "Đơn giá:" và "388,000 đ" ở hai dòng/thẻ rời, không có dữ liệu cấu trúc. Giá thật là **388.000 đ cho 1 thùng = 48 hộp x 110ml** (≈ 8.083 đ/hộp), không phải "110" (110 là dung tích 110ml).

**Nguyên nhân gộp lại và cách sửa:**
- Trích giá: đọc thêm giá trong phần tử có class/id "price/gia" (bỏ giá cũ/gạch), và ghép nhãn "Đơn giá:" với số ở dòng kế. Ngưỡng giá tối thiểu hạ từ 10.000đ xuống 1.000đ vì hàng tiêu dùng (1 hộp sữa, 1 gói mì) có thể dưới 10.000đ.
- Quy cách đóng gói: nhận "1 Thùng = 48 Hộp x 110ml" và hiện **giá mỗi hộp** dưới giá trang (≈ 8.083 đ/hộp) để không nhầm giá thùng với giá hộp.
- Bảng NCC: mặc định trước đây **ẩn** các dòng chưa đọc được từ đúng trang (giá lấy từ Google/kết quả tìm kiếm) nên link có giá vẫn "biến mất". Nay mặc định hiện **tất cả NCC**, dòng chưa đọc từ trang có nhãn "chưa đọc từ trang"; vẫn có lựa chọn "Chỉ dữ liệu đã đọc từ đúng trang" (đặt lại cho mọi người một lần).
- Trang đã bị loại theo cách nhận cũ (cache các lần tìm trước) được **đọc lại một lần** ở lần tìm bổ sung kế tiếp, vì app không mở lại trang đã mở.
- Cache trang cũ tự đọc lại (FACTS_VERSION 6).

**Chưa kiểm chứng:** không biết chính xác "110" bạn thấy ở đâu trong tab Tổng hợp (không có dữ liệu lần tìm đó). Nếu còn thấy giá 110 sau khi tìm lại, gửi mình ảnh tab Tổng hợp và Nhật ký.

## 2m. Thiết kế lại luồng theo kiểu dữ liệu người dùng nhập (bản 2.10.0)

**Trang WinMart (Next.js) không đọc được giá:** trang dựng bằng JavaScript, không có JSON-LD nhưng nhúng dữ liệu trong `<script id="__NEXT_DATA__">`. Đã thêm đọc dữ liệu nhúng này (tên, giá, mã, hãng, ảnh; bỏ qua các biến thể bên trong) và nhận quy cách "lốc 4 hộp x 110ml" để hiện giá mỗi hộp. Thử trực tiếp trang bạn gửi: giá 21.900 đ/lốc 4 hộp (≈ 5.475 đ/hộp), hãng VINAMILK, mã 10602909G4.

**Nguyên tắc luồng mới:** nhận diện dữ liệu nhập TRƯỚC khi tìm (chạy ngay trên máy, không gọi mạng, không tốn lượt tìm) → chọn kịch bản. Dòng gợi ý dưới ô tìm cho biết kịch bản ngay khi gõ.

| # | Kiểu dữ liệu nhập | Ví dụ | Hành vi |
|---|---|---|---|
| 1 | Dữ liệu thô, thiếu thông tin (biết loại hàng) | "đồng hồ đo dầu", "máy lọc nước" | Hiện **thẻ câu hỏi trước** (3–5 thẻ theo loại hàng, mỗi thẻ có ô "Khác" tự nhập, bỏ qua được). Trả lời đủ → tìm đầy đủ. **Bỏ qua** → chế độ **khám phá**: chỉ giá, sản phẩm tương đương, ưu nhược điểm (tối đa 6 trang, không mở trang liên hệ), **chưa có bảng so sánh NCC**; chọn một sản phẩm ở tab Tư vấn chọn thì tìm đầy đủ cho đúng sản phẩm đó |
| 2 | Đủ thông tin | "Sony WH-1000XM5", "Kangaroo KG100A", hãng + thông số ("LIGI inox 316 D63mm ren 13mm"), "sữa vinamilk growplus pha sẵn 110ml" | **Không hỏi**, tìm thẳng, dựng bảng NCC theo đúng tên/mã (trang giống một phần vào bảng với dấu "tương tự") |
| 3 | Có hãng + loại, thiếu chi tiết | "sữa vinamilk" | Thẻ câu hỏi (bỏ câu hãng vì đã có) |
| 4 | Mới có ngân sách/nhu cầu | "quà tặng dưới 500k", "laptop dưới 15 triệu cho sinh viên" | Chưa biết loại → thẻ **chọn loại hàng** trước, rồi hỏi tiếp theo loại đó; ngân sách/mục đích tự điền vào ô Nhu cầu |
| 5 | Link sản phẩm | dán URL | Không hỏi; đọc thẳng trang, tên/mã lấy từ trang, rồi tìm các NCC khác |
| 6 | Ảnh | dán/chụp ảnh | Đọc chữ trên ảnh → điền vào ô tìm → áp dụng các kịch bản trên |
| 7 | Hai sản phẩm | "so sánh A với B", "A vs B" | Hỏi tìm cái nào trước (tìm từng sản phẩm một) |
| 8 | Đã có trong cache | tìm lại cùng sản phẩm | **Không hỏi lại**, mở cache ngay rồi bổ sung trang mới |
| 9 | Quá ngắn / chưa rõ | "xyz" | Thẻ chọn loại hàng + đối tượng + ngân sách, hoặc nhắc nhập thêm |

**Thẻ câu hỏi lấy từ đâu:** ngân hàng câu hỏi có sẵn trong ứng dụng cho 14 loại hàng (sữa, thực phẩm đóng gói, đồng hồ đo công nghiệp, van/ống, điều hòa, tủ lạnh, máy giặt, máy lọc nước, laptop, điện thoại, tivi, tai nghe/loa, đồ bếp, máy bơm/dụng cụ điện) + gợi ý học từ cache các lần tìm trước trên máy (hãng và thông số đã gặp, nhãn "đã gặp"). Không gọi dịch vụ ngoài. Chuỗi tìm = chữ bạn gõ + các lựa chọn bạn chọn (hiện ngay trong ô tìm, sửa được); thẻ ngân sách/đối tượng/ưu tiên chỉ điền ô Nhu cầu, không vào chuỗi tìm. Loại hàng chưa có trong ngân hàng thì hỏi thẻ chung (loại hàng, đối tượng, ngân sách).

**Tải nhanh, tìm hiệu quả:** (1) nhận diện và thẻ câu hỏi chạy tức thì trên máy; (2) cache trước: đã tìm rồi thì mở ngay, không hỏi; (3) thiếu thông tin thì không phí lượt tìm vào bảng NCC (khám phá nhẹ, tối đa 6 trang, bỏ trang liên hệ); (4) đủ thông tin mới tìm sâu (12 trang, trang liên hệ, danh bạ NCC dùng chung); (5) dừng sớm khi đã đủ 8 trang/8 NCC; (6) đọc nhiều trang cùng lúc (3 luồng), giãn cách theo tên miền; (7) vỏ ứng dụng được lưu offline (service worker), thư viện Excel chỉ tải khi xuất file.

**Chưa làm / hạn chế:** loại hàng ngoài 14 loại chỉ có thẻ chung; chưa so sánh song song hai sản phẩm trong một lần chạy; ngân hàng câu hỏi là quy tắc cố định (mở rộng bằng cách thêm vào `web/js/lib/kb.js`).

## 2n. Đọc giá trên nhiều kiểu website, không tư vấn khi thiếu thông tin, tab cấu hình (bản 2.11.0)

### Tự chạy thử đọc giá trên website thật
Công cụ: `node dev/probe-sites.mjs dev/sites.json` (tự tìm trang sản phẩm thật rồi đọc giá) và `node dev/probe-sitemap.mjs <website>`. Đã chạy trên 24 website (52 trang).

**Đọc được giá (từ HTML, không cần chạy JavaScript):** thegioididong, dienmayxanh, cellphones, hoanghamobile, fptshop, phongvu, tiki, pico, mediamart, dienmaycholon, viettelstore, shopdunk, WinMart (Next.js nhúng dữ liệu).

**Lỗi tìm thấy và đã sửa:**
- thegioididong: JSON-LD dạng đồ thị, `Product.offers` chỉ là tham chiếu `@id` và giá nằm ở nút Offer khác; trước đó đọc nhầm giá trong chữ (50.000 thay vì 48.990.000). Nay ghép theo `@id` và ưu tiên sản phẩm có giá (nhóm biến thể thường không có giá).
- Thêm các cách đọc giá cho trang không có dữ liệu cấu trúc: vi dữ liệu `itemprop="price"`, `data-price-amount` (Magento), WooCommerce, giá nằm ngay sau tên sản phẩm (bỏ dòng giảm giá/trả góp/phí), phần tử có class "price" (bỏ giá cũ gạch), nhãn "Đơn giá:" ở dòng riêng.
- Có mẫu kiểm thử mô phỏng từng nền tảng: `tests/sites.test.mjs`.

**Không đọc được giá, và app giờ nói rõ vì sao** (cột Đơn giá của bảng NCC):
- "Giá do trang tải bằng JavaScript — mở link để xem": coolmate, bachhoaxanh, hasaki, lazada, shopee (HTML không chứa giá). Cần trình duyệt chạy JavaScript; **chưa làm** (hướng: tiện ích Chrome mở tab thật rồi đọc giá, cần cập nhật tiện ích).
- "Liên hệ báo giá (trang không niêm yết)": nhiều website thiết bị công nghiệp ghi "Giá: Liên hệ".
- Website bán bằng USD (gymshark) không nằm trong phạm vi (ứng dụng dành cho giá VND).

Các dòng THIẾU còn lại trong lần chạy cuối đều là trang tin tức/danh mục/landing bị công cụ chọn nhầm, không phải trang sản phẩm.

### Thiếu thông tin thì KHÔNG tư vấn
Ở kịch bản khám phá (thiếu thông tin hoặc bạn bấm bỏ qua thẻ câu hỏi): không "Lựa chọn tối ưu", không tư vấn chọn sản phẩm/NCC, không xếp hạng hay so sánh báo giá, không bảng NCC, không giá trung bình. Chỉ có cái nhìn chung (ưu nhược điểm, công nghệ, ảnh, **khoảng giá tham khảo** kèm cảnh báo, các hãng cùng loại thường gặp) và nhắc **bổ sung thông tin** (nút "Bổ sung thông tin" mở lại thẻ câu hỏi, liệt kê cần bổ sung gì). Ô hỏi đáp bỏ gợi ý "nên chọn"/"so sánh công nghệ". Bổ sung đủ thì tìm lại ở chế độ đầy đủ.

### Tab Cài đặt cấu hình
Cài đặt chia 3 tab: **Tìm kiếm** (mẫu Nhanh / Cân bằng / Đầy đủ hoặc tự chỉnh: số trang khi đủ/khi thiếu thông tin/mỗi lần tìm thêm, số ảnh sản phẩm chính và mỗi hãng khác, số trang đọc cùng lúc, tối đa trang mỗi website, bật/tắt trang liên hệ NCC, bật/tắt DuckDuckGo+Bing qua tiện ích, dừng sớm khi đủ), **Kết nối** (máy chủ, nguồn tìm, khóa, mã, kiểm tra kết nối, tiện ích), **Dữ liệu** (tự xóa sau N ngày). Mọi giá trị được ép vào khoảng an toàn; có hiệu lực ngay từ lần tìm kế tiếp.

## 2o. Thẻ câu hỏi không hỏi loại hàng, bố cục khít ngang, ảnh giống ảnh tham chiếu, hướng dẫn khóa (bản 2.13.0)

- **Thẻ câu hỏi:** bỏ câu "Bạn đang tìm loại sản phẩm nào?". Chưa nhận ra loại hàng thì dùng đúng chuỗi bạn gõ, chỉ có ô **tự gõ thêm** (hãng, mã, thông số), bỏ qua được; kèm đối tượng và ngân sách.
- **Bố cục:** khít đúng chiều ngang màn hình, không tràn ngang, không bị kéo lệch khi vuốt ngang. Chỉ cho phóng to, không cho thu nhỏ dưới khổ màn hình (`minimum-scale=1`). Đã kiểm tra ở 320px trên mọi tab (lưới nhà cung cấp và thanh công cụ bảng NCC đã sửa chỗ tràn).
- **Ảnh theo ảnh tham chiếu:** khi bạn đưa ảnh (chọn/dán/chụp), app lưu "dấu vân tay" của ảnh (hình dạng dHash 64 bit + biểu đồ màu), tìm nhiều ảnh ứng viên hơn rồi **xếp giống/gần giống nhất lên trước**, giữ đúng số ảnh đã chọn; mỗi ảnh có nhãn "giống N%". Không cần giống hệt. Ảnh web được tải qua máy chủ (`/api/image`, chặn mạng nội bộ, chỉ nhận ảnh ≤1,5 MB) để đọc điểm ảnh. Đây là so sánh gần đúng về dáng và màu, không nhận diện vật thể: ảnh khác góc chụp hoặc nền khác có thể điểm thấp.
- **Hướng dẫn khóa trong Cài đặt → Kết nối:** từng bước lấy khóa Gemini (miễn phí), Claude, cài tiện ích Google trong Chrome và nguồn miễn phí; mục tương ứng tự mở theo nguồn tìm đang chọn; dán khóa sai dạng/sai nguồn thì báo ngay.

## 3. Tự xóa dữ liệu cũ

- Mỗi lần mở app: xóa mục lưu quá **N ngày** (Cài đặt → "Tự xóa dữ liệu đã lưu sau", mặc định 30 ngày).
- Luôn giữ tối đa **40** mục mới nhất.
- Bộ nhớ trình duyệt đầy khi lưu: tự xóa còn 10 mục mới nhất (≤ 7 ngày) rồi lưu lại.
- Mặc định app luôn tìm thêm và gộp vào cache (mục 2d); chỉ chọn "chỉ xem cache" mới dùng nguyên trạng.
- Nút "Xóa tất cả" và xuất/nạp file cache ở ngăn Lịch sử.

## 4. Triển khai Cloudflare (gói Free) — ĐÃ TRIỂN KHAI

**Địa chỉ: https://mua-hang-thong-minh.purchasing-online.workers.dev** (27/10/2026, Worker `mua-hang-thong-minh` trên tài khoản của bạn, phiên bản app 2.3.0).

Đã kiểm chứng trên bản online:
- [x] Giao diện, manifest, service worker (đăng ký được), icon, `/ext/mua-hang-extension.zip`, `/ext/version.json`, `/privacy` đều phục vụ đúng; `/api/health` trả lời.
- [x] **Đọc trang thật từ máy chủ Cloudflare**: dienmayxanh.com trả đủ giá, hãng, mã, ảnh, đánh giá.
- [x] **Tìm miễn phí DuckDuckGo từ máy chủ Cloudflare hoạt động** (trước đó chưa kiểm chứng được). Chạy trọn luồng trên giao diện online, 15 giây, không khóa AI: "Nồi chiên không dầu Sunhouse SHD4030" → 5 giá, 6 ưu điểm, 1 nhược điểm, 8 trang đọc được (kể cả Shopee, sunhouse.com.vn).
- [x] Lần chạy đầu bước so sánh hãng khác bị DuckDuckGo yêu cầu xác minh vì gửi 4 truy vấn trong vài giây → đã sửa: bước so sánh chỉ 1 truy vấn, nghỉ 4 giây giữa hai lượt tìm; số ảnh tối đa 24 (đã deploy lại).
- [ ] Thử "Máy hút bụi cầm tay Xiaomi G11" ở chế độ miễn phí: chạy hết, không lỗi, nhưng chỉ 2 giá, 0 ưu/nhược điểm, **0 hãng so sánh** (các trang bán hàng đọc được không có mục ưu/nhược điểm và không có danh sách sản phẩm dạng dữ liệu cấu trúc). Đây là giới hạn của chế độ không AI, không phải lỗi: muốn đủ so sánh hãng hãy dùng tiện ích Chrome (Chế độ AI) hoặc khóa Gemini miễn phí.
- [ ] Chưa thử với khóa AI thật và chưa thử tiện ích trong Chrome thật trên bản online.

Còn lại cho bạn:
- [ ] (Tùy chọn) `npx wrangler secret put GEMINI_API_KEY` — khóa Gemini miễn phí từ aistudio.google.com.
- [ ] (Nên) `npx wrangler secret put APP_CODE` rồi nhập mã ở Cài đặt, để người lạ không dùng hết hạn mức khóa của bạn. Hiện chưa có mã: ai có địa chỉ đều dùng được chế độ miễn phí.
- [ ] Cài tiện ích Chrome từ thư mục `extension/` và bấm "Cho phép trang này" trên địa chỉ trên.
- [ ] Đã quyết định **không đăng Chrome Web Store**: cập nhật tiện ích bằng `git pull`/giải nén đè, tiện ích tự tải lại (mục 2c).

Giới hạn gói Free (xác nhận lại trên trang giá của Cloudflare vì có thể đổi):
- CPU ≈ 10 ms mỗi lần gọi: app giới hạn trang đọc 320 KB; chưa gặp lỗi CPU trong các lần thử (13 trang/lần).
- Tối đa 50 yêu cầu ra ngoài mỗi lần gọi: mỗi trang là một lần gọi API riêng nên không vượt.
- Số lần gọi/ngày có hạn mức; mỗi lần tìm dùng khoảng 10–20 lần gọi API.

## 5. Lỗi phát sinh đã sửa (theo thứ tự gặp)

| # | Lỗi | Cách sửa | Có test |
|---|---|---|---|
| 1 | Giá đếm hai lần (AI báo + đọc lại từ chính trang đó) | Giá đọc từ trang thay giá AI của cùng nguồn | ✔ |
| 2 | Chấm điểm thiên vị sản phẩm đang xem (có nhiều ý hơn vì đọc nhiều trang) | Dùng tỉ lệ ưu/(ưu+nhược) có làm mịn thay vì hiệu số | ✔ |
| 3 | Ưu điểm gần giống nhau (câu AI vs câu trên trang) không gộp | Gộp khi câu này nằm trong câu kia (≥ 25 ký tự) | ✔ |
| 4 | `parseVnd("1.2 triệu")` ra 2.000.000 | Sửa regex "tr" | ✔ |
| 5 | Danh sách ưu/nhược điểm lấy thừa đoạn văn sau danh sách | Dừng khi hết dòng gạch đầu dòng | ✔ |
| 6 | Nguồn "chưa kiểm chứng" bị đổi thành đã kiểm chứng khi thêm lại | Không ghi đè cờ | ✔ |
| 7 | Hãng lạ (vd "Zeta") không nhận ra → chính sản phẩm đang xem bị tính là đối thủ | Nhận hãng = từ viết hoa trước mã model; bỏ sản phẩm có cùng model | ✔ |
| 8 | Cache không khớp khi gõ hoa/thường khác nhau (hãng nhận diện khác) | Khóa cache chỉ dùng model nếu có | ✔ |
| 9 | Tìm miễn phí: gửi 4 truy vấn cùng lúc → DuckDuckGo chặn | Gửi tuần tự, giãn 0,7 giây, chỉ 2 truy vấn | — |
| 10 | Bing trả kết quả rác (Google Dịch, Zalo) khi không có cookie | Chỉ nhận kết quả có chứa từ của truy vấn; thêm DuckDuckGo Lite | ✔ |
| 11 | Công cụ tìm bị chặn làm cả lần tìm lỗi | Ghi log, vẫn mở link người dùng dán; không có gì mới báo hướng dẫn | ✔ |
| 12 | Dán link sản phẩm không được hỗ trợ | Link trong ô tìm được đọc trước, lấy tên sản phẩm từ trang | ✔ |
| 13 | Tab Hỏi đáp lặp nguồn ([1] và chip) | Biến [n] thành liên kết nguồn ngay cạnh ý | — |
| 14 | Phân tích Chế độ AI: dòng ý bắt đầu bằng "Giá rẻ hơn…" bị coi là đề mục "Giá" nên mất ưu điểm | Đề mục không có dấu phẩy, mục giá phải ngắn (≤ 30 ký tự) | ✔ |
| 15 | Dòng bảng "Công nghệ làm nóng | Rapid Air" bị coi là đề mục công nghệ | Dòng có " | " không phải đề mục | ✔ |
| 16 | Regex giá không nhận "800.000đ" ( không hoạt động với chữ "đ") | Dùng lookahead Unicode | ✔ |
| 18 | Tiện ích đếm "đang bận" sai (giảm bộ đếm sau khi trả lời) nên tự tải lại có thể bị hoãn lệnh kế tiếp | Giảm bộ đếm trước khi trả lời | ✔ |
| 17 | Tiện ích: hẹn giờ chờ tab không được hủy (giữ service worker chạy 20 giây thừa) | Hủy hẹn giờ khi tab tải xong | ✔ |

## 6. Việc còn lại / chưa kiểm chứng

- [ ] **Chưa chạy thử khóa Gemini/Claude thật** (không có khóa trong môi trường dựng app). Phần Gemini đã test bằng giả lập (gửi `google_search`, đọc nguồn, giải link chuyển hướng). Phần Claude (`web_search_20260209`, `output_config.effort`) chưa chạy thật. Gemini mặc định `gemini-2.5-flash`: nếu Google đã đổi tên model, đặt `GEMINI_MODEL` trong `wrangler.toml`.
- [x] Tìm miễn phí từ máy chủ Cloudflare đã hoạt động (xem mục 4), nhưng DuckDuckGo vẫn có thể chặn khi gửi dồn nhiều lượt: đã giãn cách; nếu bị chặn hãy dán link sản phẩm hoặc dùng Chrome/Gemini.
- [x] Service worker đăng ký được trên bản online (https). Chưa thử cài lên điện thoại thật (Android: Cài đặt ứng dụng; iPhone: Thêm vào MH chính).
- [ ] Đọc chữ từ ảnh (OCR) cần khóa AI. Chưa có OCR chạy ngay trên máy (Tesseract.js) cho chế độ miễn phí.
- [ ] Chế độ miễn phí không trả lời câu hỏi tự do (chỉ các nút Giá/Ưu/Nhược/Công nghệ/Nên chọn).
- [ ] Dán link sản phẩm vẫn là cách chắc nhất khi mọi công cụ tìm bị chặn.
- [ ] Trang vẽ giá bằng JavaScript (Shopee, TikTok Shop) không đọc được giá.
- [ ] Bản cũ (`docs/`, `purchasing/`, `app.py`, `templates/`, `tests/test_core.py`) vẫn còn, không dùng nữa; xóa khi bạn đồng ý (có trong lịch sử git).
- [ ] Chưa commit/push lên GitHub.

## 7. Lệnh hay dùng

```bash
npm install
```
```bash
npm run dev
```
```bash
npm test
```
```bash
npm run deploy
```
