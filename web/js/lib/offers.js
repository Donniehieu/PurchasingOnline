// Bảng so sánh nhà cung cấp (NCC): mỗi dòng = một NCC bán một sản phẩm, lấy từ trang web thật đã đọc (và cache).
// Cột: STT | Tên sản phẩm / mã model | Đơn giá | VAT | Thông tin kỹ thuật bổ sung | NCC / hãng sản xuất | Link truy vấn thông tin
import { normUrl, domainOf, modelKey, norm, parseVnd, money, clip } from "./text.js";
import { contactText } from "./contact.js";

export const OFFER_COLUMNS = [
  { id: "stt", label: "STT", width: 6, numeric: true },
  { id: "name", label: "Tên sản phẩm / mã model", width: 38 },
  { id: "price", label: "Đơn giá", width: 16, numeric: true },
  { id: "vat", label: "VAT", width: 18 },
  { id: "specs", label: "Thông tin kỹ thuật bổ sung", width: 52 },
  { id: "ncc", label: "NCC / hãng sản xuất", width: 30 },
  { id: "contact", label: "Liên hệ NCC", width: 36 },
  { id: "link", label: "Link truy vấn thông tin", width: 46 },
];

export const offerKey = (url, model) => normUrl(url) + "|" + modelKey(model || "");

export const VAT_LABEL = { included: "Đã gồm VAT", excluded: "Chưa gồm VAT", rate: "VAT", unknown: "Chưa rõ" };
export function vatText(v) {
  if (!v) return VAT_LABEL.unknown;
  return v.state === "rate" ? `VAT ${v.rate}%` : VAT_LABEL[v.state] ?? VAT_LABEL.unknown;
}

export function specText(specs, max = 8) {
  return (specs ?? []).slice(0, max).map((s) => `${s.k}: ${s.v}`).join("; ");
}

/** Gộp một offer mới vào danh sách của entry: cùng trang + cùng model thì cập nhật, không nhân đôi. */
export function upsertOffer(entry, o) {
  entry.offers ??= [];
  const key = offerKey(o.url, o.model);
  const now = { ...o, key, ts: o.ts ?? Date.now(), specs: o.specs ?? [], vat: o.vat ?? { state: "unknown" } };
  const cur = entry.offers.find((x) => x.key === key);
  if (!cur) { entry.offers.push(now); return now; }
  const better = now.priceVia !== "ai" || cur.price == null; // giá đọc từ trang thay giá AI/Google
  if (now.price != null && (better || cur.priceVia === "ai")) { cur.price = now.price; cur.priceVia = now.priceVia; }
  if ((now.specs?.length ?? 0) >= (cur.specs?.length ?? 0) && now.specs?.length) cur.specs = now.specs;
  if (now.vat?.state && now.vat.state !== "unknown") cur.vat = now.vat;
  for (const k of ["name", "brand", "seller", "model"]) if (now[k] && (!cur[k] || now.priceVia !== "ai")) cur[k] = now[k];
  cur.kind = now.kind;
  if (now.pack) cur.pack = now.pack;
  cur.weak = !!(cur.weak && now.weak); // đã từng khớp đúng thì không còn là "tương tự"
  cur.readFromPage = !!(cur.readFromPage || now.readFromPage); // đã từng đọc đúng trang này
  cur.ts = now.ts;
  if (now.srcId) cur.srcId = now.srcId;
  return cur;
}

/**
 * Tất cả offer của entry. Entry cũ (chưa có entry.offers) được suy ra từ giá + hãng khác đã lưu,
 * nên cache cũ vẫn có bảng (chỉ thiếu thông số/VAT cho tới khi tìm thêm).
 */
export function offersOf(entry) {
  const out = [...(entry.offers ?? [])];
  const haveKey = new Set(out.map((o) => o.key ?? offerKey(o.url, o.model)));
  const haveUrl = new Set(out.filter((o) => o.kind === "same").map((o) => normUrl(o.url)));
  const src = (id) => entry.sources.find((s) => s.id === id);
  for (const p of entry.prices) {
    const s = src(p.srcId);
    if (!s || haveUrl.has(normUrl(s.url))) continue; // trang này đã có offer của sản phẩm chính
    haveUrl.add(normUrl(s.url));
    out.push({ key: offerKey(s.url, entry.product.model), kind: "same", name: entry.product.name, model: entry.product.model, brand: entry.product.brand, seller: s.domain, price: p.value, priceVia: p.via === "page" ? "page" : "ai", vat: { state: "unknown" }, specs: [], url: s.url, srcId: s.id, ts: p.ts ?? entry.updatedAt });
  }
  for (const a of entry.alternatives) {
    const s = src(a.priceSrcId) ?? src(a.srcIds?.[0]);
    if (!s) continue;
    const key = offerKey(s.url, a.model || a.name);
    if (haveKey.has(key) || out.some((o) => o.kind === "other" && norm(o.brand) === norm(a.brand) && normUrl(o.url) === normUrl(s.url))) continue; // hãng này đã có offer
    haveKey.add(key);
    out.push({ key, kind: "other", name: a.name, model: a.model, brand: a.brand, seller: s.domain, price: a.price, priceVia: "ai", vat: { state: "unknown" }, specs: [], url: s.url, srcId: s.id, ts: entry.updatedAt });
  }
  return out;
}

/** Dòng hiển thị cho bảng (chưa lọc/sắp xếp). */
export function tableRows(entry) {
  return offersOf(entry).map((o, i) => ({
    ...o,
    i,
    domain: domainOf(o.url),
    seller: o.seller || domainOf(o.url),
    nameText: [o.name, o.model && !String(o.name || "").toUpperCase().includes(String(o.model).toUpperCase()) ? o.model : ""].filter(Boolean).join(" — "),
    vatLabel: vatText(o.vat),
    specText: specText(o.specs, 12),
    contact: entry.contacts?.[domainOf(o.url)] ?? null,
    contactText: contactText(entry.contacts?.[domainOf(o.url)]),
    read: isRead(o),
  }));
}

/**
 * Danh sách NCC đã gặp (theo tên miền): tên, liên hệ, các trang đã đọc, số sản phẩm và giá thấp nhất.
 * Gồm cả NCC chỉ có trang không khớp model, và NCC từ cache cũ (chưa có entry.suppliers) suy ra từ bảng.
 */
export function suppliersOf(entry) {
  const map = new Map();
  for (const s of Object.values(entry.suppliers ?? {})) map.set(s.domain, { domain: s.domain, name: s.name || "", pages: [...(s.pages ?? [])], matched: !!s.matched });
  const rows = tableRows(entry);
  for (const r of rows) {
    const d = r.domain;
    if (!d) continue;
    const s = map.get(d) ?? { domain: d, name: "", pages: [], matched: false };
    if (!map.has(d)) map.set(d, s);
    if (!s.name && r.seller && r.seller !== d) s.name = r.seller;
    if (r.read) s.matched = true;
    if (!s.pages.some((p) => normUrl(p.url) === normUrl(r.url))) s.pages.push({ url: r.url, title: r.name || "", relevant: !!r.read, price: r.price ?? null });
  }
  return [...map.values()].map((s) => {
    const mine = rows.filter((r) => r.domain === s.domain);
    const prices = mine.map((r) => r.price).filter((p) => p != null);
    const contact = entry.contacts?.[s.domain] ?? null;
    return { ...s, name: s.name || s.domain, offers: mine.length, minPrice: prices.length ? Math.min(...prices) : null, brands: [...new Set(mine.map((r) => r.brand).filter(Boolean))].slice(0, 4), contact, contactText: contactText(contact) };
  }).sort((a, b) => Number(b.matched) - Number(a.matched) || (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity) || a.name.localeCompare(b.name, "vi"));
}

// ---------- lọc thông số kỹ thuật (đúng, không khớp chữ số một phần) ----------
const spaced = (s) => " " + norm(s).replace(/(\d)[.,](?=\d{3}(?!\d))/g, "$1").replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").replace(/[^a-z0-9.,]+/g, " ").replace(/[.,]+(?=\s)/g, "").trim() + " ";
function numberIn(text) {
  const m = String(text ?? "").match(/\d+(?:[.,]\d+)*/);
  if (!m) return null;
  const t = m[0];
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  if (/^\d{1,3}(,\d{3})+$/.test(t)) return Number(t.replace(/,/g, ""));
  return Number(t.replace(",", "."));
}
// cụm chữ bắt đầu đúng đầu từ; số phải khớp trọn (150 không khớp 1500)
function phraseTest(term) {
  const toks = spaced(term).trim().split(" ").filter(Boolean);
  if (!toks.length) return null;
  const tail = /^[0-9.,]+$/.test(toks[toks.length - 1]) ? " " : "";
  const needle = " " + toks.join(" ") + tail;
  return (hay) => hay.includes(needle);
}

/**
 * Bộ lọc thông số. Nhiều điều kiện cách nhau bằng ";" (hoặc "và"), tất cả phải đúng:
 *  - "inverter"            : có thông số nhắc đúng từ đó (từ đầu từ; số phải khớp trọn)
 *  - "công suất: 1500"     : thông số tên chứa "công suất" và giá trị chứa 1500
 *  - "công suất>=1500"     : so sánh số (>, >=, <, <=, =); có đơn vị thì giá trị cũng phải có đơn vị đó
 * Trả về hàm (specs) => boolean, hoặc null nếu không lọc.
 */
export function specFilter(text) {
  const terms = String(text ?? "").split(/;|\s+và\s+|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  if (!terms.length) return null;
  const tests = terms.map((term) => {
    let m = term.match(/^(.+?)\s*(>=|<=|=>|=<|>|<|=)\s*(\d[\d.,]*)\s*([^\d\s]*)\s*$/);
    if (m) {
      const kt = phraseTest(m[1]), op = m[2].replace("=>", ">=").replace("=<", "<="), want = numberIn(m[3]), unit = norm(m[4]);
      if (!kt || want == null) return () => false;
      return (specs) => specs.some((s) => {
        if (!kt(spaced(s.k))) return false;
        const v = numberIn(s.v);
        if (v == null || (unit && !spaced(s.v).includes(" " + unit))) return false;
        return op === ">" ? v > want : op === ">=" ? v >= want : op === "<" ? v < want : op === "<=" ? v <= want : v === want;
      });
    }
    m = term.match(/^([^:]{1,40}):\s*(.+)$/);
    if (m) {
      const kt = phraseTest(m[1]), vt = phraseTest(m[2]);
      if (!kt || !vt) return () => true;
      return (specs) => specs.some((s) => kt(spaced(s.k)) && vt(spaced(s.v)));
    }
    const pt = phraseTest(term);
    if (!pt) return () => true;
    return (specs) => specs.some((s) => pt(spaced(`${s.k} ${s.v}`)));
  });
  return (specs) => tests.every((t) => t(specs ?? []));
}

/** Dòng có dữ liệu được đọc từ ĐÚNG trang của dòng đó (giá/thông số/VAT lấy từ link). Dữ liệu cũ chưa có cờ: suy từ nguồn giá. */
export const isRead = (o) => (o.readFromPage != null ? !!o.readFromPage : ["page", "jsonld", "meta", "markup", "text"].includes(o.priceVia));

// ---------- lọc / sắp xếp ----------
/** "<3tr", ">2000000", "2tr-3tr", "2.490.000": hàm kiểm tra giá. Chuỗi rỗng = không lọc. Không hiểu thì lọc theo chữ. */
export function priceFilter(text) {
  const t = norm(text).replace(/\s+/g, "");
  if (!t) return null;
  let m = t.match(/^(<=|>=|<|>)(.+)$/);
  if (m) { const n = parseVnd(m[2]); if (n == null) return () => false; return (p) => p != null && (m[1] === "<" ? p < n : m[1] === "<=" ? p <= n : m[1] === ">" ? p > n : p >= n); }
  m = t.match(/^(.+?)-(.+)$/);
  if (m) { const a = parseVnd(m[1]), b = parseVnd(m[2]); if (a != null && b != null) return (p) => p != null && p >= Math.min(a, b) && p <= Math.max(a, b); }
  const n = parseVnd(t);
  if (n != null && /\d/.test(t)) return (p) => p != null && Math.abs(p - n) <= Math.max(n * 0.05, 1);
  return (p) => p != null && money(p).toLowerCase().includes(t);
}

const ACCESS = {
  stt: (r) => r.i,
  name: (r) => norm(r.nameText),
  price: (r) => r.price,
  vat: (r) => ({ included: 0, rate: 1, excluded: 2, unknown: 3 })[r.vat?.state ?? "unknown"],
  specs: (r) => norm(r.specText),
  ncc: (r) => norm(`${r.seller} ${r.brand}`),
  contact: (r) => (r.contactText ? norm(r.contactText) : null),
  link: (r) => r.domain,
};

export const DEFAULT_VIEW = { q: "", kind: "all", source: "page", group: "none", filters: { name: "", price: "", vat: "", specs: "", ncc: "", contact: "", link: "" }, sort: { col: "price", dir: "asc" } };

const has = (hay, needle) => !needle || norm(hay).includes(norm(needle));

/** Áp bộ lọc + sắp xếp, đánh lại STT theo thứ tự đang xem. */
export function applyView(rows, view = DEFAULT_VIEW) {
  const f = { ...DEFAULT_VIEW.filters, ...(view.filters ?? {}) };
  const pf = priceFilter(f.price);
  const sf = specFilter(f.specs);
  let out = rows.filter((r) => {
    if ((view.source ?? "page") === "page" && !r.read) return false; // mặc định chỉ dòng đã đọc từ đúng trang
    if (view.kind === "same" && r.kind !== "same") return false;
    if (view.kind === "other" && r.kind !== "other") return false;
    if (view.q && !has([r.nameText, r.vatLabel, r.specText, r.seller, r.brand, r.contactText, r.url, r.price != null ? money(r.price) : ""].join(" "), view.q)) return false;
    if (!has(r.nameText, f.name)) return false;
    if (pf && !pf(r.price)) return false;
    if (f.vat && r.vat?.state !== f.vat) return false;
    if (sf && !sf(r.specs)) return false;
    if (!has(`${r.seller} ${r.brand}`, f.ncc)) return false;
    if (!has(r.contactText, f.contact)) return false;
    if (!has(`${r.domain} ${r.url}`, f.link)) return false;
    return true;
  });
  const { col, dir } = view.sort ?? {};
  if (col && ACCESS[col] && col !== "stt") {
    const get = ACCESS[col], sign = dir === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null && y == null) return a.i - b.i;
      if (x == null) return 1;  // dữ liệu thiếu luôn ở cuối, cả khi giảm dần
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "vi");
      return c * sign || a.i - b.i;
    });
  }
  // nhóm theo NCC (website) hoặc theo hãng: các dòng cùng nhóm đứng cạnh nhau, giữ thứ tự sắp xếp trong nhóm
  const g = view.group ?? "none";
  if (g !== "none") {
    const keyOf = (r) => (g === "brand" ? r.brand || "(chưa rõ hãng)" : r.seller);
    const order = [];
    for (const r of out) { const k = keyOf(r); if (!order.includes(k)) order.push(k); }
    out = [...out].sort((a, b) => order.indexOf(keyOf(a)) - order.indexOf(keyOf(b)));
    out = out.map((r) => ({ ...r, group: keyOf(r) }));
  }
  return out.map((r, n) => ({ ...r, stt: n + 1 }));
}

/** Giải thích vì sao bảng ít hoặc không có dữ liệu và cách khắc phục (dựa trên nhật ký của lần tìm). */
export function diagnose(entry, rowsShown = 0, hiddenUnread = 0) {
  const log = (entry.log ?? []).filter((l) => l.kind === "error").map((l) => l.msg).join(" | ");
  const tips = [];
  const opened = entry.pages.filter((p) => p.ok).length;
  const blocked = entry.pages.filter((p) => !p.ok && /chặn|403|CAPTCHA|xác minh/i.test(p.error || "")).length;
  let title = "";
  if (/DuckDuckGo|công cụ tìm kiếm miễn phí/i.test(log) && !opened) {
    title = "Công cụ tìm kiếm miễn phí (DuckDuckGo) đang chặn nên chưa có trang nào để mở.";
    tips.push("Cài tiện ích Chrome để tìm bằng Google trong trình duyệt của bạn (xem README, mục “Dùng Google trong Chrome”).", "Hoặc dán link các trang bán hàng vào ô tìm kiếm.", "Hoặc nhập khóa Gemini miễn phí ở Cài đặt; thử lại sau 10 phút.");
  } else if (/Google/i.test(log) && /xác minh|CAPTCHA|chặn/i.test(log)) {
    title = "Google đang yêu cầu xác minh (CAPTCHA) nên chưa mở được kết quả.";
    tips.push("Mở google.com trong Chrome, xác minh, rồi bấm “Tìm thêm NCC”. App không tự giải CAPTCHA.");
  } else if (!opened) {
    title = "Chưa mở được trang web nào.";
    tips.push("Kiểm tra mạng, hoặc dán link trang bán hàng vào ô tìm kiếm.");
  } else if (rowsShown === 0 && hiddenUnread > 0) {
    title = `Có ${hiddenUnread} dòng chưa đọc được từ đúng trang (chỉ là gợi ý từ Google/trang danh sách).`;
    tips.push("Chọn “Gồm cả dữ liệu chưa xác nhận” để xem, hoặc bấm “Tìm thêm NCC” để mở thêm trang.");
  } else if (rowsShown === 0) {
    title = "Các trang đã mở không phải trang bán đúng sản phẩm này (khác model).";
    tips.push("Bấm “Tìm thêm NCC”, hoặc gõ chính xác mã model, hoặc dán link trang bán hàng.");
  }
  if (blocked) tips.push(`${blocked} trang chặn truy cập tự động (403/CAPTCHA) nên bị bỏ qua; app không vượt CAPTCHA.`);
  return { title, tips, opened, blocked };
}

/** Giá trị từng ô dạng chữ/số (dùng chung cho bảng web và Excel). */
export function cellValue(row, colId) {
  switch (colId) {
    case "stt": return row.stt;
    case "name": return row.nameText;
    case "price": return row.price ?? null;
    case "vat": return row.vatLabel;
    case "specs": return row.specText;
    case "ncc": return `NCC: ${row.seller}${row.brand ? "\nHãng: " + row.brand : ""}`;
    case "contact": return row.contactText || "";
    case "link": return row.url;
    default: return "";
  }
}

export const PRICE_NOTE = { page: "đọc từ trang", jsonld: "đọc từ trang", meta: "đọc từ trang", markup: "đọc từ trang", text: "ước lượng từ chữ trên trang", ai: "Google, chưa xác nhận", snippet: "trích từ kết quả tìm kiếm", listing: "từ trang danh sách, chưa mở trang sản phẩm" };
