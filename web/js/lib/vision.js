// Đọc sản phẩm từ ảnh theo 2 bước (chạy ngay trên máy người dùng, không cần khóa):
//   1) NHẬN DIỆN SẢN PHẨM (phát hiện vật thể, mô hình COCO-SSD/MobileNet giống các mô hình YOLO phát hiện vật thể): ra loại sản phẩm,
//      ví dụ "điện thoại", "tủ lạnh" -> từ khóa sản phẩm khi người dùng KHÔNG nhập gì;
//   2) ĐỌC CHỮ trên ảnh (OCR Tesseract, xem localocr.js / hoặc dịch vụ AI): hãng, mã model, tên trên nhãn.
// Chuỗi tìm = từ khóa sản phẩm (bước 1) + chữ đọc được (bước 2). Nếu người dùng đã gõ thì GIỮ NGUYÊN chữ đã gõ.
// Phần tải mô hình nằm ở detectProduct (cần trình duyệt); các hàm còn lại là hàm thuần để kiểm thử.
import { norm } from "./text.js";

const TF_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const COCO_URL = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const MOBILENET_URL = "https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js";

// Lớp vật thể COCO có thể là sản phẩm -> từ khóa tiếng Việt. Lớp không phải sản phẩm (người, động vật, biển báo...) bị bỏ.
export const PRODUCT_CLASSES = {
  "cell phone": "điện thoại", laptop: "laptop", tv: "tivi", refrigerator: "tủ lạnh", microwave: "lò vi sóng", oven: "lò nướng", toaster: "máy nướng bánh mì",
  "hair drier": "máy sấy tóc", keyboard: "bàn phím", mouse: "chuột máy tính", remote: "điều khiển từ xa", clock: "đồng hồ", bottle: "chai", cup: "cốc", "wine glass": "ly",
  bowl: "bát", fork: "nĩa", knife: "dao", spoon: "thìa", vase: "bình hoa", scissors: "kéo", toothbrush: "bàn chải đánh răng", book: "sách", backpack: "ba lô",
  umbrella: "ô dù", handbag: "túi xách", suitcase: "vali", tie: "cà vạt", chair: "ghế", couch: "ghế sofa", bed: "giường", "dining table": "bàn ăn", sink: "bồn rửa",
  toilet: "bồn cầu", bicycle: "xe đạp", motorcycle: "xe máy", car: "ô tô", "teddy bear": "gấu bông", "sports ball": "bóng", "tennis racket": "vợt tennis",
  skateboard: "ván trượt", "potted plant": "chậu cây", bench: "ghế dài",
};

// Lớp COCO hay bị nhầm với đồ điện lạnh/điện thoại trong ảnh bán hàng (đo thật: điều hòa -> "oven" 80%, điện thoại -> "remote" 63%): cần điểm rất cao mới nhận
const CONFUSABLE = { oven: 0.92, remote: 0.92, microwave: 0.9, toaster: 0.9, sink: 0.9, toilet: 0.9, bench: 0.9, clock: 0.8, vase: 0.8 };

/** Chọn sản phẩm chính trong kết quả phát hiện: lớp là sản phẩm, điểm ≥ ngưỡng, ưu tiên điểm cao và vật to chiếm nhiều khung hình. */
export function pickProduct(preds, { imgW = 1, imgH = 1, minScore = 0.35 } = {}) {
  const area = imgW * imgH || 1;
  const cands = (preds ?? [])
    .filter((p) => PRODUCT_CLASSES[p.class] && p.score >= Math.max(minScore, CONFUSABLE[p.class] ?? 0))
    .map((p) => { const [, , w = 0, h = 0] = p.bbox ?? []; return { cls: p.class, kw: PRODUCT_CLASSES[p.class], score: p.score, share: Math.min(1, (w * h) / area), rank: p.score * (0.4 + Math.min(1, (w * h) / area)) }; })
    .sort((a, b) => b.rank - a.rank);
  return cands[0] ?? null;
}

const has = (hay, needle) => !!needle && ` ${norm(hay)} `.includes(` ${norm(needle)} `);

/**
 * Chuỗi tìm từ ảnh. typed: chữ người dùng đã gõ (nếu có thì giữ nguyên, không ghi đè).
 * product: { kw } từ nhận diện vật thể; ocr: { brand, name, model } đọc từ chữ trên ảnh.
 * Thứ tự: từ khóa sản phẩm + hãng + tên trên nhãn (bỏ phần trùng) + mã model.
 */
export function composeImageQuery({ typed = "", product = null, ocr = null } = {}) {
  const t = String(typed).replace(/\s+/g, " ").trim();
  if (t) return t;
  const parts = [];
  const add = (s) => { const v = String(s ?? "").replace(/\s+/g, " ").trim(); if (v && !parts.some((p) => has(p, v))) parts.push(v); };
  add(product?.kw);
  add(ocr?.brand);
  let name = String(ocr?.name ?? "").replace(/\s+/g, " ").trim();
  // bỏ phần tên đã có trong từ khóa sản phẩm/hãng để không lặp ("điện thoại" + "Điện thoại Samsung Galaxy" -> "Samsung Galaxy")
  for (const known of [product?.kw, ocr?.brand]) if (known && name && has(name, known)) name = name.replace(new RegExp(known.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ").replace(/\s+/g, " ").trim();
  add(name);
  if (ocr?.model && !parts.some((p) => has(p, ocr.model))) add(ocr.model);
  return parts.join(" ");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Không tải được thư viện nhận diện sản phẩm (kiểm tra mạng)"));
    document.head.appendChild(s);
  });
}

let modelP = null;
async function getModel(onStatus) {
  if (!modelP) {
    modelP = (async () => {
      onStatus?.("tải mô hình nhận diện (lần đầu, vài MB)");
      await loadScript(TF_URL);
      await loadScript(COCO_URL);
      return window.cocoSsd.load({ base: "lite_mobilenet_v2" });
    })().catch((e) => { modelP = null; throw e; });
  }
  return modelP;
}

// Lớp ImageNet (1000 lớp, họ mô hình phân loại ImageAI dùng: MobileNet/ResNet/Inception/DenseNet) -> từ khóa sản phẩm tiếng Việt.
// Khớp theo từ khóa trong tên lớp (tên lớp là chuỗi tiếng Anh nhiều cách gọi, ví dụ "washer, automatic washer, washing machine").
export const IMAGENET_PRODUCTS = [
  [/refrigerator|icebox/, "tủ lạnh"], [/cellular telephone|cellphone|mobile phone|\bcell\b|smartphone/, "điện thoại"], [/laptop|notebook/, "laptop"],
  [/television|\btv\b/, "tivi"], [/\bmonitor\b|\bscreen\b/, "màn hình máy tính"], [/microwave/, "lò vi sóng"], [/washer|washing machine/, "máy giặt"],
  [/dishwasher/, "máy rửa chén"], [/electric fan|blower/, "quạt"], [/space heater/, "máy sưởi"], [/vacuum/, "máy hút bụi"], [/smoothing iron|\biron\b/, "bàn ủi"],
  [/toaster/, "máy nướng bánh mì"], [/coffeepot|espresso maker|coffee maker/, "máy pha cà phê"], [/crock pot|pressure cooker|rice cooker/, "nồi"], [/frying pan|skillet|wok/, "chảo"],
  [/barometer|odometer|speedometer|thermometer|gauge|\bmeter\b/, "đồng hồ đo"], [/clock|\bwatch\b|stopwatch/, "đồng hồ"], [/printer/, "máy in"], [/projector/, "máy chiếu"],
  [/computer mouse|\bmouse\b/, "chuột máy tính"], [/computer keyboard|\bkeyboard\b/, "bàn phím"], [/desktop computer/, "máy tính để bàn"], [/headphone|headset|earphone/, "tai nghe"],
  [/loudspeaker|speaker/, "loa"], [/reflex camera|polaroid camera|\bcamera\b/, "máy ảnh"], [/power drill|\bdrill\b/, "máy khoan"], [/chain saw|chainsaw/, "cưa xích"], [/lawn mower|mower/, "máy cắt cỏ"],
  [/water bottle|water jug|pop bottle|beer bottle|wine bottle|\bbottle\b/, "chai"], [/backpack/, "ba lô"], [/umbrella/, "ô dù"], [/running shoe|sneaker/, "giày thể thao"],
  [/ipod|mp3|digital watch/, "thiết bị nghe nhạc"], [/hair dryer|blow dryer|hair spray/, "máy sấy tóc"], [/water tower|\btap\b|faucet/, "vòi nước"], [/pump/, "máy bơm"],
];

/** Chọn sản phẩm từ kết quả phân loại ImageNet [{className, probability}]: lớp đầu tiên có trong bảng và đủ điểm. */
export function pickImagenet(preds, { minScore = 0.3 } = {}) {
  for (const p of (preds ?? []).slice().sort((a, b) => b.probability - a.probability)) {
    if (p.probability < minScore) break;
    const name = String(p.className ?? "").toLowerCase();
    const hit = IMAGENET_PRODUCTS.find(([re]) => re.test(name));
    if (hit) return { cls: name.split(",")[0].trim(), kw: hit[1], score: p.probability };
  }
  return null;
}

let mobileP = null;
async function getMobilenet(onStatus) {
  if (!mobileP) {
    mobileP = (async () => {
      onStatus?.("tải mô hình phân loại ImageNet (lần đầu)");
      await loadScript(TF_URL);
      await loadScript(MOBILENET_URL);
      return window.mobilenet.load({ version: 2, alpha: 1.0 });
    })().catch((e) => { mobileP = null; throw e; });
  }
  return mobileP;
}

async function withImage(blob, fn) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("Không mở được ảnh")); i.src = url; });
    return await fn(img);
  } finally { URL.revokeObjectURL(url); }
}

async function classifyImagenet(blob, onStatus) {
  const model = await getMobilenet(onStatus);
  onStatus?.("phân loại ImageNet");
  return withImage(blob, async (img) => pickImagenet(await model.classify(img, 8), { minScore: 0.3 }));
}

// CLIP (OpenAI) chạy trong trình duyệt bằng Transformers.js: phân loại "không cần huấn luyện" theo danh sách tên sản phẩm của chính ứng dụng.
// Đo thật trên ảnh bán hàng: CLIP nhỏ (ViT-B/32 q8) hay chưa chắc giữa các loại gần nhau (điều hòa/màn hình, điện thoại/máy tính bảng) nên chỉ nhận khi top 1 hơn hạng 2 rõ rệt; chưa chắc thì bỏ qua thay vì đoán.
// Nặng nhất (~90 MB lần đầu, sau đó nằm trong bộ nhớ đệm trình duyệt) nên chỉ nạp khi cần và có thể tắt trong Cài đặt.
export const CLIP_LABELS = [
  ["air conditioner", "điều hòa"], ["mobile phone", "điện thoại"], ["tablet", "máy tính bảng"], ["laptop", "laptop"], ["television", "tivi"], ["refrigerator", "tủ lạnh"],
  ["washing machine", "máy giặt"], ["water purifier", "máy lọc nước"], ["rice cooker", "nồi cơm điện"], ["air fryer", "nồi chiên không dầu"], ["microwave oven", "lò vi sóng"],
  ["pressure gauge", "đồng hồ đo áp suất"], ["water pump", "máy bơm nước"], ["power drill", "máy khoan"], ["carton of milk", "sữa"], ["baby formula milk powder can", "sữa bột"],
  ["instant noodles", "mì gói"], ["headphones", "tai nghe"], ["speaker", "loa"], ["electric fan", "quạt điện"], ["vacuum cleaner", "máy hút bụi"], ["wristwatch", "đồng hồ đeo tay"],
  ["shoes", "giày"], ["handbag", "túi xách"], ["chair", "ghế"], ["camera", "máy ảnh"], ["valve", "van"], ["pipe fittings", "phụ kiện đường ống"], ["electric kettle", "ấm đun nước"],
  ["blender", "máy xay sinh tố"], ["hair dryer", "máy sấy tóc"], ["printer", "máy in"], ["computer monitor", "màn hình máy tính"], ["keyboard", "bàn phím"], ["computer mouse", "chuột máy tính"],
  ["bottle of water", "chai nước"], ["cooking oil bottle", "dầu ăn"], ["induction cooker", "bếp từ"], ["water heater", "máy nước nóng"], ["angle grinder", "máy mài"], ["air purifier", "máy lọc không khí"],
];

/** Chọn kết quả CLIP [{label, score}] (đã sắp giảm dần): top 1 phải đủ điểm và hơn hạng 2 một khoảng, không thì coi là chưa chắc. */
export function pickClip(results, { minScore = 0.12, minMargin = 0.03 } = {}) {
  const r = (results ?? []).slice().sort((a, b) => b.score - a.score);
  if (!r.length || r[0].score < minScore) return null;
  if (r[1] && r[0].score - r[1].score < minMargin) return null;
  const hit = CLIP_LABELS.find(([en]) => en === r[0].label);
  return hit ? { cls: hit[0], kw: hit[1], score: r[0].score, margin: r[1] ? r[0].score - r[1].score : r[0].score } : null;
}

let clipP = null;
async function getClip(onStatus) {
  if (!clipP) {
    clipP = (async () => {
      onStatus?.("tải mô hình CLIP (lần đầu ~90 MB, có thể mất ~30 giây)");
      const tr = await import(/* @vite-ignore */ TRANSFORMERS_URL);
      tr.env.allowLocalModels = false;
      return tr.pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32", { dtype: "q8" });
    })().catch((e) => { clipP = null; throw e; });
  }
  return clipP;
}

async function classifyClip(blob, onStatus) {
  const pipe = await getClip(onStatus);
  onStatus?.("phân loại CLIP");
  const url = URL.createObjectURL(blob);
  try {
    const res = await pipe(url, CLIP_LABELS.map((x) => x[0]), { hypothesis_template: "a product photo of a {}." });
    return pickClip(res);
  } finally { URL.revokeObjectURL(url); }
}

/**
 * HÀNG CHỜ MÔ HÌNH nhận diện sản phẩm: thử lần lượt, mô hình nào nhận ra (đủ điểm) thì dừng, chưa ra thì sang mô hình kế tiếp.
 *  1) CLIP zero-shot theo danh sách sản phẩm của ứng dụng (chính xác nhất khi đo, nặng ~90 MB; có thể tắt)
 *  2) COCO-SSD (phát hiện vật thể, 80 loại, cùng họ YOLO/SSD)
 *  3) MobileNet ImageNet (phân loại 1000 lớp: họ mô hình phân loại của ImageAI — MobileNetV2/ResNet/Inception/DenseNet)
 * ImageAI là thư viện Python nên không chạy được trên Cloudflare/trình duyệt; ở đây dùng đúng họ mô hình đã huấn luyện sẵn của nó bằng phiên bản trình duyệt.
 * Thêm mô hình khác = thêm một phần tử vào buildQueue.
 */
const COCO = { id: "coco-ssd", label: "COCO-SSD (phát hiện vật thể)", minScore: 0.5, run: (blob, onStatus) => detectCoco(blob, onStatus) };
const MOBILE = { id: "mobilenet", label: "MobileNet ImageNet (phân loại, họ mô hình của ImageAI)", minScore: 0.3, run: (blob, onStatus) => classifyImagenet(blob, onStatus) };
const CLIP = { id: "clip", label: "CLIP (phân loại theo danh sách sản phẩm)", minScore: 0.12, run: (blob, onStatus) => classifyClip(blob, onStatus) };

/** Thứ tự theo độ chính xác đã đo: CLIP (nếu bật) → COCO-SSD → MobileNet. Mô hình đầu không tải được hoặc chưa chắc thì sang mô hình kế. */
export const buildQueue = ({ clip = true } = {}) => [...(clip ? [CLIP] : []), COCO, MOBILE];
export const MODEL_QUEUE = buildQueue();

/** Trả về { cls, kw, score, model } của mô hình đầu tiên nhận ra sản phẩm, hoặc null; tried = các mô hình đã thử. */
export async function recognizeProduct(blob, { onStatus, queue = MODEL_QUEUE } = {}) {
  const tried = [];
  for (const m of queue) {
    try {
      const r = await m.run(blob, (st) => onStatus?.(`${m.label}: ${st}`));
      tried.push({ id: m.id, ok: !!r && r.score >= m.minScore });
      if (r && r.score >= m.minScore) return { ...r, model: m.id, modelLabel: m.label, tried };
    } catch (e) { tried.push({ id: m.id, ok: false, error: String(e?.message ?? e) }); }
  }
  return null;
}

/** Nhận diện bằng COCO-SSD (Blob/File). Trả về { cls, kw, score } hoặc null; ném lỗi nếu không tải được mô hình. */
export async function detectCoco(blob, onStatus) {
  const model = await getModel(onStatus);
  onStatus?.("nhận diện sản phẩm");
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("Không mở được ảnh")); i.src = url; });
    const preds = await model.detect(img, 10, 0.3);
    return pickProduct(preds, { imgW: img.naturalWidth, imgH: img.naturalHeight });
  } finally { URL.revokeObjectURL(url); }
}
