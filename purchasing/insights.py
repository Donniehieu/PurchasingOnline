"""Phân tích giá, kịch bản đàm phán và luận điểm thuyết phục sếp.

Mọi con số và căn cứ đều lấy từ dữ liệu đã crawl (trang NCC) và các câu trích từ tìm kiếm web.
Nội dung được sắp theo quy trình mua hàng: nhu cầu, khảo sát, so sánh, đàm phán, rủi ro, trình duyệt.
Đây là bản nháp gợi ý, người mua cần đọc lại và chỉnh trước khi dùng.
"""

import statistics
from datetime import date, datetime

STALE_MONTHS = 6


def price_comparison(suppliers):
    """Bảng tỷ lệ giá so với NCC rẻ nhất (dùng cho biểu đồ)."""
    priced = [s for s in suppliers if s.get("price")]
    if not priced:
        return []
    lowest = min(s["price"] for s in priced)
    rows = [{"name": s["name"], "price": s["price"], "ratio": round(s["price"] / lowest * 100, 1),
             "recommended": bool(s.get("recommended"))} for s in priced]
    return sorted(rows, key=lambda r: r["price"])


def build_insights(suppliers, quantity, ctx=None):
    ctx = ctx or {}
    eligible = [s for s in suppliers if s.get("eligible") and s.get("price")]
    recommended = next((s for s in suppliers if s.get("recommended")), None)
    return {
        "negotiation": _negotiation(eligible, recommended, quantity, ctx),
        "persuasion": _persuasion(suppliers, eligible, recommended, quantity, ctx),
    }


def persuasion_text(persuasion):
    """Chuyển luận điểm thành văn bản thuần (dùng cho email và sao chép)."""
    if not persuasion.get("title"):
        return ""
    lines = [persuasion["title"], ""]
    for section in persuasion.get("sections", []):
        lines.append(section["heading"])
        lines += [f"- {p}" for p in section["points"]]
        lines.append("")
    lines.append(persuasion["closing"])
    return "\n".join(lines)


# ---------------------------------------------------------------- đàm phán
def _negotiation(eligible, recommended, quantity, ctx):
    if not recommended or not recommended.get("price"):
        return []
    price = recommended["price"]
    others = sorted((s for s in eligible if s is not recommended and s["name"] != recommended["name"]), key=lambda s: s["price"])
    prices = [s["price"] for s in eligible]
    median = statistics.median(prices) if prices else None

    target, target_note = None, "Giá đang ở mức thấp nhất hoặc gần thấp nhất, tập trung đàm phán chiết khấu số lượng và điều kiện đi kèm."
    cheaper = [s for s in others if s["price"] < price]
    if cheaper:
        target = cheaper[0]["price"]
        target_note = (f"Mục tiêu về {_money(target)}: bằng giá của {cheaper[0]['name']}, thấp hơn giá hiện tại "
                       f"{_money(price - target)} ({round((price - target) / price * 100)}%).")
    elif median and price > median:
        target = round(median)
        target_note = f"Mục tiêu về {_money(target)}: mức trung vị của các NCC đủ điều kiện."

    leverage = []
    for s in cheaper[:2]:
        leverage.append(f"{s['name']} có giá {_money(s['price'])}, thấp hơn {round((price - s['price']) / price * 100)}% so với báo giá hiện tại.")
    own_warranty = recommended.get("warranty_months") or 0
    better_warranty = [s for s in others if (s.get("warranty_months") or 0) > own_warranty]
    if better_warranty:
        best = max(better_warranty, key=lambda s: s["warranty_months"])
        leverage.append(f"{best['name']} bảo hành {best['warranty_months']} tháng; đề nghị bảo hành tương đương hoặc dài hơn.")
    age = _age_months(recommended.get("date"))
    if age is not None and age >= STALE_MONTHS:
        leverage.append(f"Thông tin giá trên web cập nhật cách đây khoảng {age} tháng, đề nghị NCC xác nhận lại báo giá hiện hành.")
    leverage.append(f"Số lượng {quantity} cái: đề nghị bảng giá theo bậc số lượng và chiết khấu cho đơn này.")
    if not leverage[:-1]:
        leverage.insert(0, "Chưa có NCC nào rẻ hơn hoặc bảo hành tốt hơn trong dữ liệu thu thập, nên chuẩn bị thêm báo giá từ NCC khác để có thêm căn cứ.")

    return [{
        "ncc": recommended["name"],
        "current_price": price,
        "target_price": target,
        "target_note": target_note,
        "backup": f"{others[0]['name']} ({_money(others[0]['price'])})" if others else "Chưa có NCC dự phòng",
        "leverage": leverage,
        "questions": _questions_for(recommended, ctx),
        "strategies": _strategies(quantity, others),
        "steps": [
            "Bước 1 - Chuẩn bị: chốt thông số cần mua, số lượng, hạn giao hàng và mức giá tối đa chấp nhận được trước khi liên hệ.",
            "Bước 2 - Hỏi giá (RFQ): gửi cùng một yêu cầu cho ít nhất 3 NCC để so sánh trên cùng điều kiện.",
            "Bước 3 - Đàm phán vòng 1: giá và chiết khấu số lượng, dùng các căn cứ ở mục Điểm mạnh thương lượng.",
            "Bước 4 - Đàm phán vòng 2: bảo hành, giao hàng, thanh toán, hóa đơn VAT, hiệu lực báo giá.",
            "Bước 5 - Xác nhận bằng văn bản: báo giá chính thức có dấu hoặc email xác nhận, ghi rõ model, đơn giá, bảo hành.",
            "Bước 6 - Mua thử mẫu (nếu đơn lớn): kiểm tra thực tế trước khi đặt toàn bộ số lượng.",
        ],
        "references": _references(ctx),
    }]


def _questions_for(s, ctx):
    questions = []
    if s.get("vat") is not True:
        questions.append("Đơn giá đã bao gồm VAT chưa? Xuất được hóa đơn VAT đúng tên công ty không?")
    if not s.get("warranty_months"):
        questions.append("Thời gian bảo hành pin và quạt là bao lâu? Có đổi mới nếu lỗi do nhà sản xuất không?")
    if not s.get("mah"):
        questions.append("Dung lượng pin và điện áp thực tế của model này là bao nhiêu? Có tem hoặc chứng nhận CO/CQ không?")
    spec = ctx.get("spec")
    if spec and spec != "Không yêu cầu":
        questions.append(f"Sản phẩm có đáp ứng đúng thông số yêu cầu ({spec}) không? Xin gửi thông số kỹ thuật chính thức.")
    if ctx.get("purpose"):
        questions.append(f"Sản phẩm dùng cho \"{ctx['purpose']}\": NCC có khuyến nghị model phù hợp và độ bền thực tế không?")
    questions += [
        "Thời gian giao hàng sau khi xác nhận đơn là bao lâu? Phí vận chuyển đã tính chưa?",
        "Báo giá này có hiệu lực đến khi nào? Giá có thay đổi theo số lượng đặt không?",
        "Chính sách đổi trả, hỗ trợ kỹ thuật và địa điểm bảo hành là gì?",
        "Có thể cho mượn hoặc bán mẫu thử trước khi đặt toàn bộ số lượng không?",
    ]
    return questions


def _strategies(quantity, others):
    strategies = [
        f"Đàm phán theo gói: gộp số lượng {quantity} cái, xin chiết khấu và miễn phí giao hàng.",
        "Thương lượng quyền lợi thay vì chỉ giảm giá: kéo dài bảo hành pin, tặng phụ kiện, đổi mới trong 30 ngày đầu.",
        "Đề nghị giữ giá ổn định trong thời hạn hiệu lực báo giá, ghi rõ trong báo giá hoặc hợp đồng.",
        "Điều kiện thanh toán: đề xuất thanh toán theo đợt (đặt cọc, phần còn lại khi nhận hàng đạt yêu cầu).",
    ]
    if others:
        strategies.append(f"Giữ {len(others)} NCC khác làm phương án dự phòng, nói rõ công ty đang so sánh nhiều báo giá.")
    return strategies


def _references(ctx):
    refs = []
    for topic_id, label in (("price", "Giá thị trường"), ("tech", "Công nghệ, ưu nhược điểm"), ("using", "Công nghệ sử dụng")):
        for snippet in (ctx.get("research", {}).get(topic_id, {}).get("snippets") or [])[:2]:
            refs.append({"topic": label, "text": snippet["text"], "url": snippet["url"]})
    return refs


# ---------------------------------------------------------------- thuyết phục
def _persuasion(suppliers, eligible, recommended, quantity, ctx):
    if not recommended or not recommended.get("price"):
        return {"title": "", "sections": [], "points": [], "closing": ""}
    price = recommended["price"]
    prices = [s["price"] for s in eligible]
    median = statistics.median(prices) if prices else None
    others = [s for s in eligible if s["name"] != recommended["name"]]
    sites = len({s["url"] for s in suppliers})
    sections = []

    need = [f"Nhu cầu: mua {quantity} {ctx.get('product') or 'sản phẩm'}."]
    if ctx.get("purpose"):
        need.append(f"Mục đích sử dụng: {ctx['purpose']}.")
    if ctx.get("spec") and ctx["spec"] != "Không yêu cầu":
        need.append(f"Thông số yêu cầu đã xác nhận: {ctx['spec']}.")
    sections.append({"heading": "1. Nhu cầu và yêu cầu", "points": need})

    survey = [f"Đã khảo sát {sites} trang web NCC, trong đó {len(eligible)} NCC đủ điều kiện (có thể xuất hóa đơn VAT hoặc chưa có thông tin loại trừ)."]
    if len(prices) >= 2:
        survey.append(f"Giá thu thập được từ {_money(min(prices))} đến {_money(max(prices))}, trung vị {_money(median)}, trung bình {_money(statistics.mean(prices))}.")
    for snippet in (ctx.get("research", {}).get("price", {}).get("snippets") or [])[:1]:
        survey.append(f"Tham khảo mặt bằng giá trên web: \"{snippet['text']}\" (nguồn: {snippet['url']}).")
    for snippet in (ctx.get("research", {}).get("tech", {}).get("snippets") or [])[:1]:
        survey.append(f"Tham khảo về công nghệ: \"{snippet['text']}\" (nguồn: {snippet['url']}).")
    sections.append({"heading": "2. Khảo sát thị trường", "points": survey})

    reasons = [f"{recommended['name']} đạt điểm đánh giá cao nhất ({recommended['score']}) theo các tiêu chí giá, bảo hành, hóa đơn VAT và độ phù hợp."]
    reasons.append(f"Đơn giá tham khảo {_money(price)}, tổng giá trị dự kiến khoảng {_money(price * quantity)} cho {quantity} cái.")
    if median and price < median:
        reasons.append(f"Thấp hơn mức trung vị {_money(median)}, có thể tiết kiệm khoảng {_money((median - price) * quantity)} cho cả đơn.")
    if recommended.get("warranty_months"):
        others_w = [s["warranty_months"] for s in others if s.get("warranty_months")]
        suffix = f", cao hơn mức trung bình {round(statistics.mean(others_w))} tháng của NCC khác" if others_w and recommended["warranty_months"] > statistics.mean(others_w) else ""
        reasons.append(f"Bảo hành {recommended['warranty_months']} tháng{suffix}.")
    if recommended.get("vat") is True:
        reasons.append("Có hóa đơn VAT, thuận tiện cho kế toán.")
    if others:
        reasons.append(f"Phương án dự phòng: {others[0]['name']} ({_money(others[0]['price'])}).")
    sections.append({"heading": "3. Vì sao đề xuất NCC này", "points": reasons})

    risks = []
    filled = sum(1 for c in (price, recommended.get("mah"), recommended.get("warranty_months"), recommended.get("vat") is True, recommended.get("date")) if c)
    risks.append(f"Dữ liệu lấy từ website công khai, hiện có {filled}/5 thông tin đầy đủ (giá, dung lượng, bảo hành, VAT, ngày cập nhật). Giá chưa phải báo giá chính thức.")
    age = _age_months(recommended.get("date"))
    if age is not None and age >= STALE_MONTHS:
        risks.append(f"Thông tin giá trên trang đã cũ khoảng {age} tháng, cần xác nhận lại.")
    risks.append("Cách kiểm soát: xin báo giá chính thức bằng văn bản, đàm phán điều kiện bảo hành và giao hàng, mua thử mẫu trước khi đặt cả đơn.")
    sections.append({"heading": "4. Rủi ro và cách kiểm soát", "points": risks})

    sections.append({"heading": "5. Đề xuất bước tiếp theo", "points": [
        "Cho phép liên hệ NCC được đề xuất và 2 NCC dự phòng để lấy báo giá chính thức.",
        "Đàm phán giá và điều kiện, sau đó trình lại kết quả cuối để duyệt đặt hàng.",
    ]})

    return {
        "title": f"Đề xuất mua {quantity} {ctx.get('product') or 'sản phẩm'} từ {recommended['name']}",
        "sections": sections,
        "points": [p for section in sections for p in section["points"]],
        "closing": ("Kính trình anh/chị xem xét. Em rất mong nhận được góp ý và sự đồng ý của anh/chị để em tiếp tục "
                    "xác nhận báo giá chính thức và đàm phán thêm trước khi đặt hàng. Em xin cảm ơn anh/chị."),
    }


def _age_months(iso):
    if not iso:
        return None
    try:
        then = datetime.strptime(iso, "%Y-%m-%d").date()
    except ValueError:
        return None
    return max(0, (date.today().year - then.year) * 12 + date.today().month - then.month)


def _money(value):
    return f"{round(value):,} đ".replace(",", ".")
