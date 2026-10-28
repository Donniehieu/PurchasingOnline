// Tìm bổ sung theo bộ từ khóa tự sinh (keygen.js), chạy SAU lần tìm ban đầu và cộng dồn vào cùng bản ghi cache:
//   core       -> các trang bán/đánh giá đúng sản phẩm: đọc như trang nguồn chính (giá, VAT, ưu nhược điểm, NCC)
//   competitor -> trang của hãng đối thủ: thêm/cập nhật "hãng khác" (giá, ảnh, ưu nhược điểm, công nghệ) và dòng bảng NCC
//   tech       -> đoạn trích về công nghệ của cả nhóm sản phẩm, lưu để tab Công nghệ đối chiếu
// Dùng /api/discover (công cụ tìm miễn phí), không tốn hạn mức AI.
import { addSource, ingestPage, logEvent } from "./entry.js";
import { domainOf, normUrl, norm, clip } from "./text.js";
import { detectBrands, canonBrand } from "./plan.js";
import { cleanTechName } from "./extract.js";
import { brandKeys, interleave } from "./keygen.js";
import { judgeTech, recordTech } from "./techverify.js";

const SKIP_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|facebook\.com|youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|pinterest\.[a-z]+|reddit\.com|zalo\.me|t\.me|wikipedia\.org)$/i;
const MAX_ALTS = 8;
const MAX_NOTES = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const aborted = (signal) => { if (signal?.aborted) throw new DOMException("Đã dừng", "AbortError"); };

async function pool(items, size, fn, signal) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { aborted(signal); await fn(items[i++]); }
  }));
}

function altFor(entry, rawBrand) {
  const brand = canonBrand(rawBrand);
  if (!brand) return null;
  const k = norm(brand);
  let a = entry.alternatives.find((x) => norm(x.brand) === k);
  if (!a && entry.alternatives.length < MAX_ALTS) {
    a = { brand: clip(brand, 40), name: "", model: "", price: null, priceSrcId: null, pros: [], cons: [], tech: [], vsMain: "", srcIds: [], images: [] };
    entry.alternatives.push(a);
  }
  return a ?? null;
}

const mentions = (page, brand) => norm([page.title, page.h1, page.product?.brand, page.product?.name, page.finalUrl].filter(Boolean).join(" ")).includes(norm(brand));

function takeNew(list, texts, make, cap = 4) {
  const have = new Set(list.map((x) => norm(x.text ?? x.name)));
  for (const t of texts) {
    if (list.length >= cap) break;
    const k = norm(t);
    if (!k || have.has(k)) continue;
    have.add(k);
    list.push(make(t));
  }
}

/**
 * keys: [{key, group, brand?, tech?}] đã sắp theo ưu tiên. opts: { api, store, emit, signal, pagesPerKey, maxPages, gapMs, concurrency, category, kind }
 * Trả về { keys, links, pages, brands }.
 */
export async function expandResearch(entry, keys, { api, store, emit = () => {}, signal, pagesPerKey = 2, maxPages = 12, gapMs = 700, concurrency = 3, perHostCap = 2, kind = "", mainHint = null } = {}) {
  entry.expand ??= { done: [], runs: [], brands: [] };
  const done = new Set(entry.expand.done.map((k) => norm(k)));
  const queue = interleave(keys).filter((k) => !done.has(norm(k.key)));
  const known = new Set([...entry.pages.map((p) => normUrl(p.url)), ...entry.sources.map((s) => s.key)]);
  const perHost = new Map();
  const todo = [];
  const stats = { keys: 0, links: 0, pages: 0, brands: [] };
  const step = (text) => emit({ type: "step", id: "pages", status: "running", text });
  const mainBrand = norm(entry.product.brand);
  const hint = mainHint ?? { model: entry.product.model, name: entry.product.name, brand: entry.product.brand };
  let fails = 0;
  const addedKeys = new Set(queue.map((k) => norm(k.key)));

  entry.status = "running";
  logEvent(entry, "plan", `Tìm bổ sung theo ${queue.length} từ khóa mới (${queue.filter((k) => k.group === "core").length} theo thông tin bạn cung cấp, ${queue.filter((k) => k.group === "competitor").length} đối thủ, ${queue.filter((k) => k.group === "tech").length} công nghệ)`);
  emit({ type: "entry", entry });

  try {
    // 1) tìm các link mới theo từng từ khóa (một từ khóa mỗi lần: không dồn yêu cầu vào công cụ tìm)
    for (let i = 0; i < queue.length; i++) {
      aborted(signal);
      const k = queue[i];
      step(`từ khóa bổ sung ${i + 1}/${queue.length}: ${clip(k.key, 50)}`);
      let res;
      try { res = await api.discover([k.key], signal); }
      catch (e) {
        if (e.name === "AbortError" || e.status === 401) throw e;
        logEvent(entry, "error", `Từ khóa “${clip(k.key, 60)}”: ${e.message}`);
        if (/chặn|xác minh/i.test(e.message) || ++fails >= 3) break; // công cụ tìm đang chặn hoặc lỗi liên tiếp: dừng, giữ phần đã có
        continue;
      }
      fails = 0;
      stats.keys++;
      entry.expand.done.push(k.key);
      const fresh = (res.results ?? []).filter((r) => !SKIP_HOSTS.test(domainOf(r.url)) && !known.has(normUrl(r.url)));
      let used = 0;
      // công nghệ của nhóm sản phẩm: chỉ nhận khi kết quả tìm "<nhóm sản phẩm> công nghệ <tên>" thật sự nhắc cụm đó (hoặc chức năng tương đồng)
      let techOk = true;
      if (k.group === "tech" && k.tech) {
        const v = judgeTech({ term: k.tech, group: kind || entry.plan.query }, res.results ?? []);
        recordTech(entry, k.tech, v, k.key);
        techOk = v.ok;
        logEvent(entry, "plan", `Kiểm tra công nghệ “${k.tech}”: ${v.ok ? "đạt, dùng làm từ khóa" : "chưa kiểm chứng, không dùng làm từ khóa"} (${v.hits} kết quả nhắc, ${v.domains} website)`);
      }
      for (const r of fresh) {
        const key = normUrl(r.url);
        if (k.group === "tech") {
          if (!techOk) { known.add(key); continue; }
          entry.techNotes ??= [];
          if (entry.techNotes.length < MAX_NOTES && !entry.techNotes.some((n) => n.url === r.url)) entry.techNotes.push({ url: r.url, title: clip(r.title, 100), text: clip(r.snippet, 240), tech: k.tech || "" });
          known.add(key);
          continue;
        }
        if (k.group === "competitor" && !k.brand) {
          // khám phá hãng đối thủ từ tiêu đề/đoạn trích: hãng mới sinh thêm bộ từ khóa riêng
          for (const b of detectBrands(`${r.title} ${r.snippet}`)) {
            if (norm(b) !== mainBrand && !entry.expand.brands.some((x) => norm(x) === norm(b)) && !stats.brands.some((x) => norm(x) === norm(b))) stats.brands.push(b);
          }
          continue;
        }
        if (used >= pagesPerKey || todo.length >= maxPages) continue;
        const h = domainOf(r.url);
        if ((perHost.get(h) ?? 0) >= perHostCap) continue;
        if (k.group === "competitor" && !norm(`${r.title} ${r.snippet} ${r.url}`).includes(norm(k.brand))) continue;
        perHost.set(h, (perHost.get(h) ?? 0) + 1);
        known.add(key);
        const srcId = addSource(entry, r.url, r.title, "search", true, "shop");
        todo.push({ url: r.url, srcId, brand: k.group === "competitor" ? k.brand : "", key: k.key });
        used++;
        stats.links++;
      }
      logEvent(entry, "plan", `Từ khóa “${clip(k.key, 70)}”: ${res.results?.length ?? 0} kết quả, ${used || (k.group === "tech" ? fresh.length : 0)} link mới được chọn`);
      // hãng đối thủ vừa tìm ra: thêm bộ từ khóa riêng ngay sau các từ khóa hiện có (tối đa 3 hãng mới)
      if (k.group === "competitor" && !k.brand && stats.brands.length) {
        for (const b of stats.brands.slice(0, 3)) {
          if (entry.expand.brands.some((x) => norm(x) === norm(b))) continue;
          entry.expand.brands.push(b);
          const extra = brandKeys(kind || entry.product.name, b, entry.category).map((key) => ({ key, group: "competitor", brand: b })).filter((x) => !addedKeys.has(norm(x.key)) && !done.has(norm(x.key)));
          for (const x of extra) addedKeys.add(norm(x.key));
          queue.splice(i + 1, 0, ...extra);
          logEvent(entry, "plan", `Tìm ra hãng đối thủ: ${b} — thêm ${extra.length} từ khóa`);
        }
        stats.brands = [];
      }
      emit({ type: "entry", entry });
      if (i < queue.length - 1 && gapMs) await sleep(gapMs);
    }

    // 2) đọc các trang đã chọn
    let n = 0;
    await pool(todo, concurrency, async (p) => {
      const alt = p.brand ? altFor(entry, p.brand) : null;
      if (p.brand && !alt) return;
      const h = alt ? { model: "", name: entry.generic || kind || "", brand: p.brand } : hint;
      let page;
      try { page = await api.page(p.url, h, signal); }
      catch (e) { if (e.name === "AbortError" || e.status === 401) throw e; page = { ok: false, url: p.url, error: e.message }; }
      step(`mở trang ${++n}/${todo.length} · ${domainOf(p.url)}`);
      if (alt && page.ok && !mentions(page, p.brand)) {
        logEvent(entry, "page", `Bỏ ${domainOf(p.url)}: trang không nói về hãng ${p.brand}`, { url: p.url, ok: false });
        if (!alt.srcIds.length && !alt.price && !alt.pros.length) entry.alternatives.splice(entry.alternatives.indexOf(alt), 1);
        return;
      }
      ingestPage(entry, page, alt ? { alt } : {});
      if (alt && page.ok) {
        if (p.srcId && !alt.srcIds.includes(p.srcId)) alt.srcIds.push(p.srcId);
        if (!alt.name) alt.name = clip(page.product?.name || page.h1 || page.title, 120);
        if (!alt.model && page.product?.sku) alt.model = clip(page.product.sku, 40);
        takeNew(alt.pros, page.pros ?? [], (text) => ({ text, srcId: p.srcId, verified: true, via: "page" }));
        takeNew(alt.cons, page.cons ?? [], (text) => ({ text, srcId: p.srcId, verified: true, via: "page" }));
        if (entry.category === "tech") takeNew(alt.tech, (page.tech ?? []).map((x) => cleanTechName(x, 60)).filter(Boolean), (name) => ({ name: clip(name, 60), benefit: "", drawback: "", srcId: p.srcId }));
      }
      stats.pages++;
      emit({ type: "entry", entry });
      if (store) await store.save(entry).catch(() => {});
    }, signal);
  } finally {
    entry.expand.runs.push({ ts: Date.now(), keys: stats.keys, links: stats.links, pages: stats.pages });
    entry.status = "done";
    logEvent(entry, "plan", `Tìm bổ sung xong: ${stats.keys} từ khóa, ${stats.links} link mới, đọc ${stats.pages} trang`);
    emit({ type: "entry", entry });
    if (store) await store.save(entry).catch(() => {});
  }
  return stats;
}
