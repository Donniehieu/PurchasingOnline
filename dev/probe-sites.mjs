// Chạy thử trích giá trên trang sản phẩm THẬT của nhiều kiểu website (không chỉ Next.js).
//   node dev/probe-sites.mjs [file-sites.json] [file-kết-quả.json]
// Với mỗi website: lấy trang danh mục, thử các liên kết nội bộ cho tới khi gặp tối đa 3 trang SẢN PHẨM
// (có chữ giá + dấu hiệu bán hàng), rồi chạy extractFacts. Phân loại:
//   OK = đọc được giá · THIẾU = trong HTML có chữ giá nhưng không đọc được (lỗi cần sửa)
//   KHÔNG-THẤY = không gặp trang sản phẩm có giá trong HTML (thường do trang tải giá bằng JavaScript hoặc chặn truy cập)
import fs from "node:fs";
process.on("uncaughtException", (e) => console.log("  (lỗi mạng bỏ qua: " + String(e.message).slice(0, 50) + ")")); // undici đôi khi ném lỗi trên socket đã đóng
import { extractFacts } from "../web/js/lib/extract.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sites = JSON.parse(fs.readFileSync(process.argv[2] || "dev/sites.json", "utf8"));
const PRICE_TXT = /\d{1,3}(?:[.,]\d{3}){1,3}\s*(?:đ|₫|vnđ|vnd|VND|Đ)|[$€£]\s?\d{1,4}(?:[.,]\d{2})?/;
const SELL = /(thêm vào giỏ|them vao gio|add to cart|add-to-cart|"@type"\s*:\s*"Product"|og:type" content="(?:og:)?product|itemprop="price"|data-price|prd-price|product-price)/i;
const BAD = /(tin-tuc|blog|kinh-nghiem|huong-dan|helpcenter|_next|\.css|\.js|\.png|\.jpg|thuong-hieu|brand|gioi-thieu|lien-he|chinh-sach|tuyen-dung|ban-tin|khuyen-mai|uu-dai|cart|gio-hang|dang-nhap|account|search|tim-kiem|sitemap|login|\/c\/|danh-muc|collection)/i;
const platform = (h) => [/cdn\.shopify\.com|Shopify\.theme/i.test(h) && "shopify", /haravan/i.test(h) && "haravan", /wp-content\/plugins\/woocommerce|woocommerce-Price/i.test(h) && "woocommerce", /Mage\.Cookies|data-mage-init|Magento_/i.test(h) && "magento", /__NUXT__/.test(h) && "nuxt", /__NEXT_DATA__/.test(h) && "next", /application\/ld\+json/.test(h) && "ld+json", /itemprop="price"/i.test(h) && "microdata", /data-price/i.test(h) && "data-price", /__INITIAL_STATE__|__APOLLO_STATE__|__PRELOADED_STATE__/.test(h) && "state-json", /id="root"|id="app"/.test(h) && "spa-root", /wp-content/.test(h) && "wordpress", /opencart|catalog\/view/i.test(h) && "opencart"].filter(Boolean).join(",") || "-";
async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "vi-VN,vi;q=0.9", accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  return { status: r.status, final: r.url, html: await r.text() };
}
const rows = [];
for (const s of sites) {
  try {
    const list = await get(s.url);
    const base = new URL(list.final);
    const seen = new Set([base.href]);
    const cands = [];
    for (const m of list.html.matchAll(/href="([^"#]+)"/g)) {
      try {
        const u = new URL(m[1].replace(/&amp;/g, "&"), base);
        const k = u.origin + u.pathname;
        if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "") || seen.has(k) || BAD.test(u.pathname) || u.pathname.split("/").filter(Boolean).length < 1) continue;
        seen.add(k);
        cands.push(k);
      } catch { /* bỏ */ }
    }
    // ưu tiên đường dẫn dài, nhiều gạch nối (thường là tên sản phẩm)
    cands.sort((a, b) => (b.split("-").length - a.split("-").length) || b.length - a.length);
    let found = 0, tried = 0;
    for (const url of cands) {
      if (found >= 3 || tried >= 14) break;
      tried++;
      let page;
      try { page = await get(url); } catch { continue; }
      if (page.status !== 200 || !PRICE_TXT.test(page.html) || !SELL.test(page.html)) continue;
      found++;
      const t0 = performance.now();
      const f = extractFacts(page.html, page.final, { model: "", name: "", brand: "" });
      const ms = Math.round(performance.now() - t0);
      const got = f.product.price;
      const txt = page.html.match(PRICE_TXT)?.[0] ?? "";
      const verdict = got ? "OK" : "THIẾU";
      rows.push({ site: s.name, url: page.final, platform: platform(page.html), price: got?.value ?? null, src: got?.source ?? "", name: (f.product.name || f.h1 || f.title).slice(0, 60), txt, verdict, ms, size: page.html.length });
      console.log(`${verdict.padEnd(6)} ${s.name.padEnd(24)} ${String(got?.value ?? "-").padStart(10)} ${(got?.source ?? "").padEnd(7)} ${String(ms).padStart(3)}ms [${platform(page.html)}] ${txt} | ${page.final.slice(0, 80)}`);
    }
    if (!found) { console.log(`${"KHÔNG".padEnd(6)} ${s.name.padEnd(24)} không gặp trang sản phẩm có giá trong HTML (thử ${tried} link, HTTP danh mục ${list.status}${list.status === 403 ? " bị chặn" : ""})`); rows.push({ site: s.name, verdict: "KHÔNG-THẤY", http: list.status }); }
  } catch (e) { console.log(`LỖI   ${s.name.padEnd(24)} ${e.message.slice(0, 70)}`); rows.push({ site: s.name, verdict: "LỖI" }); }
}
fs.writeFileSync(process.argv[3] || "dev/.probe.json", JSON.stringify(rows, null, 1));
const c = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\nTổng ${rows.length} dòng: OK ${c("OK")} · THIẾU ${c("THIẾU")} · không thấy sản phẩm ${c("KHÔNG-THẤY")} · lỗi ${c("LỖI")}`);
