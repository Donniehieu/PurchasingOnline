// Điều phối một lần tìm hiểu: AI tìm trước -> lưu cache -> mở các trang nguồn -> tổng hợp.
// Mỗi bước phát sự kiện ngay (emit) để giao diện hiện kết quả đến đâu làm đến đó.
import { makePlan, cacheKey } from "./plan.js";
import { hasContact, mergeContact } from "./contact.js";
import { PAGE_LOGIC_VERSION } from "./entry.js";
import { rankBySimilarity } from "./imagesim.js";
import { verifyEntryTech } from "./techverify.js";
import { needsVisual, visualPage } from "./visualpage.js";
import { newEntry, ingestProduct, ingestCompare, ingestPage, ingestListing, ingestAltInsight, dropStalePrices, sellersNeedingContact, ingestContactPage, logEvent } from "./entry.js";
import { domainOf, normUrl, clip, modelKey } from "./text.js";
import { summarize } from "./aggregate.js";
import { addSource } from "./entry.js";
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
import { answerFromCache, contextForAI } from "./answer.js";

export const CACHE_DAYS = 14;
const SKIP_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|facebook\.com|youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|pinterest\.[a-z]+|reddit\.com|zalo\.me|t\.me|wikipedia\.org)$/i;

export const STEPS = [
  { id: "plan", label: "Chọn từ khóa" },
  { id: "product", label: "Tìm sản phẩm" },
  { id: "compare", label: "So sánh hãng khác" },
  { id: "pages", label: "Mở trang nguồn" },
  { id: "done", label: "Tổng hợp" },
];

const aborted = (signal) => { if (signal?.aborted) throw new DOMException("Đã dừng", "AbortError"); };

/**
 * Chọn các trang đáng mở. Ưu tiên (1) link người dùng dán, (2) các TRANG CỬA HÀNG trong kết quả Google/tìm kiếm
 * (mỗi trang là một NCC cho bảng so sánh), (3) nguồn AI trích dẫn (bài đánh giá), (4) vài trang của hãng khác.
 */
export function pickPages(entry, limit = 10, perHostCap = 2) {
  const bySrc = new Map(entry.sources.map((s) => [s.id, s]));
  const used = (ids) => ids.map((i) => bySrc.get(i)).filter(Boolean);
  const mainCited = new Map(); // srcId -> số lần được trích
  for (const c of [...entry.prices, ...entry.pros, ...entry.cons, ...entry.tech]) if (c.srcId) mainCited.set(c.srcId, (mainCited.get(c.srcId) ?? 0) + 1);
  const out = [];
  // trang đã mở thì không mở lại; riêng trang từng bị loại theo cách nhận cũ (chưa có dấu phiên bản) được đọc lại một lần
  const seen = new Set(entry.pages.filter((p) => p.relevant || p.v === PAGE_LOGIC_VERSION || !p.ok).map((p) => normUrl(p.url)));
  const perHost = new Map(); // tối đa N trang mỗi tên miền để không dồn yêu cầu vào một nơi
  const push = (s, alt = null) => {
    if (!s || seen.has(s.key) || SKIP_HOSTS.test(domainOf(s.url)) || /\.(pdf|jpe?g|png|webp|mp4)(\?|$)/i.test(s.url)) return false;
    const h = domainOf(s.url);
    if ((perHost.get(h) ?? 0) >= perHostCap) return false;
    perHost.set(h, (perHost.get(h) ?? 0) + 1);
    seen.add(s.key);
    out.push({ url: s.url, srcId: s.id, alt });
    return true;
  };
  for (const u of entry.seeds ?? []) push(entry.sources.find((s) => s.url === u));
  const altSrc = new Set(entry.alternatives.flatMap((a) => a.srcIds));
  const altCap = entry.alternatives.length ? Math.min(entry.alternatives.length, 3) : 0;
  const mainCap = Math.max(1, limit - altCap);
  // trang cửa hàng: ưu tiên trang có mã model trong tiêu đề/địa chỉ
  const mk = modelKey(entry.product.model);
  const shops = entry.sources.filter((s) => s.kind === "shop" && !altSrc.has(s.id)).sort((a, b) => Number(mk && modelKey(b.title + b.url).includes(mk)) - Number(mk && modelKey(a.title + a.url).includes(mk)));
  const shopCap = Math.max(1, Math.ceil(limit * 0.6));
  let nShop = 0;
  for (const s of shops) { if (nShop >= shopCap || out.length >= mainCap) break; if (push(s)) nShop++; }
  const mainIds = [...mainCited.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const id of mainIds) { if (out.length >= mainCap) break; push(bySrc.get(id)); }
  // chỗ trống thì lấy nguồn khác chưa được trích
  for (const s of entry.sources) { if (out.length >= mainCap) break; if (!altSrc.has(s.id)) push(s); }
  for (const a of entry.alternatives) {
    if (out.length >= limit) break;
    const ids = [a.priceSrcId, ...a.srcIds].filter(Boolean);
    const s = used(ids).find((x) => !seen.has(x.key) && !SKIP_HOSTS.test(domainOf(x.url)));
    if (s) push(s, a);
  }
  return out.slice(0, limit);
}

/** Đủ dữ liệu để kết luận: không cần mở thêm trang cho sản phẩm chính (giảm số yêu cầu). */
export function enough(entry) {
  const readOk = entry.pages.filter((x) => x.ok).length;
  const sellers = new Set((entry.offers ?? []).filter((o) => o.readFromPage && o.kind === "same").map((o) => o.seller)).size;
  return readOk >= 8 && sellers >= 8 && entry.prices.length >= 4 && entry.pros.length >= 4 && entry.cons.length >= 3 && entry.images.length >= 3;
}

async function pool(items, size, fn, signal) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      aborted(signal);
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

/**
 * input: { text, model?, brand?, category?, ocrText? }
 * opts: { api, store, emit, signal, force, pageLimit, concurrency }
 * Trả về entry (cũng đã lưu vào store).
 */
export async function research(input, { api, store, emit = () => {}, signal, mode = "enrich", force = false, pageLimit = 12, enrichPageLimit = 10, explorePageLimit = 6, concurrency = 3, perHostCap = 2, freeGapMs = 4000, contactPages = true, stopEarly = true, imageLimit = 5, imageLimitAlt = 5, refImage = null, imageFeatures = null, verifyTech = false, visualRead = null, visualPages = 0 }) {
  const step = (id, status, text = "") => emit({ type: "step", id, status, text });
  const publish = (entry) => emit({ type: "entry", entry });
  if (force) mode = "fresh";

  step("plan", "running");
  // Link dán vào ô nhập: đọc thẳng trang đó (không cần công cụ tìm kiếm), lấy tên sản phẩm từ trang
  const seeds = [...new Set(String(input.text ?? "").match(URL_RE) ?? [])].slice(0, 8);
  if (seeds.length) {
    const rest = String(input.text).replace(URL_RE, " ").replace(/\s+/g, " ").trim();
    let name = rest;
    if (!name) {
      step("plan", "running", "đọc link bạn dán…");
      const first = await api.page(seeds[0], {}, signal);
      if (!first.ok) throw new Error(`Không mở được link (${first.error}). Hãy gõ tên hoặc mã sản phẩm thay vì dán link.`);
      name = first.product?.name || first.h1 || first.title;
    }
    input = { ...input, text: name };
  }
  const plan = makePlan(input);
  if (!plan.query) throw new Error("Chưa nhập tên sản phẩm hoặc ảnh.");
  const key = cacheKey(plan);

  // 1) Cache: mặc định VẪN tìm thêm trang MỚI rồi gộp vào dữ liệu cũ (dữ liệu cũ đôi khi chưa đủ).
  //    mode "cache": chỉ xem lại, không tìm. mode "fresh": làm lại từ đầu, bỏ dữ liệu cũ.
  const old = mode === "fresh" ? null : await store.get(key);
  if (old && mode === "cache") {
    step("plan", "done", "Chỉ dùng cache (không tìm thêm)");
    for (const s of STEPS.slice(1)) step(s.id, "skip", "không tìm thêm");
    logEvent(old, "cache", "Mở lại từ cache, không tìm mới");
    old.fromCache = true; // chỉ để hiển thị, không lưu
    publish(old);
    return old;
  }

  const enriching = !!old;
  const entry = old ?? newEntry(plan, key);
  entry.runs ??= [];
  // Kịch bản: "full" = đủ thông tin (bảng NCC theo đúng tên/mã); "explore" = thiếu thông tin (chỉ giá, sản phẩm tương đương, ưu nhược điểm; nhẹ và nhanh hơn)
  const scenario = input.scenario === "explore" && !(old?.scenario === "full") ? "explore" : "full";
  entry.scenario = scenario;
  entry.imageLimit = imageLimit; entry.imageLimitAlt = imageLimitAlt; // hiển thị đúng số ảnh đã chọn trong cài đặt
  if (scenario === "explore") { pageLimit = explorePageLimit; enrichPageLimit = Math.min(enrichPageLimit, explorePageLimit); }
  const before = enriching ? counts(entry) : counts(null);
  if (enriching) {
    entry.status = "running";
    dropStalePrices(entry);
    plan.variant = entry.runs.length;          // đổi cách đặt từ khóa mỗi lần để ra nguồn khác
    plan.known = knownOf(entry);               // nguồn/ý đã có: tìm cái MỚI, không lặp lại
    entry.seeds = [...new Set([...(entry.seeds ?? []), ...seeds])];
    for (const u of seeds) addSource(entry, u, "", "user");
    logEvent(entry, "plan", `Lần tìm thứ ${entry.runs.length + 1}: bổ sung vào dữ liệu đã lưu (${plan.known.urls.length} nguồn đã đọc sẽ không mở lại)`);
    step("plan", "done", `Dùng dữ liệu đã lưu · tìm bổ sung lần ${entry.runs.length + 1}`);
  } else {
    entry.seeds = seeds;
    for (const u of seeds) addSource(entry, u, "", "user");
    logEvent(entry, "plan", `Từ khóa: ${plan.queries.slice(0, 4).join(" | ")}`);
    step("plan", "done", `${plan.model ? "Model " + plan.model + " · " : ""}${plan.queries.length} từ khóa`);
  }
  publish(entry); // hiện dữ liệu cũ ngay, phần mới bổ sung dần

  // danh bạ NCC dùng chung cho mọi lần tìm: NCC đã biết liên hệ thì không phải mở lại trang liên hệ
  const dir = typeof store.suppliers === "function" ? await store.suppliers().catch(() => ({})) : {};
  const save = () => Promise.all([store.save(entry).catch(() => {}), saveDirectory(store, entry)]);
  const finishRun = () => {
    const after = counts(entry);
    const added = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]));
    entry.runs.push({ ts: Date.now(), n: entry.runs.length + 1, added, via: entry.ai?.model || "" });
    const parts = Object.entries(added).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${RUN_LABEL[k]}`);
    logEvent(entry, "plan", `Lần tìm thứ ${entry.runs.length}: ${parts.join(", ") || "không có dữ liệu mới"}`);
  };
  try {
    // 2) AI tìm thông tin sản phẩm
    aborted(signal);
    step("product", "running", "Đang tìm trên web…");
    let res;
    try {
      res = await api.search("product", plan, null, signal);
    } catch (e) {
      if (e.name === "AbortError" || e.status === 401 || !(e.extra?.free && (seeds.length || true))) throw e;
      // chế độ miễn phí bị công cụ tìm kiếm chặn: ghi lại và đi tiếp với link đã có (nếu có)
      logEvent(entry, "error", e.message);
      res = { data: {}, sources: [], queries: [], provider: "free", model: "duckduckgo", free: true, ms: 0, searchFailed: true };
    }
    entry.ai = { provider: res.provider, model: res.model, mock: !!res.mock, free: !!res.free, chrome: !!res.chrome, organic: !!res.organic };
    if (res.fallbackFrom) logEvent(entry, "error", res.fallbackFrom + " — chuyển sang nguồn dự phòng");
    ingestProduct(entry, res);
    if (res.chrome) {
      logEvent(entry, "ai", `Google ${res.organic ? "(kết quả thường)" : "(tìm nâng cao)"} trong Chrome của bạn: ${entry.prices.length} giá, ${entry.pros.length} ưu điểm, ${entry.cons.length} nhược điểm, đã mở ${res.resolved ?? 0} nguồn trích dẫn${res.cached ? " (từ cache Google 24 giờ)" : ""}`);
      if (res.queries?.length) logEvent(entry, "ai", `Từ khóa đã tìm: ${res.queries.join(" | ")}`);
    } else if (res.free) {
      logEvent(entry, "ai", `Tìm miễn phí (${res.model}): ${res.sources.length} kết quả, ${entry.prices.length} giá đọc từ đoạn trích, trong ${(res.ms / 1000).toFixed(1)}s`);
      if (res.errors?.length) logEvent(entry, "error", "Một số công cụ tìm lỗi: " + res.errors.join("; "));
      if (res.queries?.length) logEvent(entry, "ai", `Từ khóa đã tìm: ${res.queries.join(" | ")}`);
    } else {
      if (res.fellBack?.length) logEvent(entry, "ai", `Đã tự chuyển sang ${res.provider} vì: ${res.fellBack.join(" · ")}`);
      logEvent(entry, "ai", `Dịch vụ tìm (${res.provider}) trả về ${entry.prices.length} giá, ${entry.pros.length} ưu điểm, ${entry.cons.length} nhược điểm trong ${(res.ms / 1000).toFixed(1)}s`);
      if (res.queries?.length) logEvent(entry, "ai", `Từ khóa đã tìm: ${res.queries.join(" | ")}`);
    }

    // Thiếu giá: thử lại một lần với từ khóa chuẩn hóa theo hãng + model mà AI vừa xác định
    if (!entry.prices.length && !res.mock && !res.free && !res.chrome && (entry.product.model || entry.product.name)) {
      step("product", "running", "Chưa có giá, thử lại với từ khóa chính xác hơn…");
      const plan2 = makePlan({ text: [entry.product.brand, entry.product.name].filter(Boolean).join(" "), model: entry.product.model, brand: entry.product.brand, category: entry.category });
      plan2.queries.unshift(`${entry.product.brand ?? ""} ${entry.product.model ?? ""} giá bán chính hãng`.trim());
      try {
        const r2 = await api.search("product", plan2, null, signal);
        ingestProduct(entry, r2);
        logEvent(entry, "ai", `Tìm lại: thêm ${r2.data?.prices?.length ?? 0} giá`);
      } catch (e) { if (e.name === "AbortError") throw e; logEvent(entry, "error", "Tìm lại giá thất bại: " + e.message); }
    }
    step("product", "done", `${entry.prices.length} giá · ${entry.pros.length}/${entry.cons.length} ưu/nhược`);
    publish(entry);
    await save();

    // 3) So sánh 4–5 hãng khác
    aborted(signal);
    // Chrome + Chế độ AI: hỏi ưu/nhược điểm từng hãng còn thiếu (tối đa 3, dừng khi Google nhắc giới hạn)
    const runInsights = async (planC) => {
      if (!api.insight) return;
      const todo = entry.alternatives.filter((a) => !a.pros.length && !a.cons.length).slice(0, 3);
      let k = 0;
      for (const alt of todo) {
        aborted(signal);
        step("compare", "running", `tra Google về hãng khác ${++k}/${todo.length}`);
        const ins = await api.insight(planC, alt, signal).catch((e) => { if (e.name === "AbortError") throw e; return { ok: false, error: e.message }; });
        if (!ins) break;
        if (!ins.ok) { logEvent(entry, "error", `Google (${alt.brand}): ${ins.error}`); if (ins.blocked || ins.rate) break; continue; }
        ingestAltInsight(entry, alt, ins);
        publish(entry);
      }
    };
    const planC = { ...plan, category: entry.category, model: entry.product.model || plan.model, brand: entry.product.brand || plan.brand, name: entry.product.name || plan.name };
    if (enriching && entry.alternatives.length >= 5) {
      // đã đủ 5 hãng: không tìm thêm hãng, chỉ bổ sung ưu/nhược điểm cho hãng còn thiếu
      logEvent(entry, "plan", "Đã đủ 5 hãng so sánh, không tìm thêm hãng");
      try { await runInsights(planC); } catch (e) { if (e.name === "AbortError") throw e; logEvent(entry, "error", "Bổ sung hãng thất bại: " + e.message); }
      step("compare", "done", `${entry.alternatives.length} hãng (đã đủ)`);
      publish(entry);
      await save();
    } else {
    step("compare", "running", "Đang tìm sản phẩm của hãng khác…");
    // công cụ tìm miễn phí (DuckDuckGo) chặn khi gửi dồn: nghỉ vài giây giữa hai lượt tìm
    if (entry.ai?.free && freeGapMs) await new Promise((r) => setTimeout(r, freeGapMs));
    aborted(signal);
    try {
      const rc = await api.search("compare", planC, entry.product, signal);
      if (rc.discover) {
        // Không có AI: mở vài trang bán hàng cùng loại, lấy các hãng khác từ dữ liệu sản phẩm trên trang
        const urls = rc.sources.filter((s) => !SKIP_HOSTS.test(domainOf(s.url))).slice(0, 5);
        for (const q of rc.queries ?? []) if (!entry.queries.includes(q)) entry.queries.push(q);
        let n = 0;
        step("compare", "running", `mở trang bán hàng 0/${urls.length}`);
        await pool(urls, concurrency, async (s) => {
          let page;
          try { page = await api.page(s.url, { model: "", name: planC.name, brand: "" }, signal); }
          catch (e) { if (e.name === "AbortError" || e.status === 401) throw e; page = { ok: false, url: s.url, error: e.message }; }
          ingestListing(entry, page);
          step("compare", "running", `mở trang bán hàng ${++n}/${urls.length} · ${entry.alternatives.length} hãng`);
          publish(entry);
        }, signal);
        logEvent(entry, "plan", `So sánh theo trang bán hàng: ${entry.alternatives.map((a) => a.brand).join(", ") || "chưa tìm được hãng khác"}`);
        await runInsights(planC);
      } else {
        ingestCompare(entry, rc);
        logEvent(entry, "ai", `So sánh: ${entry.alternatives.map((a) => a.brand).join(", ") || "không có"}`);
      }
      step("compare", "done", `${entry.alternatives.length} hãng`);
    } catch (e) {
      if (e.name === "AbortError" || e.status === 401) throw e;
      logEvent(entry, "error", "Bước so sánh thất bại: " + e.message);
      step("compare", "error", e.message);
    }
    publish(entry);
    await save();
    }

    // 4) Mở từng trang nguồn MỚI: lấy giá thật, ảnh, ưu/nhược điểm và ghi log từng trang (trang đã đọc không mở lại)
    const picks = pickPages(entry, enriching ? enrichPageLimit : pageLimit, perHostCap);
    if (!picks.length) step("pages", "skip", "không có trang để mở");
    else {
      let done = 0, skippedEnough = 0, deepLeft = 3, visualLeft = visualPages; // đọc sâu bằng AI tối đa vài trang đầu (tiết kiệm hạn mức khóa)
      step("pages", "running", `0/${picks.length}`);
      await pool(picks, concurrency, async (p) => {
        const hint = p.alt
          ? { model: p.alt.model, name: p.alt.name, brand: p.alt.brand }
          : { model: entry.product.model || plan.model, name: entry.product.name || plan.name, brand: entry.product.brand || plan.brand };
        if (!p.alt && !enriching && stopEarly && enough(entry)) {
          if (!skippedEnough++) logEvent(entry, "plan", "Đã đủ dữ liệu, không mở thêm trang cho sản phẩm chính (tránh gửi yêu cầu thừa)");
          step("pages", "running", `${++done}/${picks.length} · đủ dữ liệu`);
          return;
        }
        let page;
        try { page = await api.page(p.url, hint, signal, { deep: !p.alt && deepLeft-- > 0 }); }
        catch (e) { if (e.name === "AbortError" || e.status === 401) throw e; page = { ok: false, url: p.url, error: e.message }; }
        // Lớp dự phòng cuối: trang tải giá bằng JavaScript hoặc bị chặn -> chụp ảnh trang + OCR (có giới hạn số trang vì chậm)
        if (visualRead && visualLeft > 0 && !p.alt && needsVisual(page)) {
          visualLeft--;
          step("pages", "running", `đọc bằng ảnh chụp · ${domainOf(p.url)}`);
          let v = null;
          try { v = await visualRead(p.url, hint, signal); } catch (e) { if (e.name === "AbortError") throw e; }
          if (v?.ok && v.price) {
            page = visualPage(p.url, v, page);
            logEvent(entry, "page", `Đọc bằng ảnh chụp (OCR) ${domainOf(p.url)}: giá ${v.price.toLocaleString("vi-VN")}đ — cần kiểm tra vì chữ OCR có thể sai`, { url: p.url, ok: true });
          } else logEvent(entry, "page", `Ảnh chụp ${domainOf(p.url)}: ${v ? (v.reason === "challenge" ? "trang yêu cầu xác minh/chặn, bỏ qua (không vượt CAPTCHA)" : v.reason === "empty" ? "không đọc được chữ" : "không thấy giá") : "không chụp được"}`, { url: p.url, ok: false });
        }
        ingestPage(entry, page, { alt: p.alt, forLabel: p.alt ? p.alt.brand : "", imageLimit, imageLimitAlt, imageKeep: refImage && imageFeatures ? { main: imageLimit * 4, alt: imageLimitAlt * 3 } : null });
        step("pages", "running", `${++done}/${picks.length} · ${domainOf(p.url)}`);
        publish(entry);
      }, signal);
      const ok = entry.pages.filter((x) => x.ok).length;
      step("pages", "done", `${ok}/${picks.length} trang đọc được`);
    }

    // Công nghệ/tính năng chỉ được coi là từ khóa đúng khi tìm "<chuỗi gõ> <công nghệ>" ra kết quả nhắc đúng cụm đó (hoặc chức năng tương đồng)
    if (verifyTech && entry.category === "tech" && scenario !== "explore" && api.discover && entry.tech.length) {
      aborted(signal);
      step("pages", "running", "kiểm tra công nghệ bằng tìm kiếm…");
      try {
        const v = await verifyEntryTech(entry, { api, typed: plan.query, group: plan.query, signal, log: (m) => logEvent(entry, "plan", m) });
        if (v.checked) logEvent(entry, "plan", `Kiểm tra công nghệ: ${v.ok}/${v.checked} đạt, dùng làm từ khóa`);
      } catch (e) { if (e.name === "AbortError") throw e; logEvent(entry, "error", "Kiểm tra công nghệ thất bại: " + e.message); }
    }

    // Có ảnh tham chiếu: ưu tiên ảnh giống hoặc gần giống nhất (không cần giống hệt), giữ đúng số ảnh đã chọn
    if (refImage && imageFeatures) {
      aborted(signal);
      step("pages", "running", "xếp ảnh theo độ giống ảnh của bạn…");
      const main = await rankBySimilarity(entry.images, refImage, imageFeatures, { keep: imageLimit });
      entry.images.splice(0, entry.images.length, ...main.ranked);
      for (const a of entry.alternatives) if (a.images.length > 1) { const r = await rankBySimilarity(a.images, refImage, imageFeatures, { keep: imageLimitAlt, maxFetch: 8 }); a.images.splice(0, a.images.length, ...r.ranked); }
      entry.refImage = true;
      logEvent(entry, "plan", main.best != null ? `Ảnh: xếp theo độ giống ảnh tham chiếu, giống nhất ${Math.round(main.best * 100)}%${main.failed ? ` (${main.failed} ảnh không tải được)` : ""}` : "Ảnh: không tải được ảnh nào để so với ảnh tham chiếu");
    }
    seedFromDirectory(entry, dir);
    // 5) Trang "Liên hệ" của các NCC chưa có SĐT/email (mỗi NCC một lần, tối đa vài trang mỗi lần tìm)
    for (const c of scenario === "explore" || !contactPages ? [] : sellersNeedingContact(entry, enriching ? 2 : 3)) {
      aborted(signal);
      step("pages", "running", `trang liên hệ · ${c.domain}`);
      let page;
      try { page = await api.page(c.url, {}, signal); }
      catch (e) { if (e.name === "AbortError" || e.status === 401) throw e; page = { ok: false, url: c.url, error: e.message }; }
      ingestContactPage(entry, c.domain, page);
      publish(entry);
    }

    if (!enriching && !entry.prices.length && !entry.pros.length && !entry.cons.length && !entry.pages.some((x) => x.ok)) {
      throw new Error("Chưa thu được dữ liệu nào. Công cụ tìm kiếm miễn phí có thể đang chặn: hãy dán link trang sản phẩm vào ô tìm, hoặc nhập khóa Gemini miễn phí ở Cài đặt rồi thử lại.");
    }
    finishRun();
    entry.status = "done";
    step("done", "done", enriching ? entry.log[entry.log.length - 1].msg : "");
    publish(entry);
    await save();
    return entry;
  } catch (e) {
    const aborted_ = e.name === "AbortError";
    // đang bổ sung: dữ liệu cũ vẫn nguyên vẹn và dùng được, chỉ ghi nhận lần tìm này lỗi/dừng
    entry.status = enriching ? "done" : aborted_ ? "partial" : "error";
    logEvent(entry, aborted_ ? "plan" : "error", aborted_ ? "Đã dừng, giữ phần dữ liệu thu được" : e.message);
    if (enriching) finishRun();
    if (enriching || entry.prices.length || entry.pros.length || entry.pages.length) await save();
    publish(entry);
    throw e;
  }
}

/** Điền tên + liên hệ đã biết (từ các lần tìm trước) cho các NCC vừa gặp. */
function seedFromDirectory(entry, dir) {
  for (const [d, s] of Object.entries(entry.suppliers ?? {})) {
    const known = dir[d];
    if (!known) continue;
    if (!s.name && known.name && known.name !== d) s.name = known.name;
    if (known.contact && hasContact(known.contact) && !hasContact(entry.contacts?.[d])) {
      entry.contacts ??= {};
      entry.contacts[d] = { ...mergeContact(entry.contacts[d], known.contact), fetchedContactPage: !!known.contact.fetchedContactPage };
    }
  }
}

/** Ghi các NCC của lần tìm này vào danh bạ chung (best-effort). */
async function saveDirectory(store, entry) {
  if (typeof store.saveSuppliers !== "function") return;
  const list = Object.values(entry.suppliers ?? {}).map((s) => ({ domain: s.domain, name: s.name, matched: s.matched, contact: entry.contacts?.[s.domain] ?? null, pages: (s.pages ?? []).slice(-5), firstTs: s.firstTs }));
  await store.saveSuppliers(list).catch(() => {});
}

const RUN_LABEL = { pages: "trang", prices: "giá", pros: "ưu điểm", cons: "nhược điểm", tech: "công nghệ", images: "ảnh", alts: "hãng" };

/** Số liệu của một entry (dùng để tính lần tìm này đã thêm được gì). */
function counts(entry) {
  if (!entry) return { pages: 0, prices: 0, pros: 0, cons: 0, tech: 0, images: 0, alts: 0 };
  const s = summarize(entry);
  return { pages: entry.pages.filter((p) => p.ok).length, prices: entry.prices.length, pros: s.pros.length, cons: s.cons.length, tech: s.tech.length, images: entry.images.length, alts: entry.alternatives.length };
}

/** Những gì đã biết, gửi kèm để tìm nguồn/ý MỚI thay vì lặp lại. */
export function knownOf(entry) {
  const s = summarize(entry);
  const urls = [...entry.pages.map((p) => p.url), ...entry.sources.map((x) => x.url)];
  return {
    urls: [...new Set(urls)].slice(0, 25),
    pros: s.pros.slice(0, 8).map((x) => clip(x.text, 90)),
    cons: s.cons.slice(0, 8).map((x) => clip(x.text, 90)),
    brands: entry.alternatives.map((a) => a.brand).filter(Boolean),
  };
}

/** Trả lời câu hỏi: ưu tiên dữ liệu cache (không tốn lượt tìm), chỉ hỏi AI khi câu hỏi tự do. */
export async function ask(entry, question, { api, signal } = {}) {
  const local = answerFromCache(entry, question);
  if (local) return { ...local, via: "cache" };
  if (!api) return { text: "Câu hỏi này chưa có trong dữ liệu đã lưu.", srcIds: [], via: "cache" };
  const r = await api.ask(question, contextForAI(entry), signal);
  const ids = [...r.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((id) => entry.sources.some((s) => s.id === id));
  return { text: r.answer, srcIds: [...new Set(ids)], via: "ai", mock: r.mock };
}

export { normUrl };
