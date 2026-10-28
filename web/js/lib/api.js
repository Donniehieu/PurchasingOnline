// Gọi backend. Cài đặt (địa chỉ API, khóa, mã truy cập) đọc từ getSettings() mỗi lần gọi.
export class ApiError extends Error {
  constructor(message, status = 0, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

/** Khóa dự phòng (Gemini/Claude/ChatGPT/AI tùy chọn) gói thành một header; trống thì không gửi. */
export function extraKeysOf(s) {
  const k = s.keys ?? {};
  const o = {};
  for (const p of ["gemini", "claude", "openai"]) if (String(k[p] ?? "").trim()) o[p] = String(k[p]).trim();
  if (String(k.customKey ?? "").trim() && String(k.customUrl ?? "").trim()) o.custom = { key: String(k.customKey).trim(), url: String(k.customUrl).trim(), model: String(k.customModel ?? "").trim() };
  if (!Object.keys(o).length) return "";
  try { return btoa(JSON.stringify(o)); } catch { return ""; }
}

export function createApi(getSettings, fetchImpl = (...a) => fetch(...a)) {
  async function call(path, body, signal) {
    const s = getSettings();
    const base = (s.apiBase || "").replace(/\/+$/, "");
    const headers = { "content-type": "application/json" };
    if (s.appCode) headers["x-app-code"] = s.appCode;
    if (s.provider && s.provider !== "auto") headers["x-ai-provider"] = s.provider;
    const extra = extraKeysOf(s);
    if (extra) headers["x-ai-keys"] = extra;
    if (s.aiKey) { headers["x-ai-key"] = s.aiKey; if (!headers["x-ai-provider"]) headers["x-ai-provider"] = "auto"; }
    let res;
    try {
      res = await fetchImpl(base + path, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      throw new ApiError("Không kết nối được máy chủ. Kiểm tra mạng hoặc địa chỉ máy chủ trong Cài đặt.", 0);
    }
    const j = await res.json().catch(() => null);
    if (!j) throw new ApiError(`Máy chủ trả về dữ liệu lạ (HTTP ${res.status}). Địa chỉ máy chủ có đúng không?`, res.status);
    if (res.status === 401 || (j.ok === false && path !== "/api/page")) throw new ApiError(j.error || `Lỗi HTTP ${res.status}`, res.status, j);
    return j;
  }
  return {
    search: (task, plan, product, signal) => call("/api/search", { task, plan, product }, signal),
    page: (url, hint, signal, opts = {}) => call("/api/page", { url, hint, ...(opts.deep ? { deep: true } : {}) }, signal),
    /** Tìm link mới theo từ khóa (không dùng AI). Trả về { results: [{url, title, snippet}] }. */
    discover: (queries, signal) => call("/api/discover", { queries }, signal),
    ask: (question, context, signal) => call("/api/ask", { question, context }, signal),
    ocr: (image, signal) => call("/api/ocr", { image }, signal),
    /** Chụp ảnh một trang web qua máy chủ (để OCR). Trả về Blob hoặc null. */
    async shot(url, signal) {
      const s = getSettings();
      const headers = { "content-type": "application/json" };
      if (s.appCode) headers["x-app-code"] = s.appCode;
      try {
        const res = await fetchImpl((s.apiBase || "").replace(/\/+$/, "") + "/api/shot", { method: "POST", headers, body: JSON.stringify({ url }), signal });
        return res.ok && /^image\//.test(res.headers.get("content-type") || "") ? await res.blob() : null;
      } catch (e) { if (e?.name === "AbortError") throw e; return null; }
    },
    /** Tải ảnh web qua máy chủ (để đọc điểm ảnh, tính độ giống). Trả về Blob hoặc null. */
    async image(url, signal) {
      const s = getSettings();
      const headers = { "content-type": "application/json" };
      if (s.appCode) headers["x-app-code"] = s.appCode;
      try {
        const res = await fetchImpl((s.apiBase || "").replace(/\/+$/, "") + "/api/image", { method: "POST", headers, body: JSON.stringify({ url }), signal });
        return res.ok && /^image\//.test(res.headers.get("content-type") || "") ? await res.blob() : null;
      } catch (e) { if (e?.name === "AbortError") throw e; return null; }
    },
    async health() {
      const s = getSettings();
      const res = await fetchImpl((s.apiBase || "").replace(/\/+$/, "") + "/api/health");
      return res.json();
    },
  };
}
