"""Sinh các question card để người dùng xác nhận thông tin sản phẩm trước khi tìm kiếm.

Mỗi card có tiêu đề, câu hỏi, danh sách lựa chọn và một lựa chọn 'Khác' để nhập tay.
Card được dựng theo quy tắc (không dùng AI), nên kết quả ổn định và kiểm thử được.
"""

import re

CUSTOM = "__custom__"
NONE = ""
MAH_CHOICES = ["10000", "20000", "30000", "50000"]
VOLT_CHOICES = ["12", "15", "18", "24", "28"]
PURPOSE_CHOICES = [
    "Công nhân làm ngoài trời (8 giờ trở lên mỗi ngày)",
    "Đi xe máy hoặc làm việc văn phòng",
    "Làm việc nặng, công trình xây dựng",
]
QUANTITY_CHOICES = [1, 10, 50, 100, 150]
MAH_RE = re.compile(r"(\d{4,6})\s*m\s?ah", re.IGNORECASE)
VOLT_RE = re.compile(r"\b(\d{1,2})\s*v(?:dc)?\b", re.IGNORECASE)


def _unique(options):
    seen, result = set(), []
    for option in options:
        if option["value"] not in seen:
            seen.add(option["value"])
            result.append(option)
    return result


def _custom():
    return {"value": CUSTOM, "label": "Khác (nhập bên dưới)"}


def build_cards(request_data, suggested_name=None, ocr_text=""):
    """request_data: query, product_code, quantity, purpose. suggested_name: tên đoán từ ảnh (nếu có)."""
    query = (request_data.get("query") or "").strip()
    code = (request_data.get("product_code") or "").strip()
    quantity = request_data.get("quantity") or 1
    purpose = (request_data.get("purpose") or "").strip()
    cards = []

    # 1. Tên sản phẩm
    name_options = []
    if query:
        name_options.append({"value": query, "label": f"Đúng: {query}"})
    if suggested_name and suggested_name.lower() != query.lower():
        name_options.append({"value": suggested_name, "label": f"Theo ảnh: {suggested_name}"})
    if not name_options and code:
        name_options.append({"value": code, "label": f"Dùng mã: {code}"})
    name_options.append(_custom())
    cards.append({
        "id": "product",
        "title": "Tên sản phẩm",
        "question": "Sản phẩm bạn cần mua có đúng là như này không?",
        "options": _unique(name_options),
        "default": name_options[0]["value"],
    })

    # 2. Mã / model
    model_options = [{"value": code, "label": f"Đúng: {code}"}] if code else []
    model_options.append({"value": NONE, "label": "Không rõ, để app tự tìm"})
    model_options.append(_custom())
    cards.append({
        "id": "model",
        "title": "Mã / model",
        "question": "Sản phẩm có mã hoặc model cụ thể không?",
        "options": _unique(model_options),
        "default": code or NONE,
    })

    # 3. Dung lượng pin
    found_mah = _first_number(MAH_RE, query)
    mah_options = ([{"value": found_mah, "label": _mah_label(found_mah)}] if found_mah else [])
    mah_options += [{"value": v, "label": _mah_label(v)} for v in MAH_CHOICES]
    mah_options += [{"value": NONE, "label": "Không quan trọng"}, _custom()]
    cards.append({
        "id": "mah",
        "title": "Dung lượng pin",
        "question": "Dung lượng pin cần là bao nhiêu mAh?",
        "options": _unique(mah_options),
        "default": found_mah or NONE,
    })

    # 4. Điện áp
    found_volt = _first_number(VOLT_RE, query)
    volt_options = ([{"value": found_volt, "label": f"{found_volt}V"}] if found_volt else [])
    volt_options += [{"value": v, "label": f"{v}V"} for v in VOLT_CHOICES]
    volt_options += [{"value": NONE, "label": "Không quan trọng"}, _custom()]
    cards.append({
        "id": "volt",
        "title": "Điện áp",
        "question": "Điện áp cần là bao nhiêu volt?",
        "options": _unique(volt_options),
        "default": found_volt or NONE,
    })

    # 5. Số lượng
    qty_options = [{"value": str(quantity), "label": f"{quantity} cái"}]
    qty_options += [{"value": str(q), "label": f"{q} cái"} for q in QUANTITY_CHOICES]
    qty_options.append(_custom())
    cards.append({
        "id": "quantity",
        "title": "Số lượng",
        "question": "Bạn cần mua bao nhiêu cái?",
        "options": _unique(qty_options),
        "default": str(quantity),
    })

    # 6. Mục đích sử dụng
    purpose_options = ([{"value": purpose, "label": f"Đúng: {purpose}"}] if purpose else [])
    purpose_options += [{"value": p, "label": p} for p in PURPOSE_CHOICES]
    purpose_options += [{"value": NONE, "label": "Chưa xác định"}, _custom()]
    cards.append({
        "id": "purpose",
        "title": "Mục đích sử dụng",
        "question": "Sản phẩm dùng cho mục đích gì?",
        "options": _unique(purpose_options),
        "default": purpose or NONE,
    })
    if ocr_text:
        cards.append({
            "id": "ocr",
            "title": "Chữ đọc được trong ảnh",
            "question": f"Thêm chữ này vào từ khóa tìm kiếm? \"{ocr_text[:120]}\"",
            "options": [
                {"value": "use", "label": "Có, thêm vào từ khóa"},
                {"value": "skip", "label": "Không, bỏ qua"},
            ],
            "default": "use",
        })
    return cards


def _first_number(pattern, text):
    match = pattern.search(text or "")
    return match.group(1) if match else None


def _mah_label(value):
    return f"{int(value):,} mAh".replace(",", ".")
