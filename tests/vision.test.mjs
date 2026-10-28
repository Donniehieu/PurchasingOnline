// Đọc sản phẩm từ ảnh: nhận diện sản phẩm trước (từ khóa sản phẩm), rồi ghép chữ đọc được; giữ nguyên chữ người dùng đã gõ.
import test from "node:test";
import assert from "node:assert/strict";
import { pickProduct, composeImageQuery, PRODUCT_CLASSES } from "../web/js/lib/vision.js";

test("pickProduct: chọn vật thể là sản phẩm, điểm cao và chiếm nhiều khung hình; bỏ người/động vật/điểm thấp", () => {
  const preds = [
    { class: "person", score: 0.99, bbox: [0, 0, 400, 800] },
    { class: "cell phone", score: 0.62, bbox: [100, 100, 300, 500] },
    { class: "bottle", score: 0.7, bbox: [10, 10, 30, 60] },
    { class: "laptop", score: 0.2, bbox: [0, 0, 800, 600] },
  ];
  const p = pickProduct(preds, { imgW: 800, imgH: 800 });
  assert.equal(p.cls, "cell phone");
  assert.equal(p.kw, "điện thoại");
  assert.equal(pickProduct([{ class: "person", score: 0.9, bbox: [0, 0, 5, 5] }, { class: "dog", score: 0.9, bbox: [0, 0, 5, 5] }]), null);
  assert.equal(pickProduct([]), null);
  assert.equal(pickProduct(null), null);
  assert.ok(Object.keys(PRODUCT_CLASSES).length >= 30);
  // lớp hay bị nhầm với đồ điện lạnh/điện thoại cần điểm rất cao (đo thật: điều hòa -> oven 80%, điện thoại -> remote 63%)
  assert.equal(pickProduct([{ class: "oven", score: 0.8, bbox: [0, 0, 700, 700] }], { imgW: 800, imgH: 800 }), null);
  assert.equal(pickProduct([{ class: "remote", score: 0.63, bbox: [0, 0, 700, 700] }], { imgW: 800, imgH: 800 }), null);
  assert.equal(pickProduct([{ class: "oven", score: 0.95, bbox: [0, 0, 700, 700] }], { imgW: 800, imgH: 800 }).kw, "lò nướng");
});

test("composeImageQuery: từ khóa sản phẩm + chữ đọc từ ảnh, không lặp; có chữ người dùng gõ thì giữ nguyên", () => {
  const phone = { kw: "điện thoại" };
  assert.equal(composeImageQuery({ product: phone, ocr: { brand: "Samsung", name: "Galaxy Z Fold8", model: "SM-F976" } }), "điện thoại Samsung Galaxy Z Fold8 SM-F976");
  // tên trên nhãn đã có loại sản phẩm: bỏ phần trùng
  assert.equal(composeImageQuery({ product: phone, ocr: { brand: "Samsung", name: "Điện thoại Samsung Galaxy A57", model: "" } }), "điện thoại Samsung Galaxy A57");
  // model đã nằm trong tên thì không thêm lại
  assert.equal(composeImageQuery({ product: { kw: "tủ lạnh" }, ocr: { brand: "Panasonic", name: "Panasonic NR-BX471", model: "NR-BX471" } }), "tủ lạnh Panasonic NR-BX471");
  // chưa đọc được chữ: chỉ có từ khóa sản phẩm
  assert.equal(composeImageQuery({ product: phone, ocr: null }), "điện thoại");
  // không nhận diện được sản phẩm: dùng chữ đọc được
  assert.equal(composeImageQuery({ product: null, ocr: { brand: "Kangaroo", name: "Máy lọc nước KG100A", model: "KG100A" } }), "Kangaroo Máy lọc nước KG100A");
  // người dùng đã gõ: giữ nguyên, không ghi đè bằng kết quả từ ảnh
  assert.equal(composeImageQuery({ typed: "  máy lọc nước   Karofi ", product: phone, ocr: { brand: "Samsung", name: "x", model: "y" } }), "máy lọc nước Karofi");
  assert.equal(composeImageQuery({}), "");
});

import { pickImagenet, pickClip, CLIP_LABELS, buildQueue, recognizeProduct, IMAGENET_PRODUCTS } from "../web/js/lib/vision.js";

test("ImageNet (họ mô hình phân loại của ImageAI): lớp -> từ khóa sản phẩm; lớp không phải sản phẩm hoặc điểm thấp thì bỏ", () => {
  assert.equal(pickImagenet([{ className: "refrigerator, icebox", probability: 0.7 }]).kw, "tủ lạnh");
  assert.equal(pickImagenet([{ className: "washer, automatic washer, washing machine", probability: 0.5 }]).kw, "máy giặt");
  assert.equal(pickImagenet([{ className: "cellular telephone, cellular phone, cellphone, cell, mobile phone", probability: 0.4 }]).kw, "điện thoại");
  assert.equal(pickImagenet([{ className: "web site, website", probability: 0.64 }, { className: "laptop, laptop computer", probability: 0.31 }]).kw, "laptop", "bỏ lớp không phải sản phẩm, lấy lớp sản phẩm kế");
  assert.equal(pickImagenet([{ className: "modem", probability: 0.8 }]), null);
  assert.equal(pickImagenet([{ className: "laptop", probability: 0.1 }]), null);
  assert.ok(IMAGENET_PRODUCTS.length >= 30);
});

test("CLIP: chọn top 1 khi đủ điểm và hơn hạng 2; mơ hồ hoặc điểm thấp thì chưa chắc", () => {
  const r = (a, b) => [{ label: "air conditioner", score: a }, { label: "refrigerator", score: b }, { label: "laptop", score: 0.05 }];
  const ok = pickClip(r(0.2, 0.12));
  assert.equal(ok.kw, "điều hòa"); assert.ok(ok.margin > 0.07);
  assert.equal(pickClip(r(0.2, 0.19)), null, "hai lớp sát nhau: chưa chắc");
  assert.equal(pickClip(r(0.1, 0.03)), null, "điểm thấp");
  assert.equal(pickClip([]), null);
  assert.equal(pickClip([{ label: "không có trong danh sách", score: 0.9 }]), null);
  assert.ok(CLIP_LABELS.length >= 35 && CLIP_LABELS.every(([en, vi]) => en && vi));
});

test("hàng chờ mô hình: thử lần lượt; mô hình trước lỗi hoặc chưa chắc thì sang mô hình sau; có thể tắt CLIP", async () => {
  assert.deepEqual(buildQueue({ clip: true }).map((m) => m.id), ["clip", "coco-ssd", "mobilenet"]);
  assert.deepEqual(buildQueue({ clip: false }).map((m) => m.id), ["coco-ssd", "mobilenet"]);
  const mk = (id, run, minScore = 0.3) => ({ id, label: id, minScore, run });
  const order = [];
  const q = [
    mk("a", async () => { order.push("a"); throw new Error("không tải được"); }),
    mk("b", async () => { order.push("b"); return null; }),
    mk("c", async () => { order.push("c"); return { cls: "x", kw: "tủ lạnh", score: 0.2 }; }, 0.5),
    mk("d", async () => { order.push("d"); return { cls: "y", kw: "máy giặt", score: 0.6 }; }),
    mk("e", async () => { order.push("e"); return { cls: "z", kw: "tivi", score: 0.9 }; }),
  ];
  const r = await recognizeProduct(null, { queue: q });
  assert.equal(r.kw, "máy giặt");
  assert.equal(r.model, "d");
  assert.deepEqual(order, ["a", "b", "c", "d"], "dừng ở mô hình đầu tiên nhận ra, không chạy tiếp");
  assert.deepEqual(r.tried.map((t) => t.ok), [false, false, false, true]);
  assert.equal(await recognizeProduct(null, { queue: [mk("a", async () => null)] }), null);
});
