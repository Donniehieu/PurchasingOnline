// Cấu hình tìm kiếm do người dùng chọn (tab Cài đặt): đọc bao nhiêu trang, lấy bao nhiêu ảnh, mấy luồng...
// Mẫu có sẵn: Nhanh / Cân bằng / Đầy đủ. Mọi giá trị được ép vào khoảng an toàn để không làm quá tải trang web hay máy chủ.

export const DEFAULT_CFG = {
  pagesFull: 12,     // số trang mở khi đủ thông tin (tìm đầy đủ, dựng bảng NCC)
  pagesExplore: 6,   // số trang mở khi thiếu thông tin (chỉ cái nhìn chung)
  pagesEnrich: 10,   // số trang mở thêm ở mỗi lần "tìm thêm dữ liệu mới"
  images: 5,         // số ảnh giữ cho sản phẩm chính
  imagesAlt: 5,      // số ảnh giữ cho mỗi hãng khác
  concurrency: 3,    // số trang đọc cùng lúc
  perHost: 2,        // tối đa số trang mở của cùng một website trong một lần tìm
  contactPages: true, // mở trang "Liên hệ" của NCC để lấy SĐT/email
  supplement: true,  // đọc thêm DuckDuckGo + Bing qua tiện ích Chrome
  stopEarly: true,   // dừng mở thêm trang khi đã đủ dữ liệu
};

export const LIMITS = {
  pagesFull: [4, 40], pagesExplore: [2, 12], pagesEnrich: [3, 24], images: [1, 12], imagesAlt: [1, 8], concurrency: [1, 6], perHost: [1, 5],
};

export const PRESETS = {
  fast: { label: "Nhanh", note: "Ít trang, ít ảnh, bỏ trang liên hệ: tải nhanh, ít yêu cầu.", cfg: { pagesFull: 6, pagesExplore: 4, pagesEnrich: 5, images: 3, imagesAlt: 2, concurrency: 4, perHost: 1, contactPages: false, supplement: false, stopEarly: true } },
  balanced: { label: "Cân bằng", note: "Mặc định: đủ dữ liệu để so sánh mà vẫn nhẹ.", cfg: { ...DEFAULT_CFG } },
  full: { label: "Đầy đủ", note: "Nhiều trang, nhiều ảnh, đọc thêm nguồn: nhiều dữ liệu nhất nhưng chậm và nhiều yêu cầu hơn.", cfg: { pagesFull: 24, pagesExplore: 8, pagesEnrich: 16, images: 8, imagesAlt: 5, concurrency: 3, perHost: 3, contactPages: true, supplement: true, stopEarly: false } },
};

const clamp = (v, [lo, hi], fallback) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };

/** Ép cấu hình vào khoảng cho phép; thiếu trường thì dùng mặc định. */
export function normalizeCfg(c = {}) {
  const out = { ...DEFAULT_CFG };
  for (const [k, lim] of Object.entries(LIMITS)) out[k] = clamp(c[k], lim, DEFAULT_CFG[k]);
  for (const k of ["contactPages", "supplement", "stopEarly"]) out[k] = c[k] === undefined ? DEFAULT_CFG[k] : !!c[k];
  return out;
}

/** Tên mẫu trùng khớp ("fast" | "balanced" | "full") hoặc "custom". */
export function matchPreset(cfg) {
  const n = normalizeCfg(cfg);
  for (const [id, p] of Object.entries(PRESETS)) if (Object.keys(DEFAULT_CFG).every((k) => n[k] === p.cfg[k])) return id;
  return "custom";
}

/** Cấu hình cũ (chỉ có settings.pages) -> cấu hình mới. */
export function cfgFromSettings(settings = {}) {
  const base = settings.cfg ? normalizeCfg(settings.cfg) : { ...DEFAULT_CFG };
  if (!settings.cfg && Number.isFinite(Number(settings.pages))) base.pagesFull = clamp(settings.pages, LIMITS.pagesFull, DEFAULT_CFG.pagesFull);
  return base;
}

/** Kiểm tra nhanh khóa người dùng dán: đúng dạng của nguồn đã chọn chưa. Trả về { level: "ok"|"warn"|"", text }. */
export function keyHint(provider, key) {
  const k = String(key ?? "").trim();
  if (!k) return { level: "", text: "" };
  const kind = /^sk-ant-/.test(k) ? "claude" : /^AIza/.test(k) ? "gemini" : /^sk-/.test(k) ? "openai" : "";
  if (provider === "custom") return { level: "", text: "" };
  if (/\s/.test(k)) return { level: "warn", text: "Khóa có khoảng trắng: hãy dán lại, không kèm chữ thừa." };
  if (k.length < 20) return { level: "warn", text: "Khóa quá ngắn, có thể chưa dán đủ." };
  if (provider === "claude" && kind === "gemini") return { level: "warn", text: "Đây có vẻ là khóa Gemini (AIza…) nhưng bạn đang chọn Claude." };
  if (provider === "gemini" && kind === "claude") return { level: "warn", text: "Đây có vẻ là khóa Claude (sk-ant-…) nhưng bạn đang chọn Gemini." };
  if (!kind) return { level: "warn", text: "Không nhận ra dạng khóa (Gemini bắt đầu bằng AIza, Claude bằng sk-ant-). Kiểm tra lại nếu không chạy." };
  return { level: "ok", text: kind === "gemini" ? "Khóa Gemini: đúng dạng. Chọn nguồn tìm Gemini (hoặc Tự chọn) rồi Lưu." : kind === "openai" ? "Khóa ChatGPT: đúng dạng. Chọn nguồn tìm ChatGPT (hoặc Tự chọn) rồi Lưu." : "Khóa Claude: đúng dạng. Chọn nguồn tìm Claude (hoặc Tự chọn) rồi Lưu." };
}
