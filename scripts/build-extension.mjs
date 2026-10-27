// Đóng gói tiện ích Chrome: tạo zip + version.json để app báo bản mới và để đăng lên Chrome Web Store.
//   npm run build:ext   ->  web/ext/mua-hang-extension.zip, web/ext/version.json, dist/mua-hang-extension-v<phiên bản>.zip
// Chạy tự động trước `npm run dev` và `npm run deploy`, nên mỗi lần deploy app là bản tiện ích mới nhất được phát hành kèm.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeZip } from "./zip.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const EXCLUDE = /(\.md$|^STORE|\.DS_Store$|^\.)/i;

export function buildExtension({ srcDir = join(ROOT, "extension"), webDir = join(ROOT, "web", "ext"), distDir = join(ROOT, "dist"), builtAt = new Date().toISOString() } = {}) {
  const manifest = JSON.parse(readFileSync(join(srcDir, "manifest.json"), "utf8"));
  const names = readdirSync(srcDir, { withFileTypes: true }).filter((d) => d.isFile() && !EXCLUDE.test(d.name)).map((d) => d.name).sort();
  const files = names.map((n) => ({ path: n, data: readFileSync(join(srcDir, n)) }));
  const zip = makeZip(files);
  const info = {
    name: manifest.name,
    version: manifest.version,
    zip: "mua-hang-extension.zip",
    size: zip.length,
    sha256: sha256(zip),
    files: files.map((f) => ({ path: f.path, sha256: sha256(f.data) })),
    builtAt,
  };
  mkdirSync(webDir, { recursive: true });
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(webDir, info.zip), zip);
  writeFileSync(join(webDir, "version.json"), JSON.stringify(info, null, 2) + "\n");
  writeFileSync(join(distDir, `mua-hang-extension-v${manifest.version}.zip`), zip);
  return info;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = buildExtension();
  console.log(`Tiện ích ${i.version}: ${i.files.length} file, ${i.size} byte -> web/ext/${i.zip}, dist/mua-hang-extension-v${i.version}.zip`);
}
