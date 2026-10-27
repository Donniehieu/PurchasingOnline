// Ngân hàng câu hỏi theo loại hàng, có sẵn trong ứng dụng (không gọi mạng, không tốn lượt tìm): hiện ngay lập tức.
// Mỗi loại có từ khóa nhận diện (viết không dấu) và các câu hỏi để điền đủ thông tin trước khi tìm.
// Câu trả lời được nối vào chuỗi người dùng gõ (người dùng thấy và sửa được chuỗi này trước khi tìm).
const o = (labels, adds = {}) => labels.map((l) => ({ label: l, add: adds[l] ?? l }));
const BRAND_Q = (list) => ({ id: "brand", title: "Bạn muốn hãng nào?", options: o(list) });

export const TYPES = [
  {
    id: "milk", label: "Sữa", kind: "consumer",
    // từ khóa có dấu được khớp theo chữ có dấu (tránh nhầm "sữa" với "sửa")
    keys: ["sữa bột", "sữa tươi", "sữa chua", "sữa đặc", "sữa hạt", "sữa công thức", "sữa pha sẵn", "sữa", "milk", "formula"],
    questions: [
      { id: "form", title: "Loại sữa bạn cần?", options: o(["Sữa tươi", "Sữa bột", "Sữa pha sẵn", "Sữa chua", "Sữa đặc", "Sữa hạt"]), skipIf: ["sua tuoi", "sua bot", "pha san", "sua chua", "sua dac", "sua hat"] },
      { id: "volume", title: "Dung tích / khối lượng?", facet: "capacity", options: o(["110ml", "180ml", "1 lít", "400g", "900g"]), skipIf: ["ml", " lit", "gram", " kg", "400g", "900g"] },
      { id: "age", title: "Cho ai dùng?", options: o(["Trẻ dưới 1 tuổi", "Trẻ 1-3 tuổi", "Trẻ trên 3 tuổi", "Người lớn", "Người cao tuổi"]) },
      { id: "pack", title: "Đóng gói?", options: o(["Hộp lẻ", "Lốc", "Thùng"]), skipIf: ["loc", "thung", "hop"] },
      BRAND_Q(["Vinamilk", "TH True Milk", "Nutifood", "Dutch Lady", "Abbott", "Nestlé"]),
    ],
  },
  {
    id: "food", label: "Thực phẩm, đồ uống đóng gói", kind: "consumer",
    keys: ["mi goi", "mi an lien", "banh", "keo", "nuoc ngot", "nuoc suoi", "nuoc mam", "dau an", "gao", "duong", "ca phe", "tra", "bia", "nuoc tuong", "gia vi", "sua ong"],
    questions: [
      { id: "pack", title: "Quy cách đóng gói?", options: o(["Gói/chai/lon lẻ", "Lốc", "Thùng", "Túi lớn"]), skipIf: ["loc", "thung"] },
      { id: "size", title: "Khối lượng / dung tích?", facet: "capacity", options: o(["100g", "500g", "1kg", "330ml", "1 lít", "5 lít"]), skipIf: ["ml", " lit", "gram", " kg"] },
      { id: "use", title: "Dùng để làm gì?", options: o(["Gia đình", "Quán ăn, kinh doanh", "Làm quà tặng"]) },
    ],
  },
  {
    id: "gauge", label: "Đồng hồ đo, thiết bị đo công nghiệp", kind: "tech",
    keys: ["dong ho do", "dong ho ap", "dong ho nhiet", "dong ho dau", "dong ho nuoc", "dong ho chan khong", "cam bien ap", "cam bien", "nhiet ke", "ap ke", "gauge", "pressure gauge"],
    questions: [
      { id: "measure", title: "Đo đại lượng nào?", options: o(["Áp suất", "Nhiệt độ", "Dầu, nhớt", "Nước", "Khí nén", "Chân không"]), skipIf: ["ap suat", "nhiet", "dau", "nuoc", "khi", "chan khong"] },
      { id: "size", title: "Đường kính mặt đồng hồ?", facet: "size", options: o(["D40", "D50", "D63", "D100", "D150"], { D40: "D40mm", D50: "D50mm", D63: "D63mm", D100: "D100mm", D150: "D150mm" }) },
      { id: "range", title: "Dải đo tối đa?", facet: "pressure", options: o(["6 bar", "10 bar", "16 bar", "25 bar", "40 bar", "100 bar"]) },
      { id: "thread", title: "Kiểu chân / ren kết nối?", facet: "thread", options: o(["Chân sau", "Chân đứng", "Chân sau có vành", "Ren 13mm", "Ren 1/4", "Ren 1/2"]), skipIf: ["chan sau", "chan dung"] },
      { id: "material", title: "Chất liệu?", facet: "material", options: o(["Inox 304", "Inox 316", "Thép", "Đồng thau"]) },
      BRAND_Q(["Wika", "Ligi", "Yamaki", "Asahi", "Nuova Fima"]),
    ],
  },
  {
    id: "valve", label: "Van, ống, phụ kiện đường ống", kind: "tech",
    keys: ["van bi", "van cong", "van mot chieu", "van", "ong inox", "ong nhua", "ong ppr", "khop noi", "co noi", "tee", "mang xong", "pipe", "valve"],
    questions: [
      { id: "type", title: "Loại?", options: o(["Van bi", "Van cổng", "Van một chiều", "Ống", "Co, cút, tê", "Măng sông"]), skipIf: ["van bi", "van cong", "mot chieu", "ong", "co noi"] },
      { id: "size", title: "Kích thước (DN / ren)?", options: o(["DN15", "DN20", "DN25", "DN50", "Ren 21", "Ren 27"]) },
      { id: "material", title: "Chất liệu?", facet: "material", options: o(["Inox 304", "Inox 316", "Đồng", "Nhựa PVC", "Nhựa PPR", "Gang"]) },
      { id: "pressure", title: "Áp lực làm việc?", facet: "pressure", options: o(["PN10", "PN16", "PN25"]) },
      BRAND_Q(["Minh Hòa", "Tiền Phong", "Bình Minh", "Kitz", "Yamato"]),
    ],
  },
  {
    id: "aircon", label: "Điều hòa", kind: "tech",
    keys: ["dieu hoa", "may lanh", "air conditioner", "aircon"],
    questions: [
      { id: "area", title: "Diện tích phòng?", options: o(["Dưới 15 m²", "15-20 m²", "20-30 m²", "Trên 30 m²"], { "Dưới 15 m²": "9000 BTU", "15-20 m²": "12000 BTU", "20-30 m²": "18000 BTU", "Trên 30 m²": "24000 BTU" }), skipIf: ["btu", " hp", "m2"] },
      { id: "kind", title: "Loại máy?", options: o(["Inverter", "Một chiều", "Hai chiều", "Âm trần, tủ đứng"]), skipIf: ["inverter", "1 chieu", "2 chieu", "mot chieu", "hai chieu"] },
      BRAND_Q(["Daikin", "Panasonic", "LG", "Samsung", "Mitsubishi", "Casper"]),
    ],
  },
  {
    id: "fridge", label: "Tủ lạnh", kind: "tech",
    keys: ["tu lanh", "refrigerator", "fridge"],
    questions: [
      { id: "capacity", title: "Dung tích?", facet: "capacity", options: o(["Dưới 150 lít", "150-300 lít", "300-450 lít", "Trên 450 lít"], { "Dưới 150 lít": "dưới 150 lít", "150-300 lít": "250 lít", "300-450 lít": "350 lít", "Trên 450 lít": "500 lít" }) },
      { id: "kind", title: "Kiểu tủ?", options: o(["Mini", "Ngăn đá trên", "Ngăn đá dưới", "Side by side", "Nhiều cửa"]) },
      BRAND_Q(["Samsung", "LG", "Panasonic", "Toshiba", "Hitachi", "Aqua"]),
    ],
  },
  {
    id: "washer", label: "Máy giặt", kind: "tech",
    keys: ["may giat", "washing machine", "may say quan ao"],
    questions: [
      { id: "weight", title: "Khối lượng giặt?", options: o(["7 kg", "8-9 kg", "10-11 kg", "Trên 12 kg"]), skipIf: [" kg"] },
      { id: "kind", title: "Kiểu máy?", options: o(["Cửa trước", "Cửa trên", "Giặt sấy"]) },
      BRAND_Q(["Samsung", "LG", "Electrolux", "Panasonic", "Toshiba", "Aqua"]),
    ],
  },
  {
    id: "purifier", label: "Máy lọc nước", kind: "tech",
    keys: ["may loc nuoc", "loc nuoc", "water purifier", "may nuoc nong lanh"],
    questions: [
      { id: "tech", title: "Công nghệ lọc?", options: o(["RO", "Nano", "Hydrogen", "Nóng lạnh"]), skipIf: [" ro ", "nano", "hydrogen", "nong lanh"] },
      { id: "cores", title: "Số lõi lọc?", options: o(["7 lõi", "9 lõi", "10 lõi", "11 lõi"]), skipIf: [" loi"] },
      { id: "use", title: "Dùng cho?", options: o(["Gia đình", "Văn phòng", "Công nghiệp"]) },
      BRAND_Q(["Kangaroo", "Karofi", "Sunhouse", "Mutosi", "Coway"]),
    ],
  },
  {
    id: "laptop", label: "Laptop, máy tính", kind: "tech",
    keys: ["laptop", "may tinh xach tay", "macbook", "may tinh de ban", "pc", "notebook"],
    questions: [
      { id: "use", title: "Nhu cầu chính?", options: o(["Văn phòng, học tập", "Đồ họa, kỹ thuật", "Gaming", "Mỏng nhẹ di chuyển"]) },
      { id: "ram", title: "RAM?", options: o(["8GB", "16GB", "32GB"]), skipIf: ["gb"] },
      { id: "screen", title: "Màn hình?", options: o(["13 inch", "14 inch", "15.6 inch", "17 inch"]), skipIf: ["inch"] },
      BRAND_Q(["Dell", "HP", "Lenovo", "Asus", "Acer", "MSI", "Apple"]),
    ],
  },
  {
    id: "phone", label: "Điện thoại, máy tính bảng", kind: "tech",
    keys: ["dien thoai", "smartphone", "iphone", "may tinh bang", "tablet", "ipad"],
    questions: [
      { id: "storage", title: "Bộ nhớ?", options: o(["64GB", "128GB", "256GB", "512GB"]), skipIf: ["gb"] },
      { id: "focus", title: "Quan tâm nhất?", options: o(["Camera", "Pin trâu", "Chơi game", "Giá rẻ"]) },
      BRAND_Q(["Apple", "Samsung", "Xiaomi", "Oppo", "Vivo", "Realme"]),
    ],
  },
  {
    id: "tv", label: "Tivi", kind: "tech",
    keys: ["tivi", "tv", "television", "smart tv"],
    questions: [
      { id: "size", title: "Kích thước?", options: o(["32 inch", "43 inch", "50 inch", "55 inch", "65 inch", "75 inch"]), skipIf: ["inch"] },
      { id: "panel", title: "Loại màn hình?", options: o(["LED", "QLED", "OLED", "Google TV"]) },
      BRAND_Q(["Samsung", "LG", "Sony", "TCL", "Casper"]),
    ],
  },
  {
    id: "audio", label: "Tai nghe, loa", kind: "tech",
    keys: ["tai nghe", "headphone", "earphone", "earbuds", "loa", "speaker", "soundbar"],
    questions: [
      { id: "kind", title: "Kiểu?", options: o(["In-ear", "Over-ear", "True wireless", "Loa bluetooth", "Soundbar"]) },
      { id: "anc", title: "Chống ồn?", options: o(["Có chống ồn", "Không cần"]) },
      BRAND_Q(["Sony", "JBL", "Apple", "Samsung", "Bose", "Anker"]),
    ],
  },
  {
    id: "kitchen", label: "Đồ gia dụng nhà bếp", kind: "tech",
    keys: ["noi chien", "noi com", "lo vi song", "lo nuong", "may xay", "am dun", "bep tu", "bep ga", "may hut bui", "robot hut bui", "quat", "may ep"],
    questions: [
      { id: "capacity", title: "Dung tích / kích cỡ?", facet: "capacity", options: o(["Dưới 3 lít", "3-5 lít", "5-8 lít", "Trên 8 lít"]) },
      { id: "power", title: "Công suất?", facet: "power", options: o(["Dưới 1000W", "1000-1500W", "Trên 1500W"]) },
      { id: "use", title: "Số người dùng?", options: o(["1-2 người", "3-4 người", "5 người trở lên"]) },
      BRAND_Q(["Sunhouse", "Philips", "Panasonic", "Kangaroo", "Lock&Lock", "Xiaomi"]),
    ],
  },
  {
    id: "power", label: "Máy bơm, động cơ, dụng cụ điện", kind: "tech",
    keys: ["may bom", "bom nuoc", "dong co", "motor", "may khoan", "may mai", "may cat", "may han", "may nen khi", "pump"],
    questions: [
      { id: "power", title: "Công suất?", facet: "power", options: o(["Dưới 500W", "500W-1HP", "1-2HP", "Trên 2HP"]) },
      { id: "volt", title: "Điện áp?", options: o(["220V", "380V", "Pin sạc"]) },
      { id: "use", title: "Mục đích?", options: o(["Gia đình", "Công trình, xây dựng", "Nhà xưởng, công nghiệp", "Nông nghiệp"]) },
      BRAND_Q(["Makita", "Bosch", "Panasonic", "Pentax", "Ebara", "Total"]),
    ],
  },
];

// Câu hỏi chung khi chưa biết loại hàng: chọn loại trước, sau đó hỏi tiếp theo loại đó
export const TYPE_PICKER = { id: "type", title: "Bạn đang tìm loại sản phẩm nào?", options: TYPES.map((t) => ({ label: t.label, add: t.label.toLowerCase(), value: t.id })) };
