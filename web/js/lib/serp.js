// Đọc kết quả tìm kiếm của DuckDuckGo / Bing từ HTML. Dùng chung cho máy chủ (Cloudflare) và trình duyệt (qua tiện ích Chrome).
import { decodeEntities, domainOf, normUrl, clip } from "./text.js";

export const strip = (h) => decodeEntities(String(h ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function unwrap(href) {
  let h = decodeEntities(href || "");
  if (h.startsWith("//")) h = "https:" + h;
  try {
    const u = new URL(h);
    if (/duckduckgo\.com$/.test(u.hostname) && u.pathname.startsWith("/l/")) { const t = u.searchParams.get("uddg"); if (t) return t; }
    if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname.startsWith("/ck/")) {
      const t = u.searchParams.get("u");
      if (t && /^a1/.test(t)) {
        const b64 = t.slice(2).replace(/-/g, "+").replace(/_/g, "/");
        const dec = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
        if (/^https?:\/\//.test(dec)) return dec;
      }
    }
    return /^https?:/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}

export function parseDuckDuckGo(html) {
  const out = [];
  const starts = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*>/g)].map((m) => m.index);
  for (let i = 0; i < starts.length; i++) {
    const slice = html.slice(starts[i], starts[i + 1] ?? starts[i] + 4000);
    const a = slice.match(/^<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = unwrap(a[1]);
    if (!url) continue;
    const sn = slice.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ url, title: clip(strip(a[2]), 140), snippet: clip(strip(sn?.[1] ?? ""), 300) });
  }
  return out;
}

export function parseBing(html) {
  const out = [];
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = unwrap(a[1]);
    if (!url) continue;
    const sn = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) || block.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ url, title: clip(strip(a[2]), 140), snippet: clip(strip(sn?.[1] ?? ""), 300) });
  }
  return out;
}

export function parseDuckLite(html) {
  const out = [];
  const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)];
  links.forEach((m, i) => {
    const url = unwrap(m[1]);
    if (!url) return;
    const next = links[i + 1]?.index ?? m.index + 3000;
    const sn = html.slice(m.index, next).match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/);
    out.push({ url, title: clip(strip(m[2]), 140), snippet: clip(strip(sn?.[1] ?? ""), 300) });
  });
  return out;
}

// Bing không có cookie thường trả kết quả rác (Google Dịch, Zalo...): chỉ nhận kết quả có chứa từ của truy vấn
const STOPW = new Set(["gia", "ban", "danh", "ung", "cho", "cua", "the", "and", "review"]);
export function relevantTo(query, r) {
  const hay = (" " + (r.title + " " + r.snippet + " " + r.url).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase());
  const toks = query.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPW.has(t));
  const hits = toks.filter((t) => hay.includes(t)).length;
  return hits >= Math.min(2, toks.length);
}


const SKIP = /(^|\.)(facebook\.com|youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|pinterest\.[a-z.]+|reddit\.com|zalo\.me|wikipedia\.org|duckduckgo\.com|bing\.com|google\.[a-z.]+)$/i;
export const isSkippedHost = (url) => SKIP.test(domainOf(url));
export { normUrl };
