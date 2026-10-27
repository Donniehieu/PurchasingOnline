// Tìm trang sản phẩm qua sitemap.xml của website rồi thử trích giá: node dev/probe-sitemap.mjs https://site.vn [số trang]
import { extractFacts } from "../web/js/lib/extract.js";
process.on("uncaughtException", (e) => console.log("  (lỗi mạng bỏ qua: " + String(e.message).slice(0, 40) + ")"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "vi-VN,vi;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(20000) }); return { status: r.status, final: r.url, text: await r.text() }; };
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
const PRICE_TXT = /\d{1,3}(?:[.,]\d{3}){1,3}\s*(?:đ|₫|vnđ|vnd|VND|Đ)/;
const site = process.argv[2];
const want = Number(process.argv[3] || 3);
const PRODUCTISH = /(san-pham|product|\/p\/|-p\d|\.html|\/[a-z0-9-]{25,}$)/i;
const BAD = /(tin-tuc|blog|bai-viet|category|danh-muc|tag|page|author|wp-json|feed)/i;
try {
  let urls = [];
  let idx = await get(site.replace(/\/$/, "") + "/sitemap.xml").catch(() => null);
  if (!idx || idx.status !== 200) idx = await get(site.replace(/\/$/, "") + "/sitemap_index.xml").catch(() => null);
  if (!idx || idx.status !== 200) { console.log(site, "không có sitemap"); process.exit(0); }
  let first = locs(idx.text);
  const subs = first.filter((u) => /\.xml(\?|$)/i.test(u));
  const prefer = subs.filter((u) => /product|san-pham|item/i.test(u));
  for (const s of (prefer.length ? prefer : subs).slice(0, 2)) { try { urls.push(...locs((await get(s)).text)); } catch { /* bỏ */ } }
  if (!subs.length) urls = first;
  urls = urls.filter((u) => PRODUCTISH.test(u) && !BAD.test(u) && !/\.xml/i.test(u));
  console.log(site, "sitemap:", urls.length, "link sản phẩm tiềm năng");
  let found = 0;
  for (const u of urls.sort(() => 0.5 - Math.random()).slice(0, 12)) {
    if (found >= want) break;
    let p; try { p = await get(u); } catch { continue; }
    if (p.status !== 200) continue;
    const f = extractFacts(p.text, p.final, { model: "", name: "", brand: "" });
    const txt = p.text.match(PRICE_TXT)?.[0] ?? "";
    if (!f.product.price && !txt && !f.priceHint) continue;
    found++;
    console.log(`  ${f.product.price ? "OK   " : "THIẾU"} ${String(f.product.price?.value ?? "-").padStart(10)} ${(f.product.price?.source ?? "").padEnd(7)} hint=${f.priceHint || "-"} txt=${txt} | ${p.final.slice(0, 95)}`);
  }
  if (!found) console.log("  không gặp trang có giá");
} catch (e) { console.log(site, "LỖI", e.message.slice(0, 60)); }
