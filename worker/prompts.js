// Các prompt gửi cho AI. Mục tiêu: dữ liệu có cấu trúc, đúng model, mỗi ý có URL nguồn, không bịa.

export const SYSTEM = `Bạn là chuyên viên thu mua tại Việt Nam, làm việc với dữ liệu web THẬT.
Nguyên tắc bắt buộc:
- Chỉ ghi điều tìm thấy trong các trang web bạn đã đọc. Không đoán, không bịa số liệu, không bịa URL. Thiếu dữ liệu thì để mảng rỗng.
- Mỗi giá, ưu điểm, nhược điểm, công nghệ phải kèm "source" là URL đầy đủ của đúng trang đã cung cấp thông tin đó.
- Khi người dùng đưa mã model, chỉ dùng trang nhắc ĐÚNG model đó. Model khác (dù cùng dòng) không được tính.
- Giá là số nguyên VND, giá bán lẻ tại Việt Nam, đã gồm VAT nếu trang ghi rõ. Không dùng giá phụ kiện, giá trả góp theo tháng, giá USD.
- Mỗi ưu/nhược điểm là một câu ngắn (tối đa 25 từ), cụ thể, không quảng cáo chung chung.
- Viết tiếng Việt. Trả về DUY NHẤT một JSON object hợp lệ, không có chữ nào ngoài JSON, không dùng markdown.`;

const CAT_RULE = `Phân loại "category":
- "tech" = máy móc, thiết bị công nghiệp/công cụ, đồ gia dụng, thiết bị điện tử.
- "consumer" = hàng tiêu dùng (thực phẩm, đồ uống, mỹ phẩm, hóa phẩm, văn phòng phẩm, quần áo, đồ dùng một lần...).`;

// Khi đã có dữ liệu trong cache: yêu cầu tìm nguồn và thông tin MỚI
function knownBlock(plan) {
  const k = plan.known;
  if (!k || !(k.urls?.length || k.pros?.length || k.cons?.length)) return "";
  return `
ĐÃ CÓ dữ liệu từ lần tìm trước. Hãy tìm NGUỒN KHÁC và thông tin MỚI chưa có (giá ở cửa hàng khác, ưu/nhược điểm khác, công nghệ chưa nêu). Không dùng lại các nguồn đã đọc. Không lặp lại các ý đã biết. Không có gì mới thì trả mảng rỗng.
Nguồn đã đọc (bỏ qua): ${(k.urls ?? []).join(" ; ")}
Ưu điểm đã biết: ${(k.pros ?? []).join(" | ")}
Nhược điểm đã biết: ${(k.cons ?? []).join(" | ")}
`;
}

export function productPrompt(plan) {
  return `Tìm hiểu sản phẩm: "${plan.query}"${knownBlock(plan)}
${plan.model ? `Mã model cần khớp chính xác: ${plan.model}` : "Chưa rõ model: hãy xác định model/phiên bản phổ biến nhất khớp với tên."}
${plan.brand ? `Hãng: ${plan.brand}` : ""}
Từ khóa gợi ý (hãy dùng và tự bổ sung từ khóa tốt hơn nếu cần):
${plan.queries.map((q) => "- " + q).join("\n")}

${CAT_RULE}
${plan.categoryAuto ? "" : `Người dùng đã chọn category = "${plan.category}", hãy giữ nguyên.`}

Việc cần làm:
1. Xác định chính xác tên đầy đủ, hãng, model.
2. Tìm 3–6 giá bán lẻ ở các cửa hàng/trang khác nhau (ưu tiên trang bán hàng uy tín tại Việt Nam).
3. 3–6 ưu điểm và 3–6 nhược điểm thực tế (từ đánh giá, bài kiểm tra, phản hồi người dùng).
4. ${"Nếu category là tech: 2–5 công nghệ/tính năng nổi bật, mỗi công nghệ nêu lợi ích và hạn chế. Nếu consumer: technologies = []."}
5. 4–8 thông số chính (specs) nếu là tech.

Schema JSON:
{
  "category": "tech" | "consumer",
  "product": {"name": "", "brand": "", "model": "", "aliases": [""], "summary": "1-2 câu"},
  "prices": [{"value": 0, "label": "tên cửa hàng/bài", "source": "URL"}],
  "pros": [{"text": "", "source": "URL"}],
  "cons": [{"text": "", "source": "URL"}],
  "technologies": [{"name": "", "benefit": "", "drawback": "", "source": "URL"}],
  "specs": [{"name": "", "value": ""}]
}`;
}

export function comparePrompt(plan, product) {
  const main = [product?.brand, product?.model || product?.name].filter(Boolean).join(" ") || plan.query;
  const cat = plan.category;
  return `Sản phẩm chính: ${main} (tên đầy đủ: ${product?.name || plan.name}, hãng: ${product?.brand || plan.brand || "chưa rõ"}).
Hãy chọn 4–5 sản phẩm CẠNH TRANH cùng phân khúc/tầm giá/công dụng, mỗi sản phẩm của MỘT HÃNG KHÁC NHAU (không dùng hãng của sản phẩm chính, không trùng hãng nhau), đang bán tại Việt Nam.
${plan.queries.filter((q) => /so sánh/i.test(q)).map((q) => "Từ khóa gợi ý: " + q).join("\n")}
${plan.known?.brands?.length ? `Đã có các hãng: ${plan.known.brands.join(", ")}. Hãy chọn hãng KHÁC những hãng này để đủ 4–5 hãng (nếu đã đủ 5 thì trả mảng rỗng).` : ""}

Với mỗi sản phẩm: model chính xác, giá bán lẻ VND (kèm URL trang giá), 2–4 ưu điểm và 2–4 nhược điểm (nêu rõ so với sản phẩm chính nếu có thể), mỗi ý kèm URL nguồn.
${cat === "tech"
    ? "Đây là hàng máy móc/thiết bị/gia dụng/điện tử: với mỗi sản phẩm liệt kê 2–4 công nghệ/tính năng chính, kèm lợi ích và hạn chế của công nghệ đó. Gọi tên công nghệ theo tên phổ biến, GIỐNG NHAU giữa các hãng khi là cùng một công nghệ (ví dụ \"Inverter\", \"Rapid Air\", \"Lọc HEPA\") để so sánh được; lợi ích/hạn chế viết ngắn, cụ thể."
    : "Đây là hàng tiêu dùng: CHỈ so sánh giá, ưu điểm, nhược điểm với sản phẩm tương tự. KHÔNG nói về công nghệ (technologies = [])."}
"vsMain": 1 câu tóm tắt khác biệt chính so với sản phẩm chính.

Schema JSON:
{"alternatives": [{"brand": "", "name": "", "model": "", "price": {"value": 0, "source": "URL"}, "pros": [{"text": "", "source": "URL"}], "cons": [{"text": "", "source": "URL"}], "technologies": [{"name": "", "benefit": "", "drawback": ""}], "sources": ["URL"], "vsMain": ""}]}`;
}

export const ASK_SYSTEM = `Bạn trả lời câu hỏi mua hàng CHỈ dựa trên CONTEXT (dữ liệu đã thu thập, mỗi nguồn có id số).
- Trả lời ngắn gọn, đi thẳng vào đúng câu hỏi, tối đa 80 từ, tiếng Việt.
- Mỗi ý có dữ kiện phải gắn nguồn ngay bên cạnh dạng [id], ví dụ [2][5]. Chỉ dùng id có trong context.
- Nếu context không có thông tin để trả lời, nói rõ "Chưa có dữ liệu về ..." và gợi ý nên tìm gì thêm. Không bịa.
- Không lặp lại câu hỏi, không mở bài dài dòng.`;

export function askPrompt(question, context) {
  return `CONTEXT:\n${JSON.stringify(context)}\n\nCÂU HỎI: ${question}`;
}

export const OCR_SYSTEM = `Bạn đọc ảnh sản phẩm/nhãn/hóa đơn/báo giá và trích thông tin để tìm mua hàng.
Trả về DUY NHẤT một JSON object, không markdown. Chép chữ nhìn thấy đúng nguyên văn (tiếng Việt có dấu), không đoán những gì không thấy.`;

export const OCR_PROMPT = `Đọc ảnh này. Schema JSON:
{"text": "toàn bộ chữ đọc được, mỗi dòng một dòng", "name": "tên sản phẩm", "brand": "hãng", "model": "mã model/part number nếu có", "specs": ["thông số thấy trên ảnh"], "keywords": ["2-4 cụm từ khóa tìm mua tốt nhất"], "unreadable": false}
Nếu ảnh mờ, không có chữ hoặc không phải sản phẩm, đặt "unreadable": true và nói rõ lý do trong "text".`;
