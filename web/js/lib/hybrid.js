// API "lai": ưu tiên Google trong Chrome của người dùng (qua tiện ích), rồi mới tới máy chủ (AI có khóa / tìm miễn phí).
// Mọi lần đọc trang đều đi qua bộ giới hạn (giãn cách theo tên miền, tự ngắt khi 403) và cache trang 7 ngày.
import { ApiError } from "./api.js";
import { extractFacts, priceFromSnippet } from "./extract.js";
import { parseAnswer, aiQuery } from "./aitext.js";
import { normUrl, domainOf, modelKey, norm } from "./text.js";

const hintKey = (h) => modelKey(h?.model) || norm(h?.name || "").slice(0, 24);
export const pageKey = (url, hint) => normUrl(url) + "|" + hintKey(hint);
export const googleAIUrl = (q) => "https://www.google.com/search?q=" + encodeURIComponent(q) + "&udm=50";

const abortIf = (signal) => { if (signal?.aborted) throw new DOMException("Đã dừng", "AbortError"); };
const NEED_ALLOW = "Tiện ích Chrome chưa được phép trên trang này. Bấm biểu tượng tiện ích → “Cho phép trang này”, rồi thử lại.";
const NEED_INSTALL = "Chưa cài tiện ích Chrome “cầu nối Google” (xem hướng dẫn trong README, mục Dùng Google trong Chrome).";

export function createHybridApi({ server, bridge, store, limiter, getSettings, extract = extractFacts }) {
  const provider = () => getSettings().provider || "auto";

  async function chromeState() {
    const p = provider();
    if (p !== "auto" && p !== "chrome") return { use: false };
    const st = await bridge.status();
    if (st.installed && st.allowed) return { use: true, st };
    if (p === "chrome") throw new ApiError(st.installed ? NEED_ALLOW : NEED_INSTALL, 0, { chrome: true, needAllow: st.installed });
    return { use: false, st };
  }

  // ---------- đọc trang ----------
  async function loadPage(url, hint, signal, viaChrome) {
    const host = domainOf(url);
    const run = viaChrome
      ? async () => {
          const r = await bridge.call("fetchPage", { url }, 45000);
          if (!r.ok) return { ok: false, url, error: r.message || r.error || "Tiện ích không đọc được trang", blocked: !!r.blocked, status: r.status, retryAfter: r.retryAfter, ms: r.ms, _ext: true };
          return { ...extract(r.html, r.finalUrl, hint), url, finalUrl: r.finalUrl, status: r.status, ms: r.ms };
        }
      : () => server.page(url, hint, signal);
    let res = await limiter.run(host, run);
    // lỗi kết nối của tiện ích (không phải bị chặn): thử máy chủ đúng một lần
    if (viaChrome && !res.ok && !res.blocked && res._ext && /Không kết nối|Quá thời gian|timeout/i.test(res.error || "")) res = await limiter.run(host, () => server.page(url, hint, signal));
    res.url ??= url;
    return res;
  }

  async function page(url, hint = {}, signal) {
    abortIf(signal);
    const key = pageKey(url, hint);
    const cached = await store.getPage(key);
    if (cached) return { ...cached, url, cached: true };
    const { use } = await chromeState().catch(() => ({ use: false }));
    const res = await loadPage(url, hint, signal, use);
    if (res.ok) await store.putPage(key, res);
    return res;
  }

  // ---------- tìm qua Google trong Chrome ----------
  async function chromeProduct(plan, signal) {
    const t0 = Date.now();
    const q = aiQuery(plan, plan.variant ?? 0);
    const r = await bridge.call("googleAI", { q }, 180000);
    abortIf(signal);
    if (!r.ok) throw new ApiError(r.message || r.error || "Google không phản hồi", 0, { chrome: true, blocked: !!r.blocked });
    const aiUrl = googleAIUrl(q);
    const hint = { model: plan.model, name: plan.name, brand: plan.brand };

    if (r.mode !== "ai") {
      // Chế độ AI không có (khu vực/tài khoản): dùng kết quả tìm kiếm thường của Google
      const results = r.results ?? [];
      const prices = results.map((x) => ({ x, v: priceFromSnippet(x.title + ". " + x.snippet) })).filter((y) => y.v).map(({ x, v }) => ({ value: v, label: domainOf(x.url) + " (trích từ kết quả Google)", source: x.url }));
      return { ok: true, task: "product", data: { category: plan.category, product: { name: plan.name, brand: plan.brand, model: plan.model, summary: "" }, prices, pros: [], cons: [], technologies: [], specs: [] }, sources: results.map((x) => ({ url: x.url, title: x.title })), queries: [q], provider: "chrome", model: "Google (kết quả thường)", ms: Date.now() - t0, chrome: true, organic: true };
    }

    const d = parseAnswer(r, plan);
    // Nguồn trích dẫn của Google là liên kết mã hóa: chỉ mở vài nguồn được dẫn nhiều nhất để biết trang thật
    const score = new Map();
    for (const c of [...d.pros, ...d.cons, ...d.prices, ...d.technologies]) for (const i of c.cites ?? []) score.set(i, (score.get(i) ?? 0) + 1);
    const byLabel = new Map();
    for (const [i, sc] of [...score].sort((a, b) => b[1] - a[1])) { const l = norm(r.cites[i]?.label); if (l && !byLabel.has(l)) byLabel.set(l, { i, sc }); }
    const resolved = new Map(); // nhãn nguồn -> { url, title }
    for (const [label, { i }] of [...byLabel].slice(0, plan.variant ? 3 : 5)) {
      abortIf(signal);
      const href = r.cites[i].href;
      const rr = await limiter.run("google.com", async () => {
        const x = await bridge.call("fetchPage", { url: href }, 45000);
        return x.ok ? x : { ok: false, blocked: !!x.blocked, error: x.message || x.error, retryAfter: x.retryAfter };
      });
      if (rr.ok) {
        const facts = extract(rr.html, rr.finalUrl, hint);
        await store.putPage(pageKey(rr.finalUrl, hint), { ...facts, url: rr.finalUrl, finalUrl: rr.finalUrl, status: rr.status, ms: rr.ms });
        resolved.set(label, { url: rr.finalUrl, title: facts.title });
      } else if (rr.blocked) break; // Google chặn: dừng mở thêm
    }
    const srcFor = (c) => { for (const i of c.cites ?? []) { const h = resolved.get(norm(r.cites[i]?.label)); if (h) return h.url; } return aiUrl; };
    const data = {
      category: plan.category,
      product: { name: plan.name, brand: plan.brand, model: plan.model, summary: d.product.summary },
      prices: d.prices.map((p) => ({ value: p.value, label: p.label, source: srcFor(p) })),
      pros: d.pros.map((c) => ({ text: c.text, source: srcFor(c) })),
      cons: d.cons.map((c) => ({ text: c.text, source: srcFor(c) })),
      technologies: d.technologies.map((t) => ({ name: t.name, benefit: t.benefit, drawback: t.drawback, source: srcFor(t) })),
      specs: d.specs,
    };
    const sources = [{ url: aiUrl, title: "Google Chế độ AI: " + q }, ...[...resolved.values()].map((x) => ({ url: x.url, title: x.title }))];
    return { ok: true, task: "product", data, sources, queries: [q], provider: "chrome", model: "Google Chế độ AI", ms: Date.now() - t0, chrome: true, resolved: resolved.size, cached: !!r.cached };
  }

  async function chromeCompare(plan, signal) {
    const t0 = Date.now();
    const g = plan.generic || plan.name;
    const QS = [[`${g} giá`, `${g} so sánh các hãng`], [`${g} bán chạy nhất`, `${g} tốt nhất tầm giá`], [`${g} nên mua hãng nào`, `${g} giá rẻ`]];
    const qs = QS[(plan.variant ?? 0) % QS.length];
    const seen = new Set(), sources = [];
    for (const q of qs) {
      abortIf(signal);
      const r = await bridge.call("googleSearch", { q }, 90000);
      if (!r.ok) { if (sources.length) break; throw new ApiError(r.message || r.error || "Google không phản hồi", 0, { chrome: true, blocked: !!r.blocked }); }
      for (const x of r.results ?? []) { const k = normUrl(x.url); if (!seen.has(k)) { seen.add(k); sources.push({ url: x.url, title: x.title }); } }
    }
    return { ok: true, task: "compare", discover: true, data: { alternatives: [] }, sources, queries: qs, provider: "chrome", model: "Google", ms: Date.now() - t0, chrome: true };
  }

  return {
    bridge,
    limiter,
    page,

    async search(task, plan, product, signal) {
      let fallbackFrom = "";
      const { use } = await chromeState();
      if (use) {
        try { return task === "compare" ? await chromeCompare(plan, signal) : await chromeProduct(plan, signal); }
        catch (e) {
          if (e.name === "AbortError" || provider() === "chrome") throw e;
          fallbackFrom = "Google Chrome: " + e.message;
        }
      }
      const res = await server.search(task, plan, product, signal);
      if (fallbackFrom) res.fallbackFrom = fallbackFrom;
      return res;
    },

    /** Hỏi Google Chế độ AI về một hãng khác (chỉ khi đang dùng Chrome). */
    async insight(plan, alt, signal) {
      const { use } = await chromeState().catch(() => ({ use: false }));
      if (!use) return null;
      const q = aiQuery({ ...plan, name: [alt.brand, alt.model || alt.name].filter(Boolean).join(" "), brand: alt.brand, model: alt.model });
      const r = await bridge.call("googleAI", { q }, 180000);
      abortIf(signal);
      if (!r.ok) return { ok: false, blocked: !!r.blocked, rate: !!r.rate, error: r.message || r.error };
      if (r.mode !== "ai") return { ok: false, error: "Google không có Chế độ AI cho truy vấn này" };
      return { ok: true, data: parseAnswer(r, { category: plan.category }), url: googleAIUrl(q), query: q };
    },

    ask: (...a) => server.ask(...a),
    ocr: (...a) => server.ocr(...a),
    health: (...a) => server.health(...a),
  };
}
