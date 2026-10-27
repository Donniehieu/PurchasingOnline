// Thông tin liên hệ của NCC trên một trang web: số điện thoại, email, Zalo, địa chỉ, link trang "Liên hệ".
// Đọc từ liên kết tel:/mailto:/zalo.me, dữ liệu cấu trúc (Organization/LocalBusiness) và chữ ở đầu/cuối trang (header, footer).
import { decodeEntities, clip, norm } from "./text.js";

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Chuẩn hóa số điện thoại Việt Nam. Trả về chuỗi hiển thị hoặc "" nếu không đúng dạng.
export function normalizePhone(raw) {
  let d = String(raw ?? "").replace(/[^\d+]/g, "");
  if (/^1[89]00\d{4,6}$/.test(d)) return d.replace(/^(\d{4})(\d+)$/, "$1 $2"); // tổng đài 1800/1900
  d = d.replace(/^\+?84/, "0");
  if (/^0[35789]\d{8}$/.test(d)) return d.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3"); // di động
  if (/^02\d{8,9}$/.test(d)) return d.length === 10 ? d.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3") : d.replace(/^(\d{4})(\d{3})(\d{4})$/, "$1 $2 $3"); // máy bàn
  return "";
}

const PHONE_RE = /(?<![\d.,])(?:\+?84|0)[\s.\-]?(?:\(?\d{1,4}\)?[\s.\-]?){2,4}\d{2,4}(?![\d])|(?<![\d])1[89]00[\s.\-]?\d{4,6}(?![\d])/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|js|css|woff2?)$|^(example|sentry|noreply|no-reply|name|email|user|your|domain)@|@(example|sentry|wixpress|domain|email|yourdomain|sentry-next)\./i;
const CONTACT_HREF = /(lien-he|lienhe|contact|lien-lac|gioi-thieu|about-us|ve-chung-toi)/i;

function textOf(html) {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/[ \t ]+/g, " ");
}

function ldOrgs(html) {
  const out = [];
  const re = /<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(html)) && n++ < 12) {
    let data;
    try { data = JSON.parse(m[1].trim().replace(/^<!--/, "").replace(/-->$/, "")); } catch { continue; }
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 6) return;
      if (Array.isArray(node)) { node.forEach((x) => walk(x, depth + 1)); return; }
      const t = asArray(node["@type"]).join(" ");
      if (/Organization|LocalBusiness|Store|Corporation|OnlineStore|Brand/i.test(t) && (node.telephone || node.email || node.address)) out.push(node);
      for (const k of ["@graph", "publisher", "seller", "provider", "offers", "mainEntity"]) if (node[k]) walk(node[k], depth + 1);
    };
    walk(data, 0);
  }
  return out;
}

// địa chỉ đủ cụ thể: có số nhà/đường/phường/quận/tỉnh, không chỉ là tên nước lặp lại
const goodAddress = (a) => a.length >= 14 && /(\d|đường|phố|phường|quận|huyện|tỉnh|tp\.?|thành phố|xã)/i.test(a) && new Set(a.split(/,\s*/).map((x) => x.toLowerCase())).size >= 2 && !/^(việt nam|vn)(,|$)/i.test(a);

function addressOf(a) {
  if (!a) return "";
  if (typeof a === "string") return clip(decodeEntities(a), 160);
  return clip([a.streetAddress, a.addressLocality, a.addressRegion, a.addressCountry && typeof a.addressCountry === "string" ? a.addressCountry : ""].filter(Boolean).join(", "), 160);
}

/**
 * html: HTML trang; baseUrl: địa chỉ trang (để ghép link tương đối).
 * Trả về { phones, emails, zalo, address, contactUrl } (mảng rỗng/chuỗi rỗng nếu không có).
 */
export function extractContacts(html, baseUrl = "") {
  const phones = [], emails = [], zalo = [];
  const addPhone = (raw) => { const p = normalizePhone(raw); if (p && !phones.includes(p)) phones.push(p); };
  const addEmail = (raw) => { const e = String(raw).trim().replace(/[.,;:)]+$/, "").toLowerCase(); if (e && !BAD_EMAIL.test(e) && !emails.includes(e)) emails.push(e); };

  // 1) liên kết có cấu trúc
  for (const m of html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) addPhone(decodeURIComponent(m[1]));
  for (const m of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) addEmail(decodeURIComponent(m[1]));
  for (const m of html.matchAll(/(?:https?:)?\/\/(?:sp\.)?zalo\.me\/(?:s\/)?([A-Za-z0-9_.\-]{3,40})/gi)) {
    const v = /^\d+$/.test(m[1]) ? normalizePhone(m[1]) || m[1] : m[1];
    if (!/^(share|s|chat|pc|ott|about|app|plugins?|widgets?|oa|embed|sdk|developers?|download|login|sp|zaloapp|mini-?app)$/i.test(m[1]) && (/^\d{8,}$/.test(m[1]) || m[1].length >= 4) && !zalo.includes(v)) zalo.push(v);
  }

  // 2) dữ liệu cấu trúc
  let address = "";
  for (const o of ldOrgs(html)) {
    for (const t of asArray(o.telephone)) addPhone(t);
    for (const e of asArray(o.email)) addEmail(e);
    const ad = addressOf(asArray(o.address)[0]);
    if (!address && goodAddress(ad)) address = ad;
  }

  // 3) chữ ở đầu và cuối trang (nơi thường đặt hotline, địa chỉ)
  const region = html.length > 110_000 ? html.slice(0, 30_000) + " " + html.slice(-80_000) : html;
  const text = textOf(region);
  const near = /(hotline|điện thoại|dien thoai|liên hệ|lien he|sđt|sdt|tel\b|phone|zalo|đặt hàng|mua hàng|tư vấn|báo giá|bán hàng|kinh doanh)/i;
  for (const m of text.matchAll(PHONE_RE)) {
    const around = text.slice(Math.max(0, m.index - 40), m.index);
    if (near.test(around) || phones.length < 1) addPhone(m[0]);
    if (phones.length >= 4) break;
  }
  for (const m of text.matchAll(EMAIL_RE)) { addEmail(m[0]); if (emails.length >= 3) break; }
  if (!address) {
    const m = text.match(/(?:địa chỉ|dia chi|trụ sở|showroom|văn phòng)\s*[:\-–]\s*([^\n]{12,200}?)(?=\s+(?:hotline|điện thoại|email|sđt|tel|website|mst|mã số thuế|giờ làm việc|fax)\b|$|\s{3,})/i);
    if (m && goodAddress(m[1].trim()) && !/^(điện thoại|dien thoai|hotline|email|tel|sđt)/i.test(m[1].trim())) address = clip(m[1].trim(), 160);
  }

  // 4) trang "Liên hệ" của NCC
  let contactUrl = "";
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const label = norm(m[2].replace(/<[^>]+>/g, " "));
    if (CONTACT_HREF.test(m[1]) || /^(lien he|contact|lien he voi chung toi)$/.test(label.trim())) {
      try { const u = new URL(m[1], baseUrl || undefined); const b = baseUrl ? new URL(baseUrl) : null; if (/^https?:$/.test(u.protocol) && (!b || u.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, ""))) { contactUrl = u.href; break; } } catch { /* link lỗi */ }
    }
  }

  return { phones: phones.slice(0, 4), emails: emails.slice(0, 3), zalo: zalo.slice(0, 2), address, contactUrl };
}

export const hasContact = (c) => !!(c && (c.phones?.length || c.emails?.length || c.zalo?.length || c.address));

/** Gộp thông tin liên hệ của cùng một NCC (cùng tên miền) từ nhiều trang: không trùng, giữ nguồn. */
export function mergeContact(cur, add, srcUrl = "") {
  const out = { phones: [], emails: [], zalo: [], address: "", contactUrl: "", srcUrls: [], fetchedContactPage: false, ...(cur || {}) };
  for (const k of ["phones", "emails", "zalo"]) for (const v of add?.[k] ?? []) if (!out[k].includes(v)) out[k].push(v);
  out.phones = out.phones.slice(0, 4); out.emails = out.emails.slice(0, 3); out.zalo = out.zalo.slice(0, 2);
  out.address = out.address || add?.address || "";
  out.contactUrl = out.contactUrl || add?.contactUrl || "";
  if (srcUrl && hasContact(add) && !out.srcUrls.includes(srcUrl)) out.srcUrls.push(srcUrl);
  return out;
}

export function contactText(c) {
  if (!hasContact(c)) return "";
  return [
    c.phones?.length ? "SĐT: " + c.phones.join(", ") : "",
    c.emails?.length ? "Email: " + c.emails.join(", ") : "",
    c.zalo?.length ? "Zalo: " + c.zalo.join(", ") : "",
    c.address ? "Địa chỉ: " + c.address : "",
  ].filter(Boolean).join("\n");
}
