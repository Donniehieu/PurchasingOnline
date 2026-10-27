// API "lai": ưu tiên Google trong Chrome của người dùng (qua tiện ích), rồi mới tới máy chủ (AI có khóa / tìm miễn phí).
// Mọi lần đọc trang đều đi qua bộ giới hạn (giãn cách theo tên miền, tự ngắt khi 403) và cache trang 7 ngày.
import { ApiError } from "./api.js";
import { extractFacts } from "./extract.js";
import { parseAnswer, aiQuery } from "./aitext.js";
import { exactQuery } from "./plan.js";
import { parseDuckDuckGo, parseBing, relevantTo, isSkippedHost } from "./serp.js";
import { normUrl, domainOf, modelKey, norm } from "./text.js";

const hintKey = (h) => modelKey(h?.model) || norm(h?.name || "").slice(0, 24);
// Đổi số này khi cấu trúc dữ liệu trang thay đổi: cache trang cũ (thiếu trường mới) tự bị bỏ qua
export const FACTS_VERSION = 6; // v2: thông số, VAT, tên NCC; v3: liên hệ; v4: sửa nhận địa chỉ và Zalo; v5: so tên theo từ, trang gần đúng; v6: giá từ phần tử price, quy cách đóng gói
export const pageKey = (url, hint) => normUrl(url) + "|" + hintKey(hint) + "|v" + FACTS_VERSION;
// Truy vấn Google thường để ra trang bán hàng/NCC; đổi theo lần tìm để ra nơi bán khác
// Tìm cửa hàng: [chuỗi người dùng gõ, giữ nguyên] + cụm hỏi; lần bổ sung đổi cụm hỏi, không cắt tên/mã
export const shopQuery = (plan, variant = 0) => `${exactQuery(plan.query) || plan.name} ${["giá bán", "mua ở đâu giá tốt", "báo giá nhà cung cấp"][Math.abs(variant) % 3]}`;
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
  // Kết quả Google là liên kết /goto?url=<mã hóa>: mở từng cái (tiện ích đi theo chuyển hướng) để biết trang đích thật và đọc luôn dữ liệu.
  // Bỏ mạng xã hội/video (không có giá); mỗi website tối đa 2 liên kết; Google chặn thì dừng.
  const JUNK = /facebook|tiktok|youtube|instagram|pinterest|zalo\.me|twitter/i;
  const hostOfSite = (site) => domainOf(/^https?:/.test(site || "") ? site : "https://" + (site || ""));
  async function resolveGoogleResults(results, { hint, max, signal, kind, perSite = 2 }) {
    const out = [], seenUrl = new Set(), seenGoto = new Set(), perHost = new Map();
    for (const x of results ?? []) {
      if (out.length >= max) break;
      if (seenGoto.has(x.url)) continue; // cùng một liên kết kết quả: không mở hai lần
      seenGoto.add(x.url);
      if (JUNK.test(`${x.site} ${(x.snippet || "").slice(0, 120)} ${x.goto ? "" : x.url}`)) continue;
      const hint0 = hostOfSite(x.site);
      if (hint0 && (perHost.get(hint0) ?? 0) >= perSite) continue;
      abortIf(signal);
      let url = x.url, facts = null;
      if (x.goto) {
        const rr = await limiter.run("google.com", async () => {
          const r = await bridge.call("fetchPage", { url: x.url }, 45000);
          return r.ok ? r : { ok: false, blocked: !!r.blocked, error: r.message || r.error, retryAfter: r.retryAfter };
        });
        if (!rr.ok) { if (rr.blocked) break; continue; }
        url = rr.finalUrl;
        facts = { ...extract(rr.html, rr.finalUrl, hint), url: rr.finalUrl, finalUrl: rr.finalUrl, status: rr.status, ms: rr.ms };
        await store.putPage(pageKey(rr.finalUrl, hint), facts);
      }
      const k = normUrl(url);
      if (seenUrl.has(k)) continue;
      seenUrl.add(k);
      const host = domainOf(url);
      if ((perHost.get(host) ?? 0) >= perSite) continue;
      perHost.set(host, (perHost.get(host) ?? 0) + 1);
      if (hint0) perHost.set(hint0, (perHost.get(hint0) ?? 0) + (hint0 === host ? 0 : 1));
      out.push({ url, title: facts?.title || x.title, snippet: x.snippet, kind });
    }
    return out;
  }

  async function chromeProduct(plan, signal) {
    const t0 = Date.now();
    const q = aiQuery(plan, plan.variant ?? 0);
    const r = await bridge.call("googleAI", { q }, 180000);
    abortIf(signal);
    if (!r.ok) throw new ApiError(r.message || r.error || "Google không phản hồi", 0, { chrome: true, blocked: !!r.blocked });
    const aiUrl = googleAIUrl(q);
    const hint = { model: plan.model, name: plan.name, brand: plan.brand };

    if (r.mode !== "ai") {
      // Chế độ AI không có (khu vực/tài khoản): dùng kết quả tìm kiếm thường của Google, mở từng trang để đọc
      const found = await resolveGoogleResults(r.results, { hint, max: 8, signal, kind: "shop" });
      return { ok: true, task: "product", data: { category: plan.category, product: { name: plan.name, brand: plan.brand, model: plan.model, summary: "" }, prices: [], pros: [], cons: [], technologies: [], specs: [] }, sources: found.map((x) => ({ url: x.url, title: x.title, kind: "shop" })), queries: [q], provider: "chrome", model: "Google (kết quả thường)", ms: Date.now() - t0, chrome: true, organic: true, shops: found.length };
    }

    const d = parseAnswer(r, plan);
    // Nguồn trích dẫn của Google là liên kết mã hóa: chỉ mở vài nguồn được dẫn nhiều nhất để biết trang thật
    const score = new Map();
    for (const c of [...d.pros, ...d.cons, ...d.prices, ...d.technologies]) for (const i of c.cites ?? []) score.set(i, (score.get(i) ?? 0) + 1);
    const byLabel = new Map();
    for (const [i, sc] of [...score].sort((a, b) => b[1] - a[1])) { const l = norm(r.cites[i]?.label); if (l && !byLabel.has(l)) byLabel.set(l, { i, sc }); }
    const resolved = new Map(); // nhãn nguồn -> { url, title }
    for (const [label, { i }] of [...byLabel].slice(0, plan.variant ? 2 : 3)) {
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
    const sources = [{ url: aiUrl, title: "Google: " + q }, ...[...resolved.values()].map((x) => ({ url: x.url, title: x.title }))];
    const queries = [q];
    // Thêm một lượt Google thường: mở các trang bán hàng THẬT trong kết quả (liên kết /goto dẫn thẳng tới trang đích)
    // để lấy giá, thông số, liên hệ của từng nhà cung cấp cho bảng NCC. Dữ liệu lấy từ đúng trang đó.
    let shops = 0;
    try {
      const sq = shopQuery(plan, plan.variant ?? 0);
      const sr = await bridge.call("googleSearch", { q: sq }, 90000);
      abortIf(signal);
      if (sr.ok) {
        queries.push(sq);
        const seen = new Set(sources.map((x) => normUrl(x.url)));
        for (const x of await resolveGoogleResults(sr.results, { hint, max: 8, signal, kind: "shop" })) {
          if (seen.has(normUrl(x.url))) continue;
          seen.add(normUrl(x.url));
          sources.push({ url: x.url, title: x.title, kind: "shop" });
          shops++;
        }
      }
    } catch (e) { if (e.name === "AbortError") throw e; /* không có lượt tìm thêm vẫn dùng được kết quả AI */ }
    // Bổ sung: DuckDuckGo + Bing đọc bằng tiện ích (IP của người dùng, không tốn hạn mức Google) để có thêm nhà cung cấp
    try {
      if (getSettings().cfg?.supplement === false) throw Object.assign(new Error("tắt trong cài đặt"), { skip: true });
      const extra = await webSupplement(plan, signal);
      const seen2 = new Set(sources.map((x) => normUrl(x.url)));
      for (const x of extra.results) { const k = normUrl(x.url); if (seen2.has(k)) continue; seen2.add(k); sources.push({ url: x.url, title: x.title, kind: "shop" }); shops++; }
      for (const q of extra.queries) queries.push(q);
    } catch (e) { if (e.name === "AbortError") throw e; /* thiếu nguồn bổ sung vẫn dùng được */ }
    return { ok: true, task: "product", data, sources, queries, provider: "chrome", model: "Google", ms: Date.now() - t0, chrome: true, resolved: resolved.size, shops, cached: !!r.cached };
  }

  // Tìm thêm bằng DuckDuckGo (bản HTML) và Bing, đọc qua tiện ích Chrome. Máy chủ Cloudflare vẫn là đường chính; đây chỉ để lấy thêm nguồn.
  async function webSupplement(plan, signal, perEngine = 10) {
    const q = shopQuery(plan, plan.variant ?? 0);
    const out = [], queries = [], seen = new Set();
    const engines = [
      { host: "duckduckgo.com", url: "https://html.duckduckgo.com/html/?kl=vn-vi&q=" + encodeURIComponent(q), parse: parseDuckDuckGo },
      { host: "bing.com", url: "https://www.bing.com/search?setlang=vi&cc=VN&q=" + encodeURIComponent(q), parse: (h) => parseBing(h).filter((x) => relevantTo(q, x)) },
    ];
    for (const e of engines) {
      abortIf(signal);
      const r = await limiter.run(e.host, async () => {
        const x = await bridge.call("fetchPage", { url: e.url }, 45000);
        return x.ok ? x : { ok: false, blocked: !!x.blocked, error: x.message || x.error, retryAfter: x.retryAfter };
      });
      if (!r.ok) continue; // bị chặn hoặc lỗi: bỏ qua nguồn này, không ảnh hưởng phần còn lại
      const got = e.parse(r.html).filter((x) => !isSkippedHost(x.url));
      let n = 0;
      for (const x of got) {
        const k = normUrl(x.url);
        if (seen.has(k)) continue;
        seen.add(k); out.push({ url: x.url, title: x.title }); if (++n >= perEngine) break;
      }
      if (n) queries.push(q);
    }
    return { results: out, queries: [...new Set(queries)] };
  }

  async function chromeCompare(plan, signal) {
    const t0 = Date.now();
    // Không cắt/đoán tên loại: dùng đúng chuỗi người dùng gõ + cụm hỏi để tìm các hãng khác
    const g = exactQuery(plan.query) || plan.name;
    // một truy vấn thôi (hạn mức Google); mở các trang cửa hàng trong kết quả để lấy các hãng khác từ danh sách sản phẩm
    const QS = [`${g} so sánh các hãng`, `${g} bán chạy nhất`, `${g} nên mua hãng nào`];
    const q = QS[(plan.variant ?? 0) % QS.length];
    const r = await bridge.call("googleSearch", { q }, 90000);
    abortIf(signal);
    if (!r.ok) throw new ApiError(r.message || r.error || "Google không phản hồi", 0, { chrome: true, blocked: !!r.blocked });
    const sources = await resolveGoogleResults(r.results, { hint: { model: "", name: g, brand: "" }, max: 5, signal, kind: "shop" });
    return { ok: true, task: "compare", discover: true, data: { alternatives: [] }, sources: sources.map((x) => ({ url: x.url, title: x.title, kind: "shop" })), queries: [q], provider: "chrome", model: "Google", ms: Date.now() - t0, chrome: true };
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
      const altName = [alt.brand, alt.model || alt.name].filter(Boolean).join(" ");
      const q = aiQuery({ ...plan, query: altName, name: altName, brand: alt.brand, model: alt.model });
      const r = await bridge.call("googleAI", { q }, 180000);
      abortIf(signal);
      if (!r.ok) return { ok: false, blocked: !!r.blocked, rate: !!r.rate, error: r.message || r.error };
      if (r.mode !== "ai") return { ok: false, error: "Google không trả lời nâng cao cho truy vấn này" };
      return { ok: true, data: parseAnswer(r, { category: plan.category }), url: googleAIUrl(q), query: q };
    },

    discover: (...a) => server.discover(...a),
    ask: (...a) => server.ask(...a),
    ocr: (...a) => server.ocr(...a),
    health: (...a) => server.health(...a),
  };
}
