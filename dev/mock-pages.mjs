// Trang và dữ liệu MẪU (thương hiệu hư cấu) để chạy thử toàn bộ luồng khi chưa có khóa AI.
// Không phải dữ liệu thật: ứng dụng luôn gắn nhãn "Dữ liệu mẫu" khi dùng chế độ này.

const shell = (title, head, body) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>
<header><nav><a href="/">Trang chủ</a><a href="/sp">Sản phẩm</a><a href="/lh">Liên hệ</a></nav></header>${body}<footer>Bản quyền &copy; cửa hàng mẫu. Hotline: 0901 234 567 Email: ban-hang@shop.test Địa chỉ: 12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh</footer></body></html>`;

export function mockPages(origin) {
  const img = (n) => `${origin}/mock/img/${n}.png`;
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  return {
    "/mock/zeta-zf500-shop-a.html": shell(
      "Nồi chiên không dầu Zeta ZF-500 5,5L chính hãng",
      `<meta property="og:image" content="${img(1)}">` +
        ld({ "@context": "https://schema.org", "@type": "Product", name: "Nồi chiên không dầu Zeta ZF-500 5,5L", brand: { "@type": "Brand", name: "Zeta" }, sku: "ZF-500", image: [img(1), img(2)], offers: { "@type": "Offer", price: "2490000", priceCurrency: "VND" }, aggregateRating: { "@type": "AggregateRating", ratingValue: "4.6", reviewCount: "212" } }),
      `<main><h1>Nồi chiên không dầu Zeta ZF-500 5,5L</h1><img src="${img(1)}" alt="Nồi chiên không dầu Zeta ZF-500" class="product-main" width="600" height="600"><img src="${origin}/mock/img/logo.png" alt="logo cửa hàng" width="90" height="30">
<p>Giá bán: 2.490.000đ. Bảo hành 24 tháng.</p>
<h2>Ưu điểm</h2><ul><li>Dung tích 5,5 lít đủ cho gia đình 4 người nấu một lần</li><li>Làm nóng nhanh chỉ 2 phút, tiết kiệm điện</li><li>Giỏ chiên chống dính, dễ vệ sinh trong máy rửa chén</li></ul>
<h2>Nhược điểm</h2><ul><li>Quạt chạy hơi ồn ở mức nhiệt cao</li><li>Không có cửa sổ quan sát thức ăn</li></ul>
<p>Sản phẩm dùng Công nghệ Rapid Air giúp luồng khí nóng lưu thông đều.</p>
<h2>Thông số kỹ thuật</h2><table><tr><th>Công suất</th><td>1700 W</td></tr><tr><th>Dung tích</th><td>5,5 lít</td></tr><tr><th>Điện áp</th><td>220V / 50Hz</td></tr><tr><th>Bảo hành</th><td>24 tháng</td></tr></table></main>`
    ),
    "/mock/zeta-zf500-review.html": shell(
      "Đánh giá Zeta ZF-500: có đáng mua không?",
      `<meta property="og:image" content="${img(2)}">`,
      `<article><h1>Đánh giá nồi chiên Zeta ZF-500</h1><p>Zeta ZF-500 là mẫu nồi chiên không dầu tầm trung, giá khoảng 2.550.000đ tại các cửa hàng.</p>
<img src="${img(2)}" alt="Zeta ZF-500 mặt trước" width="800" height="600">
<h3>Ưu điểm</h3><p>- Lớp chống dính bền, chiên khoai không dính đáy giỏ</p><p>- Làm nóng nhanh chỉ 2 phút, tiết kiệm điện</p><p>- Bảng điều khiển cảm ứng dễ dùng, có 8 chế độ cài sẵn</p>
<h3>Nhược điểm</h3><p>- Quạt chạy hơi ồn ở mức nhiệt cao</p><p>- Giá nhỉnh hơn Aurora AF-300 khoảng 500 nghìn</p>
<p>Công nghệ Rapid Air và Công nghệ Eco Heat giúp giảm thời gian nấu 20%.</p></article>`
    ),
    "/mock/zeta-zf500-shop-b.html": shell(
      "Zeta ZF-500 | Cửa hàng B",
      `<meta property="product:price:amount" content="2.390.000"><meta property="product:price:currency" content="VND"><meta property="og:image" content="${img(3)}">`,
      `<main><h1>Zeta ZF-500</h1><img src="${img(3)}" data-src="${img(3)}" alt="Zeta ZF-500 nồi chiên" width="500" height="500"><p>Giá ưu đãi 2.390.000đ (đã bao gồm VAT) - miễn phí vận chuyển.</p><ul><li><span>Xuất xứ</span><span>Việt Nam</span></li><li><span>Trọng lượng</span><span>4,2 kg</span></li></ul></main>`
    ),
    "/mock/aurora-af300.html": shell(
      "Aurora AF-300 nồi chiên không dầu 4L",
      `<meta property="og:image" content="${img(4)}">` + ld({ "@type": "Product", name: "Aurora AF-300", brand: "Aurora", sku: "AF-300", image: img(4), offers: { "@type": "Offer", price: 1990000, priceCurrency: "VND" } }),
      `<main><h1>Aurora AF-300 4L</h1><p>Giá 1.990.000đ.</p></main>`
    ),
    "/mock/nimbus-nb450.html": shell(
      "Nimbus NB-450 nồi chiên không dầu 6L",
      `<meta property="og:image" content="${img(5)}">` + ld({ "@type": "Product", name: "Nimbus NB-450", brand: "Nimbus", sku: "NB-450", image: img(5), offers: { "@type": "Offer", price: "3190000", priceCurrency: "VND" } }),
      `<main><h1>Nimbus NB-450 6L</h1><p>Giá 3.190.000đ.</p></main>`
    ),
    "/mock/listing.html": shell(
      "Nồi chiên không dầu chính hãng - Cửa hàng mẫu",
      ld({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: [
        ["Zeta ZF-500", "Zeta", "ZF-500", 2490000, 1], ["Aurora AF-300 4L", "Aurora", "AF-300", 1990000, 4], ["Nimbus NB-450 6L", "Nimbus", "NB-450", 3190000, 5],
        ["Kora KR-700 5L", "Kora", "KR-700", 2790000, 2], ["Vento VT-250 3L", "Vento", "VT-250", 1490000, 3], ["Giỏ lót giấy Aurora", "Aurora", "AC-1", 59000, 4],
        ["Aurora AF-500 5L", "Aurora", "AF-500", 2590000, 4],
      ].map(([name, brand, sku, price, n], i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "Product", name, brand: { "@type": "Brand", name: brand }, sku, url: origin + "/mock/p/" + sku.toLowerCase() + ".html", image: img(n), offers: { "@type": "Offer", price, priceCurrency: "VND" } } })) }),
      `<main><h1>Nồi chiên không dầu</h1></main>`
    ),
    "/mock/blocked.html": null,
  };
}

export function mockSources(origin) {
  const p = (s) => `${origin}/mock/${s}`;
  return {
    shopA: p("zeta-zf500-shop-a.html"),
    review: p("zeta-zf500-review.html"),
    shopB: p("zeta-zf500-shop-b.html"),
    aurora: p("aurora-af300.html"),
    nimbus: p("nimbus-nb450.html"),
    dead: p("khong-ton-tai.html"),
  };
}

export function mockProduct(origin) {
  const s = mockSources(origin);
  return {
    category: "tech",
    product: { name: "Nồi chiên không dầu Zeta ZF-500 5,5L", brand: "Zeta", model: "ZF-500", summary: "Nồi chiên không dầu 5,5 lít tầm trung (dữ liệu mẫu).", aliases: ["Zeta ZF500"] },
    prices: [
      { value: 2490000, label: "Cửa hàng A", source: s.shopA },
      { value: 2390000, label: "Cửa hàng B", source: s.shopB },
      { value: 2550000, label: "Bài đánh giá", source: s.review },
    ],
    pros: [
      { text: "Dung tích 5,5 lít đủ cho gia đình 4 người", source: s.shopA },
      { text: "Làm nóng nhanh chỉ 2 phút, tiết kiệm điện", source: s.review },
    ],
    cons: [{ text: "Quạt chạy hơi ồn ở mức nhiệt cao", source: s.review }],
    technologies: [{ name: "Rapid Air", benefit: "Luồng khí nóng đều, chiên giòn không cần dầu", drawback: "Quạt tạo tiếng ồn", source: s.shopA }],
    specs: [{ name: "Dung tích", value: "5,5 lít" }, { name: "Công suất", value: "1700W" }],
  };
}

export function mockCompare(origin) {
  const s = mockSources(origin);
  return {
    alternatives: [
      { brand: "Aurora", name: "Aurora AF-300 4L", model: "AF-300", price: { value: 1990000, source: s.aurora }, pros: [{ text: "Giá rẻ hơn Zeta ZF-500 khoảng 20%", source: s.aurora }, { text: "Nhỏ gọn, phù hợp bếp hẹp", source: s.aurora }], cons: [{ text: "Dung tích 4 lít chỉ vừa cho 2 người", source: s.aurora }], technologies: [{ name: "Turbo Heat", benefit: "Làm nóng nhanh", drawback: "Không có chế độ nướng" }], sources: [s.aurora], vsMain: "Rẻ hơn nhưng nhỏ hơn." },
      { brand: "Nimbus", name: "Nimbus NB-450 6L", model: "NB-450", price: { value: 3190000, source: s.nimbus }, pros: [{ text: "Dung tích 6 lít, có cửa sổ quan sát", source: s.nimbus }, { text: "Nhiều phụ kiện nướng đi kèm", source: s.nimbus }], cons: [{ text: "Giá cao hơn mặt bằng khoảng 25%", source: s.nimbus }, { text: "Cồng kềnh, chiếm nhiều chỗ", source: s.nimbus }], technologies: [{ name: "Vision Window", benefit: "Nhìn thức ăn không cần mở nắp", drawback: "Kính nóng khi dùng lâu" }], sources: [s.nimbus], vsMain: "Lớn hơn, đắt hơn." },
      { brand: "Kora", name: "Kora KR-700 5L", model: "KR-700", price: { value: 2790000, source: "https://example.org/kora-kr700" }, pros: [{ text: "Bảo hành 36 tháng", source: "https://example.org/kora-kr700" }], cons: [{ text: "Ít chế độ nấu cài sẵn", source: "https://example.org/kora-kr700" }], technologies: [{ name: "Dual Zone", benefit: "Nấu hai món cùng lúc", drawback: "Khó vệ sinh" }], sources: ["https://example.org/kora-kr700"], vsMain: "Bảo hành dài hơn." },
      { brand: "Vento", name: "Vento VT-250 3L", model: "VT-250", price: { value: 1490000, source: "https://example.org/vento-vt250" }, pros: [{ text: "Giá rẻ nhất nhóm", source: "https://example.org/vento-vt250" }], cons: [{ text: "Dung tích nhỏ, công suất thấp", source: "https://example.org/vento-vt250" }, { text: "Lớp chống dính bong sau vài tháng", source: "https://example.org/vento-vt250" }], technologies: [], sources: ["https://example.org/vento-vt250"], vsMain: "Rẻ nhất nhưng kém bền." },
    ],
  };
}
