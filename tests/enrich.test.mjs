// Mỗi lần tìm: mở trang MỚI rồi gộp vào cache cũ (dữ liệu cũ đôi khi chưa đủ).
import test from "node:test";
import assert from "node:assert/strict";
import { research, knownOf } from "../web/js/lib/pipeline.js";
import { createMemoryStore } from "../web/js/lib/store.js";
import { ApiError } from "../web/js/lib/api.js";
import { summarize } from "../web/js/lib/aggregate.js";
import { aiQuery } from "../web/js/lib/aitext.js";
import { makePlan } from "../web/js/lib/plan.js";
import { productPrompt, comparePrompt } from "../worker/prompts.js";
import { handle } from "../worker/index.js";
import { dropStalePrices, newEntry } from "../web/js/lib/entry.js";

const TEXT = "Nồi chiên không dầu Zeta ZF-500";
const U = (n) => `https://shop${n}.vn/zeta-zf500`;
const facts = (url, { price = 2400000, pros = [], cons = [], images = 1 } = {}) => ({
  ok: true, url, finalUrl: url, domain: new URL(url).hostname, title: "Zeta ZF-500 " + url, relevant: true, status: 200, ms: 5,
  product: { price: { value: price, source: "jsonld" } }, pros, cons, tech: [],
  images: Array.from({ length: images }, (_, i) => ({ url: url + `/img${i}.jpg`, alt: "zf", score: 5 })),
});

// api giả: mỗi lần tìm trả nguồn khác nhau theo plan.variant; ghi lại mọi lời gọi
function fakeApi({ rounds, failRound = -1 }) {
  const log = { search: [], page: [] };
  const api = {
    search: async (task, plan) => {
      log.search.push({ task, variant: plan.variant ?? 0, known: plan.known });
      if (task === "compare") return { ok: true, task, data: { alternatives: [] }, sources: [], queries: [], provider: "gemini", model: "m", ms: 1 };
      const r = rounds[plan.variant ?? 0];
      if ((plan.variant ?? 0) === failRound) throw new ApiError("Máy chủ lỗi", 502);
      return { ok: true, task, data: { category: "tech", product: { name: "Nồi chiên Zeta ZF-500", brand: "Zeta", model: "ZF-500" }, prices: [{ value: 2400000, source: r.sources[0] }], pros: r.claims ?? [], cons: [], technologies: [] }, sources: r.sources.map((u) => ({ url: u, title: u })), queries: ["q" + (plan.variant ?? 0)], provider: "gemini", model: "m", ms: 1 };
    },
    page: async (url) => { log.page.push(url); return rounds.flatMap((r) => r.pages ?? []).find((p) => p.url === url) ?? { ok: false, url, error: "HTTP 404" }; },
  };
  return { api, log };
}

const ROUNDS = [
  { sources: [U(1), U(2)], claims: [{ text: "Dung tích lớn đủ cho bốn người ăn", source: U(1) }], pages: [facts(U(1), { price: 2490000, pros: ["Làm nóng nhanh chỉ hai phút", "Giỏ chiên chống dính dễ vệ sinh"], cons: ["Quạt chạy hơi ồn khi nhiệt cao"] }), facts(U(2), { price: 2390000, pros: ["Bảng điều khiển cảm ứng dễ dùng"] })] },
  { sources: [U(1), U(3)], claims: [{ text: "Dung tích lớn đủ cho bốn người ăn", source: U(1) }, { text: "Bảo hành chính hãng hai mươi bốn tháng", source: U(3) }], pages: [facts(U(3), { price: 2450000, pros: ["Có nhiều chế độ nấu cài sẵn tiện lợi"], cons: ["Không có cửa sổ quan sát thức ăn"], images: 2 })] },
  { sources: [U(4)], claims: [], pages: [facts(U(4), { price: 2430000, pros: ["Phụ kiện đi kèm khá đầy đủ cho người mới"] })] },
];

test("lần 2: tìm thêm bằng từ khóa khác, KHÔNG mở lại trang đã đọc, gộp dữ liệu mới vào cache cũ", async () => {
  const store = createMemoryStore();
  const { api, log } = fakeApi({ rounds: ROUNDS });
  const first = await research({ text: TEXT }, { api, store, perHostCap: 99, freeGapMs: 0 });
  assert.equal(first.runs.length, 1);
  const before = summarize(first);
  const oldSources = first.sources.map((s) => s.url);
  const oldIds = Object.fromEntries(first.sources.map((s) => [s.url, s.id]));
  assert.deepEqual(log.page.sort(), [U(1), U(2)].sort());
  log.page.length = 0;

  const events = [];
  const second = await research({ text: "nồi chiên không dầu zeta zf-500" }, { api, store, perHostCap: 99, freeGapMs: 0, emit: (e) => { if (e.type === "entry") events.push({ pros: e.entry.pros.length, status: e.entry.status, runs: e.entry.runs.length }); } });
  assert.equal(second.key, first.key, "cùng một mục cache");
  assert.equal(second.runs.length, 2);
  // gửi kèm những gì đã biết và đổi cách đặt từ khóa
  const s2 = log.search.filter((x) => x.task === "product")[1];
  assert.equal(s2.variant, 1);
  assert.ok(s2.known.urls.includes(U(1)) && s2.known.urls.includes(U(2)));
  assert.ok(s2.known.pros.some((p) => /Làm nóng nhanh/.test(p)));
  // chỉ mở trang mới
  assert.deepEqual(log.page, [U(3)]);
  // dữ liệu cũ còn nguyên, dữ liệu mới được thêm
  const after = summarize(second);
  assert.ok(after.pros.length > before.pros.length);
  for (const t of ["Làm nóng nhanh chỉ hai phút", "Bảng điều khiển cảm ứng dễ dùng", "Có nhiều chế độ nấu cài sẵn tiện lợi", "Bảo hành chính hãng hai mươi bốn tháng"]) assert.ok(after.pros.some((p) => p.text === t), t);
  assert.ok(second.cons.some((c) => /Không có cửa sổ/.test(c.text)) && second.cons.some((c) => /Quạt chạy hơi ồn/.test(c.text)));
  assert.ok(after.price.count >= 3);
  assert.ok(second.images.length > first.images.length);
  // mã nguồn cũ giữ nguyên số (các ý cũ vẫn trỏ đúng nguồn)
  for (const [url, id] of Object.entries(oldIds)) assert.equal(second.sources.find((s) => s.url === url).id, id);
  assert.ok(second.sources.some((s) => s.url === U(3)));
  assert.equal(second.sources.filter((s) => s.url === U(1)).length, 1, "nguồn trùng không nhân đôi");
  // ý trùng (cùng câu, cùng nguồn) không nhân đôi
  assert.equal(second.pros.filter((p) => /Dung tích lớn/.test(p.text)).length, 1);
  // ghi nhận lần tìm
  assert.ok(second.runs[1].added.pros >= 2 && second.runs[1].added.pages === 1);
  assert.ok(second.log.some((l) => /Lần tìm thứ 2: .*ưu điểm/.test(l.msg)));
  // giao diện nhận dữ liệu cũ ngay từ đầu, rồi cập nhật dần
  assert.ok(events[0].pros >= 3 && events[0].status === "running" && events[0].runs === 1, "dữ liệu cũ hiện ngay lúc bắt đầu");
  assert.ok(events.at(-1).pros > events[0].pros, "rồi tăng dần khi có dữ liệu mới");
  assert.equal((await store.get(second.key)).runs.length, 2);
  assert.deepEqual(oldSources.every((u) => second.sources.some((s) => s.url === u)), true);

  // lần 3 lại ra nguồn khác nữa
  log.page.length = 0;
  const third = await research({ text: TEXT }, { api, store, perHostCap: 99, freeGapMs: 0 });
  assert.equal(third.runs.length, 3);
  assert.equal(log.search.filter((x) => x.task === "product")[2].variant, 2);
  assert.deepEqual(log.page, [U(4)]);
  assert.ok(summarize(third).pros.some((p) => /Phụ kiện đi kèm/.test(p.text)));
});

test("tìm bổ sung bị lỗi: dữ liệu cũ vẫn nguyên và dùng được, ghi log lần lỗi", async () => {
  const store = createMemoryStore();
  const ok = fakeApi({ rounds: ROUNDS });
  await research({ text: TEXT }, { api: ok.api, store, perHostCap: 99, freeGapMs: 0 });
  const bad = fakeApi({ rounds: ROUNDS, failRound: 1 });
  await assert.rejects(research({ text: TEXT }, { api: bad.api, store, perHostCap: 99, freeGapMs: 0 }), /Máy chủ lỗi/);
  const saved = await store.get((await store.list())[0].key);
  assert.equal(saved.status, "done", "vẫn xem được như bình thường");
  assert.ok(saved.pros.length >= 3 && saved.prices.length >= 2);
  assert.equal(saved.runs.length, 2);
  assert.ok(saved.log.some((l) => l.kind === "error" && /Máy chủ lỗi/.test(l.msg)));
  assert.equal(saved.runs[1].added.pros, 0);
});

test("mode cache: không tìm gì; mode fresh: làm lại từ đầu, bỏ dữ liệu cũ", async () => {
  const store = createMemoryStore();
  const a = fakeApi({ rounds: ROUNDS });
  await research({ text: TEXT }, { api: a.api, store, perHostCap: 99, freeGapMs: 0 });
  const n = a.log.search.length + a.log.page.length;
  const only = await research({ text: TEXT }, { mode: "cache", api: a.api, store, perHostCap: 99, freeGapMs: 0 });
  assert.equal(a.log.search.length + a.log.page.length, n);
  assert.equal(only.fromCache, true);

  const b = fakeApi({ rounds: [ROUNDS[2]] });
  const fresh = await research({ text: TEXT }, { mode: "fresh", api: b.api, store, perHostCap: 99, freeGapMs: 0 });
  assert.equal(fresh.runs.length, 1);
  assert.equal(b.log.search.find((x) => x.task === "product").variant, 0);
  assert.ok(!fresh.pros.some((p) => /Làm nóng nhanh/.test(p.text)), "dữ liệu cũ đã bỏ");
  // tương thích lời gọi cũ { force: true }
  const c = fakeApi({ rounds: [ROUNDS[0]] });
  const f2 = await research({ text: TEXT }, { force: true, api: c.api, store, perHostCap: 99, freeGapMs: 0 });
  assert.equal(f2.runs.length, 1);
});

test("giá quá cũ bị bỏ khi bổ sung (còn giá mới); nếu chỉ có giá cũ thì giữ lại", () => {
  const e = newEntry({ category: "tech", name: "x", model: "", brand: "", query: "x" }, "k");
  e.prices = [{ value: 1, srcId: 1, ts: Date.now() - 60 * 864e5 }, { value: 2, srcId: 2, ts: Date.now() - 2 * 864e5 }];
  dropStalePrices(e, 45);
  assert.deepEqual(e.prices.map((p) => p.value), [2]);
  e.prices = [{ value: 1, srcId: 1, ts: Date.now() - 90 * 864e5 }];
  dropStalePrices(e, 45);
  assert.equal(e.prices.length, 1);
});

test("đã đủ 5 hãng thì không tìm thêm hãng", async () => {
  const store = createMemoryStore();
  const a = fakeApi({ rounds: ROUNDS });
  const first = await research({ text: TEXT }, { api: a.api, store, perHostCap: 99, freeGapMs: 0 });
  first.alternatives = ["A", "B", "C", "D", "E"].map((b) => ({ brand: b, name: b, model: b, price: 1e6, priceSrcId: null, pros: [{ text: "ưu điểm dài đủ", srcId: null }], cons: [], tech: [], vsMain: "", srcIds: [], images: [] }));
  await store.save(first);
  a.log.search.length = 0;
  await research({ text: TEXT }, { api: a.api, store, perHostCap: 99, freeGapMs: 0 });
  assert.equal(a.log.search.filter((x) => x.task === "compare").length, 0);
});

test("knownOf, từ khóa biến thể và prompt dùng dữ liệu đã có", () => {
  const plan = makePlan({ text: TEXT });
  const qs = [0, 1, 2, 3].map((v) => aiQuery(plan, v));
  assert.equal(new Set(qs).size, 4, "4 cách hỏi khác nhau");
  assert.ok(qs.every((q) => q.includes(TEXT)), "mọi cách hỏi giữ nguyên chuỗi người dùng gõ");
  assert.equal(aiQuery(plan, 4), qs[0], "vòng lại");
  assert.ok(!aiQuery(makePlan({ text: "Dầu gội Clear 650g" }), 0).includes("công nghệ"));
  const e = newEntry(plan, "k");
  const k = knownOf(e);
  assert.deepEqual(k, { urls: [], pros: [], cons: [], brands: [] });
  const p = productPrompt({ ...plan, known: { urls: ["https://a.vn/1"], pros: ["Êm"], cons: ["Nặng"], brands: [] } });
  assert.match(p, /Nguồn đã đọc \(bỏ qua\): https:\/\/a\.vn\/1/);
  assert.match(p, /NGUỒN KHÁC/);
  assert.ok(!/ĐÃ CÓ dữ liệu/.test(productPrompt(plan)), "lần đầu không có phần này");
  assert.match(comparePrompt({ ...plan, known: { brands: ["Aurora", "Kora"] }, queries: [] }, {}), /Đã có các hãng: Aurora, Kora/);
});

test("tìm miễn phí (DuckDuckGo): từ khóa giữ nguyên chuỗi gõ + cụm hỏi, đổi cụm hỏi theo lần tìm, loại bỏ trang đã đọc", async () => {
  const bodies = [];
  const results = [["https://shop1.vn/a", "Zeta ZF-500 A"], ["https://shop9.vn/b", "Zeta ZF-500 B"], ["https://shop2.vn/c", "Zeta ZF-500 C"]];
  const html = results.map(([u, t]) => `<a rel="nofollow" class="result__a" href="${u}">${t}</a><a class="result__snippet" href="x">Giá 2.400.000đ</a>`).join("");
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => { if (String(u).includes("duckduckgo")) { bodies.push(decodeURIComponent(String(init.body))); return new Response(html, { status: 200 }); } return new Response("", { status: 404 }); };
  try {
    const call = async (variant, known) => {
      const r = await handle(new Request("http://x/api/search", { method: "POST", headers: { "x-ai-provider": "free" }, body: JSON.stringify({ task: "product", plan: { query: TEXT, name: TEXT, model: "ZF-500", brand: "Zeta", generic: "nồi chiên không dầu", category: "tech", queries: [], variant, known } }) }), { SEARCH_GAP_MS: "0" });
      return r.json();
    };
    const v0 = await call(0, undefined);
    assert.equal(v0.sources.length, 3);
    const q0 = bodies.splice(0).join("|");
    const v1 = await call(1, { urls: ["https://shop1.vn/a", "https://shop2.vn/c"], pros: [], cons: [], brands: [] });
    const q1 = bodies.splice(0).join("|");
    assert.notEqual(q0, q1, "cụm hỏi khác nhau giữa các lần tìm");
    assert.ok(q0.includes(TEXT) && q1.includes(TEXT), "chuỗi người dùng gõ được giữ nguyên ở mọi lần");
    assert.deepEqual(v1.sources.map((s) => s.url), ["https://shop9.vn/b"], "chỉ còn trang mới");
  } finally { globalThis.fetch = real; }
});
