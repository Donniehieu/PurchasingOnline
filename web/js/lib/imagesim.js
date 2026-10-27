// Độ giống ảnh (gần đúng, chạy ngay trên máy): dấu vân tay hình dạng dHash 64 bit + biểu đồ màu 4x4x4.
// Dùng để ưu tiên các ảnh tìm được GIỐNG HOẶC GẦN GIỐNG ảnh tham chiếu người dùng đưa vào (không cần giống hệt).
// Tách riêng phần tính toán thuần (nhận điểm ảnh RGBA) để kiểm thử; phần đọc ảnh bằng canvas nằm ở app.js.

/** rgba16: ImageData 16x16 (biểu đồ màu); rgba9x8: ImageData 9x8 (dHash). Mỗi mảng là Uint8ClampedArray RGBA. */
export function featuresFromRGBA(rgba16, rgba9x8) {
  const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const bits = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(gray(rgba9x8, (y * 9 + x) * 4) > gray(rgba9x8, (y * 9 + x + 1) * 4) ? 1 : 0);
  const hist = new Array(64).fill(0);
  let n = 0;
  for (let i = 0; i < rgba16.length; i += 4) {
    if (rgba16[i + 3] < 32) continue; // bỏ điểm trong suốt
    hist[(rgba16[i] >> 6) * 16 + (rgba16[i + 1] >> 6) * 4 + (rgba16[i + 2] >> 6)]++;
    n++;
  }
  return { hash: bits.join(""), hist: hist.map((v) => (n ? +(v / n).toFixed(4) : 0)) };
}

/** 0..1: 1 = giống hệt. Gộp hình dạng (55%) và màu sắc (45%). Thiếu dữ liệu thì 0. */
export function similarity(a, b) {
  if (!a?.hash || !b?.hash || !a.hist || !b.hist) return 0;
  let diff = 0;
  for (let i = 0; i < a.hash.length; i++) if (a.hash[i] !== b.hash[i]) diff++;
  const shape = 1 - diff / a.hash.length;
  let inter = 0;
  for (let i = 0; i < a.hist.length; i++) inter += Math.min(a.hist[i], b.hist[i]);
  return +(0.55 * shape + 0.45 * inter).toFixed(3);
}

/**
 * Xếp lại danh sách ảnh theo độ giống ảnh tham chiếu (cao trước), ghi im.sim, rồi giữ tối đa `keep` ảnh.
 * getFeatures(url) -> features | null (không tải được thì giữ ảnh ở cuối, không bỏ). Trả về { ranked, best, failed }.
 */
export async function rankBySimilarity(images, ref, getFeatures, { concurrency = 4, keep = images.length, maxFetch = 24 } = {}) {
  const list = images.slice(0, maxFetch);
  let i = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (i < list.length) {
      const im = list[i++];
      let f = null;
      try { f = await getFeatures(im.url); } catch { f = null; }
      if (f) im.sim = similarity(ref, f); else failed++;
    }
  }));
  const order = images.map((im, idx) => ({ im, idx }));
  order.sort((x, y) => (y.im.sim ?? -1) - (x.im.sim ?? -1) || x.idx - y.idx);
  const ranked = order.map((o) => o.im).slice(0, keep);
  return { ranked, best: ranked.find((x) => x.sim != null)?.sim ?? null, failed };
}
