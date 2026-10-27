// Tạo biểu tượng PWA (PNG 192/512 + maskable) và SVG: kính lúp trên nền xanh. Chạy: npm run icons
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, hex } from "./png.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "icons");
mkdirSync(OUT, { recursive: true });
const BG = hex("#2b4ccf"), FG = hex("#ffffff");

// Khoảng cách có dấu tới các hình để tô mép mịn (SS = siêu mẫu 3x3)
function draw(size, { full }) {
  const px = new Uint8Array(size * size * 4);
  const S = 3;
  const u = size / 100;
  const pad = full ? 0 : 6 * u; // bản "any" có nền bo góc; bản maskable tràn viền
  const R = full ? 0 : 22 * u;
  const k = full ? 0.78 : 1;       // maskable: thu nhỏ biểu tượng vào vùng an toàn
  const cx = 44 * u * k + (full ? 11 * u : 0), cy = 44 * u * k + (full ? 11 * u : 0);
  const r = 22 * u * k, th = 7 * u * k;
  const hx1 = cx + r * 0.72, hy1 = cy + r * 0.72, hx2 = cx + r * 0.72 + 26 * u * k, hy2 = cy + r * 0.72 + 26 * u * k;
  const hth = 8 * u * k;
  const inRound = (x, y) => {
    const qx = Math.abs(x - size / 2) - (size / 2 - pad - R), qy = Math.abs(y - size / 2) - (size / 2 - pad - R);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= R;
  };
  const segDist = (x, y) => {
    const dx = hx2 - hx1, dy = hy2 - hy1;
    const t = Math.max(0, Math.min(1, ((x - hx1) * dx + (y - hy1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (hx1 + t * dx), y - (hy1 + t * dy));
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let bg = 0, fg = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const X = x + (sx + 0.5) / S, Y = y + (sy + 0.5) / S;
      if (full || inRound(X, Y)) {
        bg++;
        const ring = Math.abs(Math.hypot(X - cx, Y - cy) - r) <= th / 2;
        if (ring || segDist(X, Y) <= hth / 2) fg++;
      }
    }
    const i = (y * size + x) * 4, n = S * S;
    const a = bg / n, f = bg ? fg / bg : 0;
    px[i] = Math.round(BG[0] * (1 - f) + FG[0] * f);
    px[i + 1] = Math.round(BG[1] * (1 - f) + FG[1] * f);
    px[i + 2] = Math.round(BG[2] * (1 - f) + FG[2] * f);
    px[i + 3] = Math.round(255 * a);
  }
  return px;
}

for (const [name, size, full] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["icon-maskable-512.png", 512, true]]) {
  writeFileSync(join(OUT, name), encodePng(size, size, draw(size, { full })));
}
writeFileSync(join(OUT, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="6" y="6" width="88" height="88" rx="22" fill="#2b4ccf"/><circle cx="44" cy="44" r="22" fill="none" stroke="#fff" stroke-width="7"/><path d="M60 60 L86 86" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>\n`);
console.log("Đã tạo biểu tượng trong", OUT);
