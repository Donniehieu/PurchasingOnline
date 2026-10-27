// Kiểm thử bộ phân tích bằng nội dung THẬT của Google Chế độ AI (đọc ngày 27/10/2026, truy vấn "nồi chiên không dầu Sunhouse SHD4030 ưu nhược điểm").
import test from "node:test";
import assert from "node:assert/strict";
import { parseAnswer, aiQuery, pricesIn } from "../web/js/lib/aitext.js";
import { makePlan } from "../web/js/lib/plan.js";

const L = (t, c = []) => ({ t, c });
const REAL = {
  cites: ["Điện máy XANH", "Facebook · Điện máy XANH (dienmayxanh.com)", "Hoàng Hà Mobile", "Siêu Thị Điện Máy Chợ Lớn", "Điện máy XANH", "Thegioididong.com", "Siêu thị Điện máy XANH", "SUNHOUSE GROUP"].map((label, i) => ({ label, href: "https://www.google.com/goto?url=T" + i })),
  lines: [
    L("Nồi chiên không dầu Sunhouse SHD4030 (dung tích tổng 6.5 lít, công suất 1700W) là một dòng nồi chiên cơ phân khúc bình dân rất phổ biến của Sunhouse. Điểm nhấn lớn nhất của model này là thiết kế cửa sổ kính trong suốt.", [0]),
    L("Dưới đây là bảng thông số cơ bản cùng phần phân tích chi tiết ưu, nhược điểm của sản phẩm dựa trên trải nghiệm thực tế từ người dùng:"),
    L("Thông số kỹ thuật cốt lõi"),
    L("Tiêu chí | Thông số chi tiết"),
    L("Dung tích tổng / Sử dụng | 6.5 Lít / 6 Lít (Chiên được gà nguyên con khoảng 1.2kg)"),
    L("Công suất hoạt động | 1700 W"),
    L("Công nghệ làm nóng | Rapid Air 360 độ (Đối lưu khí nóng)"),
    L("Bảng điều khiển | Núm xoay cơ (Hẹn giờ tối đa 60 phút, nhiệt độ 80 - 200°C)"),
    L("Các ưu điểm nổi bật"),
    L("Thiết kế kính trong suốt tiện lợi: Đây là cải tiến đáng giá nhất so với các dòng nồi cơ cũ. Kết hợp với đèn chiếu sáng bên trong, bạn có thể quan sát trực tiếp bề mặt đồ ăn.", [1]),
    L("Dung tích lớn, giá thành rẻ: Với dung tích thực tế 6 lít, nồi đáp ứng tốt nhu cầu cho gia đình từ 4 – 6 người. Mức giá của model này rất \"mềm\" (dao động khoảng 800.000đ - 1.100.000đ tùy nơi bán và chương trình khuyến mãi).", [2]),
    L("Điều khiển cơ bền bỉ, dễ dùng: Thiết kế 2 núm xoay độc lập giúp người lớn tuổi cũng có thể sử dụng dễ dàng.", [3]),
    L("Giảm chất béo hiệu quả: Công nghệ Rapid Air giúp thức ăn chín đều, giòn ngoài mềm trong mà không cần (hoặc cần rất ít) dầu mỡ.", [5]),
    L("Các nhược điểm cần lưu ý"),
    L("Vạch chỉ số trên núm xoay nhỏ và mờ: Một số người dùng phản hồi rằng phần vạch chia nhiệt độ và thời gian được in khá nhỏ."),
    L("Thời gian đầu có mùi nhựa nhẹ: Do phần vỏ làm bằng nhựa PP, trong 1-2 lần đầu tiên cắm điện sử dụng, nồi sẽ tỏa ra mùi nhựa mới."),
    L("Kích thước khá cồng kềnh: Dung tích lòng nồi lớn đồng nghĩa với việc tổng thể máy tương đối chiếm diện tích trên mặt bàn bếp.", [6]),
    L("Đánh giá chung: Có nên mua không?"),
    L("Nồi chiên không dầu Sunhouse SHD4030 là sự lựa chọn rất đáng tiền cho những ai đang tìm kiếm một chiếc nồi chiên ngon - bổ - rẻ, ưu tiên sự bền bỉ của nồi cơ.", [7]),
    L("Để giúp bạn đưa ra quyết định chuẩn xác nhất, bạn có thể chia sẻ thêm:"),
    L("Bạn dự kiến mua nồi cho bao nhiêu người ăn?"),
  ],
};

test("pricesIn hiểu khoảng giá và loại số không phải tiền", () => {
  assert.deepEqual(pricesIn("dao động khoảng 800.000đ - 1.100.000đ tùy nơi bán"), [800000, 1100000]);
  assert.deepEqual(pricesIn("giá 1,2 triệu"), [1200000]);
  assert.deepEqual(pricesIn("công suất 1700W, 6 lít, 4 – 6 người"), []);
});

test("parseAnswer trên câu trả lời thật: ưu/nhược điểm, thông số, công nghệ, giá, nguồn", () => {
  const plan = makePlan({ text: "Nồi chiên không dầu Sunhouse SHD4030" });
  const d = parseAnswer(REAL, plan);
  assert.equal(d.pros.length, 4);
  assert.equal(d.cons.length, 3);
  assert.match(d.pros[0].text, /^Thiết kế kính trong suốt/);
  assert.deepEqual(d.pros[1].cites, [2]);
  assert.deepEqual(d.cons[2].cites, [6]);
  assert.ok(!d.pros.some((p) => /Bạn dự kiến|Tiêu chí/.test(p.text)));
  assert.equal(d.specs.length, 4);
  assert.deepEqual(d.specs[1], { name: "Công suất hoạt động", value: "1700 W" });
  assert.ok(d.technologies.some((t) => /Rapid Air 360/.test(t.name)));
  assert.equal(d.prices.length, 1);
  assert.equal(d.prices[0].low, 800000);
  assert.equal(d.prices[0].high, 1100000);
  assert.equal(d.prices[0].value, 950000);
  assert.match(d.product.summary, /^Nồi chiên không dầu Sunhouse SHD4030/);
  assert.match(d.verdict, /lựa chọn rất đáng tiền/);
});

test("hàng tiêu dùng: không có công nghệ", () => {
  const d = parseAnswer(REAL, makePlan({ text: "Dầu gội Clear 650g" }));
  assert.equal(d.technologies.length, 0);
  assert.ok(d.pros.length > 0);
});

test("aiQuery gom đủ nội dung, hàng tiêu dùng không hỏi công nghệ", () => {
  assert.match(aiQuery(makePlan({ text: "Nồi chiên không dầu Sunhouse SHD4030" })), /công nghệ.*ưu điểm.*nhược điểm/);
  assert.ok(!/công nghệ/.test(aiQuery(makePlan({ text: "Dầu gội Clear 650g" }))));
});
