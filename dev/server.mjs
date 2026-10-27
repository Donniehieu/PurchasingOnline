// Máy chủ chạy thử trên máy (Node, không cần Python): phục vụ web/ và chạy cùng mã backend với Worker.
//   npm run dev        -> http://localhost:8787
// Đọc khóa từ .dev.vars (cùng định dạng wrangler) hoặc biến môi trường. Không có khóa => chế độ MẪU.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../worker/index.js";
import { mockPages } from "./mock-pages.mjs";
import { encodePng } from "../scripts/png.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB = join(ROOT, "web");
const PORT = Number(process.env.PORT || 8787);

function loadVars() {
  const out = {};
  const f = join(ROOT, ".dev.vars");
  if (existsSync(f)) {
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const env = { ...loadVars(), ...Object.fromEntries(["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "APP_CODE", "CLAUDE_MODEL", "GEMINI_MODEL", "MOCK"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])), ALLOW_LOCAL: "1" };
if (!env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY && env.MOCK == null) env.MOCK = "1";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function mockImage(n) {
  const w = 480, h = 480, px = new Uint8Array(w * h * 4);
  const colors = [[239, 108, 0], [0, 121, 107], [94, 53, 177], [2, 119, 189], [194, 24, 91]];
  const [r, g, b] = colors[(Number(n) || 1) % colors.length];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const dx = x - w / 2, dy = y - h / 2, d = Math.sqrt(dx * dx + dy * dy);
    const inBody = d < 170 || (Math.abs(dx) < 150 && dy > 20 && dy < 160);
    const k = inBody ? 1 : 0.18;
    px[i] = 255 - (255 - r) * k; px[i + 1] = 255 - (255 - g) * k; px[i + 2] = 255 - (255 - b) * k; px[i + 3] = 255;
  }
  return encodePng(w, h, px);
}

async function sendResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = url.origin;
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks);
      const request = new Request(url, { method: req.method, headers: req.headers, body });
      return sendResponse(res, await handle(request, env));
    }
    if (url.pathname.startsWith("/mock/img/")) {
      const png = mockImage(url.pathname.split("/").pop().replace(/\D/g, ""));
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(png);
    }
    if (url.pathname.startsWith("/mock/")) {
      const html = mockPages(origin)[url.pathname];
      if (!html) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (!rel || rel.endsWith("/") || rel.endsWith("\\")) rel = join(rel, "index.html");
    let file = join(WEB, rel);
    if (!file.startsWith(WEB)) { res.writeHead(403); return res.end("forbidden"); }
    if (!existsSync(file) || (await stat(file)).isDirectory()) file = join(WEB, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Lỗi: " + e.message);
  }
});

server.listen(PORT, () => {
  const mode = env.MOCK === "1" ? "CHẾ ĐỘ MẪU (chưa có khóa AI, dữ liệu hư cấu)" : env.ANTHROPIC_API_KEY ? "Claude" : "Gemini";
  console.log(`Mua hàng thông minh chạy tại http://localhost:${PORT}  [${mode}]`);
});
