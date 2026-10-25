// Album ảnh của từng yêu cầu: lưu trong IndexedDB của trình duyệt (ảnh thu nhỏ), kèm nguồn và độ giống ảnh gốc.
// Crawl ảnh cần chạy dạng tiện ích (tải ảnh từ website khác không bị chặn CORS).
import { googleImages, isExt, sleep } from "./net.js";

const DB_NAME = "po_album", STORE = "photos", THUMB_MAX = 640, MIN_SIDE = 150, MAX_BYTES = 6 * 1024 * 1024;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { const s = req.result.createObjectStore(STORE, { keyPath: "id" }); s.createIndex("jobId", "jobId"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = async (mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && "result" in out ? out.result : out);
    t.onerror = () => reject(t.error);
  });
};

export const listPhotos = (jobId) => tx("readonly", (s) => s.index("jobId").getAll(jobId));
export const putPhoto = (photo) => tx("readwrite", (s) => s.put(photo));
export const deletePhoto = (id) => tx("readwrite", (s) => s.delete(id));
export async function deleteJobPhotos(jobId) { for (const p of await listPhotos(jobId)) await deletePhoto(p.id); }
export async function clearAll() { await tx("readwrite", (s) => s.clear()); }

/* ---------------- xử lý ảnh ---------------- */
async function sha1(buffer) {
  const hash = await crypto.subtle.digest("SHA-1", buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
/** Dấu vân tay ảnh 64 bit (dHash) dạng chuỗi nhị phân. Ảnh giống nhau, dù khác kích thước hay nén, cho dấu gần nhau. */
function dhash(bitmap) {
  const c = new OffscreenCanvas(9, 8), ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data, gray = (i) => d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray(y * 9 + x) > gray(y * 9 + x + 1) ? "1" : "0";
  return bits;
}
export function similarity(a, b) {
  let diff = 0;
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) diff++;
  return Math.round((1 - diff / 64) * 100);
}
async function thumbnail(bitmap) {
  const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
  const c = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}
async function analyze(blob) {
  const buffer = await blob.arrayBuffer(), bitmap = await createImageBitmap(blob);
  return { buffer, bitmap, digest: await sha1(buffer), hash: dhash(bitmap) };
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14));

/* ---------------- ảnh người dùng up ---------------- */
export async function addUploads(jobId, files) {
  const existing = new Set((await listPhotos(jobId)).map((p) => p.digest)), added = [];
  for (const file of files) {
    let info;
    try { info = await analyze(file); } catch { continue; } // không phải ảnh
    if (existing.has(info.digest)) { info.bitmap.close(); continue; }
    const photo = { id: uid(), jobId, source: "upload", title: file.name.slice(0, 160), page_url: "", image_url: "", engine: "upload", query: "",
      width: info.bitmap.width, height: info.bitmap.height, digest: info.digest, hash: info.hash, match: null, blob: await thumbnail(info.bitmap), time: Date.now() };
    info.bitmap.close(); await putPhoto(photo); existing.add(info.digest); added.push(photo);
  }
  return added;
}

/* ---------------- crawl từ Google Hình ảnh ---------------- */
async function fetchImage(url, referrer) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000), referrer: referrer || undefined });
    if (!r.ok || !(r.headers.get("content-type") || "").startsWith("image/")) return null;
    const blob = await r.blob();
    return blob.size > MAX_BYTES ? null : blob;
  } catch { return null; }
}
/** Tải ảnh gốc, không được thì dùng ảnh thu nhỏ của trang kết quả (data: hoặc link gstatic). */
async function downloadImage(item) {
  for (const [url, ref] of [[item.image_url, item.page_url], [item.thumb_url, ""]]) {
    if (!url) continue;
    const blob = await fetchImage(url, ref);
    if (!blob) continue;
    try { return await analyze(blob); } catch { /* thử nguồn khác */ }
  }
  return null;
}

/**
 * Tìm ảnh theo "tên + mã/model" trên Google Hình ảnh và lấy `limit` ảnh đầu tiên (1-20) vào album của yêu cầu.
 * Ảnh trùng nội dung bị bỏ; có ảnh do bạn up thì tính độ giống để so khớp. Tải lần lượt, nghỉ `gapMs` giữa các ảnh.
 * Trả về { added, tried, error }.
 */
export async function crawlAlbum(jobId, query, limit = 3, gapMs = 400) {
  if (!isExt) return { added: [], tried: 0, error: "Crawl ảnh chỉ chạy khi cài làm tiện ích trình duyệt" };
  limit = Math.min(20, Math.max(1, Math.round(limit) || 3));
  let candidates;
  try { candidates = await googleImages(query); } catch (e) { return { added: [], tried: 0, error: e.message }; }
  if (!candidates.length) return { added: [], tried: 0, error: "Google Hình ảnh không trả ảnh nào (có thể đang yêu cầu xác minh hoặc đổi cấu trúc)" };
  const have = await listPhotos(jobId), knownDigests = new Set(have.map((p) => p.digest)), knownUrls = new Set(have.map((p) => p.image_url));
  const refs = have.filter((p) => p.source === "upload").map((p) => p.hash);
  const seenUrls = new Set(); candidates = candidates.filter((c) => c.image_url && !knownUrls.has(c.image_url) && !seenUrls.has(c.image_url) && seenUrls.add(c.image_url));

  const added = []; let tried = 0;
  for (const item of candidates) {
    if (added.length >= limit || tried >= limit * 6) break;
    tried++;
    const info = await downloadImage(item);
    if (info) {
      const { bitmap, digest, hash } = info;
      if (Math.min(bitmap.width, bitmap.height) < MIN_SIDE || knownDigests.has(digest)) bitmap.close();
      else {
        knownDigests.add(digest);
        const photo = { id: uid(), jobId, source: "web", title: (item.title || "").slice(0, 160), page_url: item.page_url, image_url: item.image_url, engine: "Google Hình ảnh", query,
          width: bitmap.width, height: bitmap.height, digest, hash, match: refs.length ? Math.max(...refs.map((r) => similarity(hash, r))) : null, blob: await thumbnail(bitmap), time: Date.now() };
        bitmap.close(); await putPhoto(photo); added.push(photo);
      }
    }
    await sleep(gapMs);
  }
  return { added, tried, error: "" };
}
