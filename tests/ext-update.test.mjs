// Cập nhật tiện ích: đóng gói zip, báo bản mới, tự tải lại khi file đổi (bản cài từ thư mục).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExtension } from "../scripts/build-extension.mjs";
import { compareVersions, extUpdateNotice } from "../web/js/lib/version.js";

const EXT = new URL("../extension/", import.meta.url);
const sha = (b) => createHash("sha256").update(b).digest("hex");

// đọc zip bằng thư mục trung tâm để kiểm tra file zip hợp lệ
function readZip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "có EOCD");
  const n = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const data = inflateRawSync(buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize));
    assert.equal(data.length, usize);
    out[name] = data;
    p += 46 + nl;
  }
  return out;
}

test("build:ext tạo zip hợp lệ, đúng nội dung, không kèm tài liệu; version.json khớp manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "po-ext-"));
  const info = buildExtension({ webDir: join(dir, "web"), distDir: join(dir, "dist"), builtAt: "2026-01-01T00:00:00Z" });
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", EXT), "utf8"));
  assert.equal(info.version, manifest.version);
  const zipBuf = readFileSync(join(dir, "web", "mua-hang-extension.zip"));
  assert.equal(info.sha256, sha(zipBuf));
  const files = readZip(zipBuf);
  const expected = readdirSync(EXT).filter((f) => !/\.md$/i.test(f) && !f.startsWith("STORE"));
  assert.deepEqual(Object.keys(files).sort(), expected.sort());
  for (const f of expected) assert.equal(sha(files[f]), sha(readFileSync(new URL(f, EXT))), f);
  assert.ok(files["manifest.json"] && files["background.js"] && files["bridge.js"]);
  assert.ok(existsSync(join(dir, "dist", `mua-hang-extension-v${manifest.version}.zip`)));
  const vj = JSON.parse(readFileSync(join(dir, "web", "version.json"), "utf8"));
  assert.equal(vj.version, manifest.version);
  assert.equal(vj.files.length, expected.length);
  // cùng nội dung -> cùng file zip (dễ kiểm chứng, không đổi vô cớ)
  const again = buildExtension({ webDir: join(dir, "web2"), distDir: join(dir, "dist2"), builtAt: "x" });
  assert.equal(again.sha256, info.sha256);
});

test("so sánh phiên bản và quyết định báo cập nhật", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.1", "1.1.0"), 0);
  assert.equal(compareVersions("1.0.9", "1.1.0"), -1);
  const latest = { version: "1.2.0" };
  assert.equal(extUpdateNotice({ installed: true, version: "1.2.0" }, latest), null, "đã mới nhất");
  assert.deepEqual(extUpdateNotice({ installed: true, version: "1.1.0", store: false }, latest), { kind: "folder", current: "1.1.0", latest: "1.2.0" });
  assert.equal(extUpdateNotice({ installed: true, version: "1.1.0", store: true }, latest).kind, "store");
  assert.equal(extUpdateNotice({ installed: false }, latest).kind, "install");
  assert.equal(extUpdateNotice({ installed: true, version: "1.1.0" }, latest, "1.2.0"), null, "đã bấm Ẩn cho bản này");
  assert.equal(extUpdateNotice({ installed: true, version: "1.1.0" }, { version: "1.3.0" }, "1.2.0").latest, "1.3.0", "bản còn mới hơn thì báo lại");
  assert.equal(extUpdateNotice({ installed: true, version: "1.1.0" }, null), null);
});

// ---- tự tải lại ----
function loadUnpacked({ files, store = false }) {
  const state = { reloads: 0, alarmCreated: null, onAlarm: null, storage: {}, files: { ...files } };
  const src = readFileSync(new URL("background.js", EXT), "utf8");
  const chrome = {
    runtime: {
      getManifest: () => (store ? { version: "1.0.0", update_url: "https://clients2.google.com/service/update2/crx" } : { version: "1.0.0" }),
      getURL: (f) => "chrome-extension://abc/" + f,
      reload: () => { state.reloads++; },
      onMessage: { addListener(fn) { chrome._on = fn; } },
    },
    alarms: { create: (n, o) => { state.alarmCreated = [n, o]; }, onAlarm: { addListener(fn) { state.onAlarm = fn; } } },
    storage: { local: { get: async (k) => (k in state.storage ? { [k]: state.storage[k] } : {}), set: async (o) => Object.assign(state.storage, o) } },
    tabs: { create: async () => ({ id: 1 }), get: async () => ({ status: "complete" }), update: async () => {}, remove: async () => {}, onUpdated: { addListener() {}, removeListener() {} } },
    windows: { update: async () => {} },
    scripting: { executeScript: async () => [] },
  };
  const fetchImpl = async (u) => {
    if (!String(u).startsWith("chrome-extension://")) { if (state.hang) await state.hang; return new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }); }
    const f = String(u).replace("chrome-extension://abc/", "");
    return new Response(state.files[f] ?? "", { status: 200 });
  };
  const sandbox = { chrome, fetch: fetchImpl, crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout, URL, URLSearchParams, AbortController, Date, Math, Promise, Object, Array, JSON, Number, String, Set, Map, console };
  sandbox.importScripts = (f) => vm.runInContext(readFileSync(new URL(f, EXT), "utf8"), sandbox);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const send = (msg, origin = "http://localhost:8787") => new Promise((resolve) => chrome._on(msg, { origin }, resolve));
  // lần kiểm tra lúc khởi động chạy nền; đợi nó xong để kết quả các bước sau không phụ thuộc thứ tự chạy
  const ready = new Promise((r) => setTimeout(r, 40));
  return { state, send, ready, check: async () => { await ready; return (await send({ type: "popup:selfcheck" })).result; } };
}

const FILES = { "manifest.json": '{"version":"1.0.0"}', "background.js": "a", "ai-extract.js": "b", "bridge.js": "c", "popup.html": "d", "popup.js": "e" };

test("tự tải lại: file đổi (git pull / chép đè) thì tiện ích tự reload; không đổi thì không", async () => {
  const t = loadUnpacked({ files: FILES });
  await t.ready;
  assert.equal(JSON.stringify(t.state.alarmCreated), JSON.stringify(["self-check", { periodInMinutes: 1 }]), "kiểm tra mỗi phút");
  assert.equal(await t.check(), "same", "lần khởi động đã ghi nhận phiên bản hiện tại");
  assert.equal(await t.check(), "same");
  assert.equal(t.state.reloads, 0);
  t.state.files["background.js"] = "a-moi";
  assert.equal(await t.check(), "reload");
  assert.equal(t.state.reloads, 1);
  assert.equal(await t.check(), "same", "đã ghi nhận bản mới, không reload lặp");
  t.state.files["manifest.json"] = '{"version":"1.2.0"}';
  assert.equal(await t.state.onAlarm({ name: "self-check" }), "reload", "báo thức định kỳ cũng kiểm tra");
  assert.equal(t.state.reloads, 2);
});

test("tự tải lại: bản Web Store (có update_url) để Chrome tự cập nhật, không kiểm tra file", async () => {
  const t = loadUnpacked({ files: FILES, store: true });
  assert.equal(await t.check(), "store");
  t.state.files["background.js"] = "doi";
  assert.equal(await t.check(), "store");
  assert.equal(t.state.reloads, 0);
});

test("tự tải lại: đang xử lý yêu cầu thì hoãn, không ngắt giữa chừng", async () => {
  const t = loadUnpacked({ files: FILES });
  await t.check();
  t.state.files["bridge.js"] = "doi";
  let release;
  t.state.hang = new Promise((r) => { release = r; });
  const work = t.send({ type: "fetchPage", payload: { url: "https://a.vn/" } }); // yêu cầu tải trang đang treo
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await t.state.onAlarm({ name: "self-check" }), "busy");
  assert.equal(t.state.reloads, 0);
  release();
  await work;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await t.state.onAlarm({ name: "self-check" }), "reload", "xong việc thì mới tải lại");
});

test("tiện ích khai báo quyền alarms và báo phiên bản + nguồn cài trong ping", async () => {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", EXT), "utf8"));
  assert.ok(manifest.permissions.includes("alarms"));
  const t = loadUnpacked({ files: FILES });
  const pong = await t.send({ type: "ping" });
  assert.equal(pong.ok, true);
  assert.equal(pong.store, false);
  assert.equal(pong.version, "1.0.0");
});
