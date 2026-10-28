// Đọc trang bằng ảnh chụp + OCR (lớp dự phòng cuối): phân tích chữ OCR, chọn trang cần đọc, đi qua pipeline, máy chủ chụp ảnh.
import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../worker/index.js";
import { mockPages } from "../dev/mock-pages.mjs";
import { createApi } from "../web/js/lib/api.js";
import { research } from "../web/js/lib/pipeline.js";
import { createMemoryStore } from "../web/js/lib/store.js";
import { parseVisual, needsVisual, visualPage, priceFromOcrLines } from "../web/js/lib/visualpage.js";
import { tableRows } from "../web/js/lib/offers.js";

const OCR_LISTING = `Sữa Rửa Mặt (443)
Mới nhất Bán chạy Giá thấp đến cao
370.000 đ 490.000 đ
CeraVe
Sữa Rửa Mặt CeraVe Sạch Sâu Foaming Cleanser
4.9 (116) 1.4k/tháng
345.000 đ 499.000 đ
Cetaphil
Sữa Rửa Mặt Cetaphil Dịu Là`;

const OCR_PRODUCT = `Trang chủ > Sữa tươi
Sữa tươi tiệt trùng Vinamilk ít đường lốc 4 hộp x 110ml
Thương hiệu: Vinamilk
Giảm 10% khi thanh toán qua ví
21.900 đ 24.000 đ
Trả góp 0% từ 3.000.000 đ
Thêm vào giỏ hàng`;

test("OCR trang sản phẩm: lấy đúng giá ngay sau tên sản phẩm, bỏ dòng giảm giá/trả góp; xác nhận đúng sản phẩm", () => {
  const v = parseVisual(OCR_PRODUCT, { name: "sữa tươi vinamilk ít đường 110ml" });
  assert.equal(v.ok, true);
  assert.equal(v.price, 21900);
  assert.equal(v.relevant, true, "điểm tên " + v.nameScore);
  assert.match(v.title, /Vinamilk/);
  // sản phẩm khác thì không coi là đúng
  assert.equal(parseVisual(OCR_PRODUCT, { name: "máy lọc nước Kangaroo KG100A" }).relevant, false);
});

test("OCR thật (WinMart): ký hiệu ₫ bị đọc thành ¢, dòng miễn phí vận chuyển 'từ 300.000đ' không được nhầm là giá", () => {
  const text = `Trang chủ / Sữa tươi tiệt trùng Vinamilk ít đường lốc 4 hop x 110ml.
Sữa tươi tiệt trùng Vinamilk ít đường lốc 4 hộp x 110ml
SKU: 10602909
Giá bán le 21.900 ¢
Tinh trang Con hang
Vận chuyển Miễn phí giao hang cho đơn từ 300.000đ.
Số lượng -ị +`;
  const v = parseVisual(text, { name: "Sữa tươi tiệt trùng Vinamilk ít đường lốc 4 hộp x 110ml" });
  assert.equal(v.price, 21900);
  // trang chỉ có dòng vận chuyển: không đoán giá từ đó
  assert.equal(parseVisual("Mô tả sản phẩm dài đủ chữ để không bị coi là trống rỗng ở đây\nVận chuyển Miễn phí giao hang cho đơn từ 300.000đ.\nBảo hành 12 tháng chính hãng", { name: "áo thun" }).price, null);
  // ảnh chụp là trang lỗi kết nối của chính dịch vụ chụp ảnh: không phải nội dung trang
  assert.equal(parseVisual("This site can't be reached\nThe webpage at https://www.dienmayxanh.com/may-lanh might be temporarily down\nERR TUNNEL CONNECHION FAILED", {}).ok, false);
});

test("OCR trang danh sách nhiều giá: không đoán bừa giá; chỉ nhận khi gần tên sản phẩm hoặc chỉ có 1–2 mức giá", () => {
  const lines = OCR_LISTING.split("\n");
  assert.equal(priceFromOcrLines(lines, "sữa rửa mặt cetaphil dịu lành"), 345000, "gần dòng tên Cetaphil");
  assert.equal(priceFromOcrLines(lines, "xyz abc"), null, "nhiều mức giá và không khớp tên thì không chọn");
  assert.equal(priceFromOcrLines(["Giá 1.250.000 đ", "mô tả"], "bơm"), 1250000, "chỉ một mức giá");
});

test("không vượt CAPTCHA: ảnh chụp là trang xác minh/chặn hoặc trống thì bỏ qua", () => {
  const chal = parseVisual("Khoan đã...\nVui lòng chọn ô bên dưới để tiếp tục truy cập coolmate.me\nVerifying...\nCloudflare\nHãy hoàn thành CAPTCHA để chứng minh bạn không phải là robot", { name: "áo thun" });
  assert.deepEqual([chal.ok, chal.reason], [false, "challenge"]);
  assert.deepEqual([parseVisual("", {}).ok, parseVisual("a b", {}).reason], [false, "empty"]);
});

test("needsVisual: chỉ trang tải giá bằng JavaScript hoặc bị chặn; không phải trang liên hệ báo giá hay đã có giá", () => {
  assert.equal(needsVisual({ ok: true, product: {}, priceHint: "js" }), true);
  assert.equal(needsVisual({ ok: true, product: {}, priceHint: "contact" }), false);
  assert.equal(needsVisual({ ok: true, product: { price: { value: 1 } }, priceHint: "js" }), false);
  assert.equal(needsVisual({ ok: false, blocked: true }), true);
  assert.equal(needsVisual({ ok: false, error: "HTTP 404" }), false);
  assert.equal(needsVisual(null), false);
  const p = visualPage("https://shop.vn/a", { title: "Áo thun", nameScore: 0.8, relevant: true, price: 199000 }, { ok: false, blocked: true });
  assert.equal(p.ok, true); assert.equal(p.visual, true); assert.deepEqual(p.product.price, { value: 199000, source: "ocr" }); assert.equal(p.domain, "shop.vn");
});

// ---- chạy qua pipeline ----
const ORIGIN = "http://localhost:8787";
const pages = mockPages(ORIGIN);
const realFetch = globalThis.fetch;
function fakeFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const u = new URL(url);
  if (u.pathname.startsWith("/api/")) return handle(new Request(url, init), { MOCK: "1", ALLOW_LOCAL: "1" });
  if (u.pathname.startsWith("/mock/img/")) return Promise.resolve(new Response("png", { headers: { "content-type": "image/png" } }));
  const html = pages[u.pathname];
  return Promise.resolve(html ? new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("nf", { status: 404 }));
}
test.before(() => { globalThis.fetch = fakeFetch; });
test.after(() => { globalThis.fetch = realFetch; });
const base = createApi(() => ({ apiBase: ORIGIN }), fakeFetch);
// trang cửa hàng A trở thành "trang tải giá bằng JavaScript" (không có giá trong HTML)
const jsApi = { ...base, page: async (url, hint, sig, opts) => { const r = await base.page(url, hint, sig, opts); return /shop-a/.test(url) && r.ok ? { ...r, product: { ...r.product, price: null }, priceHint: "js" } : r; } };

test("pipeline: trang không có giá trong HTML được đọc bằng ảnh chụp + OCR, giá nguồn 'ocr', ghi log; giới hạn số trang; tắt được", async () => {
  const asked = [];
  const visualRead = async (url, hint) => { asked.push(url); return { ok: true, title: "Nồi chiên Zeta ZF-500", nameScore: 0.9, relevant: true, price: 2390000 }; };
  const e = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api: jsApi, store: createMemoryStore(), visualRead, visualPages: 2 });
  assert.equal(asked.length, 1, "chỉ trang tải giá bằng JavaScript được chụp");
  assert.match(asked[0], /shop-a/);
  const row = tableRows(e).find((r) => /shop-a|localhost/.test(r.url) && r.priceVia === "ocr");
  assert.ok(row, "có dòng NCC giá đọc từ ảnh chụp");
  assert.equal(row.price, 2390000);
  assert.equal(row.read, true);
  assert.ok(e.log.some((l) => /Đọc bằng ảnh chụp \(OCR\)/.test(l.msg) && /cần kiểm tra/.test(l.msg)));
  // ảnh chụp là trang xác minh: bỏ qua, ghi log, không có giá OCR
  const chal = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api: jsApi, store: createMemoryStore(), visualRead: async () => ({ ok: false, reason: "challenge" }), visualPages: 2 });
  assert.ok(chal.log.some((l) => /không vượt CAPTCHA/.test(l.msg)));
  assert.ok(!tableRows(chal).some((r) => r.priceVia === "ocr"));
  // tắt (visualPages 0): không chụp
  const off = [];
  await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api: jsApi, store: createMemoryStore(), visualRead: async (u) => { off.push(u); return null; }, visualPages: 0 });
  assert.equal(off.length, 0);
});

test("máy chủ /api/shot: chặn địa chỉ nội bộ, trả ảnh từ dịch vụ chụp ảnh, không phải ảnh thì lỗi", async () => {
  const post = (body, env, f) => { const prev = globalThis.fetch; if (f) globalThis.fetch = f; return handle(new Request("http://x/api/shot", { method: "POST", body: JSON.stringify(body) }), env).finally(() => { globalThis.fetch = prev; }); };
  assert.equal((await post({ url: "http://10.0.0.1/a" }, {})).status, 400);
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  let called = "";
  const ok = await post({ url: "https://shop.vn/p/abc?x=1" }, {}, async (u) => { called = String(u); return new Response(png, { headers: { "content-type": "image/png" } }); });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.ok(called.startsWith("https://image.thum.io/get/") && called.endsWith("https://shop.vn/p/abc?x=1"));
  assert.equal((await ok.arrayBuffer()).byteLength, 7);
  const bad = await post({ url: "https://shop.vn/p" }, { SHOT_RETRY_MS: "1" }, async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
  assert.equal(bad.status, 502);
  // dịch vụ thứ nhất bị chặn (403) -> sang mShots; lần đầu mShots trả ảnh chờ (GIF nhỏ) -> đợi rồi lấy ảnh thật
  const calls = [];
  const gif = new Uint8Array(8737).fill(71);
  const jpg = new Uint8Array(50_000).fill(255);
  const queued = await post({ url: "https://shop.vn/p" }, { SHOT_RETRY_MS: "1" }, async (u) => {
    calls.push(String(u));
    if (String(u).includes("thum.io")) return new Response("no", { status: 403 });
    return calls.filter((c) => c.includes("mshots")).length === 1 ? new Response(gif, { headers: { "content-type": "image/gif" } }) : new Response(jpg, { headers: { "content-type": "image/jpeg" } });
  });
  assert.equal(queued.status, 200);
  assert.equal(queued.headers.get("x-shot-provider"), "mshots");
  assert.equal(queued.headers.get("content-type"), "image/jpeg");
  assert.equal(calls.filter((c) => c.includes("mshots")).length, 2, "thử lại sau ảnh chờ");
  assert.ok(calls[1].includes(encodeURIComponent("https://shop.vn/p")));
});
