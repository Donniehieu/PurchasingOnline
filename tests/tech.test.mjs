// So sánh công nghệ giữa các hãng: gom theo công nghệ, ưu/nhược điểm của từng công nghệ, có nguồn.
import test from "node:test";
import assert from "node:assert/strict";
import { techKey, technologyComparison } from "../web/js/lib/aggregate.js";
import { newEntry, ingestProduct, ingestCompare } from "../web/js/lib/entry.js";
import { makePlan, cacheKey } from "../web/js/lib/plan.js";
import { answerFromCache, detectIntent } from "../web/js/lib/answer.js";
import { renderTech } from "../web/js/render.js";

function sample(text = "Nồi chiên không dầu Zeta ZF-500") {
  const plan = makePlan({ text });
  const e = newEntry(plan, cacheKey(plan));
  ingestProduct(e, {
    data: {
      category: plan.category,
      product: { name: text, brand: "Zeta", model: "ZF-500" },
      prices: [{ value: 2490000, source: "https://a.vn/p" }],
      pros: [{ text: "Công nghệ Rapid Air giúp thức ăn chín đều, giòn ngoài mềm trong", source: "https://a.vn/p" }, { text: "Làm nóng nhanh chỉ hai phút", source: "https://a.vn/p" }],
      cons: [{ text: "Rapid Air làm quạt chạy ồn ở mức nhiệt cao", source: "https://b.vn/p" }],
      technologies: [{ name: "Công nghệ Rapid Air 360 độ (Đối lưu khí nóng)", benefit: "Luồng khí nóng đều, chiên giòn không cần dầu", drawback: "", source: "https://a.vn/p" }, { name: "Eco Heat", benefit: "Tiết kiệm điện", drawback: "Kéo dài thời gian làm nóng", source: "https://a.vn/p" }],
    },
    sources: [{ url: "https://a.vn/p" }, { url: "https://b.vn/p" }],
  });
  ingestCompare(e, {
    data: {
      alternatives: [
        { brand: "Aurora", name: "AF-300", model: "AF-300", price: { value: 1990000, source: "https://c.vn/p" }, pros: [{ text: "Nhỏ gọn, dễ cất", source: "https://c.vn/p" }], cons: [], technologies: [{ name: "Rapid Air", benefit: "Chín đều", drawback: "Tiếng ồn lớn hơn quạt thường", source: "https://c.vn/p" }, { name: "Turbo Heat", benefit: "Làm nóng nhanh", drawback: "Không có chế độ nướng" }] },
        { brand: "Nimbus", name: "NB-450", model: "NB-450", price: { value: 3190000, source: "https://d.vn/p" }, pros: [{ text: "Có cửa sổ Vision Window nhìn thức ăn không cần mở nắp", source: "https://d.vn/p" }], cons: [], technologies: [{ name: "Vision Window", benefit: "Quan sát không mở nắp", drawback: "Kính nóng khi dùng lâu" }, { name: "Công nghệ Rapid Air", benefit: "", drawback: "" }] },
        { brand: "Kora", name: "KR-700", model: "KR-700", price: { value: 2790000, source: "https://e.vn/p" }, pros: [], cons: [], technologies: [] },
      ],
    },
    sources: [{ url: "https://c.vn/p" }, { url: "https://d.vn/p" }, { url: "https://e.vn/p" }],
  });
  return e;
}

test("techKey gom các cách viết của một công nghệ", () => {
  assert.equal(techKey("Công nghệ Rapid Air 360 độ (Đối lưu khí nóng)"), "rapid air");
  assert.equal(techKey("RAPID AIR"), "rapid air");
  assert.equal(techKey("Công nghệ Inverter 2.0"), "inverter");
  assert.equal(techKey("Turbo Heat"), "turbo heat");
  assert.equal(techKey("Wi-Fi 6E"), "wi fi");
});

test("technologyComparison: gom theo công nghệ, hãng dùng chung/riêng, ưu & nhược điểm có nguồn", () => {
  const tc = technologyComparison(sample());
  assert.equal(tc.applicable, true);
  const names = tc.clusters.map((c) => c.name);
  assert.deepEqual(names.slice(0, 1), ["Rapid Air"], "công nghệ dùng chung nhiều hãng nhất đứng đầu");
  assert.ok(["Eco Heat", "Turbo Heat", "Vision Window"].every((n) => names.includes(n)));

  const rapid = tc.clusters.find((c) => c.name === "Rapid Air");
  assert.equal(rapid.shared, true);
  assert.deepEqual(rapid.brands.map((b) => b.brand).sort(), ["Aurora", "Nimbus", "Zeta"]);
  assert.ok(rapid.brands.find((b) => b.brand === "Zeta").isMain);
  // ưu điểm: từ mô tả công nghệ và từ câu ưu điểm có nhắc tên công nghệ
  assert.ok(rapid.benefits.some((b) => /Luồng khí nóng đều/.test(b.text) && b.brand === "Zeta"));
  assert.ok(rapid.benefits.some((b) => /Công nghệ Rapid Air giúp thức ăn chín đều/.test(b.text)));
  assert.ok(rapid.benefits.some((b) => b.brand === "Aurora" && /Chín đều/.test(b.text)));
  // nhược điểm: từ hãng khác và từ câu nhược điểm có nhắc tên công nghệ
  assert.ok(rapid.drawbacks.some((d) => /Tiếng ồn lớn hơn/.test(d.text) && d.brand === "Aurora"));
  assert.ok(rapid.drawbacks.some((d) => /quạt chạy ồn/.test(d.text) && d.brand === "Zeta"));
  // mỗi ý có nguồn
  assert.ok([...rapid.benefits, ...rapid.drawbacks].every((x) => x.srcIds.length >= 1), "ý nào cũng kèm nguồn");

  const vision = tc.clusters.find((c) => c.name === "Vision Window");
  assert.equal(vision.shared, false);
  assert.deepEqual(vision.brands.map((b) => b.brand), ["Nimbus"]);

  // tóm tắt
  const s = tc.summary.join("\n");
  assert.match(s, /Nhận diện \d+ công nghệ trên 3\/4 hãng/);
  assert.match(s, /Dùng chung nhiều hãng: Rapid Air \(.*Zeta.*\)/);
  assert.match(s, /Riêng từng hãng:.*Vision Window \(Nimbus\)/);
  assert.match(s, /Hạn chế cần lưu ý:/);
  assert.ok(tc.brands.find((b) => b.brand === "Kora").count === 0, "hãng chưa có dữ liệu công nghệ vẫn được liệt kê");
});

test("hàng tiêu dùng không có so sánh công nghệ", () => {
  const e = sample("Dầu gội Clear 650g");
  e.category = "consumer";
  const tc = technologyComparison(e);
  assert.equal(tc.applicable, false);
  assert.equal(tc.clusters.length, 0);
  assert.match(renderTech(e), /không phân tích công nghệ/);
});

test("renderTech hiện tóm tắt, từng công nghệ với hãng, ưu/nhược điểm và chip nguồn; thoát ký tự nguy hiểm", () => {
  const e = sample();
  e.alternatives[0].tech.push({ name: "<img src=x onerror=alert(1)>", benefit: "<script>x</script>", drawback: "", srcId: null });
  const html = renderTech(e);
  assert.match(html, /Tóm tắt so sánh công nghệ/);
  assert.match(html, /Rapid Air/);
  assert.match(html, /3 hãng dùng chung/);
  assert.match(html, /Ưu điểm của công nghệ/);
  assert.match(html, /Nhược điểm của công nghệ/);
  assert.match(html, /class="src/);
  assert.ok(!/<img src=x/.test(html) && !/<script>/.test(html));
});

test("hỏi đáp: 'so sánh công nghệ' trả lời ngắn từ dữ liệu đã lưu, có nguồn", () => {
  const e = sample();
  for (const q of ["So sánh công nghệ giữa các hãng", "công nghệ nào khác nhau giữa các hãng", "hãng nào dùng công nghệ gì"]) assert.equal(detectIntent(q), "techcmp", q);
  assert.equal(detectIntent("công nghệ gì"), "tech");
  assert.equal(detectIntent("ưu điểm"), "pros");
  const a = answerFromCache(e, "so sánh công nghệ các hãng");
  assert.match(a.text, /So sánh công nghệ giữa 4 hãng/);
  assert.match(a.text, /Rapid Air \(.*Zeta.*Aurora.*\)/);
  assert.match(a.text, /\[\d+\]/);
  assert.ok(a.srcIds.length > 0);
  e.category = "consumer";
  assert.match(answerFromCache(e, "so sánh công nghệ").text, /không phân tích công nghệ/);
});
