"""Chấm điểm NCC và chọn nhà cung cấp ưu tiên.

Trọng số (có thể chỉnh trong WEIGHTS):
  - giá: giá trên 1.000 mAh càng thấp càng tốt (nếu có dung lượng), không có thì trung tính
  - bảo hành: số tháng, tối đa 12 tháng
  - hóa đơn VAT: có = 1, chưa rõ = 0.5, không = 0 (và bị loại nếu REQUIRE_VAT)
  - độ phù hợp: tỷ lệ từ khóa sản phẩm xuất hiện trên trang
"""

WEIGHTS = {"price": 0.40, "warranty": 0.25, "vat": 0.20, "relevance": 0.15}
REQUIRE_VAT = True
NEUTRAL = 0.5


def _price_per_1000mah(item):
    if item["price"] and item["mah"]:
        return item["price"] / (item["mah"] / 1000)
    return None


def score_suppliers(items):
    """Nhận danh sách NCC đã trích, trả về danh sách có thêm 'score', 'eligible', 'reason'."""
    ppk_values = [v for v in (_price_per_1000mah(i) for i in items) if v]
    best_ppk = min(ppk_values) if ppk_values else None

    scored = []
    for item in items:
        row = {k: v for k, v in item.items() if k not in ("recommended", "eligible", "reason", "score")}
        row["eligible"] = True
        row["reason"] = ""

        if REQUIRE_VAT and item["vat"] is False:
            row.update(eligible=False, reason="Không có hóa đơn VAT", score=0.0)
            scored.append(row)
            continue

        ppk = _price_per_1000mah(item)
        if ppk and best_ppk:
            price_score = best_ppk / ppk
        else:
            price_score = NEUTRAL

        warranty_score = min(item["warranty_months"] or 0, 12) / 12
        vat_score = {True: 1.0, None: NEUTRAL, False: 0.0}[item["vat"]]

        row["score"] = round(
            WEIGHTS["price"] * price_score
            + WEIGHTS["warranty"] * warranty_score
            + WEIGHTS["vat"] * vat_score
            + WEIGHTS["relevance"] * item["relevance"],
            3,
        )
        scored.append(row)

    eligible = [r for r in scored if r["eligible"]]
    if eligible:
        best = max(eligible, key=lambda r: r["score"])
        best["recommended"] = True
        best["reason"] = "Khuyến nghị: điểm cao nhất"
    for row in scored:
        row.setdefault("recommended", False)
    return sorted(scored, key=lambda r: (not r["eligible"], -r.get("score", 0)))
