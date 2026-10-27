// Lập kế hoạch tìm kiếm: nhận diện model, hãng, ngành hàng và sinh bộ từ khóa thông minh.
import { norm, stripAccents, modelKey } from "./text.js";

const BRANDS = [
  "samsung", "lg", "sony", "panasonic", "philips", "xiaomi", "apple", "asus", "acer", "dell", "hp", "lenovo", "msi", "huawei", "oppo", "vivo", "realme", "nokia",
  "toshiba", "sharp", "hitachi", "daikin", "mitsubishi", "electrolux", "aqua", "casper", "midea", "gree", "carrier", "funiki", "nagakawa", "reetech", "tcl", "hisense",
  "bosch", "makita", "dewalt", "stanley", "ingco", "total", "milwaukee", "hikoki", "ryobi", "black+decker", "karcher", "kärcher", "dyson", "ecovacs", "roborock", "dreame", "shark",
  "kangaroo", "sunhouse", "kangaroo", "bluestone", "lock&lock", "tefal", "philips", "russell hobbs", "sanaky", "ariston", "ferroli", "rinnai", "paloma", "kocher", "hafele", "hafele",
  "siemens", "schneider", "abb", "omron", "mitsubishi electric", "delta", "fuji", "yaskawa", "ls electric", "autonics", "fluke", "grundfos", "pentax", "ebara",
  "canon", "epson", "brother", "hp", "logitech", "jbl", "bose", "sennheiser", "anker", "baseus", "garmin", "gopro", "dji", "tp-link", "d-link", "ubiquiti",
  "vinamilk", "th true milk", "nestle", "unilever", "p&g", "colgate", "clear", "sunsilk", "dove", "omo", "comfort", "sunlight", "lifebuoy", "pepsi", "coca-cola", "nescafe", "trung nguyen", "g7", "acecook", "masan",
];

const TECH_WORDS = [
  "may ", "thiet bi", "dieu hoa", "tu lanh", "tu dong", "noi chien", "noi com", "lo vi song", "lo nuong", "robot", "hut bui", "tai nghe", "laptop", "dien thoai", "tablet", "tivi", "tv ", "man hinh",
  "khoan", "mai ", "cat ", "bom ", "motor", "dong co", "inverter", "plc", "cam bien", "bien tan", "may giat", "quat", "den led", "camera", "router", "loa ", "may in", "may anh", "pin ", "sac ",
  "may nen", "may han", "may phat", "may bom", "van ", "xi lanh", "reducer", "hop so", "may tinh", "case ", "ssd", "ram ", "cpu", "gpu", "may loc", "binh nong lanh", "bep ", "may xay", "may ep",
  "air fryer", "vacuum", "drill", "pump", "sensor", "switch", "ups", "ac ", "smart", "wifi",
];
const CONSUMER_WORDS = [
  "sua ", "dau goi", "sua tam", "nuoc ", "banh", "keo ", "xa phong", "my pham", "kem ", "thuc pham", "ca phe", "mi goi", "gao ", "dau an", "nuoc mam", "bot giat", "nuoc rua", "giay ", "khan ",
  "but ", "vo ", "tap ", "quan ", "ao ", "giay dep", "tui ", "balo", "tra ", "bia ", "ruou", "gia vi", "thuc an", "vitamin", "thuoc ", "khau trang", "bim ", "ta ", "kem danh rang", "ban chai",
  "tuong ", "sua chua", "nuoc ngot", "snack", "shampoo", "soap", "coffee", "noodle",
];

export const CATEGORY_LABELS = { tech: "Máy móc / thiết bị / gia dụng / điện tử", consumer: "Hàng tiêu dùng" };

export function detectCategory(text) {
  const t = " " + norm(text) + " ";
  let tech = 0, consumer = 0;
  for (const w of TECH_WORDS) if (t.includes(w.startsWith(" ") ? w : " " + w) || t.includes(w)) tech++;
  for (const w of CONSUMER_WORDS) if (t.includes(" " + w) || t.includes(w)) consumer++;
  if (extractModel(text) && tech >= consumer) tech++;
  if (!tech && !consumer) return "unknown";
  return tech >= consumer ? "tech" : "consumer";
}

// Thông số linh kiện (CPU, GPU, bộ nhớ, chuẩn kết nối...) trông giống mã model nhưng không phải tên sản phẩm
const SPEC_LIKE = /^(i[3579]-?\d{3,5}[a-z]{0,2}|r[3579]-?\d{4}[a-z]{0,2}|ryzen\d*|rtx-?\d{3,4}\w*|gtx-?\d{3,4}\w*|rx-?\d{3,4}\w*|mx\d{3}|ddr\d|lpddr\d\w*|usb\d?(?:\.\d)?|wifi\d\w*|wi-fi\d\w*|bluetooth\d(?:\.\d)?|bt\d(?:\.\d)?|h\.?26[45]|ip\d{2}|ipx\d|ssd\d*|nvme\d*|pcie\d*|hdmi\d(?:\.\d)?|dp\d(?:\.\d)?|co2|r32|r410a?|r600a|\d+nm|\d+w[hp]?|\d+v\d*a?|[dø]\d+(?:[.,]\d+)?(?:mm|cm)|ø\d+(?:[.,]\d+)?|phi\d+|dn\d{1,4}|pn\d{1,3}|sch\d+|g\d\/\d+|\d+\/\d+)$/i;

const UNIT_LIKE =/^\d+(?:[.,]\d+)?(gb|tb|mb|mah|w|kw|v|hz|khz|l|lit|kg|g|inch|in|mm|cm|m|ml|btu|hp|k|mp|fps|db|pa|bar|rpm|ah)$/i;

// Model = token vừa có chữ vừa có số, ví dụ SHD4080, WH-1000XM5, KX-TG3611
export function extractModel(text) {
  const tokens = String(text ?? "").match(/[A-Za-z0-9][A-Za-z0-9\-_/.]{1,24}[A-Za-z0-9]/g) ?? [];
  const cands = tokens.filter((t) => /[A-Za-z]/.test(t) && /\d/.test(t) && !UNIT_LIKE.test(t) && !SPEC_LIKE.test(t) && !/^\d{1,2}[a-z]$/i.test(t) && !/^(4k|8k|5g|4g|3g|2in1|3in1|2d|3d|1080p|720p)$/i.test(t));
  if (!cands.length) return "";
  cands.sort((a, b) => scoreModel(b) - scoreModel(a));
  return cands[0].replace(/[.,]+$/, "");
}

function scoreModel(t) {
  let s = Math.min(t.length, 14);
  if (/^[A-Z]{1,5}[-]?\d/.test(t)) s += 4;
  if (t === t.toUpperCase()) s += 2;
  if (/-/.test(t)) s += 1;
  return s;
}

export function detectBrand(text) {
  const t = " " + norm(text).replace(/[^a-z0-9&+\- ]/g, " ") + " ";
  let best = "";
  for (const b of BRANDS) {
    const key = " " + stripAccents(b) + " ";
    if (t.includes(key) && b.length > best.length) best = b;
  }
  return best ? best.replace(/\b\w/g, (c) => c.toUpperCase()) : "";
}

/** Chuỗi người dùng gõ, giữ nguyên chữ; chỉ gom khoảng trắng thừa. Không cắt, không thêm chữ. */
export function exactQuery(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

const FILLER =/\b(giá|giá bán|mua|tư vấn|so sánh|review|đánh giá|ưu nhược điểm|thông số|cho tôi|tìm|hãy|có tốt không|nên mua)\b/gi;

/**
 * input: { text, model?, brand?, category? ("tech"|"consumer"|"auto"), ocrText? }
 * Trả về kế hoạch: tên gọn, model, hãng, ngành, danh sách từ khóa ưu tiên.
 */
export function makePlan(input) {
  const raw = [input.text, input.ocrText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const model = (input.model || extractModel(raw)).trim();
  const brand = (input.brand || detectBrand(raw) || brandBeforeModel(raw, model) || brandInCaps(raw, model)).trim();
  let name = raw.replace(FILLER, " ").replace(/\s+/g, " ").trim() || raw;
  const auto = !input.category || input.category === "auto";
  const guessed = detectCategory(raw);
  const category = auto ? (guessed === "unknown" ? "tech" : guessed) : input.category;

  // Từ khóa: [chuỗi người dùng gõ, giữ nguyên] + cụm hỏi (giá, ưu/nhược điểm, thông số...). Không cắt tên/mã sản phẩm.
  const typed = exactQuery(raw);
  const queries = [`${typed} giá bán`, `${typed} đánh giá ưu điểm nhược điểm`];
  if (category === "tech") queries.push(`${typed} thông số kỹ thuật công nghệ tính năng`, `${typed} so sánh với đối thủ cùng phân khúc`, `${typed} nhược điểm công nghệ có tốt không`);
  else queries.push(`${typed} giá so sánh sản phẩm tương tự`, `${typed} review có tốt không`, `${typed} thay thế rẻ hơn tương đương`);
  const generic = genericName(name, model, brand);
  return {
    query: raw,
    generic,
    name,
    model,
    brand,
    modelKey: modelKey(model),
    category,
    categoryAuto: auto,
    categoryLabel: CATEGORY_LABELS[category] ?? CATEGORY_LABELS.tech,
    queries: queries.slice(0, 8),
  };
}

// Hãng lạ viết HOA giữa câu thường: "Đồng hồ đo áp LIGI Inox 316" -> "LIGI" (bỏ các từ viết tắt thông dụng)
const ACRONYMS = new Set(["LED", "LCD", "USB", "PVC", "PPR", "HDPE", "HDMI", "WIFI", "RAM", "SSD", "HDD", "CPU", "GPU", "UPS", "LPG", "RO", "UV", "DC", "AC", "IP", "PLC", "NAS", "TV", "UHD", "OLED", "QLED", "DIY", "ABS", "INOX", "NEW", "PRO", "MAX", "MINI", "PLUS", "SET", "VAT"]);
function brandInCaps(text, model) {
  const words = String(text).split(/[\s,;:()/]+/).filter(Boolean);
  if (!words.some((w) => /[a-zà-ỹ]/.test(w))) return ""; // cả câu viết hoa: không suy ra hãng
  const w = words.find((x) => /^[A-Z]{3,10}$/.test(x) && !ACRONYMS.has(x) && x !== model);
  return w ?? "";
}

// Hãng lạ (không có trong danh sách): từ viết hoa đứng ngay trước mã model, ví dụ "Zeta ZF-500" -> "Zeta"
function brandBeforeModel(text, model) {
  if (!model) return "";
  const words = String(text).split(/\s+/);
  const i = words.findIndex((w) => w.replace(/[.,]+$/, "") === model);
  const prev = i > 0 ? words[i - 1] : "";
  return /^[A-ZÀ-Ỹ][\p{L}&+-]{1,20}$/u.test(prev) && !/\d/.test(prev) ? prev : "";
}

// Tên loại sản phẩm: phần đầu trước hãng/model/thông số.
// "Nồi chiên không dầu Zeta ZF-500 5,5L" -> "nồi chiên không dầu"
export function genericName(name, model = "", brand = "") {
  const stop = new Set([norm(brand), ...norm(model).split(/[\s-]+/)].filter(Boolean));
  const out = [];
  const all = String(name).split(/\s+/).filter(Boolean);
  // Viết Hoa Mỗi Chữ (Title Case): chữ hoa đầu từ không báo hiệu tên hãng, chỉ dựa vào hãng/model/số
  const titleCase = all.filter((w) => /^[A-ZÀ-Ỹ]/.test(w)).length / (all.length || 1) > 0.5;
  for (const [i, w] of all.entries()) {
    const n = norm(w).replace(/[^a-z0-9]/g, "");
    if (!n) continue;
    const capitalized = !titleCase && i > 0 && /^[A-ZÀ-Ỹ]/.test(w) && w !== w.toLowerCase();
    if (stop.has(n) || /\d/.test(n) || capitalized) break;
    out.push(w);
  }
  return out.slice(0, 5).join(" ").toLowerCase();
}

// Khóa cache cho một yêu cầu: không phụ thuộc hoa/thường, dấu, thứ tự khoảng trắng
export function cacheKey(plan) {
  // có model thì chỉ dùng model (hãng có thể nhận diện khác nhau giữa các lần gõ)
  return norm(plan.model || plan.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "|" + plan.category;
}
