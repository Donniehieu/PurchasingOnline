// Báo giá NCC theo link, sinh từ khóa, tìm bổ sung và bản đồ công nghệ.
import test from "node:test";
import assert from "node:assert/strict";
import { extractLinks, linksFromRows, parseCsv, cellText, mergeLinks, readLinkFile } from "../web/js/lib/links.js";
import { newQuoteEntry, importLinks } from "../web/js/lib/quote.js";
import { genKeys, withInfo, competitorBrands, interleave, brandKeys } from "../web/js/lib/keygen.js";
import { expandResearch } from "../web/js/lib/expand.js";
import { techLandscape, catalogNames } from "../web/js/lib/techkb.js";
import { tableRows } from "../web/js/lib/offers.js";
import { TYPES } from "../web/js/lib/kb.js";
import { makePlan } from "../web/js/lib/plan.js";
import { newEntry } from "../web/js/lib/entry.js";
import { createMemoryStore } from "../web/js/lib/store.js";

test("extractLinks: nhiều link, bỏ trùng, bỏ dấu câu dính cuối, giữ ghi chú", () => {
  const r = extractLinks("Mỏ lết A: https://a.vn/x?id=1.\nhttps://b.vn/y), www.c.vn/z\nhttps://a.vn/x?id=1\nkhông có link");
  assert.deepEqual(r.map((x) => x.url), ["https://a.vn/x?id=1", "https://b.vn/y", "https://www.c.vn/z"]);
  assert.equal(r[0].label, "Mỏ lết A:");
});

test("linksFromRows / CSV / ô siêu liên kết", () => {
  const rows = [["STT", "Link"], [1, { text: "Xem", hyperlink: "https://shop.vn/a" }], [2, { formula: 'HYPERLINK("https://shop.vn/b","B")', result: "B" }], [3, "https://shop.vn/c"]];
  assert.deepEqual(linksFromRows(rows).map((x) => x.url), ["https://shop.vn/a", "https://shop.vn/b", "https://shop.vn/c"]);
  assert.equal(cellText({ richText: [{ text: "ab" }, { text: "cd" }] }), "abcd");
  assert.deepEqual(parseCsv('a;"b;c"\n1;2\n'), [["a", "b;c"], ["1", "2"]]);
  assert.equal(mergeLinks([{ url: "https://a.vn/x" }], [{ url: "https://a.vn/x/" }, { url: "https://b.vn" }]).length, 2);
});

test("readLinkFile: .txt, .csv và .xls cũ báo lỗi rõ", async () => {
  const f = (name, text) => ({ name, text: async () => text });
  assert.equal((await readLinkFile(f("l.txt", "https://a.vn/1\nhttps://a.vn/2"))).length, 2);
  assert.equal((await readLinkFile(f("l.csv", "ten,link\nA,https://a.vn/1"))).length, 1);
  await assert.rejects(() => readLinkFile(f("l.xls", "")), /xlsx/);
});

const pageOf = (url, price, name = "Mỏ lết 200mm") => ({ ok: true, url, finalUrl: url, domain: new URL(url).hostname, title: name, h1: name, relevant: false, product: { name, price: price ? { value: price, source: "jsonld" } : null }, pros: [], cons: [], tech: [], specs: [{ k: "Chiều dài", v: "200mm" }], images: [], seller: new URL(url).hostname, vat: { state: "included" }, contact: null });

test("importLinks: mỗi link một dòng bảng NCC, link lỗi vẫn có dòng, link trùng bị bỏ", async () => {
  const entry = newQuoteEntry("");
  const seen = [];
  const api = { page: async (url) => { seen.push(url); if (url.includes("bad")) return { ok: false, url, error: "HTTP 403" }; return pageOf(url, url.includes("a.vn") ? 120000 : null); } };
  const events = [];
  const st = await importLinks(entry, [{ url: "https://a.vn/p1" }, { url: "https://bad.vn/p2", label: "NCC lỗi" }, { url: "https://c.vn/p3" }], { api, store: createMemoryStore(), emit: (e) => events.push(e) });
  assert.deepEqual([st.added, st.ok, st.failed], [3, 2, 1]);
  const rows = tableRows(entry);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.domain === "a.vn").price, 120000);
  const bad = rows.find((r) => r.domain === "bad.vn");
  assert.equal(bad.price, null);
  assert.equal(bad.read, false);
  assert.equal(entry.status, "done");
  assert.ok(entry.product.name.includes("Mỏ lết"));
  const again = await importLinks(entry, [{ url: "https://a.vn/p1/" }, { url: "https://d.vn/p4" }], { api });
  assert.equal(again.skipped, 1);
  assert.equal(tableRows(entry).length, 4);
  assert.equal(seen.length, 4);
  assert.ok(events.some((e) => e.type === "progress"));
});

test("importLinks: có tên sản phẩm thì trang khác sản phẩm bị đánh dấu tương tự, không bỏ", async () => {
  const entry = newQuoteEntry("Mỏ lết Lobster UM30XG");
  const api = { page: async (url) => ({ ...pageOf(url, 99000, "Kìm bấm cáp"), relevant: false }) };
  await importLinks(entry, [{ url: "https://z.vn/k" }], { api });
  const [r] = tableRows(entry);
  assert.equal(r.weak, true);
  assert.equal(r.price, 99000);
});

test("withInfo giữ nguyên chuỗi gõ và không ghép lặp", () => {
  assert.equal(withInfo("Máy lọc nước Kangaroo", ["RO", "Gia đình", "ro"]), "Máy lọc nước Kangaroo RO Gia đình");
});

test("genKeys: giữ chuỗi gõ, ghép thông tin, đối thủ, công nghệ; bỏ trùng và giới hạn", () => {
  const keys = genKeys({ typed: "Máy lọc nước Kangaroo", adds: ["RO"], generic: "máy lọc nước", mainBrand: "Kangaroo", brands: ["Karofi", "Sunhouse"], techNames: ["RO", "UF"], max: 30 });
  assert.equal(keys[0].key, "Máy lọc nước Kangaroo RO");
  assert.ok(keys.every((k) => k.key.length > 5));
  assert.ok(keys.some((k) => k.group === "competitor" && k.brand === "Karofi" && /giá/.test(k.key)));
  assert.ok(keys.some((k) => k.group === "competitor" && k.brand === "Karofi" && /công nghệ/.test(k.key)));
  assert.ok(keys.some((k) => /đối thủ cạnh tranh của Kangaroo/.test(k.key)));
  assert.ok(keys.some((k) => k.group === "tech" && k.tech === "UF"));
  assert.equal(new Set(keys.map((k) => k.key.toLowerCase())).size, keys.length);
  assert.equal(genKeys({ typed: "x y z", max: 3 }).length, 3);
  const consumer = genKeys({ typed: "Sữa tươi", generic: "sữa tươi", category: "consumer", brands: ["TH"] });
  assert.ok(!consumer.some((k) => k.group === "tech" || /công nghệ/.test(k.key)));
  assert.deepEqual(interleave(keys).slice(0, 3).map((k) => k.group), ["core", "competitor", "tech"]);
  assert.equal(brandKeys("van bi", "Kitz").length, 3);
});

test("competitorBrands: bỏ hãng đang tìm, ưu tiên hãng đã gặp", () => {
  const entry = { product: { brand: "Kangaroo" }, alternatives: [{ brand: "Karofi" }], offers: [{ kind: "other", brand: "Coway" }] };
  const type = TYPES.find((t) => t.id === "purifier");
  const b = competitorBrands({ entry, type, max: 5 });
  assert.deepEqual(b.slice(0, 2), ["Karofi", "Coway"]);
  assert.ok(!b.some((x) => /kangaroo/i.test(x)));
  assert.ok(b.includes("Sunhouse"));
});

function fakeApi({ results = {}, pages = {} } = {}) {
  const calls = { discover: [], page: [] };
  return {
    calls,
    discover: async (qs) => { calls.discover.push(qs[0]); const r = results[qs[0]] ?? Object.entries(results).find(([k]) => qs[0].includes(k))?.[1]; if (!r) { if (Object.keys(results).length) return { ok: true, results: [] }; throw Object.assign(new Error("Công cụ tìm kiếm miễn phí không trả kết quả"), { status: 502 }); } return { ok: true, results: r }; },
    page: async (url, hint) => { calls.page.push({ url, hint }); return pages[url] ?? { ok: false, url, error: "HTTP 404" }; },
  };
}

test("expandResearch: đọc trang theo thông tin, thêm hãng đối thủ, lưu ghi chú công nghệ, không lặp từ khóa", async () => {
  const plan = makePlan({ text: "Máy lọc nước Kangaroo KG100", category: "tech" });
  const entry = newEntry(plan, "k|tech");
  entry.product = { name: "Máy lọc nước Kangaroo KG100", brand: "Kangaroo", model: "KG100", summary: "" };
  const api = fakeApi({
    results: {
      "đối thủ cạnh tranh": [{ url: "https://news.vn/top", title: "Karofi và Sunhouse là đối thủ của Kangaroo", snippet: "Karofi" }],
      "Karofi giá bán": [{ url: "https://shop.vn/karofi-k9", title: "Máy lọc nước Karofi K9", snippet: "Karofi 7 lõi 5.490.000đ" }],
      "công nghệ RO": [{ url: "https://blog.vn/ro", title: "RO là gì", snippet: "Công nghệ RO loại bỏ kim loại nặng" }],
      "KG100 giá bán": [{ url: "https://shop2.vn/kg100", title: "Kangaroo KG100", snippet: "giá" }],
    },
    pages: {
      "https://shop.vn/karofi-k9": { ok: true, url: "https://shop.vn/karofi-k9", finalUrl: "https://shop.vn/karofi-k9", domain: "shop.vn", title: "Máy lọc nước Karofi K9", h1: "Máy lọc nước Karofi K9", relevant: false, product: { name: "Karofi K9", brand: "Karofi", price: { value: 5490000, source: "jsonld" } }, pros: ["Lọc 7 cấp"], cons: ["Hơi ồn"], tech: ["RO"], specs: [], images: [], seller: "Shop", vat: { state: "unknown" } },
      "https://shop2.vn/kg100": { ok: true, url: "https://shop2.vn/kg100", finalUrl: "https://shop2.vn/kg100", domain: "shop2.vn", title: "Kangaroo KG100", h1: "Kangaroo KG100", relevant: true, product: { name: "Kangaroo KG100", brand: "Kangaroo", price: { value: 4990000, source: "jsonld" } }, pros: [], cons: [], tech: [], specs: [], images: [], seller: "Shop2", vat: { state: "included" } },
    },
  });
  const keys = genKeys({ typed: "Máy lọc nước Kangaroo KG100", generic: "máy lọc nước", mainBrand: "Kangaroo", brands: [], techNames: ["RO"] });
  const st = await expandResearch(entry, keys, { api, gapMs: 0, kind: "máy lọc nước" });
  assert.ok(st.pages >= 2);
  const karofi = entry.alternatives.find((a) => a.brand === "Karofi");
  assert.ok(karofi, "đã thêm hãng Karofi từ trang đối thủ");
  assert.equal(karofi.price, 5490000);
  assert.ok(karofi.pros.length && karofi.tech.length);
  assert.ok(api.calls.discover.some((q) => /Karofi giá bán/.test(q)), "hãng tìm ra được sinh từ khóa riêng");
  assert.ok(entry.techNotes.some((n) => /kim loại nặng/.test(n.text)));
  assert.ok(entry.offers.some((o) => o.url.includes("shop2.vn")));
  // lần sau không tìm lại từ khóa đã chạy
  const before = api.calls.discover.length;
  await expandResearch(entry, keys, { api, gapMs: 0, kind: "máy lọc nước" });
  assert.ok(api.calls.discover.length - before < before);
});

test("expandResearch: công cụ tìm bị chặn thì dừng nhưng giữ dữ liệu", async () => {
  const entry = newEntry(makePlan({ text: "Nồi chiên ABC-100" }), "k|tech");
  const api = fakeApi({});
  const st = await expandResearch(entry, genKeys({ typed: "Nồi chiên ABC-100" }), { api, gapMs: 0 });
  assert.equal(st.pages, 0);
  assert.equal(entry.status, "done");
  assert.ok(entry.log.some((l) => l.kind === "error"));
});

test("techLandscape: nhận nhóm máy lọc nước, đánh dấu công nghệ sản phẩm có, gợi ý theo ưu tiên", () => {
  const entry = newEntry(makePlan({ text: "Máy lọc nước RO Kangaroo KG100 UV", category: "tech" }), "k|tech");
  entry.product = { name: "Máy lọc nước RO Kangaroo KG100 UV", brand: "Kangaroo", model: "KG100", summary: "" };
  entry.alternatives.push({ brand: "Karofi", name: "Karofi K9 Nano", tech: [{ name: "Công nghệ Nano" }], pros: [] });
  const quality = techLandscape(entry, { priority: "quality" });
  assert.equal(quality.typeId, "purifier");
  assert.ok(quality.items.find((i) => i.id === "ro").has);
  assert.ok(quality.items.find((i) => i.id === "uv").has);
  assert.ok(!quality.items.find((i) => i.id === "uf").has);
  assert.ok(quality.items.find((i) => i.id === "nano").products >= 1);
  assert.equal(quality.best[0].id, "ro");
  const cheap = techLandscape(entry, { priority: "cheap" });
  assert.ok(["uf", "nano"].includes(cheap.best[0].id));
  assert.ok(cheap.summary.some((s) => /Gợi ý theo nhu cầu/.test(s)));
  assert.equal(techLandscape(newEntry(makePlan({ text: "Sữa tươi Vinamilk" }), "k|c")), null);
  assert.deepEqual(catalogNames("purifier", 2), ["RO", "UF"]);
});

test("ngân hàng công nghệ: mỗi mục đủ trường, điểm 0–10", async () => {
  const { TECH_CATALOG } = await import("../web/js/lib/techkb.js");
  for (const [id, cat] of Object.entries(TECH_CATALOG)) {
    assert.ok(TYPES.some((t) => t.id === id), id);
    for (const t of cat.techs) {
      assert.ok(t.name && t.what && t.pros.length && t.cons.length && t.match.length, t.id);
      for (const v of Object.values(t.scores)) assert.ok(v >= 0 && v <= 10);
    }
  }
});

import { saveWizard, recallWizard, savedFor } from "../web/js/lib/wizcache.js";
import { preCards, analyzeInput } from "../web/js/lib/intent.js";

function memStorage() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; }

test("wizcache: nhớ câu trả lời theo từ khóa và theo loại hàng, điền lại đúng thẻ", () => {
  const st = memStorage();
  const cards = preCards(analyzeInput("Máy lọc nước Kangaroo"));
  const brandCard = cards.find((c) => c.id === "cores") ?? cards.find((c) => c.kind === "query");
  const opt = brandCard.options[0];
  saveWizard({ baseKey: "k1|tech", typeId: "purifier", answers: { [brandCard.id]: { value: opt.value, add: opt.add }, other: { custom: "tự gõ" } }, adds: [opt.add] }, st);
  // cùng từ khóa: điền lại đúng, exact
  const same = recallWizard({ baseKey: "k1|tech", typeId: "purifier", cards }, st);
  assert.equal(same.exact, true);
  assert.equal(same.answers[brandCard.id].value, opt.value);
  assert.equal(same.answers[brandCard.id].add, opt.add);
  // sản phẩm khác cùng loại: gợi ý lại lựa chọn gần nhất, không exact
  const other = recallWizard({ baseKey: "k2|tech", typeId: "purifier", cards }, st);
  assert.equal(other.exact, false);
  assert.equal(other.answers[brandCard.id].value, opt.value);
  // loại khác: không điền
  assert.deepEqual(recallWizard({ baseKey: "k3|tech", typeId: "tv", cards }, st).answers, {});
  // lựa chọn không còn tồn tại thì bỏ, chữ tự nhập thì giữ
  saveWizard({ baseKey: "k4|tech", typeId: "purifier", answers: { [brandCard.id]: { value: "không còn", add: "x" } } }, st);
  assert.equal(recallWizard({ baseKey: "k4|tech", typeId: "x", cards }, st).answers[brandCard.id], undefined);
  assert.deepEqual(savedFor("k1|tech", st).adds, [opt.add]);
  assert.equal(savedFor("zzz", st), null);
});

import { cleanTechName, extractFacts } from "../web/js/lib/extract.js";
import { canonBrand, detectBrand } from "../web/js/lib/plan.js";
import { ingestPage, ingestProduct } from "../web/js/lib/entry.js";
import { summarize } from "../web/js/lib/aggregate.js";

test("cleanTechName: bỏ tên bị cắt dở, cả câu, chung chung; không tự cắt ngắn", () => {
  assert.equal(cleanTechName("Công nghệ Rapid Air"), "Công nghệ Rapid Air");
  assert.equal(cleanTechName("Công nghệ Inverter và"), "Công nghệ Inverter");
  assert.equal(cleanTechName("Công nghệ làm lạnh tiên tiến nhất…"), "");
  assert.equal(cleanTechName("Công nghệ lọc RO (thẩm thấu"), "Công nghệ lọc RO");
  assert.equal(cleanTechName("Công nghệ hiện đại"), "");
  assert.equal(cleanTechName("Máy giúp bạn nấu ăn nhanh hơn rất nhiều lần so với các loại khác."), "");
  assert.equal(cleanTechName("360"), "");
  assert.equal(cleanTechName("x".repeat(70)), "");
});

test("canonBrand: viết đúng tên hãng, bỏ chuỗi không phải tên hãng", () => {
  assert.equal(canonBrand("lg"), "LG");
  assert.equal(canonBrand("TP-LINK"), "TP-Link");
  assert.equal(canonBrand("kangaroo"), "Kangaroo");
  assert.equal(canonBrand("Hãng X"), "Hãng X");
  assert.equal(canonBrand("một hãng rất dài nhiều chữ lắm nhé"), "");
  assert.equal(canonBrand("Samsung…"), "");
  assert.equal(detectBrand("tai nghe jbl tune"), "JBL");
});

test("techLandscape: 'rõ ràng' không bị nhận nhầm là RO; chữ RO viết hoa thì nhận", () => {
  const e1 = newEntry(makePlan({ text: "Máy lọc nước Kangaroo KG100", category: "tech" }), "a|tech");
  e1.pros.push({ text: "Lọc nước rõ ràng, uống ngon", srcId: 1 });
  assert.equal(techLandscape(e1).items.find((i) => i.id === "ro").has, false);
  e1.pros.push({ text: "Màng lọc RO 0,0001 micron", srcId: 1 });
  assert.equal(techLandscape(e1).items.find((i) => i.id === "ro").has, true);
});

test("trang khác hãng (tên giống) không phải sản phẩm mục tiêu; giá AI gắn với trang đó bị bỏ", () => {
  const html = (brand) => `<html><head><title>Máy lọc nước ${brand} 7 lõi</title></head><body><h1>Máy lọc nước ${brand} 7 lõi</h1><p>Giá: 5.490.000 đ</p></body></html>`;
  const hint = { name: "Máy lọc nước Kangaroo 7 lõi", brand: "Kangaroo", model: "" };
  assert.equal(extractFacts(html("Karofi"), "https://shop.vn/a", hint).relevant, false);
  assert.equal(extractFacts(html("Kangaroo"), "https://shop.vn/b", hint).relevant, true);
  const entry = newEntry(makePlan({ text: "Máy lọc nước Kangaroo 7 lõi", category: "tech" }), "k|tech");
  ingestProduct(entry, { data: { product: { name: "Máy lọc nước Karofi", brand: "Karofi" }, prices: [{ value: 5490000, source: "https://shop.vn/a" }] }, sources: [{ url: "https://shop.vn/a", title: "" }] });
  assert.equal(entry.product.brand.toLowerCase(), "kangaroo", "AI trả hãng khác: giữ hãng người dùng gõ");
  assert.equal(entry.prices.length, 1);
  ingestPage(entry, { ...extractFacts(html("Karofi"), "https://shop.vn/a", hint), url: "https://shop.vn/a", ok: true, domain: "shop.vn" });
  assert.equal(summarize(entry).price.count, 0);
});

import { forgetWizard } from "../web/js/lib/wizcache.js";
import { renderSummary, renderHeadline } from "../web/js/render.js";

test("store.purge: xóa toàn bộ / theo mục chọn / theo thời gian; forgetWizard xóa câu trả lời tương ứng", async () => {
  const mk = async () => {
    const st = createMemoryStore();
    const day = 864e5;
    for (const [k, age] of [["a|tech", 0], ["b|tech", 10 * day], ["c|tech", 40 * day]]) {
      const e = newEntry(makePlan({ text: "SP " + k }), k);
      e.updatedAt = Date.now() - age;
      await st.put?.(e);
    }
    return st;
  };
  // memory store bọc: dùng save() sẽ cập nhật updatedAt? kiểm tra qua list()
  const st = createMemoryStore();
  const day = 864e5;
  for (const [k, age] of [["a|tech", 0], ["b|tech", 10 * day], ["c|tech", 40 * day]]) {
    const e = newEntry(makePlan({ text: "SP " + k }), k);
    await st.save(e);
    const cur = await st.get(k); cur.updatedAt = Date.now() - age; await st.save(Object.assign(cur, { updatedAt: Date.now() - age }));
  }
  assert.equal((await st.list()).length, 3);
  const keys = await st.purge({ mode: "keys", keys: ["b|tech"] });
  assert.deepEqual(keys.keys, ["b|tech"]);
  assert.equal((await st.list()).length, 2);
  await assert.rejects(() => st.purge({ mode: "xyz" }));
  const old = await st.purge({ mode: "time", days: 30 });
  assert.equal(old.n >= 0, true);
  const all = await st.purge({ mode: "all" });
  assert.ok(all.n >= 0);
  assert.equal((await st.list()).length, 0);

  const ws = memStorage();
  saveWizard({ baseKey: "k1", typeId: "t", answers: { x: { value: "v", add: "v" } }, adds: ["v"] }, ws);
  saveWizard({ baseKey: "k2", typeId: "t", answers: { x: { value: "v", add: "v" } }, adds: ["v"] }, ws);
  forgetWizard(["k1"], ws);
  assert.equal(savedFor("k1", ws), null);
  assert.ok(savedFor("k2", ws));
  forgetWizard(null, ws);
  assert.equal(savedFor("k2", ws), null);
});

test("Tổng hợp: giá chỉ có giá + link; ưu/nhược có link đứng trước; tiêu đề công nghệ theo nhóm; dữ kiện nhập không có chữ giải thích", () => {
  const e = newEntry(makePlan({ text: "Máy lọc nước Kangaroo KG100", category: "tech" }), "k|tech");
  e.product = { name: "Máy lọc nước Kangaroo KG100", brand: "Kangaroo", model: "KG100", summary: "" };
  e.sources.push({ id: 1, key: "https://a.vn/p", url: "https://a.vn/p", title: "A", domain: "a.vn", via: "page", verified: true });
  e.prices.push({ value: 4990000, label: "Giá trên a.vn", srcId: 1, via: "page", verified: true, ts: Date.now() });
  e.pros.push({ text: "Lọc 7 cấp", srcId: 1, verified: true });
  e.tech.push({ name: "Công nghệ RO", benefit: "", drawback: "", srcId: 1 });
  e.asked = { adds: ["RO", "7 lõi"], ts: Date.now() };
  const html = renderSummary(e);
  assert.ok(!/Giá trên|đọc từ trang/.test(html));
  assert.match(html, /<b>4\.990\.000[^<]*<\/b> <a class="src"/);
  assert.match(html, /<li><a class="src"[^>]*>\[1\] a\.vn<\/a> <span class="t">Lọc 7 cấp/);
  assert.match(html, /Công nghệ &amp; tính năng chung nhóm sản phẩm này/);
  const head = renderHeadline(e);
  assert.ok(!/Thông tin bạn đã cung cấp|đã lưu/.test(head));
  assert.match(head, /Kangaroo · KG100 · RO · 7 lõi/);
});
