// Backend: Cloudflare Worker (cũng chạy được bằng Node qua dev/server.mjs).
//   GET  /api/health
//   POST /api/search  {task:"product"|"compare", plan, product?}  -> AI tìm web, trả JSON có nguồn
//   POST /api/page    {url, hint}                                 -> mở 1 trang, trích giá/ảnh/ưu nhược điểm
//   POST /api/ask     {question, context}                         -> trả lời ngắn từ dữ liệu đã cache
//   POST /api/ocr     {image:{mime,data}}                         -> đọc chữ/nhận diện sản phẩm từ ảnh
import { AIError, pickProvider, callAI, extractJson, verifyClaims } from "./ai.js";
import { SYSTEM, productPrompt, comparePrompt, ASK_SYSTEM, askPrompt, OCR_SYSTEM, OCR_PROMPT } from "./prompts.js";
import { fetchHtml } from "./safe-url.js";
import { extractFacts, priceFromSnippet } from "../web/js/lib/extract.js";
import { searchMany } from "./websearch.js";
import { modelKey, norm, domainOf, normUrl } from "../web/js/lib/text.js";
import { exactQuery } from "../web/js/lib/plan.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-app-code,x-ai-key,x-ai-provider",
  "access-control-max-age": "86400",
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
const fail = (error, status = 400, extra = {}) => json({ ok: false, error, ...extra }, status);

async function readBody(request, limit) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > limit) throw new AIError("Dữ liệu gửi lên quá lớn.", 413);
  const text = await request.text();
  if (text.length > limit) throw new AIError("Dữ liệu gửi lên quá lớn.", 413);
  try { return JSON.parse(text || "{}"); } catch { throw new AIError("JSON không hợp lệ.", 400); }
}

const str = (v, max) => String(v ?? "").slice(0, max);

function cleanPlan(p) {
  if (!p || typeof p !== "object") throw new AIError("Thiếu kế hoạch tìm kiếm.", 400);
  const plan = {
    query: str(p.query, 500), name: str(p.name, 200), generic: str(p.generic, 80), model: str(p.model, 60), brand: str(p.brand, 60),
    category: p.category === "consumer" ? "consumer" : "tech", categoryAuto: !!p.categoryAuto,
    queries: Array.isArray(p.queries) ? p.queries.slice(0, 8).map((q) => str(q, 200)) : [],
    variant: Number.isInteger(p.variant) ? Math.abs(p.variant) % 50 : 0,
  };
  // những gì đã có trong cache: để tìm cái MỚI
  const list = (a, n, m) => (Array.isArray(a) ? a.slice(0, n).map((x) => str(x, m)) : []);
  if (p.known && typeof p.known === "object") plan.known = { urls: list(p.known.urls, 25, 300), pros: list(p.known.pros, 8, 120), cons: list(p.known.cons, 8, 120), brands: list(p.known.brands, 8, 40) };
  if (!plan.query) throw new AIError("Chưa nhập tên sản phẩm.", 400);
  return plan;
}

// Chế độ miễn phí: không có AI, chỉ tìm web rồi để client mở từng trang nguồn
async function freeSearch(task, plan, env) {
  const t0 = Date.now();
  // Không cắt/đoán tên loại: dùng đúng chuỗi người dùng gõ
  const g = exactQuery(plan.query) || plan.name;
  // Sản phẩm: [chuỗi người dùng gõ, giữ nguyên] + cụm hỏi (giá, ưu/nhược điểm...). Không cắt tên/mã.
  // Mỗi lần bổ sung đổi cụm hỏi để ra nguồn khác; 1–2 truy vấn thôi vì DuckDuckGo chặn khi gửi dồn.
  const v = (plan.variant ?? 0) % 3;
  const typed = exactQuery(plan.query) || plan.name;
  const qs = task === "compare"
    ? [[`${g} so sánh các hãng`], [`${g} bán chạy nhất`], [`${g} nên mua hãng nào`]][v]
    : [[`${typed} giá`, `${typed} đánh giá ưu nhược điểm`], [`${typed} review thực tế người dùng`, `${typed} mua ở đâu giá tốt`], [`${typed} so sánh`, `${typed} thông số kỹ thuật`]][v];
  const found = await searchMany(qs, { limit: task === "compare" ? 8 : 30, gapMs: Number(env.SEARCH_GAP_MS ?? 700) });
  const { queries, errors } = found;
  // bỏ các trang đã có trong cache (đã đọc) để lần này ra trang MỚI
  const known = new Set((plan.known?.urls ?? []).map((u) => normUrl(u)));
  const results = task === "product" ? found.results.filter((r) => !known.has(normUrl(r.url))).slice(0, 12) : found.results;
  if (!found.results.length) throw new AIError("Công cụ tìm kiếm miễn phí không trả kết quả" + (errors.length ? " (" + errors.join("; ") + ")" : "") + ". Thử lại sau, hoặc nhập khóa Gemini miễn phí ở Cài đặt.", 502);
  const key = modelKey(plan.model);
  // từ trong chuỗi người dùng gõ: trang đúng sản phẩm phải khớp mã model HOẶC phần lớn các từ này
  const nameTokens = norm(plan.query || plan.name).split(" ").filter((w) => w.length >= 3).slice(0, 6);
  const rel = (r) => {
    const hay = r.title + " " + r.snippet + " " + r.url;
    const byTokens = nameTokens.filter((w) => norm(hay).includes(w)).length >= Math.max(2, Math.ceil(nameTokens.length * 0.6));
    return (key && modelKey(hay).includes(key)) || byTokens;
  };
  const sorted = task === "compare" ? results : [...results].sort((a, b) => Number(rel(b)) - Number(rel(a)));
  const data = { category: plan.category, product: { name: plan.name, brand: plan.brand, model: plan.model, summary: "" }, prices: [], pros: [], cons: [], technologies: [], specs: [], alternatives: [] };
  if (task === "product") {
    for (const r of sorted) {
      if (!rel(r)) continue;
      const v = priceFromSnippet(r.title + ". " + r.snippet);
      if (v) data.prices.push({ value: v, label: domainOf(r.url) + " (trích từ kết quả tìm kiếm)", source: r.url });
    }
  }
  return { ok: true, task, data, sources: sorted.map((r) => ({ url: r.url, title: r.title, kind: "shop" })), queries, provider: "free", model: "duckduckgo+bing", ms: Date.now() - t0, free: true, discover: task === "compare", errors };
}

async function handleSearch(request, env, origin) {
  const body = await readBody(request, 40_000);
  const plan = cleanPlan(body.plan);
  const task = body.task === "compare" ? "compare" : "product";
  const sel = pickProvider(env, request.headers);
  if (sel.provider === "free") {
    try { return json(await freeSearch(task, plan, env)); }
    catch (e) { if (e instanceof AIError) return fail(e.message, e.status, { free: true }); throw e; }
  }
  const user = task === "compare" ? comparePrompt(plan, body.product ?? {}) : productPrompt(plan);
  const r = await callAI(sel, task, { system: SYSTEM, user, search: true, effort: env.CLAUDE_EFFORT || "medium", maxUses: task === "compare" ? 6 : 5, origin });
  const data = extractJson(r.text);
  if (!data) throw new AIError("Dịch vụ tìm trả về dữ liệu không đọc được. Hãy thử lại.", 502);
  if (task === "compare" && !Array.isArray(data.alternatives)) throw new AIError("Dịch vụ tìm không trả về danh sách sản phẩm so sánh.", 502);
  verifyClaims(data, r.sources);
  return json({ ok: true, task, data, sources: r.sources, queries: r.queries, provider: r.provider, model: r.model, ms: r.ms, mock: r.provider === "mock" });
}

async function handlePage(request, env) {
  const body = await readBody(request, 8_000);
  const hint = { model: str(body.hint?.model, 60), name: str(body.hint?.name, 200), brand: str(body.hint?.brand, 60) };
  const got = await fetchHtml(str(body.url, 1000), { allowLocal: env.ALLOW_LOCAL === "1" });
  if (!got.ok) return json({ ok: false, url: str(body.url, 1000), error: got.error, status: got.status, blocked: !!got.blocked, retryAfter: got.retryAfter, ms: got.ms });
  const facts = extractFacts(got.html, got.finalUrl, hint);
  return json({ ...facts, url: str(body.url, 1000), finalUrl: got.finalUrl, status: got.status, ms: got.ms });
}

async function handleAsk(request, env, origin) {
  const body = await readBody(request, 80_000);
  const question = str(body.question, 400).trim();
  if (!question) throw new AIError("Chưa nhập câu hỏi.", 400);
  const sel = pickProvider(env, request.headers);
  if (sel.provider === "free") throw new AIError("Chế độ miễn phí không trả lời được câu hỏi tự do. Hãy dùng các nút Giá, Ưu điểm, Nhược điểm, Nên chọn, hoặc nhập khóa Gemini miễn phí ở Cài đặt.", 501);
  const r = await callAI(sel, "ask", { system: ASK_SYSTEM, user: askPrompt(question, body.context ?? {}), search: false, effort: "low", origin });
  return json({ ok: true, answer: r.text.trim(), provider: r.provider, model: r.model, ms: r.ms, mock: r.provider === "mock" });
}

async function handleOcr(request, env, origin) {
  const body = await readBody(request, 6_000_000);
  const im = body.image;
  if (!im?.data || !/^image\/(jpeg|png|webp|gif)$/.test(im.mime ?? "")) throw new AIError("Ảnh không hợp lệ (cần JPEG/PNG/WebP).", 400);
  const sel = pickProvider(env, request.headers);
  if (sel.provider === "free") throw new AIError("Đọc chữ từ ảnh cần khóa dịch vụ. Hãy nhập khóa Gemini miễn phí ở Cài đặt, hoặc gõ tên/model bằng tay.", 501);
  const r = await callAI(sel, "ocr", { system: OCR_SYSTEM, user: OCR_PROMPT, search: false, images: [{ mime: im.mime, data: im.data }], effort: "low", origin });
  const data = extractJson(r.text);
  if (!data) throw new AIError("Không đọc được kết quả nhận diện ảnh.", 502);
  return json({ ok: true, ocr: data, provider: r.provider, model: r.model, ms: r.ms, mock: r.provider === "mock" });
}

export async function handle(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!url.pathname.startsWith("/api/")) {
    if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  }
  try {
    if (url.pathname === "/api/health") {
      return json({ ok: true, version: "2.12.0", needsCode: !!env.APP_CODE, serverKey: { claude: !!env.ANTHROPIC_API_KEY, gemini: !!env.GEMINI_API_KEY }, mock: env.MOCK === "1", free: true });
    }
    if (request.method !== "POST") return fail("Phương thức không hỗ trợ.", 405);
    if (env.APP_CODE && request.headers.get("x-app-code") !== env.APP_CODE) return fail("Sai hoặc thiếu mã truy cập.", 401, { needsCode: true });
    switch (url.pathname) {
      case "/api/search": return await handleSearch(request, env, url.origin);
      case "/api/page": return await handlePage(request, env);
      case "/api/ask": return await handleAsk(request, env, url.origin);
      case "/api/ocr": return await handleOcr(request, env, url.origin);
      default: return fail("Không có API này.", 404);
    }
  } catch (e) {
    if (e instanceof AIError) return fail(e.message, e.status);
    return fail("Lỗi máy chủ: " + (e?.message || "không rõ").slice(0, 160), 500);
  }
}

export default { fetch: (request, env, ctx) => handle(request, env, ctx) };
