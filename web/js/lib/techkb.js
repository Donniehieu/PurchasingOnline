// Ngân hàng công nghệ theo NHÓM sản phẩm (không chỉ sản phẩm đang tìm): mỗi công nghệ có mô tả, ưu/nhược điểm, điểm
// (chất lượng, chi phí, độ bền; 0–10, càng cao càng tốt) và từ khóa nhận diện. Kết hợp với những gì tìm thấy trong dữ liệu đã đọc
// (công nghệ nào đang xuất hiện ở bao nhiêu sản phẩm/hãng) để phân loại và gợi ý công nghệ tối ưu theo ưu tiên của người dùng.
// Điểm là nhận định tham khảo của ứng dụng, KHÔNG phải kết quả đo; luôn nên đối chiếu nguồn.
import { norm } from "./text.js";
import { detectType } from "./intent.js";

// t(id, tên, vai trò, nhóm, từ khóa nhận diện (không dấu), mô tả, ưu, nhược, hợp với, [chất lượng, chi phí, bền])
const t = (id, name, role, group, match, what, pros, cons, bestFor, [quality, cost, durable]) => ({ id, name, role, group, match, what, pros, cons, bestFor, scores: { quality, cost, durable } });

export const TECH_CATALOG = {
  purifier: {
    label: "Máy lọc nước",
    combo: "Nguồn nước chưa rõ chất lượng (giếng khoan, nhiễm phèn/mặn, kim loại nặng): RO + than hoạt tính, thêm UV nếu lo vi sinh và lõi khoáng nếu muốn bổ sung khoáng. Nước máy đã qua xử lý, cần tiết kiệm: UF hoặc Nano là đủ.",
    techs: [
      t("ro", "RO (thẩm thấu ngược)", "core", "Công nghệ lọc chính", ["ro", "tham thau nguoc", "reverse osmosis"], "Màng lọc cỡ 0,0001 micron, giữ lại gần như mọi tạp chất hòa tan.", ["Loại bỏ kim loại nặng, vi khuẩn, virus, muối hòa tan", "Cho nước tinh khiết, uống trực tiếp"], ["Thải nước thải (tỷ lệ thường 1:1 đến 1:3)", "Cần điện và bơm, tiếng ồn", "Loại cả khoáng có lợi, nên có lõi bổ sung khoáng", "Chi phí thay lõi cao hơn"], "Nguồn nước ô nhiễm, nhiễm kim loại nặng hoặc không rõ chất lượng", [9, 5, 7]),
      t("uf", "UF (siêu lọc màng rỗng)", "core", "Công nghệ lọc chính", ["uf", "sieu loc", "mang rong", "ultrafiltration"], "Màng sợi rỗng cỡ 0,01–0,1 micron, chạy bằng áp lực nước.", ["Giữ lại vi khuẩn, cặn, giữ được khoáng", "Không cần điện, không nước thải", "Giá và chi phí thấp"], ["Không loại được ion kim loại nặng và muối hòa tan", "Không phù hợp nguồn nước ô nhiễm nặng"], "Nước máy sạch, gia đình cần tiết kiệm", [6, 8, 7]),
      t("nano", "Nano (màng lọc nano/nano bạc)", "core", "Công nghệ lọc chính", ["nano"], "Màng lọc kích thước nano giữ cặn và vi khuẩn, thường kèm bạc kháng khuẩn.", ["Giữ khoáng tự nhiên", "Không điện, ít nước thải", "Giá hợp lý"], ["Không loại được kim loại nặng hòa tan như RO", "Khả năng thực tế phụ thuộc chất lượng màng của từng hãng"], "Nước đầu vào tương đối sạch", [6, 8, 6]),
      t("hydro", "Hydrogen / ion kiềm", "addon", "Tiện ích và bổ sung", ["hydrogen", "ion kiem", "dien phan", "alkaline"], "Điện phân tạo nước giàu hydro hoặc kiềm sau khi lọc.", ["Nước vị êm, có thể điều chỉnh độ pH"], ["Giá rất cao", "Lợi ích sức khỏe chưa có kết luận thống nhất", "Cần bảo dưỡng điện cực"], "Người thích nước kiềm, ngân sách cao", [5, 3, 5]),
      t("uv", "UV (tia cực tím diệt khuẩn)", "addon", "Tiện ích và bổ sung", ["uv", "tia cuc tim", "den uv"], "Đèn UV diệt vi khuẩn, virus ở khâu cuối.", ["Diệt vi sinh không dùng hóa chất", "Bổ sung tốt cho RO/UF"], ["Không loại cặn hay hóa chất", "Đèn phải thay định kỳ (khoảng 1 năm)"], "Nguồn nước có nguy cơ vi sinh", [7, 7, 6]),
      t("carbon", "Than hoạt tính", "addon", "Tiện ích và bổ sung", ["than hoat tinh", "carbon", "khu clo"], "Lõi hấp phụ clo, mùi và chất hữu cơ.", ["Khử mùi, vị, clo", "Rẻ, dễ thay"], ["Chỉ lọc một nhóm chất nhất định", "Bão hòa thì phải thay đúng hạn"], "Nước máy có mùi clo", [6, 9, 5]),
      t("mineral", "Lõi khoáng / bổ sung khoáng", "addon", "Tiện ích và bổ sung", ["loi khoang", "bo sung khoang", "khoang chat", "mineral"], "Bổ sung khoáng và cân bằng vị sau khi lọc RO.", ["Nước uống dễ chịu hơn sau RO"], ["Thêm một lõi phải thay", "Lượng khoáng bổ sung không nhiều"], "Máy RO dùng lâu dài", [6, 7, 6]),
      t("hotcold", "Nóng lạnh", "addon", "Tiện ích và bổ sung", ["nong lanh", "nong-lanh"], "Tích hợp làm nóng và làm lạnh nước.", ["Tiện lợi cho gia đình, văn phòng"], ["Tốn điện hơn", "Thêm bộ phận dễ hỏng"], "Nhu cầu dùng nước nóng/lạnh thường xuyên", [5, 5, 5]),
    ],
  },
  aircon: {
    label: "Điều hòa",
    combo: "Dùng nhiều giờ mỗi ngày: Inverter + gas R32 (tiết kiệm điện, êm). Ngân sách thấp hoặc dùng ít: loại thường (mono). Có người dị ứng, trẻ nhỏ: thêm lọc không khí/kháng khuẩn và tự làm sạch dàn lạnh.",
    techs: [
      t("inverter", "Inverter", "core", "Máy nén", ["inverter"], "Máy nén đổi tốc độ theo tải thay vì bật/tắt liên tục.", ["Tiết kiệm điện, thường 30–60% so với loại thường", "Êm, giữ nhiệt độ ổn định"], ["Giá mua cao hơn", "Sửa mạch điều khiển tốn kém"], "Dùng nhiều giờ mỗi ngày", [9, 5, 8]),
      t("mono", "Không inverter (bật/tắt)", "core", "Máy nén", ["khong inverter", "non-inverter", "non inverter", "may nen thuong", "mono"], "Máy nén chạy hết công suất rồi ngắt.", ["Giá mua thấp", "Cấu tạo đơn giản, dễ sửa"], ["Tốn điện hơn", "Nhiệt độ dao động, ồn khi khởi động"], "Phòng ít dùng, ngân sách thấp", [5, 9, 6]),
      t("r32", "Gas R32", "addon", "Môi chất lạnh", ["r32", "gas r32"], "Môi chất thế hệ mới, hiệu suất cao hơn R410A/R22.", ["Làm lạnh hiệu quả, tiết kiệm điện", "Ít ảnh hưởng môi trường hơn"], ["Dễ cháy nhẹ, cần thợ có tay nghề"], "Hầu hết máy mới", [8, 7, 7]),
      t("air", "Lọc không khí, kháng khuẩn", "addon", "Tiện ích", ["loc khong khi", "khang khuan", "pm2.5", "plasma", "nanoe", "ion"], "Bộ lọc bụi mịn, khử mùi, diệt khuẩn (Nanoe, Plasma, ion…).", ["Không khí sạch hơn", "Hữu ích khi có người dị ứng"], ["Giá cao hơn", "Hiệu quả khác nhau giữa các hãng"], "Gia đình có trẻ nhỏ, người dị ứng", [7, 6, 6]),
      t("selfclean", "Tự làm sạch dàn lạnh", "addon", "Tiện ích", ["tu lam sach", "self clean", "ice clean", "dong bang"], "Đóng băng rồi xả để rửa dàn lạnh, hạn chế nấm mốc.", ["Giảm mùi, giảm số lần vệ sinh"], ["Không thay thế được vệ sinh định kỳ"], "Dùng thường xuyên", [7, 6, 7]),
      t("wifi", "Wifi / điều khiển thông minh", "addon", "Tiện ích", ["wifi", "wi-fi", "smart", "ung dung"], "Điều khiển qua điện thoại, hẹn giờ thông minh.", ["Tiện, bật máy trước khi về nhà"], ["Cần mạng ổn định", "Phụ thuộc ứng dụng của hãng"], "Người hay vắng nhà", [6, 6, 6]),
      t("eco", "Cảm biến người / chế độ tiết kiệm", "addon", "Tiện ích", ["cam bien", "eco", "tiet kiem dien", "ai"], "Tự điều chỉnh theo người trong phòng.", ["Giảm điện năng khi phòng vắng"], ["Hiệu quả tùy cách hãng cài đặt"], "Phòng làm việc, dùng không đều", [6, 7, 6]),
    ],
  },
  washer: {
    label: "Máy giặt",
    combo: "Dùng lâu dài, giặt nhiều: động cơ Inverter truyền động trực tiếp là nền tảng. Có trẻ nhỏ hoặc cần diệt khuẩn: thêm giặt hơi nước. Ít chỗ phơi: giặt sấy bơm nhiệt.",
    techs: [
      t("dd", "Inverter truyền động trực tiếp", "core", "Động cơ", ["truyen dong truc tiep", "direct drive", "inverter", "dd motor"], "Động cơ gắn trực tiếp vào lồng giặt, không dùng dây curoa.", ["Êm, tiết kiệm điện", "Ít bộ phận mòn nên bền"], ["Giá cao hơn", "Hỏng động cơ thì chi phí sửa lớn"], "Dùng thường xuyên, gia đình", [9, 5, 9]),
      t("belt", "Động cơ dây curoa", "core", "Động cơ", ["day curoa", "curoa"], "Động cơ truyền lực qua dây curoa.", ["Giá rẻ", "Dễ sửa, linh kiện sẵn"], ["Ồn hơn, hao điện hơn", "Dây curoa phải thay"], "Ngân sách thấp", [5, 9, 5]),
      t("steam", "Giặt hơi nước", "addon", "Tiện ích", ["hoi nuoc", "steam"], "Dùng hơi nóng để diệt khuẩn, làm mềm vết bẩn và giảm nhăn.", ["Diệt khuẩn, hợp quần áo trẻ em", "Giảm nhăn"], ["Tốn thêm điện và nước", "Chu trình giặt lâu hơn"], "Gia đình có trẻ nhỏ, người dị ứng", [8, 5, 7]),
      t("ai", "Cảm biến AI / tự định lượng", "addon", "Tiện ích", ["ai", "cam bien", "dinh luong", "auto dose"], "Cảm biến khối lượng và độ bẩn để chọn nước, thời gian, lượng nước giặt.", ["Tối ưu nước, điện, nước giặt", "Ít phải chọn chương trình"], ["Giá cao hơn", "Hiệu quả thực tế tùy hãng"], "Người muốn tiện, tiết kiệm", [7, 5, 6]),
      t("heatpump", "Sấy bơm nhiệt", "addon", "Tiện ích", ["bom nhiet", "heat pump", "giat say"], "Sấy bằng bơm nhiệt, nhiệt độ thấp hơn sấy điện trở.", ["Tiết kiệm điện hơn khi sấy", "Ít hại vải"], ["Giá cao", "Thời gian sấy lâu"], "Ít chỗ phơi, thời tiết ẩm", [8, 4, 7]),
    ],
  },
  fridge: {
    label: "Tủ lạnh",
    combo: "Ưu tiên tiết kiệm điện và bền: Inverter + làm lạnh đa chiều không đóng tuyết. Thường xuyên trữ thực phẩm tươi: thêm ngăn cấp đông mềm / khử mùi kháng khuẩn.",
    techs: [
      t("inverter", "Inverter", "core", "Máy nén", ["inverter"], "Máy nén đổi tốc độ theo tải.", ["Tiết kiệm điện", "Êm, bền máy nén"], ["Giá cao hơn"], "Tủ chạy 24/24", [9, 5, 8]),
      t("nofrost", "Không đóng tuyết (No Frost)", "core", "Làm lạnh", ["khong dong tuyet", "no frost", "nofrost", "lam lanh da chieu", "multi air flow"], "Quạt đưa khí lạnh lưu thông, không đóng tuyết ở thành tủ.", ["Không cần xả đá", "Lạnh đều các ngăn"], ["Tốn điện hơn tủ đóng tuyết cơ bản", "Thực phẩm dễ khô hơn nếu không bọc kín"], "Gia đình bận rộn", [8, 5, 7]),
      t("direct", "Làm lạnh trực tiếp (đóng tuyết)", "core", "Làm lạnh", ["dong tuyet", "truc tiep"], "Dàn lạnh áp thành tủ, có đóng tuyết.", ["Giá rẻ", "Thực phẩm ít bị khô"], ["Phải xả đá định kỳ", "Lạnh không đều"], "Tủ nhỏ, ngân sách thấp", [5, 9, 6]),
      t("antibac", "Khử mùi, kháng khuẩn", "addon", "Tiện ích", ["khu mui", "khang khuan", "nano", "ag+", "plasma"], "Bộ lọc/ion khử mùi và hạn chế vi khuẩn.", ["Tủ ít mùi, thực phẩm giữ lâu hơn"], ["Hiệu quả khác nhau giữa các hãng"], "Hay trữ thực phẩm nhiều loại", [7, 6, 6]),
      t("softfreeze", "Ngăn cấp đông mềm / chuyển đổi", "addon", "Tiện ích", ["cap dong mem", "chuyen doi", "convertible", "ngan cap dong"], "Ngăn linh hoạt giữa mát và đông.", ["Linh hoạt khi cần trữ nhiều"], ["Giá cao hơn"], "Gia đình đông người", [7, 5, 6]),
    ],
  },
  tv: {
    label: "Tivi",
    combo: "Xem phim phòng tối: OLED. Phòng sáng, ngân sách vừa: QLED hoặc Mini LED. Tiết kiệm: LED 4K + hệ điều hành thông minh (Google TV, Tizen, webOS).",
    techs: [
      t("oled", "OLED", "core", "Tấm nền", ["oled"], "Mỗi điểm ảnh tự phát sáng, đen sâu tuyệt đối.", ["Màu đen, tương phản và góc nhìn tốt nhất", "Phản hồi nhanh"], ["Giá cao", "Độ sáng thấp hơn Mini LED", "Nguy cơ lưu ảnh nếu để tĩnh lâu"], "Xem phim trong phòng tối", [10, 3, 6]),
      t("miniled", "Mini LED", "core", "Tấm nền", ["mini led", "miniled", "neo qled"], "Hàng nghìn đèn nền nhỏ chia vùng sáng tối.", ["Rất sáng, tương phản cao", "Không lo lưu ảnh"], ["Giá cao", "Có thể thấy quầng sáng ở cảnh tối"], "Phòng sáng, xem HDR", [9, 4, 8]),
      t("qled", "QLED (chấm lượng tử)", "core", "Tấm nền", ["qled", "quantum dot", "cham luong tu"], "LCD dùng lớp chấm lượng tử cho màu rực và sáng.", ["Màu sắc rực, độ sáng tốt", "Giá hợp lý"], ["Độ đen kém OLED", "Góc nhìn phụ thuộc loại tấm nền"], "Phòng khách sáng", [8, 6, 8]),
      t("led", "LED (LCD)", "core", "Tấm nền", ["led", "lcd"], "LCD với đèn nền LED thông thường.", ["Rẻ nhất", "Bền, phổ biến"], ["Tương phản và độ đen hạn chế"], "Phòng phụ, ngân sách thấp", [5, 9, 8]),
      t("4k", "Độ phân giải 4K trở lên", "addon", "Độ phân giải", ["4k", "uhd", "8k"], "Độ phân giải 3840×2160 trở lên.", ["Hình ảnh sắc nét ở cỡ màn lớn"], ["Cần nguồn nội dung 4K mới thấy rõ"], "Màn từ 50 inch", [8, 7, 8]),
      t("hdr", "HDR / Dolby Vision", "addon", "Hình ảnh", ["hdr", "dolby vision"], "Dải tương phản và màu rộng hơn.", ["Cảnh sáng tối chi tiết hơn"], ["Hiệu quả phụ thuộc độ sáng tấm nền"], "Xem phim, chơi game", [8, 7, 8]),
      t("hz", "Tần số quét 120Hz", "addon", "Hình ảnh", ["120hz", "144hz", "vrr"], "Hình chuyển động mượt hơn.", ["Tốt cho thể thao, chơi game"], ["Giá cao hơn"], "Chơi game console, thể thao", [8, 6, 8]),
      t("os", "Hệ điều hành thông minh", "addon", "Hệ điều hành", ["google tv", "android tv", "webos", "tizen"], "Cài ứng dụng, điều khiển giọng nói.", ["Xem YouTube, Netflix trực tiếp"], ["Hệ điều hành cũ sẽ ngừng cập nhật"], "Mọi nhu cầu giải trí", [7, 7, 6]),
    ],
  },
};

const WEIGHTS = {
  cheap: { cost: 0.6, quality: 0.2, durable: 0.2 },
  balanced: { cost: 0.35, quality: 0.4, durable: 0.25 },
  quality: { cost: 0.1, quality: 0.65, durable: 0.25 },
  durable: { cost: 0.2, quality: 0.25, durable: 0.55 },
};
export const PRIORITY_LABEL = { cheap: "giá rẻ", balanced: "cân bằng giá và chất lượng", quality: "chất lượng", durable: "độ bền" };

const flat = (s) => ` ${norm(s).replace(/[^a-z0-9+.]+/g, " ")} `;
const hit = (corpus, tech) => tech.match.some((m) => corpus.includes(` ${norm(m).replace(/[^a-z0-9+. ]+/g, " ").trim()} `));

function corpora(entry) {
  const main = [entry.product?.name, entry.plan?.query, ...(entry.tech ?? []).flatMap((x) => [x.name, x.benefit]), ...(entry.pros ?? []).map((x) => x.text), ...(entry.specs ?? []).map((s) => `${s.name} ${s.value}`)];
  const mainOffers = (entry.offers ?? []).filter((o) => o.kind !== "other").map((o) => `${o.name} ${(o.specs ?? []).map((s) => `${s.k} ${s.v}`).join(" ")}`);
  const others = [
    ...(entry.alternatives ?? []).map((a) => ({ who: a.brand || a.name, text: [a.name, ...(a.tech ?? []).flatMap((x) => [x.name, x.benefit]), ...(a.pros ?? []).map((p) => p.text)].join(" ") })),
    ...(entry.offers ?? []).filter((o) => o.kind === "other").map((o) => ({ who: o.brand || o.name, text: `${o.name} ${(o.specs ?? []).map((s) => `${s.k} ${s.v}`).join(" ")}` })),
    ...mainOffers.map((text, i) => ({ who: `ncc${i}`, text })),
    ...(entry.techNotes ?? []).map((n) => ({ who: n.url, text: `${n.title} ${n.text}`, note: true })),
  ];
  return { main: flat(main.filter(Boolean).join(" . ")), others: others.map((o) => ({ ...o, text: flat(o.text) })) };
}

/**
 * Bản đồ công nghệ của nhóm sản phẩm + gợi ý tối ưu.
 * Trả về null nếu không nhận ra nhóm sản phẩm trong ngân hàng.
 * need.priority: cheap | balanced | quality | durable
 */
export function techLandscape(entry, need = {}) {
  const text = `${entry.plan?.query ?? ""} ${entry.product?.name ?? ""}`;
  const found = detectType(text);
  const cat = found ? TECH_CATALOG[found.type.id] : null;
  if (!cat) return null;
  const priority = WEIGHTS[need.priority] ? need.priority : "balanced";
  const w = WEIGHTS[priority];
  const c = corpora(entry);
  const items = cat.techs.map((tech) => {
    const inMain = hit(c.main, tech);
    const seenIn = c.others.filter((o) => hit(o.text, tech));
    const products = new Set(seenIn.filter((o) => !o.note).map((o) => o.who)).size + (inMain ? 1 : 0);
    const notes = seenIn.filter((o) => o.note).length;
    const base = w.quality * tech.scores.quality + w.cost * tech.scores.cost + w.durable * tech.scores.durable;
    const score = Math.round((base + Math.min(1, products * 0.2 + notes * 0.1)) * 10) / 10; // thêm tối đa 1 điểm nếu thấy phổ biến trong dữ liệu
    return { ...tech, has: inMain, products, notes, score };
  });
  const groups = [...new Set(items.filter((i) => i.role === "core").map((i) => i.group))];
  const best = [];
  for (const g of groups) {
    const top = items.filter((i) => i.role === "core" && i.group === g).sort((a, b) => b.score - a.score)[0];
    if (top) best.push({ ...top, why: `Điểm cao nhất nhóm “${g}” khi ưu tiên ${PRIORITY_LABEL[priority]}` });
  }
  const addons = items.filter((i) => i.role === "addon").sort((a, b) => b.score - a.score).slice(0, priority === "cheap" ? 1 : 2).map((i) => ({ ...i, why: `Bổ sung hữu ích${i.has ? " (sản phẩm bạn tìm đã có)" : ""}` }));
  const mine = items.filter((i) => i.has);
  const missing = best.filter((b) => !b.has);
  const summary = [];
  summary.push(mine.length ? `Sản phẩm bạn tìm có: ${mine.map((i) => i.name).join("; ")}.` : "Chưa thấy sản phẩm bạn tìm nêu rõ công nghệ nào trong ngân hàng công nghệ của nhóm này (có thể trang chưa ghi).");
  if (best.length) summary.push(`Công nghệ nền tảng tối ưu nếu ưu tiên ${PRIORITY_LABEL[priority]}: ${best.map((b) => b.name).join("; ")}.`);
  if (missing.length && mine.length) summary.push(`Sản phẩm bạn tìm chưa có ${missing.map((m) => m.name).join("; ")} — cân nhắc nếu đúng nhu cầu.`);
  if (cat.combo) summary.push(`Gợi ý theo nhu cầu: ${cat.combo}`);
  return { typeId: found.type.id, label: cat.label, priority, items, groups, best, addons, mine, summary };
}

/** Công nghệ của nhóm cần tìm thêm thông tin (tên rút gọn) để sinh từ khóa. */
export function catalogNames(typeId, max = 3) {
  return (TECH_CATALOG[typeId]?.techs ?? []).filter((x) => x.role === "core").slice(0, max).map((x) => x.name.replace(/\s*\(.*$/, ""));
}
