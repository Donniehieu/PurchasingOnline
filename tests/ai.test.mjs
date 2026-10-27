import test from "node:test";
import assert from "node:assert/strict";
import { extractJson, verifyClaims, pickProvider, callAI, AIError } from "../worker/ai.js";

test("extractJson chịu được rào markdown, chữ thừa và dấu ngoặc trong chuỗi", () => {
  assert.deepEqual(extractJson('Đây là kết quả:\n```json\n{"a": 1, "b": "x}y"}\n```\nxong'), { a: 1, b: "x}y" });
  assert.deepEqual(extractJson('{"a": {"b": [1,2]}} thêm chữ'), { a: { b: [1, 2] } });
  assert.equal(extractJson("không có json"), null);
  assert.equal(extractJson('{"a": '), null);
});

test("verifyClaims: URL có trong kết quả tìm = đã kiểm chứng, cùng tên miền = chấp nhận, lạ = chưa kiểm chứng", () => {
  const data = { pros: [{ text: "a", source: "https://www.shop.vn/p?utm_source=x" }, { text: "b", source: "https://shop.vn/khac" }, { text: "c", source: "https://bia-dat.com/x" }], alternatives: [{ price: { value: 1, source: "https://shop.vn/p" } }] };
  verifyClaims(data, [{ url: "https://shop.vn/p", title: "t" }]);
  assert.equal(data.pros[0].verified, true);
  assert.equal(data.pros[0].source, "https://shop.vn/p");
  assert.equal(data.pros[1].verified, true);
  assert.equal(data.pros[2].verified, false);
  assert.equal(data.alternatives[0].price.verified, true);
});

test("pickProvider: khóa người dùng > khóa máy chủ > mẫu > miễn phí", () => {
  const h = (o = {}) => new Headers(o);
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: "k" }, h({ "x-ai-key": "AIzaX" })).provider, "gemini");
  assert.equal(pickProvider({}, h({ "x-ai-key": "sk-ant-abc" })).provider, "claude");
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g" }, h()).provider, "claude");
  assert.equal(pickProvider({ GEMINI_API_KEY: "g" }, h()).provider, "gemini");
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g" }, h({ "x-ai-provider": "gemini" })).provider, "gemini");
  assert.equal(pickProvider({ MOCK: "1" }, h()).provider, "mock");
  assert.equal(pickProvider({}, h()).provider, "free");
  assert.equal(pickProvider({ MOCK: "1" }, h({ "x-ai-provider": "free" })).provider, "free");
});

test("Gemini: gửi google_search, đọc nguồn từ grounding và giải link chuyển hướng", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("generativelanguage")) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, groundingMetadata: {
          webSearchQueries: ["q1"],
          groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "shop.vn" } }, { web: { uri: "https://direct.vn/x", title: "direct.vn" } }],
        } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(null, { status: 302, headers: { location: "https://shop.vn/real-page" } });
  };
  const r = await callAI({ provider: "gemini", key: "AIzaK", model: "gemini-test" }, "product", { system: "s", user: "u", search: true, fetchImpl: fakeFetch });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.tools, [{ google_search: {} }]);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "AIzaK");
  assert.ok(calls[0].url.includes("/models/gemini-test:generateContent"));
  assert.deepEqual(r.sources.map((s) => s.url), ["https://shop.vn/real-page", "https://direct.vn/x"]);
  assert.deepEqual(r.queries, ["q1"]);
  assert.equal(extractJson(r.text).ok, true);
});

test("Gemini: lỗi khóa và hạn mức được báo bằng tiếng Việt rõ ràng", async () => {
  const mk = (status, message) => async () => new Response(JSON.stringify({ error: { message } }), { status });
  await assert.rejects(callAI({ provider: "gemini", key: "x", model: "m" }, "ask", { system: "s", user: "u", fetchImpl: mk(400, "API key not valid") }), /Khóa Gemini không hợp lệ/);
  await assert.rejects(callAI({ provider: "gemini", key: "x", model: "m" }, "ask", { system: "s", user: "u", fetchImpl: mk(429, "quota") }), (e) => e.status === 429);
});
