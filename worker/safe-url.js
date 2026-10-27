// Chặn SSRF: Worker chỉ được mở trang web công khai, không mở địa chỉ nội bộ.

const BAD_HOST = /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/i;

function privateV4(h) {
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export function checkUrl(raw, { allowLocal = false } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch { return { ok: false, reason: "URL không hợp lệ" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "Chỉ hỗ trợ http/https" };
  if (u.username || u.password) return { ok: false, reason: "URL không được chứa tài khoản" };
  if (allowLocal) return { ok: true, url: u };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (BAD_HOST.test(host) || !host.includes(".") && !host.includes(":")) return { ok: false, reason: "Địa chỉ nội bộ bị chặn" };
  if (privateV4(host)) return { ok: false, reason: "Địa chỉ nội bộ bị chặn" };
  if (host.includes(":")) return { ok: false, reason: "Địa chỉ IPv6 bị chặn" };
  if (u.port && u.port !== "80" && u.port !== "443") return { ok: false, reason: "Cổng không được phép" };
  return { ok: true, url: u };
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 PurchasingOnline/2.0";

/**
 * Tải một trang HTML (không vượt CAPTCHA, không thử lại). Theo chuyển hướng tối đa 4 lần,
 * kiểm tra lại từng chặng; đọc tối đa maxBytes.
 */
export async function fetchHtml(rawUrl, { timeoutMs = 9000, maxBytes = 300_000, allowLocal = false, fetchImpl = fetch } = {}) {
  const t0 = Date.now();
  let current = rawUrl;
  for (let hop = 0; hop <= 4; hop++) {
    const chk = checkUrl(current, { allowLocal });
    if (!chk.ok) return { ok: false, error: chk.reason, status: 0, ms: Date.now() - t0 };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(chk.url.href, {
        redirect: "manual",
        signal: ctl.signal,
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": "vi-VN,vi;q=0.9,en;q=0.6",
          "upgrade-insecure-requests": "1",
          "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "cross-site", "sec-fetch-user": "?1",
          referer: "https://www.google.com/", // người dùng thường đến từ kết quả Google
        },
      });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, error: e?.name === "AbortError" ? "Quá thời gian chờ" : "Không kết nối được", status: 0, ms: Date.now() - t0 };
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      clearTimeout(timer);
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, error: "Chuyển hướng lỗi", status: res.status, ms: Date.now() - t0 };
      current = new URL(loc, chk.url).href;
      continue;
    }
    if (res.status === 403 || res.status === 429 || res.status === 503) {
      clearTimeout(timer);
      const ra = Number(res.headers.get("retry-after"));
      return { ok: false, error: `Trang chặn truy cập tự động (HTTP ${res.status})`, status: res.status, blocked: true, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined, ms: Date.now() - t0 };
    }
    if (!res.ok) { clearTimeout(timer); return { ok: false, error: `HTTP ${res.status}`, status: res.status, ms: Date.now() - t0 }; }
    const type = res.headers.get("content-type") || "";
    if (type && !/html|xml|text\/plain/i.test(type)) { clearTimeout(timer); return { ok: false, error: "Không phải trang HTML", status: res.status, ms: Date.now() - t0 }; }
    try {
      const html = await readLimited(res, maxBytes, type);
      clearTimeout(timer);
      if (/(captcha|are you a robot|unusual traffic|xác minh bạn không phải)/i.test(html.slice(0, 6000)) && html.length < 20000) {
        return { ok: false, error: "Trang yêu cầu xác minh (CAPTCHA), đã bỏ qua", status: res.status, blocked: true, ms: Date.now() - t0 };
      }
      return { ok: true, html, finalUrl: chk.url.href, status: res.status, ms: Date.now() - t0 };
    } catch {
      clearTimeout(timer);
      return { ok: false, error: "Đọc trang bị gián đoạn", status: res.status, ms: Date.now() - t0 };
    }
  }
  return { ok: false, error: "Chuyển hướng quá nhiều", status: 0, ms: Date.now() - t0 };
}

async function readLimited(res, maxBytes, type) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* đã đọc đủ */ }
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) { const take = Math.min(c.length, buf.length - off); buf.set(c.subarray(0, take), off); off += take; if (off >= buf.length) break; }
  const cs = (type.match(/charset=([\w-]+)/i) || [])[1] || (new TextDecoder("utf-8").decode(buf.subarray(0, 2048)).match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}

/** Tải một ảnh công khai (tối đa maxBytes) để trình duyệt tính độ giống ảnh. Kiểm tra SSRF từng chặng chuyển hướng. */
export async function fetchImage(rawUrl, { timeoutMs = 8000, maxBytes = 1_500_000, allowLocal = false, fetchImpl = fetch } = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= 3; hop++) {
    const chk = checkUrl(current, { allowLocal });
    if (!chk.ok) return { ok: false, error: chk.reason };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(chk.url.href, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": UA, accept: "image/avif,image/webp,image/*,*/*;q=0.8", referer: chk.url.origin + "/" } });
      if ([301, 302, 303, 307, 308].includes(res.status)) { const loc = res.headers.get("location"); if (!loc) return { ok: false, error: "Chuyển hướng lỗi" }; current = new URL(loc, chk.url).href; continue; }
      if (!res.ok) return { ok: false, error: "HTTP " + res.status };
      const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) return { ok: false, error: "Không phải ảnh" };
      const len = Number(res.headers.get("content-length") || 0);
      if (len > maxBytes) return { ok: false, error: "Ảnh quá lớn" };
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) { try { await reader.cancel(); } catch { /* bỏ */ } return { ok: false, error: "Ảnh quá lớn" }; }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { bytes.set(c, off); off += c.length; }
      return { ok: true, bytes, type };
    } catch (e) {
      return { ok: false, error: e?.name === "AbortError" ? "Quá thời gian chờ" : "Không kết nối được" };
    } finally { clearTimeout(timer); }
  }
  return { ok: false, error: "Chuyển hướng quá nhiều" };
}
