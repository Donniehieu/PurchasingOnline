// Đọc trang web BẰNG ẢNH CHỤP: dịch vụ chụp ảnh trang (chạy JavaScript như trình duyệt thật) -> OCR chữ trên ảnh (Tesseract, cùng bộ
// máy đọc chữ mà paperless-ngx/OCRmyPDF dùng) -> lấy giá và xác nhận đúng sản phẩm. Là lớp dự phòng cuối trong hàng chờ đọc trang,
// dùng khi: trang tải giá bằng JavaScript (HTML không có giá), hoặc máy chủ/tiện ích bị chặn 403 và AI/đường đọc khác không dùng được.
// KHÔNG vượt CAPTCHA: ảnh chụp là trang xác minh/chặn thì bỏ qua. Giá đọc từ ảnh có thể sai chữ số, luôn gắn nhãn "OCR, cần kiểm tra".
import { domainOf } from "./text.js";
import { nameMatchScore, parseOfferPrice } from "./extract.js";

const CHALLENGE = /(captcha|verifying|are you (a )?robot|not a robot|access denied|just a moment|checking your browser|chọn ô bên dưới|xác minh bạn|khoan đã|attention required|403 forbidden|enable javascript|can't be reached|err[ _]tunnel|err[ _]connection|err[ _]name|connection failed|this page isn't working)/i;
const NOT_PRICE = /(giảm|tiết kiệm|trả góp|trả trước|phí|ship|vận chuyển|voucher|cọc|đặt trước|mỗi tháng|\/tháng|tặng|quà|thu cũ|hoàn tiền|thanh toán|từ \d)/i;
const PRICE_RE = /(\d{1,3}(?:[.,]\d{3}){1,3})\s*(?:đ|₫|vnđ|vnd|Đ)(?![\p{L}\d])/giu;

const words = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

// OCR hay đọc sai ký hiệu tiền ("₫" thành "¢", "c", "d"): sau nhãn "Giá ..." nhận số có dấu phân cách nghìn dù thiếu/sai ký hiệu
const LABEL_RE = /giá(?:\s+(?:bán|lẻ|niêm yết|khuyến mãi|ưu đãi))?[\s:.\-]*(?:le|lẻ)?[\s:.\-]*(\d{1,3}(?:[.,]\d{3}){1,3})/i;

function pricesIn(line) {
  const out = [];
  const lab = String(line).match(LABEL_RE);
  if (lab) { const p = parseOfferPrice(lab[1], "VND"); if (p?.value >= 1000 && p.value < 5e9) out.push(p.value); }
  for (const m of String(line).matchAll(PRICE_RE)) { const p = parseOfferPrice(m[1], "VND"); if (p?.value && p.value >= 1000 && p.value < 5e9) out.push(p.value); }
  return out;
}

/** Giá của sản phẩm trong chữ OCR: giá đầu tiên ngay sau dòng giống tên sản phẩm nhất; không có thì chỉ nhận khi cả trang chỉ có 1–2 mức giá. */
export function priceFromOcrLines(lines, name) {
  const nw = new Set(words(name));
  if (nw.size) {
    let best = -1, bestScore = 0;
    lines.forEach((l, i) => { const lw = words(l); if (!lw.length) return; const s = lw.filter((w) => nw.has(w)).length / Math.min(nw.size, 6); if (s > bestScore) { bestScore = s; best = i; } });
    if (best >= 0 && bestScore >= 0.4) {
      // giá gần dòng tên nhất: trang sản phẩm thường đặt giá SAU tên, thẻ trong danh sách thường đặt giá TRƯỚC tên; hòa thì ưu tiên sau
      for (let d = 0; d <= 9; d++) {
        for (const i of d === 0 ? [best] : [best + d, ...(d <= 4 ? [best - d] : [])]) {
          const l = lines[i];
          if (l == null || (NOT_PRICE.test(l) && !/giá/i.test(l))) continue;
          const p = pricesIn(l);
          if (p.length) return p[0];
        }
      }
    }
  }
  const all = [...new Set(lines.filter((l) => !NOT_PRICE.test(l) || /giá/i.test(l)).flatMap(pricesIn))]; // bỏ dòng giảm giá/trả góp/phí vận chuyển
  return all.length >= 1 && all.length <= 2 ? all[0] : null;
}

/**
 * Phân tích chữ OCR của ảnh chụp trang. Trả về { ok:false, reason: "empty"|"challenge" } hoặc
 * { ok:true, title, nameScore, relevant, price, text }.
 */
export function parseVisual(text, hint = {}) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 2);
  const joined = lines.join("\n");
  if (joined.length < 40) return { ok: false, reason: "empty" };
  if (CHALLENGE.test(joined.slice(0, 2000)) && joined.length < 1500) return { ok: false, reason: "challenge" }; // trang xác minh/chặn: không vượt
  const nameScore = hint.name ? nameMatchScore(joined.slice(0, 5000), hint.name) : 0;
  const title = [...lines].filter((l) => l.length >= 12 && l.length <= 140).sort((a, b) => nameMatchScore(b, hint.name || "") - nameMatchScore(a, hint.name || "") || b.length - a.length)[0] || "";
  return { ok: true, title, nameScore, relevant: nameScore >= 0.6, price: priceFromOcrLines(lines, hint.name || title), text: joined.slice(0, 4000) };
}

/** Trang nào nên thử đọc bằng ảnh chụp: trang tải giá bằng JavaScript, hoặc bị chặn (403/CAPTCHA phía mình). Trang "Liên hệ báo giá" thì không. */
export function needsVisual(page) {
  if (!page) return false;
  if (page.ok) return !page.product?.price && page.priceHint === "js";
  return !!page.blocked;
}

/** Dựng "trang" từ kết quả ảnh chụp để đi qua ingestPage như trang thường (giá nguồn "ocr"). base: trang gốc (nếu đã mở được). */
export function visualPage(url, v, base = {}) {
  const domain = domainOf(url);
  return {
    ...(base.ok ? base : {}),
    ok: true, url, finalUrl: base.finalUrl || url, status: base.status ?? 200, domain,
    title: base.title || v.title || "", h1: base.h1 || v.title || "",
    relevant: !!(base.relevant || v.relevant),
    matched: { model: null, nameScore: v.nameScore ?? 0 },
    product: { ...(base.product ?? {}), name: base.product?.name || v.title || "", price: { value: v.price, source: "ocr" } },
    specs: base.specs ?? [], images: base.images ?? [], pros: base.pros ?? [], cons: base.cons ?? [], tech: base.tech ?? [],
    contact: base.contact ?? null, seller: base.seller || domain, vat: base.vat ?? { state: "unknown" }, priceHint: "", visual: true,
  };
}
