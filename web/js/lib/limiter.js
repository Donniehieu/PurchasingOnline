// Giới hạn tốc độ "lịch sự": mỗi tên miền cách nhau vài giây, tối đa N trang cùng lúc,
// và tự ngắt (circuit breaker) một tên miền sau 403/429/CAPTCHA để không gửi thêm yêu cầu vô ích.
const KEY = "po-breaker";

export function createLimiter({ hostGapMs = 2200, concurrency = 3, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), storage = safeStorage(), rand = Math.random } = {}) {
  const next = new Map();   // host -> thời điểm sớm nhất được gọi tiếp
  let active = 0;
  const waiters = [];
  let breaker = load();

  function load() { try { return JSON.parse(storage?.getItem(KEY) || "{}"); } catch { return {}; } }
  function save() { try { storage?.setItem(KEY, JSON.stringify(breaker)); } catch { /* chế độ riêng tư */ } }
  function sweep() { const t = now(); for (const h of Object.keys(breaker)) if (breaker[h] <= t) delete breaker[h]; }

  const api = {
    isBlocked(host) { sweep(); return breaker[host] > now() ? breaker[host] : 0; },
    trip(host, ms = 30 * 60 * 1000) { breaker[host] = now() + Math.min(ms, 2 * 3600 * 1000); save(); },
    clear() { breaker = {}; save(); },
    blocked() { sweep(); return { ...breaker }; },

    /** Chạy task cho một tên miền: chờ tới lượt, giữ giãn cách, bỏ qua nếu tên miền đang bị ngắt. */
    async run(host, task) {
      const until = api.isBlocked(host);
      if (until) return { ok: false, blocked: true, skipped: true, error: `Tạm ngừng ${host} (đã bị chặn gần đây), thử lại sau ${new Date(until).toLocaleTimeString("vi-VN")}` };
      if (active >= concurrency) await new Promise((r) => waiters.push(r));
      active++;
      try {
        const at = Math.max(now(), next.get(host) ?? 0);
        next.set(host, at + hostGapMs + Math.floor(rand() * hostGapMs * 0.4)); // đặt chỗ trước cho yêu cầu kế tiếp
        const wait = at - now();
        if (wait > 0) await sleep(wait);
        if (api.isBlocked(host)) return { ok: false, blocked: true, skipped: true, error: `Tạm ngừng ${host}` };
        const res = await task();
        if (res && res.blocked && !res.skipped) api.trip(host, res.retryAfter ? res.retryAfter * 1000 : undefined);
        return res;
      } finally {
        active--;
        const w = waiters.shift();
        if (w) w();
      }
    },
  };
  return api;
}

function safeStorage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}
