// Cầu nối tới tiện ích Chrome "Mua hàng thông minh — cầu nối Google" (nếu đã cài).
// Trang chỉ gửi postMessage; tiện ích tự kiểm tra trang này có được phép không.
export function createBridge(win = typeof window !== "undefined" ? window : null) {
  const pending = new Map();
  let seq = 0;
  let status = null, statusAt = 0;

  win?.addEventListener("message", (ev) => {
    const d = ev.data;
    if (ev.source !== win || !d || d.source !== "po-ext") return;
    const done = pending.get(d.id);
    if (done) { pending.delete(d.id); done(d.res); }
  });

  function call(type, payload = {}, timeoutMs = 60000) {
    return new Promise((resolve) => {
      if (!win) return resolve({ ok: false, error: "no_window" });
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "timeout" }); }, timeoutMs);
      pending.set(id, (res) => { clearTimeout(timer); resolve(res ?? { ok: false, error: "empty" }); });
      win.postMessage({ source: "po-app", id, type, payload }, win.location.origin);
    });
  }

  return {
    call,
    /** { installed, allowed, version, origin } — nhớ 5 giây để không hỏi liên tục */
    async status(force = false) {
      if (!force && status && Date.now() - statusAt < 5000) return status;
      const r = await call("ping", {}, 1200);
      status = r.ok ? { installed: true, allowed: !!r.allowed, version: r.version, store: !!r.store, origin: r.origin } : { installed: false, allowed: false };
      statusAt = Date.now();
      return status;
    },
  };
}
