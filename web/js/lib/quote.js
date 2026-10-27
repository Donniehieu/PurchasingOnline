// Báo giá NCC theo link có sẵn: người dùng dán link (một hoặc nhiều) hoặc nạp file Excel; mỗi link được mở,
// đọc giá/VAT/thông số/liên hệ rồi thêm một dòng vào Bảng NCC (cùng form với bảng tìm kiếm, xuất Excel được).
import { makePlan, cacheKey } from "./plan.js";
import { newEntry, ingestPage, addSource, logEvent } from "./entry.js";
import { upsertOffer, offerKey } from "./offers.js";
import { domainOf, normUrl, clip } from "./text.js";

const DEFAULT_NAME = "Báo giá NCC";

/** Tạo bản ghi cho một bảng báo giá mới. name có thể trống: tên lấy từ trang đầu tiên. */
export function newQuoteEntry(name = "") {
  const title = String(name).replace(/\s+/g, " ").trim();
  const plan = makePlan({ text: title || DEFAULT_NAME, category: "auto" });
  const entry = newEntry(plan, `quote-${Date.now().toString(36)}|${plan.category}`);
  entry.scenario = "full";
  entry.quote = { named: !!title, links: [] };
  if (!title) entry.product.name = DEFAULT_NAME;
  entry.status = "done";
  return entry;
}

async function pool(items, size, fn, signal) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      if (signal?.aborted) throw new DOMException("Đã dừng", "AbortError");
      await fn(items[i], i++);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

/**
 * Đọc các link và thêm vào bảng NCC của entry. Link không đọc được vẫn có dòng (ghi "chưa đọc từ trang")
 * để file báo giá đủ mọi link người dùng đưa.
 * items: [{url, label}]; opts: { api, store, emit, signal, concurrency }. Trả về { added, ok, failed, skipped }.
 */
export async function importLinks(entry, items, { api, store, emit = () => {}, signal, concurrency = 3 } = {}) {
  entry.quote ??= { named: false, links: [] };
  const have = new Set(entry.quote.links.map((l) => normUrl(l.url)));
  const todo = [];
  let skipped = 0;
  for (const it of items) {
    const k = normUrl(it.url);
    if (have.has(k)) { skipped++; continue; }
    have.add(k);
    const rec = { url: it.url, label: it.label || "", status: "wait", error: "", ts: Date.now() };
    entry.quote.links.push(rec);
    todo.push(rec);
  }
  const stats = { added: todo.length, ok: 0, failed: 0, skipped };
  if (!todo.length) return stats;
  entry.status = "running";
  logEvent(entry, "plan", `Thêm ${todo.length} link NCC${skipped ? ` (bỏ ${skipped} link đã có)` : ""}`);
  emit({ type: "entry", entry });

  const named = entry.quote.named ? { name: entry.product.name, model: entry.product.model, brand: entry.product.brand } : {};
  let n = 0;
  try {
    await pool(todo, concurrency, async (rec) => {
      rec.status = "run";
      let page;
      try { page = await api.page(rec.url, named, signal); }
      catch (e) { if (e.name === "AbortError" || e.status === 401) throw e; page = { ok: false, url: rec.url, error: e.message }; }
      absorb(entry, rec, page);
      rec.status = page.ok ? "ok" : "fail";
      rec.error = page.ok ? "" : page.error || "không mở được";
      stats[page.ok ? "ok" : "failed"]++;
      n++;
      emit({ type: "progress", done: n, total: todo.length, domain: domainOf(rec.url) });
      emit({ type: "entry", entry });
      if (store) await store.save(entry).catch(() => {});
    }, signal);
  } finally {
    for (const r of todo) if (r.status === "wait" || r.status === "run") r.status = "stop";
    entry.status = "done";
    logEvent(entry, "plan", `Báo giá theo link: đọc được ${stats.ok}/${todo.length} link${stats.failed ? `, ${stats.failed} link lỗi` : ""}`);
    emit({ type: "entry", entry });
    if (store) await store.save(entry).catch(() => {});
  }
  return stats;
}

// Đưa một trang vào bảng. Link do người dùng chọn nên luôn có dòng; trang không khớp tên sản phẩm (nếu có tên) bị đánh dấu "tương tự".
function absorb(entry, rec, page) {
  const url = page.finalUrl || rec.url;
  addSource(entry, url, page.title || rec.label, "user", true, "shop");
  if (!page.ok) {
    ingestPage(entry, page);
    upsertOffer(entry, { kind: "same", name: rec.label || domainOf(rec.url), model: entry.product.model || "", brand: "", seller: domainOf(rec.url), price: null, priceVia: "page", url: rec.url, userLink: true, readFromPage: false });
    return;
  }
  const matched = !!page.relevant;
  ingestPage(entry, { ...page, relevant: true });
  const key = normUrl(url);
  const o = (entry.offers ?? []).find((x) => normUrl(x.url) === key);
  if (o) {
    o.userLink = true;
    o.weak = entry.quote.named ? !matched : false;
    if (rec.label && !o.name) o.name = clip(rec.label, 120);
    o.label = rec.label || "";
  }
  if (!entry.quote.named && entry.product.name === DEFAULT_NAME && (page.product?.name || page.h1)) entry.product.name = clip(page.product?.name || page.h1, 140);
}

export { offerKey, cacheKey };
