// Gọi AI có tìm web: Claude (web_search) hoặc Gemini (Google Search grounding), hoặc chế độ mẫu để chạy thử.
import Anthropic from "@anthropic-ai/sdk";
import { normUrl, domainOf } from "../web/js/lib/text.js";
import { mockProduct, mockCompare, mockSources } from "../dev/mock-pages.mjs";

export class AIError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const DEFAULT_CLAUDE = "claude-opus-5-5";
const DEFAULT_GEMINI = "gemini-2.5-flash";

/** Chọn nhà cung cấp AI từ header người dùng hoặc biến môi trường của Worker. */
export function pickProvider(env, headers) {
  const userKey = (headers.get("x-ai-key") || "").trim();
  let want = (headers.get("x-ai-provider") || "auto").toLowerCase();
  if (want === "free") return { provider: "free", key: "", model: "duckduckgo+bing" };
  if (userKey) {
    if (want === "auto") want = userKey.startsWith("sk-ant-") ? "claude" : "gemini";
    return { provider: want === "gemini" ? "gemini" : "claude", key: userKey, ...models(env, want) };
  }
  if ((want === "auto" || want === "claude") && env.ANTHROPIC_API_KEY) return { provider: "claude", key: env.ANTHROPIC_API_KEY, ...models(env, "claude") };
  if ((want === "auto" || want === "gemini") && env.GEMINI_API_KEY) return { provider: "gemini", key: env.GEMINI_API_KEY, ...models(env, "gemini") };
  if (env.MOCK === "1") return { provider: "mock", key: "", model: "mock" };
  // Không có khóa: chế độ miễn phí, tìm bằng DuckDuckGo/Bing và tự đọc trang (không có AI)
  return { provider: "free", key: "", model: "duckduckgo+bing" };
}

function models(env, which) {
  return { model: which === "gemini" ? env.GEMINI_MODEL || DEFAULT_GEMINI : env.CLAUDE_MODEL || DEFAULT_CLAUDE };
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
async function geminiCall({ key, model, system, user, search, images, fetchImpl = fetch }) {
  const parts = [...(images ?? []).map((im) => ({ inlineData: { mimeType: im.mime, data: im.data } })), { text: user }];
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    ...(search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0.2 },
  };
  let res;
  try {
    res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
  } catch { throw new AIError("Không kết nối được Gemini.", 502); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /API key/i.test(msg)) throw new AIError("Khóa Gemini không hợp lệ.", 401);
    if (res.status === 403 || res.status === 401) throw new AIError("Khóa Gemini không có quyền: " + msg.slice(0, 160), 403);
    if (res.status === 404) throw new AIError("Không tìm thấy model Gemini đã cấu hình (GEMINI_MODEL).", 502);
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

/**
 * task: "product" | "compare" | "ask" | "ocr"
 * opts: { system, user, search, images, effort, origin }
 */
export async function callAI(sel, task, opts) {
  const t0 = Date.now();
  let r;
  if (sel.provider === "mock") r = mockCall(task, opts.origin, opts.user);
  else if (sel.provider === "gemini") r = await geminiCall({ ...sel, ...opts });
  else r = await claudeCall({ ...sel, ...opts, effort: opts.effort ?? "medium" });
  return { ...r, ms: Date.now() - t0, provider: sel.provider, model: sel.model };
}
