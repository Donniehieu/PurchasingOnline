// Đọc sâu bằng AI: chỉ giữ ý có câu trích nguyên văn thật trong trang; gộp vào mục Cách dùng, thông số, ưu/nhược điểm.
import test from "node:test";
import assert from "node:assert/strict";
import { deepRead, sanitize } from "../worker/page-ai.js";
import { pageMainText } from "../web/js/lib/extract.js";
import { makePlan } from "../web/js/lib/plan.js";
import { newEntry, ingestPage } from "../web/js/lib/entry.js";
import { summarize } from "../web/js/lib/aggregate.js";

const PAGE = `<html><body><nav>Menu</nav><h1>Mỏ lết UM30XG</h1><p>Không sử dụng mỏ lết làm búa và không dùng búa đóng vào mỏ lết.</p><ul><li><strong>Mở ngàm:</strong> Xoay bánh điều chỉnh để ngàm lớn hơn chi tiết.</li></ul></body></html>`;

test("sanitize bỏ ý không có câu trích thật trong trang (chống bịa)", () => {
  const text = pageMainText(PAGE);
  const out = sanitize({
    limits: [{ text: "Không dùng làm búa", quote: "Không sử dụng mỏ lết làm búa và không dùng búa" }, { text: "Chịu nhiệt 500 độ", quote: "chịu nhiệt tới 500 độ C" }],
    usage: [{ text: "Xoay bánh để mở ngàm", quote: "Mở ngàm: Xoay bánh điều chỉnh để ngàm lớn hơn chi tiết." }],
    specs: [{ k: "Trọng lượng", v: "999g", quote: "" }],
  }, text);
  assert.deepEqual(out.limits, ["Không dùng làm búa"]);
  assert.equal(out.usage.length, 1);
  assert.equal(out.specs.length, 0);
});

test("deepRead gửi chữ trang cho Gemini và trả ý đã kiểm chứng; lỗi AI không làm hỏng việc đọc trang", async () => {
  const sent = [];
  const reply = { specs: [], features: [], limits: [{ text: "Không dùng làm búa", quote: "Không sử dụng mỏ lết làm búa" }], usage: [{ text: "Mở ngàm bằng bánh xoay", quote: "Xoay bánh điều chỉnh để ngàm lớn hơn chi tiết" }], tech: [] };
  const ok = await deepRead({ sel: { provider: "gemini", key: "k", model: "m" }, text: pageMainText(PAGE), hint: { name: "Mỏ lết UM30XG" }, fetchImpl: async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) }; } });
  assert.ok(ok.ok);
  assert.match(sent[0].contents[0].parts.at(-1).text, /Xoay bánh điều chỉnh/);
  assert.equal(ok.data.usage.length, 1);
  const bad = await deepRead({ sel: { provider: "gemini", key: "k", model: "m" }, text: "x".repeat(300), fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  assert.equal(bad.ok, false);
});

test("trang đọc sâu: cách dùng, thông số và hạn chế vào kết quả, có nguồn", () => {
  const e = newEntry(makePlan({ text: "Mỏ lết UM30XG" }), "k");
  ingestPage(e, { ok: true, url: "https://shop.vn/a", finalUrl: "https://shop.vn/a", domain: "shop.vn", title: "t", relevant: true, matched: {}, product: {}, images: [], pros: ["Ngàm mở 8–30mm"], cons: ["Không dùng làm búa"], usage: ["Xoay bánh để mở ngàm", "Chỉnh sát ngàm trước khi tạo lực"], specs: [{ k: "Trọng lượng", v: "170g" }], tech: [], deep: { ok: true, model: "m", chars: 500, images: 1 } }, {});
  const s = summarize(e);
  assert.equal(s.usage.length, 2);
  assert.equal(s.usage[0].srcIds.length, 1);
  assert.equal(e.specs[0].name, "Trọng lượng");
  assert.equal(s.cons.length, 1);
});
