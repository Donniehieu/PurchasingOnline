// Nhiều AI: tự chuyển khi hết hạn mức/lỗi, ChatGPT, AI tùy chọn, chia trang dài cho nhiều AI đọc song song.
import test from "node:test";
import assert from "node:assert/strict";
import { pickProvider, callAI, AIError } from "../worker/ai.js";
import { splitText, rotate, deepRead } from "../worker/page-ai.js";
import { extraKeysOf } from "../web/js/lib/api.js";

const h = (o = {}) => new Headers(o);
const enc = (o) => btoa(JSON.stringify(o));
const geminiOk = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const openaiOk = (text) => ({ ok: true, status: 200, clone() { return this; }, json: async () => ({ output: [{ type: "web_search_call", action: { query: "q" } }, { type: "message", content: [{ type: "output_text", text, annotations: [{ type: "url_citation", url: "https://shop.vn/a", title: "t" }] }] }] }) });

test("pickProvider: khóa phụ thành danh sách dự phòng, không trùng khóa chính", () => {
  const sel = pickProvider({}, h({ "x-ai-key": "AIzaMain", "x-ai-keys": enc({ gemini: "AIzaMain", claude: "sk-ant-x", openai: "sk-oa", custom: { url: "https://api.x.com/v1", key: "ck", model: "m" } }) }));
  assert.equal(sel.provider, "gemini");
  assert.deepEqual(sel.fallbacks.map((c) => c.provider), ["claude", "openai", "custom"]);
  // không có khóa chính: dùng khóa phụ đầu tiên
  assert.equal(pickProvider({}, h({ "x-ai-keys": enc({ openai: "sk-oa" }) })).provider, "openai");
  assert.equal(pickProvider({}, h({ "x-ai-keys": "!!not-base64" })).provider, "free");
  assert.equal(pickProvider({}, h({ "x-ai-key": "sk-proj-abc" })).provider, "openai");
});

test("callAI: Gemini hết hạn mức (429) thì tự chuyển sang ChatGPT, kèm nguồn trích dẫn", async () => {
  const calls = [];
  const fetchImpl = async (u) => {
    calls.push(String(u).replace(/https:\/\/[^/]+/, ""));
    if (u.includes("generativelanguage")) return u.includes("/models?") ? { ok: true, status: 200, json: async () => ({ models: [] }) } : { ok: false, status: 429, json: async () => ({}) };
    return openaiOk('{"ok":1}');
  };
  const sel = pickProvider({}, h({ "x-ai-key": "AIzaMain", "x-ai-keys": enc({ openai: "sk-oa" }) }));
  const r = await callAI(sel, "product", { system: "s", user: "u", search: true, fetchImpl });
  assert.equal(r.provider, "openai");
  assert.match(r.fellBack[0], /Gemini.*hạn mức/);
  assert.deepEqual(r.sources.map((s) => s.url), ["https://shop.vn/a"]);
  assert.deepEqual(r.queries, ["q"]);
  assert.ok(calls.includes("/v1/responses"));
});

test("callAI: tất cả đều lỗi thì báo lỗi của từng AI; việc tìm web không giao cho AI tùy chọn", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, clone() { return this; }, json: async () => ({}) });
  const sel = pickProvider({}, h({ "x-ai-key": "AIzaMain", "x-ai-keys": enc({ openai: "sk-oa", custom: { url: "https://api.x.com/v1", key: "ck", model: "m" } }) }));
  await assert.rejects(callAI(sel, "product", { system: "s", user: "u", search: true, fetchImpl }), (e) => e instanceof AIError && /Gemini/.test(e.message) && /ChatGPT/.test(e.message) && !/tùy chọn/.test(e.message));
  // một AI duy nhất: giữ nguyên lỗi gốc
  await assert.rejects(callAI(pickProvider({}, h({ "x-ai-key": "AIzaMain" })), "ask", { system: "s", user: "u", fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "API key not valid" } }) }) }), /Khóa Gemini không hợp lệ/);
});

test("AI tùy chọn: gọi chat/completions ở địa chỉ người dùng nhập, chặn địa chỉ nội bộ", async () => {
  let url = "", body;
  const sel = pickProvider({}, h({ "x-ai-keys": enc({ custom: { url: "https://api.muse.example/v1", key: "ck", model: "muse-1" } }) }));
  const r = await callAI(sel, "ask", { system: "s", user: "u", fetchImpl: async (u, o) => { url = u; body = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "xin chào" } }] }) }; } });
  assert.equal(r.text, "xin chào");
  assert.equal(url, "https://api.muse.example/v1/chat/completions");
  assert.equal(body.model, "muse-1");
  const bad = pickProvider({}, h({ "x-ai-keys": enc({ custom: { url: "http://127.0.0.1:8080/v1", key: "ck", model: "m" } }) }));
  await assert.rejects(callAI(bad, "ask", { system: "s", user: "u", fetchImpl: async () => { throw new Error("không được gọi"); } }), /không hợp lệ/);
});

test("trang dài chia phần, mỗi phần bắt đầu bằng một AI khác nhau (song song)", async () => {
  const text = Array.from({ length: 30 }, (_, i) => `Dòng ${i} ` + "x".repeat(4000)).join("\n");
  const parts = splitText(text);
  assert.ok(parts.length >= 2 && parts.length <= 3);
  const sel = pickProvider({}, h({ "x-ai-key": "AIzaMain", "x-ai-keys": enc({ claude: "sk-ant-x", openai: "sk-oa" }) }));
  assert.deepEqual([0, 1, 2].map((i) => rotate(sel, i).provider), ["gemini", "claude", "openai"]);
  assert.equal(rotate(sel, 1).fallbacks.length, 2);
  const used = [];
  const fetchImpl = async (u) => { used.push(u.includes("generativelanguage") ? "gemini" : "openai"); return u.includes("generativelanguage") ? geminiOk(JSON.stringify({ usage: [{ text: "Bước", quote: "Dòng 0 xxxx" }] })) : openaiOk(JSON.stringify({ usage: [{ text: "Bước 2", quote: "Dòng 10 xxxx" }] })); };
  const sel2 = pickProvider({}, h({ "x-ai-key": "AIzaMain", "x-ai-keys": enc({ openai: "sk-oa" }) }));
  const r = await deepRead({ sel: sel2, text, hint: { name: "x" }, fetchImpl });
  assert.ok(r.ok);
  assert.ok(r.parts >= 2);
  assert.ok(used.includes("gemini") && used.includes("openai"));
  assert.equal(r.data.usage.length, 2);
});

test("extraKeysOf: gói khóa phụ thành header, trống thì bỏ", () => {
  assert.equal(extraKeysOf({}), "");
  assert.equal(extraKeysOf({ keys: { gemini: " ", customUrl: "https://a" } }), "");
  assert.deepEqual(JSON.parse(atob(extraKeysOf({ keys: { openai: "sk-1", customUrl: "https://a/v1", customKey: "k", customModel: "m" } }))), { openai: "sk-1", custom: { url: "https://a/v1", key: "k", model: "m" } });
});
