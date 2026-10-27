# TODOAPP — nhật ký triển khai, lỗi đã sửa, việc còn lại

Cập nhật: 27/10/2026. Bản hiện tại: **2.5.0** (PWA + Cloudflare Worker + tiện ích Chrome tự cập nhật).

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
