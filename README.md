# Mua hàng thông minh (PWA: web + điện thoại)

Nhập **tên / mã model / ảnh** sản phẩm → AI tìm trên web → lưu **cache** → mở các trang nguồn để lấy giá, ảnh, ưu/nhược điểm → **so sánh 4–5 hãng** và chọn phương án tối ưu. Mọi kết luận ngắn gọn, **gắn nguồn bên cạnh**.

Không cần Python, không cần cài tiện ích trình duyệt. Chạy online, mở bằng link trên điện thoại hoặc máy tính, cài được như một app (PWA).

## Cách hoạt động

1. **Chọn từ khóa thông minh** (`web/js/lib/plan.js`): tách mã model, hãng, tự nhận loại hàng, sinh bộ từ khóa (mã model trong ngoặc kép, giá, ưu nhược điểm, thông số, so sánh, tiếng Anh).
2. **AI tìm trước** (Claude có `web_search` hoặc Gemini có Google Search): trả JSON gồm tên, hãng, model, giá, ưu/nhược điểm, công nghệ, kèm URL nguồn cho từng ý. Bước 2 hỏi AI chọn **4–5 hãng khác** cùng phân khúc để so sánh.
3. **Kiểm chứng nguồn**: mỗi URL AI nêu phải nằm trong kết quả tìm kiếm thật; không thì bị đánh dấu **“?” chưa kiểm chứng**.
4. **Mở từng trang nguồn** (`worker/extract.js`): đọc giá có cấu trúc (JSON-LD, meta), ảnh sản phẩm (bỏ logo/biểu tượng), mục “Ưu điểm/Nhược điểm”, tên công nghệ. **Mỗi trang mở đều ghi log**, tab *Nhật ký* tổng hợp theo mục: giá, ưu điểm, nhược điểm, công nghệ, ảnh. Trang lỗi bị bỏ qua ngay, không thử lại.
5. **Cache**: toàn bộ kết quả lưu trên thiết bị (IndexedDB). Tìm lại cùng sản phẩm: app **hiện dữ liệu cũ ngay**, rồi **tìm thêm trang mới và gộp vào cache cũ** (không mở lại trang đã đọc, không xóa dữ liệu cũ). Muốn chỉ xem lại không tìm, chọn “chỉ xem cache”. Xuất/nạp thành **một file `.json`** ở ngăn *Lịch sử*.
6. **Hỏi đáp**: các nút Giá / Ưu điểm / Nhược điểm / Công nghệ / Nên chọn trả lời **tức thì từ cache**. Câu hỏi tự do gửi AI nhưng **chỉ kèm dữ liệu đã cache** (không tìm web mới).
7. **So sánh công nghệ** (tab **Công nghệ**, chỉ máy móc / thiết bị / gia dụng / điện tử): gom công nghệ của các hãng theo từng loại (ví dụ Rapid Air, Inverter), cho biết **hãng nào dùng chung / riêng**, **ưu điểm và nhược điểm của từng công nghệ** kèm nguồn, và có đoạn **tóm tắt** ở đầu. Hỏi nhanh bằng nút “So sánh công nghệ”.
8. **Bảng so sánh NCC** (tab **Bảng NCC**, mọi loại hàng): mỗi dòng là một nhà cung cấp/hãng, lấy từ các **trang web thật** mà Google (Chế độ AI và kết quả thường) dẫn tới và từ cache. Cột đúng mẫu: **STT · Tên sản phẩm / mã model · Đơn giá · VAT · Thông tin kỹ thuật bổ sung · NCC / hãng sản xuất · Liên hệ NCC · Link truy vấn thông tin**. **Bấm tên sản phẩm là mở đúng trang đã lấy dữ liệu**; giá, VAT, thông số đọc từ chính link đó (mặc định bảng chỉ hiện dòng đã đọc từ đúng trang, có tùy chọn xem cả dữ liệu chưa xác nhận của AI/Google). NCC ghi theo tên website và hãng; có thể **nhóm theo NCC hoặc theo hãng**. **Liên hệ** (SĐT, email, Zalo, địa chỉ) lấy từ header/footer/dữ liệu cấu trúc của trang, và từ trang “Liên hệ” của NCC nếu trang sản phẩm không có. Giá, VAT (chỉ ghi khi trang nêu rõ), thông số (bảng thông số, dữ liệu cấu trúc) và tên NCC đọc trực tiếp từ trang; link là trang gốc. Trên web: **ẩn/hiện cột** (dấu × và nút “Cột”), **lọc** (ô lọc nhanh + ô lọc từng cột, lọc giá như `<3tr`, `2tr-3tr`), **sắp xếp** (bấm tên cột), **giữ chuột kéo trái/phải** để xem các cột. Nút **Xuất Excel (.xlsx)** xuất đúng bảng đang xem (cột đang hiện, dòng đã lọc và sắp xếp), có bộ lọc Excel, cố định dòng đầu, link bấm được, sheet “Thông tin” ghi nguồn và lưu ý. Nút “Tìm thêm NCC” mở thêm trang mới và gộp vào bảng.
9. **So sánh & chọn tối ưu**: chỉ dùng dữ liệu đã thu thập. Điểm = giá + tỉ lệ ưu/nhược (làm mịn để sản phẩm nhiều dữ liệu không tự thắng) + số nguồn xác nhận (+ công nghệ với hàng kỹ thuật).

**Phân loại hàng**: máy móc / thiết bị / gia dụng / điện tử → so sánh cả **tính năng, công nghệ và ưu nhược điểm của công nghệ**. Hàng tiêu dùng → chỉ **giá, ưu điểm, nhược điểm** so với sản phẩm tương tự, không nói công nghệ.

**Ảnh (OCR)**: bấm *Ảnh*, chụp hoặc chọn ảnh sản phẩm/nhãn; AI đọc chữ và tự điền tên, hãng, model. (Thay bộ đọc chữ trong trình duyệt trước đây hay lỗi.)

## Chạy thử trên máy (cần Node.js 20+)

```bash
npm install
```

```bash
npm run dev
```

Mở http://localhost:8787. Chưa có khóa AI thì app chạy **chế độ mẫu** (sản phẩm và hãng hư cấu, có nhãn “Dữ liệu mẫu”) để bạn thấy toàn bộ luồng. Có khóa: sao `.dev.vars.example` thành `.dev.vars`, điền khóa, chạy lại. Trên Windows có thể bấm đúp `run.bat`.

Kiểm thử: `npm test` (97 test: từ khóa, trích xuất trang, tổng hợp, chọn tối ưu, cache, luồng đầy đủ, bảo mật).

## Dùng Google trong Chrome (ưu tiên, miễn phí, ít bị 403)

Google chặn máy chủ nhưng không chặn Chrome thật của bạn. Tiện ích trong thư mục `extension/` cho app dùng **Google Chế độ AI** (hoặc kết quả tìm thường) ngay trong Chrome của bạn, và đọc trang web bằng **IP của bạn** thay vì IP máy chủ nên ít bị 403 hơn.

**Cài (Chrome, Cốc Cốc, Edge, Brave trên máy tính):**
1. Mở `chrome://extensions` (Cốc Cốc: `coccoc://extensions`), bật **Chế độ nhà phát triển**.
2. Bấm **Tải tiện ích đã giải nén**, chọn thư mục `extension` của dự án.
3. Mở app (địa chỉ `*.workers.dev` hoặc `http://localhost:8787`), bấm biểu tượng tiện ích → **Cho phép trang này**.
4. Thanh tiêu đề app đổi thành “Google Chrome · Chế độ AI”. Tìm sản phẩm như bình thường.

Điện thoại: Chrome Android không cài được tiện ích, nên điện thoại dùng đường máy chủ (AI có khóa hoặc tìm miễn phí). Muốn dùng Google trên điện thoại: tìm trên máy tính (kết quả lưu trong cache), xuất file cache rồi nạp vào điện thoại. Tên miền riêng (không phải workers.dev): thêm vào `content_scripts.matches` trong `extension/manifest.json`.

**Tự động cập nhật tiện ích (không phải cập nhật tay):**

| Cách cài | Cập nhật |
|---|---|
| **Chrome Web Store** (khuyên dùng) | **Chrome tự cập nhật hoàn toàn**, kể cả khi bạn không mở app. Hướng dẫn đăng và tự động đăng mỗi bản mới: `store/STORE.md` (cần tài khoản nhà phát triển 5 USD do bạn tạo; đẩy tag `ext-v1.2.0` là GitHub Actions tự đăng) |
| Nạp từ thư mục (`extension/`) | Chrome **không** tự cập nhật loại này. Nhưng tiện ích **tự phát hiện file đổi** (mỗi phút) và **tự tải lại**: chỉ cần `git pull` trong thư mục dự án, không phải bấm “Tải lại” ở `chrome://extensions`. Đang làm việc thì hoãn, không ngắt giữa chừng |
| Tải file .zip từ app | Giải nén đè lên thư mục cũ, tiện ích tự tải lại như trên. App tự báo “có bản mới” khi bản trên máy chủ cao hơn bản đang cài, và có link tải ở Cài đặt |

Mỗi lần `npm run deploy` (hoặc `npm run dev`) tự chạy `npm run build:ext`, đóng gói tiện ích thành `/ext/mua-hang-extension.zip` + `/ext/version.json` phát hành cùng app. Chrome chặn tự cập nhật từ địa chỉ riêng (`update_url`) trên Windows/macOS trừ máy do tổ chức quản lý, nên không dùng cách đó.

**Cách tránh 403 và spam request** (có trong cả tiện ích và app):
- Google: tối đa **8 lần mở / 10 phút**, cách nhau ≥ 4 giây, mỗi truy vấn nhớ **24 giờ**. Gặp CAPTCHA: tiện ích **đưa tab lên cho bạn tự xác minh**, không tự giải; không xác minh thì nghỉ 30 phút.
- Trang web: **cùng tên miền cách nhau ≥ 2,5 giây**, tối đa 2–3 trang cùng lúc, tối đa 2 trang mỗi tên miền mỗi lần tìm.
- Bị 403/429/503 hoặc CAPTCHA: **tự ngắt tên miền đó 30 phút** (hoặc theo `Retry-After`), không gửi thêm; nút **Xóa chặn** ở Cài đặt / biểu tượng tiện ích.
- **Cache trang 7 ngày**: trang đã đọc không tải lại; **đủ dữ liệu thì dừng mở thêm trang**.
- Không bao giờ giải CAPTCHA, không gửi cookie của bạn tới các trang, chỉ mở địa chỉ công khai (chặn mạng nội bộ).

Quyền tiện ích: “đọc dữ liệu trên mọi trang web” (cần để tải trang bán hàng và đọc Google). Tiện ích chỉ làm việc khi app yêu cầu, và chỉ nhận lệnh từ các trang bạn đã bấm “Cho phép”.

Thứ tự ưu tiên khi chọn “Tự chọn”: **Google Chrome → AI có khóa → tìm miễn phí (DuckDuckGo)**.

## Chọn chế độ tìm

| Chế độ | Cần gì | Kết quả |
|---|---|---|
| **Gemini, khóa miễn phí** (khuyên dùng) | 1 khóa ở aistudio.google.com, không cần thẻ | Đủ: giá, ưu/nhược điểm, công nghệ, 4–5 hãng, kèm nguồn |
| Claude | Khóa trả phí ở console.anthropic.com | Đủ như trên |
| **Miễn phí không khóa** | Không cần gì | Hạn chế: không AI, hãng khác chỉ có giá + ảnh. Dùng DuckDuckGo nên **hay bị chặn**; khi đó **dán link sản phẩm** vào ô tìm để app đọc thẳng |

Không nhập khóa thì app tự chạy chế độ miễn phí. Có khóa thì tự dùng AI.

## Đưa lên online (Cloudflare Workers, gói Free)

Cần tài khoản Cloudflare miễn phí (dash.cloudflare.com/sign-up) và Node.js 20+.

**1. Lấy khóa Gemini miễn phí (khuyên dùng).** Vào aistudio.google.com → đăng nhập Google → *Get API key* → *Create API key*. Copy khóa (dạng `AIza...`).

**2. Đăng nhập Cloudflare từ máy bạn.**

```bash
npm install
```

```bash
npx wrangler login
```

Trình duyệt mở trang Cloudflare, bấm **Allow**.

**3. Cất khóa trên máy chủ** (không bắt buộc: bỏ qua thì mỗi người tự nhập khóa ở ⚙ Cài đặt, lưu trên thiết bị họ).

```bash
npx wrangler secret put GEMINI_API_KEY
```

Dán khóa rồi Enter. Nên đặt thêm mã truy cập để người lạ không dùng hết hạn mức khóa của bạn:

```bash
npx wrangler secret put APP_CODE
```

**4. Đưa lên mạng.**

```bash
npm run deploy
```

Lệnh in địa chỉ dạng `https://muahangthongminh.<tên-bạn>.workers.dev`. Mở trên điện thoại:
- **Android/Chrome**: menu ⋮ → *Cài đặt ứng dụng*.
- **iPhone/Safari**: Chia sẻ → *Thêm vào MH chính*.

Vào ⚙ **Cài đặt** nhập mã truy cập (nếu đã đặt) hoặc khóa của bạn. Cập nhật sau này: chạy lại `npm run deploy`.

Nhiều AI dự phòng: có thể đặt thêm `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (ChatGPT), hoặc `CUSTOM_AI_URL` + `CUSTOM_AI_KEY` + `CUSTOM_AI_MODEL` (dịch vụ theo chuẩn OpenAI chat/completions) bằng `npx wrangler secret put <TÊN>`. Người dùng cũng nhập khóa dự phòng ở Cài đặt → Kết nối. Khi AI đang dùng lỗi hoặc hết hạn mức, app tự chuyển sang AI kế tiếp (Gemini → Claude → ChatGPT → AI tùy chọn); trang dài được chia phần cho nhiều AI đọc song song. Việc cần tìm web chỉ giao cho Gemini, Claude, ChatGPT.

Dùng Claude thay Gemini: `npx wrangler secret put ANTHROPIC_API_KEY`. Đổi model bằng `CLAUDE_MODEL` / `GEMINI_MODEL` trong `wrangler.toml` (mặc định `claude-opus-5-5` / `gemini-3-flash-preview`).

**Gói Free**: giới hạn ~10 ms CPU mỗi lần gọi và hạn mức số lần gọi mỗi ngày (xem trang giá Cloudflare, có thể đổi). App giữ trang đọc ≤ 320 KB và mở từng trang một lần gọi để nằm trong giới hạn.

## Cấu hình tìm kiếm (tab Cài đặt → Tìm kiếm)

Chọn mẫu **Nhanh / Cân bằng / Đầy đủ** hoặc tự chỉnh: số trang đọc (khi đủ thông tin / khi thiếu thông tin / mỗi lần tìm thêm), số ảnh giữ cho sản phẩm chính và cho mỗi hãng khác, số trang đọc cùng lúc, tối đa số trang của cùng một website, bật/tắt trang "Liên hệ" của NCC, bật/tắt đọc thêm DuckDuckGo + Bing qua tiện ích, dừng sớm khi đã đủ dữ liệu. Giá trị luôn được ép vào khoảng an toàn. Cấu hình lưu trên thiết bị.

## Thử đọc giá trên nhiều kiểu website

```bash
node dev/probe-sites.mjs dev/sites.json      # tự tìm trang sản phẩm thật trên các website mẫu và thử đọc giá
node dev/probe-sitemap.mjs https://ten-website.vn 3   # thử trên website bất kỳ có sitemap.xml
```

Mỗi dòng kết quả cho biết nền tảng đoán được, giá đọc được và đọc theo cách nào (jsonld / meta / markup / text), hoặc "THIẾU" khi trong HTML có chữ giá mà chưa đọc được. Thêm website vào `dev/sites.json` để thử.

## Dữ liệu và tự dọn

Kết quả lưu trên thiết bị (IndexedDB). App **tự xóa mục cũ hơn N ngày** (mặc định 30, chỉnh ở Cài đặt), giữ tối đa 40 mục, và tự xóa bớt khi bộ nhớ đầy. **Gộp dữ liệu mới vào cache cũ:** mỗi lần tìm lại cùng sản phẩm, app (1) hiện dữ liệu đã lưu ngay, (2) dùng bộ từ khóa khác lần trước (4 cách hỏi Google AI, 3 bộ từ khóa DuckDuckGo) và báo cho AI những nguồn/ý đã có để tìm cái MỚI, (3) chỉ mở các trang chưa đọc (tối đa 5 trang mới mỗi lần), (4) gộp ưu/nhược điểm, giá, ảnh, hãng, công nghệ mới vào dữ liệu cũ, bỏ ý trùng, giữ nguyên mã nguồn cũ, giá quá 45 ngày bị bỏ khi đã có giá mới. Đã đủ 5 hãng so sánh thì không tìm thêm hãng. Tab **Nhật ký → Các lần tìm** ghi mỗi lần thêm được gì. Bị lỗi giữa chừng thì dữ liệu cũ vẫn nguyên. Ô “Khi đã có trong cache” chọn: tìm thêm (mặc định) / chỉ xem cache / làm lại từ đầu; nút **Tìm thêm dữ liệu mới** ngay trong kết quả.

## Giới hạn cần biết

Xem **TODOAPP.md** (danh sách lỗi đã sửa và việc chưa kiểm chứng). Tóm tắt:
- Chưa chạy thử với khóa Gemini/Claude thật.
- Tìm miễn phí không khóa dễ bị DuckDuckGo chặn, nhất là từ máy chủ.
- Web chặn máy chủ (403/CAPTCHA) hoặc vẽ giá bằng JavaScript (Shopee, TikTok): app bỏ qua và ghi log, không vượt CAPTCHA.
- Giá chỉ để tham khảo; xác nhận báo giá chính thức trước khi mua.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `web/` | Giao diện PWA (`index.html`, `style.css`, `sw.js`, `manifest.webmanifest`, `js/`) |
| `web/js/lib/` | Logic dùng chung: từ khóa, tổng hợp, chọn tối ưu, cache, pipeline |
| `worker/` | Backend: AI (Claude/Gemini), đọc trang an toàn (chặn SSRF), trích xuất, API |
| `store/` | Hướng dẫn đăng Chrome Web Store, nội dung listing |
| `extension/` | Tiện ích Chrome “cầu nối Google” (Chế độ AI, đọc trang bằng IP của bạn) |
| `dev/` | Máy chủ chạy thử bằng Node + dữ liệu mẫu |
| `tests/` | Test (`npm test`) |
| `TODOAPP.md` | Nhật ký lỗi đã sửa, việc còn lại |
| `docs/`, `purchasing/`, `app.py`, `templates/` | Bản cũ (tiện ích Chrome, Flask). Không còn dùng, có thể xóa. Hướng dẫn cũ: `README-legacy.md` |
