// Lưu mô hình nhận diện ảnh trên máy và CHỈ tải lại khi mô hình gốc thay đổi.
//  - CLIP (Transformers.js): tệp mô hình nằm trong Cache API "transformers-cache" (tự có sẵn của thư viện).
//  - COCO-SSD, MobileNet (TensorFlow.js): lưu vào IndexedDB (indexeddb://...) sau lần tải đầu; các lần sau nạp thẳng từ máy, không tải lại.
//  - Tesseract (OCR): thư viện tự lưu dữ liệu tiếng Việt trong IndexedDB.
// Mỗi mô hình có "dấu vết bản" của nguồn gốc (sha trên Hugging Face / băm tệp model.json). Mỗi lần dùng (tối đa 1 lần/12 giờ) chỉ gọi
// một yêu cầu nhỏ để so dấu vết; khác thì xóa bản đã lưu và tải bản mới, giống nhau thì dùng luôn bản trên máy.

const KEY = "po-model-stamps";
export const CHECK_EVERY_MS = 12 * 3600 * 1000;

export const MODEL_SOURCES = {
  clip: { label: "CLIP (nhận diện loại sản phẩm)", size: "~90 MB", url: "https://huggingface.co/api/models/Xenova/clip-vit-base-patch32", kind: "hf" },
  coco: { label: "COCO-SSD (phát hiện vật thể)", size: "~5 MB", url: "https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json", kind: "json", store: "indexeddb://po-coco-ssd-lite" },
  mobilenet: { label: "MobileNet ImageNet (phân loại)", size: "~14 MB", url: "https://tfhub.dev/google/imagenet/mobilenet_v2_100_224/classification/2/model.json?tfjs-format=file", kind: "json", store: "indexeddb://po-mobilenet-v2" },
};

/** Băm chuỗi ngắn (FNV-1a 32 bit) để làm dấu vết nội dung model.json. */
export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

function readStamps(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(KEY) || "{}"); } catch { return {}; }
}
function writeStamps(s, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* chế độ riêng tư */ }
}
export const getStamps = readStamps;

/** Lấy dấu vết bản hiện tại của nguồn gốc. fetchImpl có thể thay khi kiểm thử. Ném lỗi nếu không kết nối được. */
export async function remoteStamp(id, fetchImpl = fetch) {
  const src = MODEL_SOURCES[id];
  if (!src) throw new Error("mô hình lạ: " + id);
  const r = await fetchImpl(src.url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  if (src.kind === "hf") { const j = await r.json(); return String(j.sha || j.lastModified || ""); }
  return fnv(await r.text());
}

/**
 * Quyết định dùng bản đã lưu hay tải mới (hàm thuần).
 *  stored: { stamp, checkedAt } | undefined; remote: dấu vết nguồn (hoặc null nếu không hỏi được); now.
 * Trả về "download" (chưa có), "use" (dùng bản trên máy), "check" (đến hạn kiểm tra), "update" (nguồn đã đổi).
 */
export function decide({ stored, remote, now = Date.now(), everyMs = CHECK_EVERY_MS }) {
  if (!stored?.stamp) return "download";
  if (remote == null) return now - (stored.checkedAt ?? 0) >= everyMs ? "check" : "use";
  return remote === stored.stamp ? "use" : "update";
}

/**
 * Trước khi dùng mô hình đã có trên máy: so dấu vết nếu đến hạn. Trả về { action: "download"|"use"|"update", offline? }.
 * "update" nghĩa là nguồn đã đổi: người gọi phải xóa bản cũ rồi tải bản mới (rồi gọi markStored).
 */
export async function checkBeforeUse(id, { fetchImpl = fetch, now = Date.now(), storage = globalThis.localStorage, force = false } = {}) {
  const stamps = readStamps(storage);
  const stored = stamps[id];
  if (!stored?.stamp) return { action: "download" };
  if (!force && decide({ stored, remote: null, now }) === "use") return { action: "use", skipped: true };
  let remote;
  try { remote = await remoteStamp(id, fetchImpl); }
  catch { return { action: "use", offline: true }; } // không hỏi được nguồn: cứ dùng bản đã lưu
  const action = decide({ stored, remote, now });
  if (action === "use") { stamps[id] = { ...stored, checkedAt: now }; writeStamps(stamps, storage); }
  return { action, remote };
}

/** Ghi nhận đã lưu mô hình (kèm dấu vết nguồn lúc tải). */
export async function markStored(id, { fetchImpl = fetch, now = Date.now(), storage = globalThis.localStorage, stamp } = {}) {
  let s = stamp;
  if (s == null) { try { s = await remoteStamp(id, fetchImpl); } catch { s = "unknown"; } }
  const stamps = readStamps(storage);
  stamps[id] = { stamp: s, storedAt: now, checkedAt: now };
  writeStamps(stamps, storage);
}

export function forget(id, storage = globalThis.localStorage) {
  const stamps = readStamps(storage);
  delete stamps[id];
  writeStamps(stamps, storage);
}

// ----- thao tác trên kho của trình duyệt (cần trình duyệt) -----
export async function hasTfModel(tf, uri) {
  try { return !!(await tf.io.listModels())[uri]; } catch { return false; }
}
export async function removeTfModel(tf, uri) {
  try { await tf.io.removeModel(uri); } catch { /* chưa có */ }
}
export async function purgeClipCache() {
  try {
    if (!globalThis.caches) return;
    const c = await caches.open("transformers-cache");
    for (const req of await c.keys()) if (/Xenova\/clip-vit-base-patch32/.test(req.url)) await c.delete(req);
  } catch { /* bỏ qua */ }
}

/** Xóa mọi mô hình đã tải (CLIP, COCO-SSD, MobileNet). Tesseract do thư viện tự quản lý. */
export async function purgeAll(tf) {
  if (tf) for (const m of Object.values(MODEL_SOURCES)) if (m.store) await removeTfModel(tf, m.store);
  await purgeClipCache();
  for (const id of Object.keys(MODEL_SOURCES)) forget(id);
}
