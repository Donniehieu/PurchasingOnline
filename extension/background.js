// Service worker của tiện ích. Làm 2 việc cho ứng dụng, đều theo kiểu "lịch sự" để tránh 403 và spam:
//   1) googleAI / googleSearch: mở google.com trong tab nền của Chrome BẠN, đọc chữ hiển thị (Chế độ AI hoặc kết quả thường).
//   2) fetchPage: tải trang web bằng IP và trình duyệt thật của bạn (không cookie), tuần tự theo từng tên miền.
// Không giải CAPTCHA: nếu Google hỏi xác minh, tab được đưa lên trước để BẠN tự xác minh.
importScripts("ai-extract.js");

const POLICY = {
  googleGapMs: 4000,          // giãn cách tối thiểu giữa hai lần mở Google
  googleMaxPer10Min: 8,       // tối đa số lần mở Google / 10 phút
  hostGapMs: 2500,            // giãn cách tối thiểu giữa hai yêu cầu tới cùng một tên miền
  concurrency: 2,             // tối đa số trang tải cùng lúc
  breakerMs: 30 * 60 * 1000,  // ngừng gọi một tên miền sau 403/429/503 hoặc CAPTCHA
  maxHtml: 320000,
  fetchTimeoutMs: 12000,
  aiWaitMs: 45000,            // chờ Chế độ AI viết xong
  userCaptchaMs: 120000,      // thời gian chờ bạn tự xác minh
  cacheMs: 24 * 3600 * 1000,  // nhớ kết quả Google 24 giờ để khỏi hỏi lại
};
const BUILTIN_ORIGINS = ["http://localhost:8787", "http://127.0.0.1:8787"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * ms * 0.4);

// ---------- lưu trạng thái ----------
async function getStore(key, fallback) {
  const o = await chrome.storage.local.get(key);
  return o[key] ?? fallback;
}
const setStore = (key, value) => chrome.storage.local.set({ [key]: value });

async function breakerUntil(host) {
  const b = await getStore("breaker", {});
  return b[host] && b[host] > Date.now() ? b[host] : 0;
}
async function trip(host, ms = POLICY.breakerMs) {
  const b = await getStore("breaker", {});
  b[host] = Date.now() + ms;
  for (const k of Object.keys(b)) if (b[k] < Date.now()) delete b[k];
  await setStore("breaker", b);
}

// ---------- kiểm tra URL công khai (không cho đọc mạng nội bộ của bạn) ----------
function publicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (!h.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/i.test(h) || h.includes(":")) return null;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return null;
  }
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  return u;
}
const isGoogleHost = (h) => /(^|\.)google\.[a-z.]+$/.test(h);

// ---------- Google: tab nền, tuần tự, có hạn mức ----------
let googleChain = Promise.resolve();
let googleLast = 0;
const googleTimes = [];

function withGoogleQueue(fn) {
  const run = googleChain.then(fn, fn);
  googleChain = run.catch(() => {});
  return run;
}

async function googleGate() {
  const until = await breakerUntil("google.com");
  if (until) return { ok: false, blocked: true, error: "Google đang yêu cầu xác minh gần đây, tạm nghỉ đến " + new Date(until).toLocaleTimeString("vi-VN") + ". Mở google.com, xác minh rồi bấm “Xóa chặn” ở biểu tượng tiện ích." };
  const now = Date.now();
  while (googleTimes.length && now - googleTimes[0] > 600000) googleTimes.shift();
  if (googleTimes.length >= POLICY.googleMaxPer10Min) return { ok: false, rate: true, error: "Đã mở Google " + googleTimes.length + " lần trong 10 phút, tạm nghỉ để tránh bị chặn." };
  const wait = googleLast + jitter(POLICY.googleGapMs) - now;
  if (wait > 0) await sleep(wait);
  googleLast = Date.now();
  googleTimes.push(googleLast);
  return null;
}

function waitComplete(tabId, ms = 20000) {
  return new Promise((resolve) => {
    let done = false, timer = null;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(); } };
    const on = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") finish(); }).catch(finish);
    timer = setTimeout(finish, ms);
  });
}

async function readTab(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: extractGoogle });
    return r && r.result;
  } catch { return null; }
}

async function googleRead(q, ai) {
  const key = (ai ? "ai:" : "web:") + q.toLowerCase();
  const cache = await getStore("gcache", {});
  const hit = cache[key];
  if (hit && Date.now() - hit.ts < POLICY.cacheMs) return { ...hit.data, cached: true };

  const gate = await googleGate();
  if (gate) return gate;

  const url = "https://www.google.com/search?q=" + encodeURIComponent(q) + (ai ? "&udm=50" : "") + "&hl=vi&gl=vn";
  const tab = await chrome.tabs.create({ url, active: false });
  let askedUser = false, deadline = Date.now() + (ai ? POLICY.aiWaitMs : 20000), lastLen = -1, stable = 0, best = null;
  try {
    await waitComplete(tab.id);
    while (Date.now() < deadline) {
      const r = await readTab(tab.id);
      if (!r) { await sleep(1000); continue; }
      if (r.state === "blocked" || r.state === "consent") {
        if (!askedUser) {
          // không tự giải: đưa tab lên trước để bạn tự xác minh / đồng ý
          askedUser = true;
          deadline = Date.now() + POLICY.userCaptchaMs;
          await chrome.tabs.update(tab.id, { active: true });
          const t = await chrome.tabs.get(tab.id);
          if (t.windowId) await chrome.windows.update(t.windowId, { focused: true });
        }
        await sleep(1500);
        continue;
      }
      if (r.state === "ok") {
        best = r;
        const enough = ai ? r.lines.length >= 5 && r.mode === "ai" : r.results.length >= 3;
        if (ai && r.done && enough) break;
        stable = r.textLen === lastLen ? stable + 1 : 0;
        lastLen = r.textLen;
        // đã ổn định (không đổi ~4,5 giây) thì coi như viết xong
        if (enough && stable >= 3) break;
        // Chế độ AI không có (bị chuyển về kết quả thường)
        if (ai && r.mode === "organic" && r.results.length >= 3 && stable >= 3) break;
      }
      await sleep(1500);
    }
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
  if (!best) {
    await trip("google.com");
    return { ok: false, blocked: true, error: "Google yêu cầu xác minh (CAPTCHA) và chưa được hoàn tất. Mở google.com, xác minh rồi thử lại." };
  }
  const data = { ok: true, mode: best.mode, url: best.url, lines: best.lines, cites: best.cites, results: best.results, done: !!best.done };
  if (data.mode === "ai" ? data.lines.length >= 5 : data.results.length > 0) {
    cache[key] = { ts: Date.now(), data };
    const keys = Object.keys(cache).sort((a, b) => cache[b].ts - cache[a].ts);
    for (const k of keys.slice(30)) delete cache[k];
    await setStore("gcache", cache);
  }
  if (!data.lines.length && !data.results.length) return { ok: false, error: "Google không trả nội dung đọc được (giao diện có thể đã đổi)." };
  return data;
}

// ---------- Tải trang: tuần tự theo tên miền, có tự ngắt ----------
const hostNext = new Map();
let active = 0;
const waiters = [];
async function acquire() {
  if (active >= POLICY.concurrency) await new Promise((r) => waiters.push(r));
  active++;
}
function release() { active--; const w = waiters.shift(); if (w) w(); }

async function hostSlot(host) {
  const at = Math.max(Date.now(), hostNext.get(host) || 0);
  hostNext.set(host, at + jitter(POLICY.hostGapMs)); // đặt chỗ trước để các yêu cầu cùng tên miền xếp hàng
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
}

async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < POLICY.maxHtml) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* đã đủ */ }
  const buf = new Uint8Array(Math.min(total, POLICY.maxHtml));
  let off = 0;
  for (const c of chunks) { const n = Math.min(c.length, buf.length - off); buf.set(c.subarray(0, n), off); off += n; if (off >= buf.length) break; }
  const type = res.headers.get("content-type") || "";
  const cs = (type.match(/charset=([\w-]+)/i) || [])[1] || (new TextDecoder().decode(buf.subarray(0, 2048)).match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder().decode(buf); }
}

async function fetchPage(rawUrl, depth = 0) {
  const u = publicUrl(rawUrl);
  if (!u) return { ok: false, error: "Địa chỉ không hợp lệ hoặc là mạng nội bộ" };
  const host = u.hostname.replace(/^www\./, "");
  const isGoto = isGoogleHost(u.hostname) && /^\/(goto|url)/.test(u.pathname);
  if (isGoogleHost(u.hostname) && !isGoto) return { ok: false, error: "Chỉ mở liên kết trích dẫn của Google, không mở trang Google khác" };
  const gate = await breakerUntil(isGoto ? "google.com" : host);
  if (gate) return { ok: false, blocked: true, status: 0, error: `Tạm ngừng ${host} (đã bị chặn gần đây), thử lại sau ${new Date(gate).toLocaleTimeString("vi-VN")}` };

  await acquire();
  const t0 = Date.now();
  try {
    await hostSlot(isGoto ? "google.com" : host);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), POLICY.fetchTimeoutMs);
    let res;
    try {
      res = await fetch(u.href, { credentials: "omit", redirect: "follow", signal: ctl.signal, cache: "no-store", headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": "vi-VN,vi;q=0.9,en;q=0.6" } });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, error: e && e.name === "AbortError" ? "Quá thời gian chờ" : "Không kết nối được", status: 0, ms: Date.now() - t0 };
    }
    const final = new URL(res.url || u.href);
    const finalHost = final.hostname.replace(/^www\./, "");
    hostNext.set(finalHost, Math.max(hostNext.get(finalHost) || 0, Date.now() + jitter(POLICY.hostGapMs)));
    if ([403, 429, 503].includes(res.status)) {
      clearTimeout(timer);
      const ra = Number(res.headers.get("retry-after"));
      await trip(isGoto && isGoogleHost(final.hostname) ? "google.com" : finalHost, Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 2 * 3600 * 1000) : POLICY.breakerMs);
      return { ok: false, blocked: true, status: res.status, error: `Trang chặn truy cập tự động (HTTP ${res.status}); tạm ngừng ${finalHost}`, ms: Date.now() - t0 };
    }
    if (!res.ok) { clearTimeout(timer); return { ok: false, status: res.status, error: "HTTP " + res.status, ms: Date.now() - t0 }; }
    const type = res.headers.get("content-type") || "";
    if (type && !/html|xml|text\/plain/i.test(type)) { clearTimeout(timer); return { ok: false, status: res.status, error: "Không phải trang HTML", ms: Date.now() - t0 }; }
    let html;
    try { html = await readLimited(res); } catch { clearTimeout(timer); return { ok: false, error: "Đọc trang bị gián đoạn", ms: Date.now() - t0 }; }
    clearTimeout(timer);
    if (isGoogleHost(final.hostname)) {
      // trang trung gian của Google: lấy liên kết ngoài đầu tiên rồi đi tiếp (tối đa 1 lần)
      const next = depth < 1 && (html.match(/href="(https?:\/\/(?!(?:[\w-]+\.)*google\.)[^"]+)"/i) || [])[1];
      return next ? fetchPage(next.replace(/&amp;/g, "&"), depth + 1) : { ok: false, error: "Google không chuyển tới trang đích", ms: Date.now() - t0 };
    }
    if (/(captcha|are you a robot|unusual traffic|xác minh bạn không phải)/i.test(html.slice(0, 6000)) && html.length < 20000) {
      await trip(finalHost);
      return { ok: false, blocked: true, status: res.status, error: "Trang yêu cầu xác minh (CAPTCHA), đã bỏ qua", ms: Date.now() - t0 };
    }
    return { ok: true, status: res.status, finalUrl: final.href, html, ms: Date.now() - t0 };
  } finally {
    release();
  }
}

// ---------- Điểm vào ----------
async function allowedOrigins() {
  return [...BUILTIN_ORIGINS, ...(await getStore("allowed", []))];
}

// ---------- Tự cập nhật ----------
// - Cài từ Chrome Web Store: Chrome tự cập nhật, không cần làm gì (manifest có update_url).
// - Cài từ thư mục (Tải tiện ích đã giải nén): Chrome KHÔNG tự cập nhật. Khi bạn cập nhật thư mục (git pull / chép đè),
//   tiện ích phát hiện file đổi và tự tải lại sau tối đa ~1 phút, không cần bấm "Tải lại" ở chrome://extensions.
const WATCH_FILES = ["manifest.json", "background.js", "ai-extract.js", "bridge.js", "popup.html", "popup.js"];
let inflight = 0;

async function fingerprint() {
  let all = "";
  for (const f of WATCH_FILES) {
    const r = await fetch(chrome.runtime.getURL(f), { cache: "no-store" });
    all += " " + f + " " + (await r.text());
  }
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(all));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function selfCheck(selfCount = 0) {
  if (chrome.runtime.getManifest().update_url) return "store";      // Chrome lo việc cập nhật
  if (inflight > selfCount) return "busy";                                   // đang làm việc: kiểm tra lần sau
  let fp;
  try { fp = await fingerprint(); } catch { return "error"; }
  const prev = await getStore("selfFp", "");
  await setStore("selfFp", fp);
  if (prev && prev !== fp) { chrome.runtime.reload(); return "reload"; }
  return prev ? "same" : "init";
}

if (chrome.alarms) {
  chrome.alarms.create("self-check", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((a) => (a.name === "self-check" ? selfCheck() : undefined));
}
selfCheck();

async function status() {
  const b = await getStore("breaker", {});
  const live = Object.fromEntries(Object.entries(b).filter(([, t]) => t > Date.now()));
  return { ok: true, version: chrome.runtime.getManifest().version, store: !!chrome.runtime.getManifest().update_url, googleLast10Min: googleTimes.filter((t) => Date.now() - t < 600000).length, breaker: live, allowed: await allowedOrigins() };
}

async function handle(msg, sender) {
  // lệnh từ popup (không có tab) được tin cậy
  if (msg.type === "popup:status") return status();
  if (msg.type === "popup:allow") { const a = await getStore("allowed", []); if (!a.includes(msg.origin)) a.push(msg.origin); await setStore("allowed", a); return status(); }
  if (msg.type === "popup:clear") { await setStore("breaker", {}); return status(); }
  if (msg.type === "popup:selfcheck") return { ok: true, result: await selfCheck(1) };

  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : "");
  const allowed = (await allowedOrigins()).includes(origin);
  if (msg.type === "ping") return { ok: true, version: chrome.runtime.getManifest().version, store: !!chrome.runtime.getManifest().update_url, allowed, origin };
  if (!allowed) return { ok: false, error: "not_allowed", origin, message: "Bấm biểu tượng tiện ích → “Cho phép trang này”." };

  const p = msg.payload || {};
  switch (msg.type) {
    case "googleAI": return withGoogleQueue(() => googleRead(String(p.q || "").slice(0, 300), true));
    case "googleSearch": return withGoogleQueue(() => googleRead(String(p.q || "").slice(0, 300), false));
    case "fetchPage": return fetchPage(String(p.url || ""));
    case "status": return status();
    default: return { ok: false, error: "Lệnh không hỗ trợ" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  inflight++;
  handle(msg, sender)
    .then((r) => { inflight--; sendResponse(r); })
    .catch((e) => { inflight--; sendResponse({ ok: false, error: String((e && e.message) || e) }); });
  return true;
});
