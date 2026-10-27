// Đọc chữ từ ảnh ngay trên máy người dùng (Tesseract.js, tiếng Việt + Anh): không cần khóa AI, không bị chặn vùng.
// Dùng khi dịch vụ AI không đọc được ảnh (hết hạn mức, lỗi vùng, không có khóa).
import { extractModel } from "./plan.js";

const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js";
let workerP = null;

async function getWorker(onStatus) {
  if (!workerP) {
    workerP = import(/* @vite-ignore */ TESS_URL).then((m) => (m.createWorker ?? m.default?.createWorker)("vie+eng", 1, {
      logger: (x) => { if (x?.status && onStatus) onStatus(x.status, x.progress ?? 0); },
    })).catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

/** Chuyển chữ OCR thô thành { name, model, keywords, specs } để điền ô tìm kiếm. */
export function parseOcrText(raw) {
  const lines = String(raw ?? "").split(/\r?\n/).map((l) => l.replace(/[|_~`^]+/g, " ").replace(/\s+/g, " ").trim()).filter((l) => l.length >= 3);
  const quality = (l) => {
    const letters = (l.match(/[A-Za-zÀ-ỹ0-9]/g) ?? []).length;
    return letters / l.length;
  };
  const good = lines.filter((l) => quality(l) >= 0.75);
  const model = extractModel(good.join(" "));
  const nameLine = good.filter((l) => /[A-Za-zÀ-ỹ]{3,}/.test(l) && l.length <= 90).sort((a, b) => b.length - a.length)[0] ?? "";
  const specs = good.filter((l) => /\d/.test(l) && /(mm|cm|kg|g|w|v|a|hz|l|ml|inch|"|%)\b/i.test(l)).slice(0, 4);
  const name = nameLine && model && nameLine.toUpperCase().includes(model.toUpperCase()) ? nameLine : nameLine;
  const keywords = [name, model].filter(Boolean);
  return { text: good.join("\n"), name: name.slice(0, 90), model, specs, keywords, unreadable: !name && !model };
}

/** Đọc ảnh (Blob/File) bằng Tesseract trong trình duyệt. Lần đầu tải thư viện + dữ liệu tiếng Việt (~vài MB). */
export async function ocrLocal(blob, onStatus) {
  const w = await getWorker(onStatus);
  const { data } = await w.recognize(blob);
  return parseOcrText(data?.text ?? "");
}
