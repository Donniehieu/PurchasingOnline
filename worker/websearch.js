// Tìm web MIỄN PHÍ, không cần khóa: DuckDuckGo (bản HTML) rồi Bing. Dùng khi chưa có khóa AI.
// Không vượt CAPTCHA: nếu công cụ tìm kiếm từ chối thì báo lỗi rõ ràng.
import { decodeEntities, domainOf, normUrl, clip } from "../web/js/lib/text.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const strip = (h) => decodeEntities(String(h ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function unwrap(href) {
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

async function timed(fetchImpl, url, init, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetchImpl(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

/** Trả về { results, engine, error? } cho một câu truy vấn. */
export async function webSearch(query, { fetchImpl = fetch } = {}) {
  const errors = [];
  try {
    const r = await timed(fetchImpl, "https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", "accept-language": "vi-VN,vi;q=0.9" },
      body: "q=" + encodeURIComponent(query) + "&kl=vn-vi",
    });
    const html = await r.text();
    const res = r.ok ? parseDuckDuckGo(html) : [];
    if (res.length) return { results: res, engine: "duckduckgo" };
    errors.push(r.status === 202 || /anomaly|challenge/i.test(html.slice(0, 4000)) ? "DuckDuckGo yêu cầu xác minh" : `DuckDuckGo HTTP ${r.status}`);
  } catch { errors.push("DuckDuckGo không kết nối được"); }
  try {
    const r = await timed(fetchImpl, "https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", "accept-language": "vi-VN,vi;q=0.9" },
      body: "q=" + encodeURIComponent(query) + "&kl=vn-vi",
    });
    const html = await r.text();
    const res = r.ok ? parseDuckLite(html) : [];
    if (res.length) return { results: res, engine: "duckduckgo-lite" };
    errors.push(r.status === 202 ? "DuckDuckGo Lite yêu cầu xác minh" : `DuckDuckGo Lite HTTP ${r.status}`);
  } catch { errors.push("DuckDuckGo Lite không kết nối được"); }
  try {
    const r = await timed(fetchImpl, "https://www.bing.com/search?q=" + encodeURIComponent(query) + "&setlang=vi&cc=VN", { headers: { "user-agent": UA, "accept-language": "vi-VN,vi;q=0.9" } });
    const html = await r.text();
    const res = r.ok ? parseBing(html).filter((x) => relevantTo(query, x)) : [];
    if (res.length) return { results: res, engine: "bing" };
    errors.push(`Bing không có kết quả (HTTP ${r.status})`);
  } catch { errors.push("Bing không kết nối được"); }
  return { results: [], engine: null, error: errors.join("; ") };
}

const SKIP = /(^|\.)(facebook\.com|youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|pinterest\.[a-z.]+|reddit\.com|zalo\.me|wikipedia\.org|duckduckgo\.com|bing\.com|google\.[a-z.]+)$/i;

/** Gộp kết quả nhiều truy vấn, bỏ trùng và mạng xã hội. */
export async function searchMany(queries, { fetchImpl = fetch, limit = 12, gapMs = 700 } = {}) {
  const runs = [];
  for (const [i, q] of queries.entries()) {
    if (i && gapMs) await new Promise((r) => setTimeout(r, gapMs));
    runs.push(await webSearch(q, { fetchImpl }));
  }
  const seen = new Set();
  const results = [];
  const used = [];
  const errors = [];
  runs.forEach((r, i) => {
    if (r.error) errors.push(r.error);
    if (r.results.length) used.push(queries[i]);
    for (const x of r.results) {
      const k = normUrl(x.url);
      if (seen.has(k) || SKIP.test(domainOf(x.url))) continue;
      seen.add(k);
      results.push({ ...x, query: queries[i] });
    }
  });
  return { results: results.slice(0, limit), queries: used, errors: [...new Set(errors)] };
}
