import test from "node:test";
import assert from "node:assert/strict";
import { parseVnd, modelKey, normUrl, decodeEntities, median } from "../web/js/lib/text.js";
import { extractModel, detectCategory, detectBrand, makePlan, cacheKey } from "../web/js/lib/plan.js";
import { newEntry, ingestProduct, ingestCompare, ingestPage, addSource } from "../web/js/lib/entry.js";
import { summarize, recommend, priceStats, comparisonRows } from "../web/js/lib/aggregate.js";
import { answerFromCache, detectIntent } from "../web/js/lib/answer.js";
import { createMemoryStore } from "../web/js/lib/store.js";

test("parseVnd hiểu các kiểu viết giá", () => {
  assert.equal(parseVnd("12.990.000đ"), 12990000);
  assert.equal(parseVnd("12,990,000 ₫"), 12990000);
  assert.equal(parseVnd("12tr9"), 12900000);
  assert.equal(parseVnd("1.2 triệu"), 1200000);
  assert.equal(parseVnd("350k"), 350000);
  assert.equal(parseVnd(5490000), 5490000);
  assert.equal(parseVnd("liên hệ"), null);
});

test("extractModel lấy mã model, bỏ đơn vị", () => {
  assert.equal(extractModel("Máy rửa chén Bosch SHD4080 13 bộ"), "SHD4080");
  assert.equal(extractModel("Tai nghe Sony WH-1000XM5"), "WH-1000XM5");
  assert.equal(extractModel("Quạt 20000mAh 65W 4K"), "");
  assert.equal(extractModel("Sữa tươi Vinamilk 1L"), "");
});

test("detectCategory/detectBrand", () => {
  assert.equal(detectCategory("Máy khoan pin Makita DF333D"), "tech");
  assert.equal(detectCategory("Dầu gội Clear 650g"), "consumer");
  assert.equal(detectBrand("Máy khoan pin Makita DF333D"), "Makita");
  assert.equal(detectBrand("nồi chiên Philips HD9200"), "Philips");
});

test("makePlan sinh từ khóa có model trong ngoặc kép, hàng tiêu dùng không hỏi công nghệ", () => {
  const t = makePlan({ text: "Máy rửa chén Bosch SHD4080" });
  assert.equal(t.model, "SHD4080");
  assert.equal(t.category, "tech");
  assert.ok(t.queries.some((q) => q.includes('"SHD4080"')));
  assert.ok(t.queries.some((q) => /thông số|công nghệ/.test(q)));
  const c = makePlan({ text: "Dầu gội Clear 650g" });
  assert.equal(c.category, "consumer");
  assert.ok(!c.queries.some((q) => /công nghệ|thông số/.test(q)));
  assert.equal(makePlan({ text: "bút bi", category: "tech" }).category, "tech");
  assert.equal(cacheKey(makePlan({ text: "Bosch  SHD4080" })), cacheKey(makePlan({ text: "bosch shd4080" })));
});

test("normUrl bỏ tham số theo dõi", () => {
  assert.equal(normUrl("https://www.A.com/x/?utm_source=z&id=2#h"), "a.com/x?id=2");
  assert.equal(modelKey("WH-1000 xm5"), "WH1000XM5");
  assert.equal(decodeEntities("m&aacute;y &amp;ecirc; &#7847;"), "máy ê ầ");
});

function sampleEntry() {
  const plan = makePlan({ text: "Máy rửa chén Bosch SHD4080" });
  const e = newEntry(plan, cacheKey(plan));
  ingestProduct(e, {
    data: {
      category: "tech",
      product: { name: "Máy rửa chén Bosch SHD4080", brand: "Bosch", model: "SHD4080" },
      prices: [{ value: 21000000, source: "https://a.vn/p" }, { value: "20.500.000đ", source: "https://b.vn/p" }, { value: 22000000, source: "https://c.vn/p" }, { value: 90000, source: "https://d.vn/phukien" }],
      pros: [{ text: "Rửa sạch, tiết kiệm nước 9,5 lít mỗi lần", source: "https://a.vn/p" }, { text: "Rửa sạch, tiết kiệm nước 9,5 lít mỗi lần.", source: "https://b.vn/p" }],
      cons: [{ text: "Giá cao hơn dòng Electrolux cùng dung tích", source: "https://b.vn/p" }],
      technologies: [{ name: "Động cơ EcoSilence", benefit: "Êm", drawback: "Sửa chữa đắt", source: "https://a.vn/p" }],
    },
    sources: [{ url: "https://a.vn/p", title: "A" }],
    queries: ["bosch shd4080 giá"],
  });
  ingestCompare(e, {
    data: {
      alternatives: [
        { brand: "Electrolux", name: "ESF5512", model: "ESF5512", price: { value: 17000000, source: "https://e.vn/p" }, pros: [{ text: "Giá rẻ hơn", source: "https://e.vn/p" }, { text: "Nhiều chương trình rửa", source: "https://e.vn/p" }], cons: [{ text: "Ồn hơn", source: "https://e.vn/p" }], technologies: [{ name: "AirDry" }] },
        { brand: "Samsung", name: "DW60", model: "DW60M5050", price: { value: 24000000 }, pros: [], cons: [{ text: "Ít ưu điểm nổi bật", source: "https://s.vn/p" }, { text: "Bảo hành ngắn", source: "https://s.vn/p" }], technologies: [] },
      ],
    },
  });
  return e;
}

test("tổng hợp giá loại giá phụ kiện lệch hẳn, gộp ưu điểm trùng, ghi nhiều nguồn", () => {
  const e = sampleEntry();
  const s = summarize(e);
  assert.equal(s.price.count, 3);
  assert.equal(s.price.dropped.length, 1);
  assert.equal(s.price.median, 21000000);
  assert.equal(s.pros.length, 1);
  assert.equal(s.pros[0].srcIds.length, 2);
  assert.equal(s.tech.length, 1);
});

test("hàng tiêu dùng không có mục công nghệ", () => {
  const e = sampleEntry();
  e.category = "consumer";
  assert.equal(summarize(e).tech.length, 0);
  assert.match(answerFromCache(e, "công nghệ gì", "tech").text, /không phân tích công nghệ/);
});

test("recommend chọn phương án cân bằng giá/ưu nhược và nêu lý do", () => {
  const e = sampleEntry();
  const rec = recommend(e);
  assert.equal(rec.rows.length, 3);
  assert.equal(rec.best.brand, "Electrolux");
  assert.equal(rec.cheapest.brand, "Electrolux");
  assert.ok(rec.reasons.length >= 2);
  assert.ok(rec.rows.every((r, i, a) => i === 0 || a[i - 1].score >= r.score));
});

test("answerFromCache trả lời ngắn có nguồn [n]", () => {
  const e = sampleEntry();
  assert.equal(detectIntent("Nhược điểm của nó là gì?"), "cons");
  assert.equal(detectIntent("giá bao nhiêu"), "price");
  assert.equal(detectIntent("có nên chọn không"), "choose");
  assert.equal(detectIntent("bảo hành mấy năm"), null);
  const price = answerFromCache(e, "giá bao nhiêu");
  assert.match(price.text, /21\.000\.000/);
  assert.match(price.text, /\[\d+\]/);
  assert.match(answerFromCache(e, "nên chọn cái nào").text, /Nên chọn: Electrolux/);
});

test("ingestPage ghi log, gộp giá/ưu/nhược/ảnh và bỏ qua trang hỏng", () => {
  const e = sampleEntry();
  ingestPage(e, { ok: true, url: "https://z.vn/p", domain: "z.vn", title: "Z", relevant: true, product: { price: { value: 20800000, source: "jsonld" } }, pros: ["Vận hành rất êm"], cons: ["Khó mua phụ kiện"], tech: [], images: [{ url: "https://z.vn/i.jpg", alt: "a", score: 5 }] });
  ingestPage(e, { ok: false, url: "https://bad.vn", error: "HTTP 403" });
  ingestPage(e, { ok: true, url: "https://off.vn/p", domain: "off.vn", relevant: false, product: { price: { value: 5 } }, pros: ["không dùng"], images: [] });
  assert.equal(e.pages.length, 3);
  assert.equal(e.images.length, 1);
  assert.ok(e.pros.some((p) => p.text === "Vận hành rất êm"));
  assert.ok(!e.pros.some((p) => p.text === "không dùng"));
  assert.ok(e.log.some((l) => /Bỏ qua/.test(l.msg)));
  assert.equal(summarize(e).sourcesFailed, 1);
});

test("store: xuất/nạp một file cache", async () => {
  const st = createMemoryStore();
  const e = sampleEntry();
  await st.save(e);
  const data = await st.exportAll();
  const st2 = createMemoryStore();
  assert.equal(await st2.importAll(data), 1);
  assert.equal((await st2.get(e.key)).product.brand, "Bosch");
  await assert.rejects(() => st2.importAll({ foo: 1 }));
});

test("từ khóa tìm lấy đúng chuỗi người dùng gõ trước, cắt gọn sau", async () => {
  const { makePlan, extractModel, exactQuery } = await import("../web/js/lib/plan.js");
  const { aiQuery } = await import("../web/js/lib/aitext.js");
  const { shopQuery } = await import("../web/js/lib/hybrid.js");
  const typed = "Laptop Dell Inspiron 15 3520 i5-1235U 16GB giá rẻ";
  const plan = makePlan({ text: typed });
  assert.equal(plan.query, typed);
  assert.equal(plan.queries[0], typed + " giá bán", "từ khóa đầu tiên là chuỗi gốc");
  assert.ok(aiQuery(plan, 0).startsWith(typed), "Google Chế độ AI hỏi đúng chữ đã gõ");
  assert.ok(aiQuery(plan, 1).startsWith(typed));
  assert.ok(shopQuery(plan, 0).startsWith(typed), "lần đầu tìm cửa hàng bằng chuỗi gốc");
  const p2 = makePlan({ text: "Nồi chiên không dầu Sunhouse SHD4030 giá rẻ nhất" });
  assert.ok(shopQuery(p2, 0).startsWith("Nồi chiên không dầu Sunhouse SHD4030 giá rẻ nhất"));
  assert.ok(shopQuery(p2, 1).startsWith("Sunhouse SHD4030 "), "lần bổ sung mới dùng bản cắt gọn: " + shopQuery(p2, 1));
  assert.notEqual(extractModel(typed), "i5-1235U", "thông số CPU không phải mã model");
  assert.equal(extractModel("Máy lạnh Daikin FTKF25XVMV R32 2.5HP"), "FTKF25XVMV");
  assert.equal(exactQuery("  a   b \n c "), "a b c");
  assert.ok(exactQuery("từ ".repeat(200)).length <= 160);
});
