// Tìm vài link sản phẩm thật trên các website mẫu (nhiều kiểu nền tảng) để chạy thử trích giá: node dev/discover.mjs
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SITES = [
  ["thegioididong (ASP.NET)", "https://www.thegioididong.com/dtdd"],
  ["dienmayxanh", "https://www.dienmayxanh.com/may-lanh"],
  ["cellphones", "https://cellphones.com.vn/mobile.html"],
  ["hoanghamobile", "https://hoanghamobile.com/dien-thoai-di-dong"],
  ["nguyenkim (Magento)", "https://www.nguyenkim.com/may-lanh-may-dieu-hoa/"],
  ["fptshop", "https://fptshop.com.vn/dien-thoai"],
  ["phongvu", "https://phongvu.vn/c/laptop"],
  ["tiki", "https://tiki.vn/dien-thoai-may-tinh-bang/c1789"],
  ["bachhoaxanh", "https://www.bachhoaxanh.com/sua-tuoi"],
  ["concung", "https://concung.com/sua-bot-cong-thuc.html"],
  ["bibomart", "https://bibomart.com.vn/sua"],
  ["kidsplaza (Magento)", "https://kidsplaza.vn/sua-bot"],
  ["shopee", "https://shopee.vn/Sữa-bột-cat.11036993"],
  ["lazada", "https://www.lazada.vn/sua-bot/"],
  ["coolmate", "https://www.coolmate.me/collection/ao-thun-nam"],
  ["shopdunk (Haravan?)", "https://shopdunk.com/iphone"],
  ["hasaki", "https://hasaki.vn/danh-muc/sua-rua-mat-c19.html"],
  ["guardian", "https://www.guardian.com.vn/vi/cham-soc-co-the"],
  ["mediamart", "https://mediamart.vn/tu-lanh"],
  ["pico", "https://pico.vn/tu-lanh"],
  ["nhathuocankhang", "https://www.nhathuocankhang.com/thuc-pham-chuc-nang"],
  ["longchau", "https://nhathuoclongchau.com.vn/thuc-pham-chuc-nang"],
  ["winmart", "https://winmart.vn/categories/thuc-pham-tuoi-song--s10"],
  ["vatgia-like thietbi", "https://thietbidiencongnghiep.com/"],
];
const PRODUCT = /(\/san-pham\/|\/product|\/products\/|\/p\/|\/dtdd\/|-p\d{3,}|\.html$|-\d{5,}|\/may-lanh\/|\/tu-lanh\/|\/iphone)/i;
async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "vi-VN,vi;q=0.9", accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  return { status: r.status, final: r.url, html: await r.text() };
}
const out = [];
for (const [name, url] of SITES) {
  try {
    const { status, final, html } = await get(url);
    const base = new URL(final);
    const links = new Set();
    for (const m of html.matchAll(/href="([^"#]+)"/g)) {
      try { const u = new URL(m[1].replace(/&amp;/g, "&"), base); if (u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "") && PRODUCT.test(u.pathname) && u.pathname.split("/").filter(Boolean).length >= 2 && u.href !== base.href) links.add(u.href.split("?")[0]); } catch { /* bỏ */ }
    }
    const picks = [...links].filter((l) => l.length > base.origin.length + 12).slice(0, 3);
    console.log(`${name.padEnd(26)} HTTP ${status} ${String(html.length).padStart(7)}B -> ${picks.length} link`);
    out.push({ name, status, picks });
  } catch (e) { console.log(`${name.padEnd(26)} LỖI ${e.message.slice(0, 60)}`); out.push({ name, status: 0, picks: [] }); }
}
import fs from "node:fs";
fs.writeFileSync(process.argv[2] || "dev/.sites.json", JSON.stringify(out, null, 1));
