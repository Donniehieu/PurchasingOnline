// Tiện ích văn bản dùng chung cho trình duyệt và Worker (không dùng DOM).

export function stripAccents(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export const norm = (text) => stripAccents(text).toLowerCase().replace(/\s+/g, " ").trim();

// Khóa so khớp model: bỏ khoảng trắng, gạch nối... "WH-1000 XM5" -> "WH1000XM5"
export const modelKey = (text) => stripAccents(text).toUpperCase().replace(/[^A-Z0-9]/g, "");

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// Chuẩn hóa URL để so sánh: bỏ giao thức, www, #, utm_*, dấu / cuối
export function normUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|srsltid)/i.test(k)) u.searchParams.delete(k);
    }
    const q = u.searchParams.toString();
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + (q ? "?" + q : "")).toLowerCase();
  } catch { return String(url ?? "").toLowerCase(); }
}

export function money(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("vi-VN") + " ₫";
}

// "12.990.000đ", "12,990,000", "12tr9", "1.2 triệu" -> số (VND)
export function parseVnd(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  const s = norm(raw);
  if (!s) return null;
  let m = s.match(/(?<![.,\d])(\d+)\s*tr(?!i)\s*(\d{1,3})?(?!\d)/);
  if (m) return Math.round(Number(m[1]) * 1e6 + (m[2] ? Number(m[2].padEnd(3, "0")) * 1e3 : 0));
  m = s.match(/(\d+(?:[.,]\d+)?)\s*(trieu|tr\b|million|m\b)/);
  if (m) return Math.round(parseFloat(m[1].replace(",", ".")) * 1e6);
  m = s.match(/(\d+(?:[.,]\d+)?)\s*(nghin|ngan|k\b)/);
  if (m) return Math.round(parseFloat(m[1].replace(",", ".")) * 1e3);
  m = s.match(/\d[\d.,\s]*/);
  if (!m) return null;
  const digits = m[0].replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export const mean = (values) => {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// Khóa chống trùng cho câu: bỏ dấu, dấu câu, chỉ lấy 60 ký tự đầu
export const sentenceKey = (text) => norm(text).replace(/[^a-z0-9 ]/g, "").slice(0, 60);

export function decodeEntities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", dstrok: "đ", Dstrok: "Đ", reg: "®", copy: "©", trade: "™", deg: "°", times: "×" };
  const latin = { agrave: "à", aacute: "á", acirc: "â", atilde: "ã", egrave: "è", eacute: "é", ecirc: "ê", igrave: "ì", iacute: "í", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ugrave: "ù", uacute: "ú", yacute: "ý", Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Egrave: "È", Eacute: "É", Ecirc: "Ê", Igrave: "Ì", Iacute: "Í", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ugrave: "Ù", Uacute: "Ú", Yacute: "Ý" };
  let out = String(text ?? "");
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
      .replace(/&([a-zA-Z]+);/g, (m, n) => named[n] ?? latin[n] ?? m);
  }
  return out;
}

function safeChar(code) {
  try { return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""; } catch { return ""; }
}

export function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function clip(text, max = 200) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
