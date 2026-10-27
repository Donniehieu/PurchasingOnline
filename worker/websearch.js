// Tìm web MIỄN PHÍ, không cần khóa: DuckDuckGo (bản HTML) rồi Bing. Dùng khi chưa có khóa AI.
// Không vượt CAPTCHA: nếu công cụ tìm kiếm từ chối thì báo lỗi rõ ràng.
import { domainOf, normUrl } from "../web/js/lib/text.js";
import { parseDuckDuckGo, parseBing, parseDuckLite, relevantTo, isSkippedHost } from "../web/js/lib/serp.js";

export { parseDuckDuckGo, parseBing, parseDuckLite, relevantTo };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
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
      if (seen.has(k) || isSkippedHost(x.url)) continue;
      seen.add(k);
      results.push({ ...x, query: queries[i] });
    }
  });
  return { results: results.slice(0, limit), queries: used, errors: [...new Set(errors)] };
}
