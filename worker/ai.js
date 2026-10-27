// Gọi AI có tìm web: Claude (web_search) hoặc Gemini (Google Search grounding), hoặc chế độ mẫu để chạy thử.
import Anthropic from "@anthropic-ai/sdk";
import { normUrl, domainOf } from "../web/js/lib/text.js";
import { mockProduct, mockCompare, mockSources } from "../dev/mock-pages.mjs";
import { checkUrl } from "./safe-url.js";

export class AIError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const DEFAULT_CLAUDE = "claude-opus-5-5";
const DEFAULT_GEMINI = "gemini-3-flash-preview";
const DEFAULT_OPENAI = "gpt-5";

const NAMES = { gemini: "Gemini", claude: "Claude", openai: "ChatGPT", custom: "AI tùy chọn" };
const ORDER = ["gemini", "claude", "openai", "custom"];

/** Khóa phụ do người dùng gửi (header x-ai-keys: base64 của JSON {gemini, claude, openai, custom:{url, model, key}}). */
function extraKeys(headers) {
  try {
    const raw = headers.get("x-ai-keys");
    if (!raw) return {};
    const j = JSON.parse(atob(raw));
    return j && typeof j === "object" ? j : {};
  } catch { return {}; }
}

/** Mọi dịch vụ AI dùng được (khóa của người dùng trước, rồi khóa của máy chủ), theo thứ tự ưu tiên cố định. */
function candidates(env, headers) {
  const x = extraKeys(headers);
  const out = [];
  const add = (provider, key, extra = {}) => {
    key = String(key ?? "").trim();
    if (!key || out.some((c) => c.provider === provider && c.key === key)) return;
    out.push({ provider, key, ...models(env, provider, extra.model), ...(extra.baseUrl ? { baseUrl: extra.baseUrl } : {}) });
  };
  for (const p of ["gemini", "claude", "openai"]) add(p, x[p]);
  if (x.custom?.key && x.custom?.url) add("custom", x.custom.key, { baseUrl: String(x.custom.url), model: x.custom.model });
  add("claude", env.ANTHROPIC_API_KEY);
  add("gemini", env.GEMINI_API_KEY);
  add("openai", env.OPENAI_API_KEY);
  if (env.CUSTOM_AI_KEY && env.CUSTOM_AI_URL) add("custom", env.CUSTOM_AI_KEY, { baseUrl: env.CUSTOM_AI_URL, model: env.CUSTOM_AI_MODEL });
  return out;
}

/** Chọn nhà cung cấp AI chính; các dịch vụ còn lại đi kèm trong `fallbacks` để tự chuyển khi lỗi hoặc hết hạn mức. */
export function pickProvider(env, headers) {
  const sel = pickPrimary(env, headers);
  if (sel.provider === "free" || sel.provider === "mock") return sel;
  sel.fallbacks = candidates(env, headers).filter((c) => !(c.provider === sel.provider && c.key === sel.key));
  return sel;
}

function pickPrimary(env, headers) {
  const userKey = (headers.get("x-ai-key") || "").trim();
  let want = (headers.get("x-ai-provider") || "auto").toLowerCase();
  if (want === "free") return { provider: "free", key: "", model: "duckduckgo+bing" };
  if (userKey) {
    if (want === "auto") want = userKey.startsWith("sk-ant-") ? "claude" : /^sk-/.test(userKey) ? "openai" : "gemini";
    const provider = ORDER.includes(want) ? want : "claude";
    return { provider, key: userKey, ...models(env, provider) };
  }
  const cands = candidates(env, headers);
  const first = want === "auto" ? cands[0] : cands.find((c) => c.provider === want);
  if (first) return first;
  if (env.MOCK === "1") return { provider: "mock", key: "", model: "mock" };
  // Không có khóa: chế độ miễn phí, tìm bằng DuckDuckGo/Bing và tự đọc trang (không có AI)
  return { provider: "free", key: "", model: "duckduckgo+bing" };
}

function models(env, which, override) {
  const o = override ? String(override).trim().slice(0, 80) : "";
  if (which === "gemini") return { model: o || env.GEMINI_MODEL || DEFAULT_GEMINI };
  if (which === "openai") return { model: o || env.OPENAI_MODEL || DEFAULT_OPENAI };
  if (which === "custom") return { model: o || env.CUSTOM_AI_MODEL || "" };
  return { model: o || env.CLAUDE_MODEL || DEFAULT_CLAUDE };
}

export function extractJson(text) {
  const s = String(text ?? "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

// ---------- Claude ----------
async function claudeCall({ key, model, system, user, search, images, effort, maxUses }) {
  const client = new Anthropic({ apiKey: key, maxRetries: 1 });
  const content = [...(images ?? []).map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.data } })), { type: "text", text: user }];
  let messages = [{ role: "user", content }];
  const sources = new Map();
  const queries = [];
  let all = "";
  try {
    for (let turn = 0; turn < 5; turn++) {
      const stream = client.messages.stream({
        model,
        max_tokens: 16000,
        system,
        messages,
        ...(search ? { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses ?? 5 }] } : {}),
        output_config: { effort },
      });
      const msg = await stream.finalMessage();
      for (const b of msg.content) {
        if (b.type === "server_tool_use" && b.input?.query) queries.push(String(b.input.query));
        else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
          for (const r of b.content) if (r?.url) sources.set(normUrl(r.url), { url: r.url, title: r.title || "" });
        } else if (b.type === "text") {
          all += b.text;
          for (const c of b.citations ?? []) if (c?.url && !sources.has(normUrl(c.url))) sources.set(normUrl(c.url), { url: c.url, title: c.title || "" });
        }
      }
      if (msg.stop_reason === "refusal") throw new AIError("Dịch vụ từ chối trả lời yêu cầu này.", 422);
      if (msg.stop_reason === "pause_turn") { messages = [...messages, { role: "assistant", content: msg.content }]; continue; }
      break;
    }
  } catch (e) {
    throw mapSdkError(e);
  }
  return { text: all, sources: [...sources.values()], queries };
}

function mapSdkError(e) {
  if (e instanceof AIError) return e;
  const status = e?.status;
  if (status === 401) return new AIError("Khóa Claude không hợp lệ.", 401);
  if (status === 403) return new AIError("Khóa Claude không có quyền dùng tính năng này.", 403);
  if (status === 404) return new AIError("Không tìm thấy model Claude đã cấu hình (CLAUDE_MODEL).", 502);
  if (status === 429) return new AIError("Đã vượt giới hạn tốc độ của Claude, thử lại sau ít phút.", 429);
  if (status === 400) return new AIError("Claude từ chối yêu cầu: " + (e.message || "").slice(0, 200), 502);
  return new AIError("Lỗi gọi Claude: " + (e?.message || "không rõ").slice(0, 200), 502);
}

// ---------- Gemini ----------
// Model Gemini cũ bị gỡ theo thời gian: khi 404, hỏi danh sách model của khóa rồi chọn bản flash mới nhất.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const geminiPicked = new Map();

async function pickGeminiModel(key, tried, fetchImpl) {
  try {
    const r = await fetchImpl(`${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { why: `liệt kê model lỗi ${r.status}: ${String(j?.error?.message || "").slice(0, 120)}` };
    const names = (j.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => String(m.name).replace(/^models\//, ""))
      .filter((n) => /^gemini-/.test(n) && !tried.includes(n) && !/(image|tts|live|audio|embed|robotics|computer|thinking-exp|learnlm|-latest)/.test(n));
    // Phiên bản mới nhất trước; cùng phiên bản thì flash trước pro, bản ổn định trước preview/exp, bỏ lite xuống cuối.
    const ver = (n) => parseFloat((n.match(/^gemini-([\d.]+)/) ?? [0, 0])[1]);
    const rank = (n) => -ver(n) * 10000 + (/flash/.test(n) ? 0 : 1000) + (/lite/.test(n) ? 500 : 0) + (/preview|exp/.test(n) ? 100 : 0);
    names.sort((x, y) => rank(x) - rank(y));
    return names.length ? { model: names[0], names } : { why: "khóa không có model nào hỗ trợ generateContent" };
  } catch { return { why: "không liệt kê được model" }; }
}

async function geminiCall({ key, model, system, user, search, images, fetchImpl = fetch }) {
  const parts = [...(images ?? []).map((im) => ({ inlineData: { mimeType: im.mime, data: im.data } })), { text: user }];
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    ...(search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0.2 },
  };
  const send = (m) => fetchImpl(`${GEMINI_BASE}/models/${encodeURIComponent(m)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  const tried = [model];
  let use = geminiPicked.get(key + "|" + model) ?? model;
  let res, notFound = "";
  try {
    res = await send(use);
    // 404 (model bị gỡ) hoặc 429 (hết hạn mức của model này): thử lần lượt các model khác của khóa, hạn mức tính riêng từng model.
    if (res.status === 404 || res.status === 429) {
      const alt = await pickGeminiModel(key, [model, use], fetchImpl);
      if (alt.names) {
        for (const n of alt.names.slice(0, 6)) {
          const r2 = await send(n);
          if (r2.ok) { res = r2; geminiPicked.set(key + "|" + model, n); break; }
          if (r2.status !== 404 && r2.status !== 429) { res = r2; break; }
        }
      } else if (res.status === 404) notFound = alt.why;
    }
  } catch { throw new AIError("Không kết nối được Gemini.", 502); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /API key/i.test(msg)) throw new AIError("Khóa Gemini không hợp lệ.", 401);
    if (res.status === 403 || res.status === 401) throw new AIError("Khóa Gemini không có quyền: " + msg.slice(0, 160), 403);
    if (res.status === 404) throw new AIError(`Không tìm thấy model Gemini dùng được (${model}${notFound ? "; " + notFound : ""}).`, 502);
    if (res.status === 429) throw new AIError("Đã vượt hạn mức Gemini, thử lại sau.", 429);
    throw new AIError("Lỗi Gemini: " + msg.slice(0, 200), 502);
  }
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text) throw new AIError("Gemini không trả về nội dung" + (cand?.finishReason ? ` (${cand.finishReason})` : "") + ".", 502);
  const gm = cand.groundingMetadata ?? {};
  const raw = (gm.groundingChunks ?? []).map((c) => c.web).filter((w) => w?.uri);
  const sources = await resolveGrounding(raw, fetchImpl);
  return { text, sources, queries: gm.webSearchQueries ?? [] };
}

// Gemini trả link chuyển hướng của Google; lấy URL thật để người dùng mở được và để đối chiếu nguồn.
async function resolveGrounding(web, fetchImpl) {
  const out = await Promise.all(web.slice(0, 10).map(async (w) => {
    if (!/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(w.uri)) return { url: w.uri, title: w.title || "" };
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetchImpl(w.uri, { redirect: "manual", signal: ctl.signal });
      clearTimeout(t);
      const loc = r.headers.get("location");
      if (loc && /^https?:/i.test(loc)) return { url: loc, title: w.title || domainOf(loc) };
    } catch { /* giữ link gốc */ }
    return { url: w.uri, title: w.title || "", unresolved: true };
  }));
  return out;
}

// ---------- Kiểm chứng nguồn ----------
/**
 * Đánh dấu verified cho mọi trường "source": URL nằm trong kết quả tìm kiếm thật => đã kiểm chứng;
 * cùng tên miền với một trang đã đọc => chấp nhận (approx); còn lại => chưa kiểm chứng.
 */
export function verifyClaims(data, sources) {
  const exact = new Map(sources.map((s) => [normUrl(s.url), s.url]));
  const hosts = new Set(sources.map((s) => domainOf(s.url)));
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    if (typeof node.source === "string" && node.source) {
      const n = normUrl(node.source);
      if (exact.has(n)) { node.source = exact.get(n); node.verified = true; }
      else if (hosts.has(domainOf(node.source))) node.verified = true;
      else node.verified = false;
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(data);
  return data;
}

// ---------- Mẫu ----------
function mockCall(task, origin, user) {
  const s = mockSources(origin);
  const all = Object.values(s).map((url) => ({ url, title: url.split("/").pop() }));
  if (task === "product") return { text: JSON.stringify(mockProduct(origin)), sources: all.filter((x) => !/aurora|nimbus/.test(x.url)), queries: ["zeta zf-500 giá bán", "zeta zf-500 đánh giá ưu nhược điểm", "zeta zf-500 specs review"] };
  if (task === "compare") return { text: JSON.stringify(mockCompare(origin)), sources: all.filter((x) => /aurora|nimbus/.test(x.url)), queries: ["nồi chiên không dầu 5 lít so sánh", "aurora af-300 nimbus nb-450 giá"] };
  if (task === "ocr") return { text: JSON.stringify({ text: "Nồi chiên không dầu\nZeta ZF-500 5,5L\n1700W - 220V", name: "Nồi chiên không dầu Zeta ZF-500 5,5L", brand: "Zeta", model: "ZF-500", specs: ["1700W", "5,5L"], keywords: ["Zeta ZF-500", "nồi chiên không dầu 5,5L"] }) };
  const ctx = (() => { try { return JSON.parse(user.slice(user.indexOf("{"), user.lastIndexOf("}") + 1)); } catch { return null; } })();
  const pro = ctx?.pros?.[0];
  return { text: pro ? `(Dữ liệu mẫu) Điểm đáng chú ý nhất: ${pro.text} ${(pro.src ?? []).map((i) => `[${i}]`).join("")}` : "(Dữ liệu mẫu) Chưa có dữ liệu để trả lời." };
}

// ---------- ChatGPT (OpenAI Responses API, có tìm web) ----------
const OPENAI_BASE = "https://api.openai.com/v1";
const openaiPicked = new Map();

async function pickOpenaiModel(key, tried, fetchImpl) {
  try {
    const r = await fetchImpl(`${OPENAI_BASE}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const ids = ((await r.json()).data ?? []).map((m) => String(m.id)).filter((n) => /^gpt-\d+(\.\d+)?(-mini|-nano)?$/.test(n) && !tried.includes(n));
    const ver = (n) => parseFloat(n.match(/^gpt-([\d.]+)/)[1]);
    const rank = (n) => -ver(n) * 10 + (/mini/.test(n) ? 1 : /nano/.test(n) ? 2 : 0);
    return ids.sort((a, b) => rank(a) - rank(b));
  } catch { return null; }
}

async function openaiCall({ key, model, system, user, search, images, fetchImpl = fetch }) {
  const content = [{ type: "input_text", text: user }, ...(images ?? []).map((im) => ({ type: "input_image", image_url: `data:${im.mime};base64,${im.data}` }))];
  const send = (m) => fetchImpl(`${OPENAI_BASE}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: m, instructions: system, input: [{ role: "user", content }], ...(search ? { tools: [{ type: "web_search" }] } : {}), store: false }),
  });
  const missing = async (r) => r.status === 404 || (r.status === 400 && /model/i.test(JSON.stringify(await r.clone().json().catch(() => ({})))));
  let res;
  try {
    const use = openaiPicked.get(key + "|" + model) ?? model;
    res = await send(use);
    if (!res.ok && await missing(res)) {
      const list = await pickOpenaiModel(key, [model, use], fetchImpl);
      for (const n of (list ?? []).slice(0, 4)) {
        const r2 = await send(n);
        if (r2.ok) { res = r2; openaiPicked.set(key + "|" + model, n); break; }
        if (!(await missing(r2)) && r2.status !== 429) { res = r2; break; }
      }
    }
  } catch { throw new AIError("Không kết nối được ChatGPT.", 502); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new AIError("Khóa ChatGPT không hợp lệ.", 401);
    if (res.status === 403) throw new AIError("Khóa ChatGPT không có quyền: " + msg.slice(0, 160), 403);
    if (res.status === 429) throw new AIError("Đã vượt hạn mức ChatGPT (hoặc hết số dư).", 429);
    if (res.status === 404 || /model/i.test(msg)) throw new AIError(`Không tìm thấy model ChatGPT dùng được (${model}).`, 502);
    throw new AIError("Lỗi ChatGPT: " + msg.slice(0, 200), 502);
  }
  let text = "";
  const sources = new Map(), queries = [];
  for (const item of j.output ?? []) {
    if (item.type === "web_search_call" && item.action?.query) queries.push(String(item.action.query));
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type !== "output_text") continue;
      text += c.text ?? "";
      for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url) sources.set(normUrl(a.url), { url: a.url, title: a.title || "" });
    }
  }
  if (!text) throw new AIError("ChatGPT không trả về nội dung.", 502);
  return { text, sources: [...sources.values()], queries };
}

// ---------- AI tùy chọn (mọi dịch vụ theo chuẩn OpenAI chat/completions: địa chỉ + khóa + tên model do người dùng nhập) ----------
async function compatCall({ key, model, baseUrl, system, user, images, fetchImpl = fetch, allowLocal = false }) {
  const chk = checkUrl(String(baseUrl || ""), { allowLocal });
  if (!chk.ok) throw new AIError("Địa chỉ AI tùy chọn không hợp lệ: " + chk.reason, 400);
  if (!model) throw new AIError("AI tùy chọn chưa nhập tên model.", 400);
  const content = [{ type: "text", text: user }, ...(images ?? []).map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } }))];
  let res;
  try {
    res = await fetchImpl(chk.url.href.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: images?.length ? content : user }] }),
    });
  } catch { throw new AIError("Không kết nối được AI tùy chọn.", 502); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new AIError("Khóa AI tùy chọn không hợp lệ hoặc không có quyền.", res.status);
    if (res.status === 429) throw new AIError("Đã vượt hạn mức AI tùy chọn.", 429);
    throw new AIError("Lỗi AI tùy chọn: " + String(msg).slice(0, 200), 502);
  }
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new AIError("AI tùy chọn không trả về nội dung.", 502);
  return { text: typeof text === "string" ? text : JSON.stringify(text), sources: [], queries: [] };
}

/**
 * task: "product" | "compare" | "ask" | "ocr" | "page"
 * opts: { system, user, search, images, effort, origin }
 * Thử dịch vụ chính; lỗi hoặc hết hạn mức thì tự chuyển sang các dịch vụ dự phòng (sel.fallbacks) theo thứ tự.
 * Việc cần tìm web chỉ giao cho dịch vụ có công cụ tìm web (Gemini, Claude, ChatGPT).
 */
export async function callAI(sel, task, opts) {
  const t0 = Date.now();
  const all = [sel, ...(sel.fallbacks ?? [])];
  const chain = all.filter((c) => !(opts.search && c.provider === "custom"));
  const errors = [];
  for (const c of chain.length ? chain : [sel]) {
    try {
      let r;
      if (c.provider === "mock") r = mockCall(task, opts.origin, opts.user);
      else if (c.provider === "gemini") r = await geminiCall({ ...c, ...opts });
      else if (c.provider === "openai") r = await openaiCall({ ...c, ...opts });
      else if (c.provider === "custom") r = await compatCall({ ...c, ...opts });
      else r = await claudeCall({ ...c, ...opts, effort: opts.effort ?? "medium" });
      const fellBack = errors.map((e) => `${NAMES[e.provider] ?? e.provider}: ${e.err.message}`);
      return { ...r, ms: Date.now() - t0, provider: c.provider, model: c.model, ...(fellBack.length ? { fellBack } : {}) };
    } catch (e) {
      if (!(e instanceof AIError)) throw e;
      errors.push({ provider: c.provider, err: e });
      if (e.status === 413) break;
    }
  }
  if (errors.length === 1) throw errors[0].err;
  throw new AIError("Mọi dịch vụ AI đều lỗi — " + errors.map((e) => `${NAMES[e.provider] ?? e.provider}: ${e.err.message}`).join(" · "), errors[0].err.status);
}
