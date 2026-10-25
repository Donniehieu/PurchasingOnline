"""Quy trình một yêu cầu mua hàng.

Luồng hai bước:
1. create_job: lưu yêu cầu và ảnh, sinh question card. Job ở trạng thái awaiting_confirmation, chưa tìm kiếm.
2. confirm_job: nhận câu trả lời card, kiểm tra, rồi mới chạy tìm web -> chấm điểm -> điền form.
"""

import json
import re
import threading
import traceback
import uuid
from datetime import datetime
from pathlib import Path

from . import crawler, form_writer, questions, research, scoring, vision

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = BASE_DIR / "Form duyệt báo giá.xlsx"
JOBS_DIR = BASE_DIR / "jobs"


def _job_file(job_id):
    return JOBS_DIR / job_id / "job.json"


_JOB_LOCK = threading.Lock()


def load_job(job_id):
    path = _job_file(job_id)
    with _JOB_LOCK:
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))


def _save_job(job):
    """Ghi job.json dưới khóa để tránh đọc file đang ghi dở (luồng xử lý và API cùng truy cập)."""
    with _JOB_LOCK:
        _job_file(job["id"]).write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")


def _log(job, message):
    job["log"].append(f"{datetime.now():%H:%M:%S} {message}")
    _save_job(job)


def create_job(request_data, uploads):
    """Bước 1: lưu yêu cầu, sinh card xác nhận. Không tìm kiếm ở bước này.

    request_data: query, product_code, quantity, purpose, engines, seed_urls.
    uploads: danh sách (tên file, bytes) ảnh sản phẩm.
    """
    job_id = uuid.uuid4().hex[:10]
    image_dir = JOBS_DIR / job_id / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    image_names = []
    for index, (filename, data) in enumerate(uploads, start=1):
        name = f"{index}_{Path(filename).name}"
        (image_dir / name).write_bytes(data)
        image_names.append(name)

    job = {
        "id": job_id,
        "status": "awaiting_confirmation",
        "query": request_data.get("query", ""),
        "product_code": request_data.get("product_code", ""),
        "quantity": request_data.get("quantity", 1),
        "purpose": request_data.get("purpose", ""),
        "engines": request_data.get("engines", []),
        "seed_urls": request_data.get("seed_urls", []),
        "topics": request_data.get("topics", []),
        "extra_keywords": request_data.get("extra_keywords", ""),
        "created": datetime.now().isoformat(timespec="seconds"),
        "images": image_names,
        "suggested_name": None,
        "ocr_text": "",
        "research": {},
        "sites_searched": [],
        "edits": [],
        "price_stats": None,
        "questions": [],
        "answers": {},
        "spec": {},
        "keywords": None,
        "errors": {},
        "log": [],
        "suppliers": [],
        "analysis": {"negotiation": [], "persuasion": {}},
        "file": None,
        "error": None,
    }
    _log(job, "Đã nhận yêu cầu, chờ bạn xác nhận thông tin sản phẩm")

    image_paths = _image_paths(job)
    if image_paths:
        try:
            seen = vision.analyze_images(image_paths)
            job["suggested_name"] = seen["keyword"] or None
            job["ocr_text"] = seen["text"]
        except Exception as exc:  # noqa: BLE001 - lỗi API không chặn bước xác nhận
            _log(job, f"Không nhận diện được ảnh: {exc}")
        if job["suggested_name"]:
            _log(job, f"Nhận diện từ ảnh: {job['suggested_name']}")
        if job["ocr_text"]:
            _log(job, f"Chữ đọc được trong ảnh: {job['ocr_text'][:120]}")
        if not (job["suggested_name"] or job["ocr_text"]):
            _log(job, "Chưa đọc được ảnh (cần Anthropic API key hoặc Tesseract trong tab Cài đặt), hãy nhập tên sản phẩm")

    job["questions"] = questions.build_cards(job, job["suggested_name"], job["ocr_text"])
    _save_job(job)
    return job_id


def confirm_job(job_id, answers):
    """Bước 2: nhận câu trả lời card, kiểm tra và bắt đầu tìm kiếm.

    answers: {id_card: {"value": ..., "custom": ...}}. Raise ValueError nếu không hợp lệ.
    """
    job = load_job(job_id)
    if job is None:
        raise LookupError("Không tìm thấy yêu cầu")
    if job["status"] != "awaiting_confirmation":
        raise ValueError("Yêu cầu này đã được xác nhận")

    def value_of(card_id):
        answer = answers.get(card_id) or {}
        if answer.get("value") == questions.CUSTOM:
            return (answer.get("custom") or "").strip()
        return str(answer.get("value") or "").strip()

    product = value_of("product")
    if not product:
        raise ValueError("Nhập tên sản phẩm")
    model = value_of("model")
    mah = value_of("mah")
    volt = value_of("volt")
    purpose = value_of("purpose")
    job["use_ocr"] = value_of("ocr") == "use"
    quantity_text = value_of("quantity")
    if not quantity_text.isdigit() or int(quantity_text) < 1:
        raise ValueError("Số lượng phải là số nguyên dương")
    if mah and not mah.isdigit():
        raise ValueError("Dung lượng pin chỉ nhập số, ví dụ 20000")
    if volt and not volt.isdigit():
        raise ValueError("Điện áp chỉ nhập số, ví dụ 18")
    if not job["engines"] and not job["seed_urls"]:
        raise ValueError("Yêu cầu cần ít nhất một engine tìm kiếm hoặc một link NCC")

    job["query"] = product
    job["product_code"] = model
    job["quantity"] = int(quantity_text)
    job["purpose"] = "" if purpose == questions.NONE else purpose
    job["spec"] = {"mah": mah, "volt": volt}
    job["answers"] = answers
    job["status"] = "queued"
    _log(job, f"Đã xác nhận: {product} | số lượng {job['quantity']}")
    _save_job(job)
    threading.Thread(target=run_job, args=(job_id,), daemon=True).start()
    return job_id


def _image_paths(job):
    return [JOBS_DIR / job["id"] / "images" / name for name in job["images"]]


def _search_keywords(job):
    """Tên sản phẩm + thông số đã xác nhận, chỉ thêm thông số nếu tên chưa có sẵn."""
    query = job["query"].strip()
    parts = [query]
    mah, volt = job["spec"].get("mah"), job["spec"].get("volt")
    if mah and not re.search(rf"\b{mah}\s*mah\b", query, re.IGNORECASE):
        parts.append(f"{mah}mAh")
    if volt and not re.search(rf"\b{volt}\s*v", query, re.IGNORECASE):
        parts.append(f"{volt}V")
    if job.get("use_ocr") and job.get("ocr_text"):
        parts.append(job["ocr_text"][:80])
    if job.get("extra_keywords"):
        parts.append(job["extra_keywords"].strip())
    return " ".join(p for p in parts if p)


def run_job(job_id):
    job = load_job(job_id)
    try:
        job["status"] = "running"
        _log(job, "Bắt đầu tìm kiếm")

        keywords = _search_keywords(job)
        job["keywords"] = keywords
        _log(job, f"Từ khóa tìm kiếm: {keywords}")

        engines = job["engines"]
        if engines:
            _log(job, f"Tìm trên engine: {', '.join(engines)}")

        found, errors, attempted = crawler.crawl(
            f"{keywords} giá mua",
            engines=engines,
            product_code=job["product_code"],
            seed_urls=job["seed_urls"],
        )
        job["errors"] = errors
        job["sites_searched"] = attempted
        for engine_id, message in errors.items():
            _log(job, f"Engine {engine_id} lỗi: {message}")
        _log(job, f"Đã thử {len(attempted)} trang, đọc được {len(found)} trang NCC phù hợp")
        if not found:
            raise RuntimeError("Không tìm được NCC phù hợp, thử nhập mã sản phẩm hoặc chọn thêm engine")
        job["suppliers"] = found

        if job["topics"] and engines:
            _log(job, f"Nghiên cứu chủ đề: {', '.join(job['topics'])}")
            job["research"] = research.run_research(job["topics"], job["query"], job["extra_keywords"], engines)

        _build_outputs(job)
        recommended = next((s for s in job["suppliers"] if s.get("recommended")), None)
        if recommended:
            _log(job, f"Khuyến nghị: {recommended['name']} (điểm {recommended['score']})")
        job["status"] = "done"
        _log(job, "Đã điền xong form duyệt báo giá")
    except Exception as exc:  # noqa: BLE001 - ghi lỗi ra job để hiển thị cho người dùng
        job["status"] = "error"
        job["error"] = str(exc)
        _log(job, f"Lỗi: {exc}")
        traceback.print_exc()
    _save_job(job)


def _build_outputs(job):
    """Chấm điểm lại, tính thống kê giá, phân tích và ghi lại file Excel từ dữ liệu hiện có của job."""
    job["suppliers"] = scoring.score_suppliers(job["suppliers"])
    job["price_stats"] = research.price_stats(job["suppliers"])
    spec = _spec_text(job["spec"])
    request_info = {
        "product": job["query"],
        "product_code": job["product_code"],
        "quantity": job["quantity"],
        "purpose": job["purpose"],
        "keywords": job["keywords"],
        "spec": spec,
        "engines": job["engines"],
        "errors": job["errors"],
        "edits": job.get("edits", []),
        "ctx": {"product": job["query"], "spec": spec, "purpose": job["purpose"], "research": job["research"]},
    }
    output = JOBS_DIR / job["id"] / "bao_gia.xlsx"
    _, analysis = form_writer.write_form(
        TEMPLATE_PATH, output, request_info, job["suppliers"], job["suppliers"], _image_paths(job)
    )
    job["analysis"] = analysis
    job["file"] = output.name


# ---------------------------------------------------------------- sửa trực tiếp trong bảng
EDIT_LABELS = {
    "name": "NCC", "price": "Đơn giá", "warranty_months": "Bảo hành (tháng)", "vat": "Hóa đơn VAT",
    "mah": "Dung lượng pin (mAh)", "volt": "Điện áp (V)", "date": "Ngày cập nhật web", "note": "Ghi chú",
}
_EDIT_LOCK = threading.Lock()


def _parse_field(field, value):
    text = "" if value is None else str(value).strip()
    if field == "name":
        if not text:
            raise ValueError("Tên NCC không được để trống")
        return text[:120]
    if field == "note":
        return text[:500]
    if field == "vat":
        lowered = text.lower()
        if lowered in ("có", "co", "true", "yes"):
            return True
        if lowered in ("không", "khong", "false", "no"):
            return False
        if lowered in ("", "chưa rõ", "chua ro", "null", "unknown"):
            return None
        raise ValueError("VAT chỉ nhận Có, Không hoặc Chưa rõ")
    if field == "date":
        if not text:
            return None
        for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
        raise ValueError("Ngày nhập theo dạng dd/mm/yyyy")
    digits = re.sub(r"[.,\s]", "", text)
    if not digits:
        return None
    if not digits.isdigit():
        raise ValueError(f"{EDIT_LABELS[field]} chỉ nhập số")
    number = int(digits)
    limits = {"price": (1, 1_000_000_000), "warranty_months": (0, 240), "mah": (1, 1_000_000), "volt": (1, 1000)}
    low, high = limits[field]
    if not low <= number <= high:
        raise ValueError(f"{EDIT_LABELS[field]} phải trong khoảng {low} đến {high}")
    return number


def update_supplier(job_id, url, field, value):
    """Sửa một ô trong bảng: lưu ngay, chấm điểm lại, ghi lịch sử điều chỉnh và cập nhật file Excel."""
    if field not in EDIT_LABELS:
        raise ValueError("Trường không được phép sửa")
    with _EDIT_LOCK:
        job = load_job(job_id)
        if job is None:
            raise LookupError("Không tìm thấy yêu cầu")
        if job["status"] != "done":
            raise ValueError("Chỉ sửa được khi yêu cầu đã xử lý xong")
        supplier = next((s for s in job["suppliers"] if s["url"] == url), None)
        if supplier is None:
            raise LookupError("Không tìm thấy NCC trong bảng")
        new_value = _parse_field(field, value)
        old_value = supplier.get(field)
        if new_value == old_value:
            return job
        job.setdefault("edits", []).append({
            "time": datetime.now().isoformat(timespec="seconds"),
            "supplier": supplier["name"], "url": url, "field": field, "field_label": EDIT_LABELS[field],
            "old": "" if old_value is None else old_value, "new": "" if new_value is None else new_value,
        })
        supplier[field] = new_value
        if field == "price":
            supplier["vat_included"] = False  # giá do người dùng nhập được hiểu là chưa VAT
        _build_outputs(job)
        _log(job, f"Sửa {EDIT_LABELS[field]} của {supplier['name']}")
        _save_job(job)
        return job


def list_edits(limit=200):
    """Toàn bộ lịch sử điều chỉnh trong bảng, mới nhất trước."""
    edits = []
    for job in iter_jobs():
        for edit in job.get("edits", []):
            edits.append({**edit, "job_id": job["id"], "product": job["query"]})
    return sorted(edits, key=lambda e: e["time"], reverse=True)[:limit]


def iter_jobs():
    if not JOBS_DIR.exists():
        return
    for folder in JOBS_DIR.iterdir():
        if (folder / "job.json").exists():
            job = load_job(folder.name)
            if job:
                yield job


def _spec_text(spec):
    parts = []
    if spec.get("mah"):
        parts.append(f"{int(spec['mah']):,} mAh".replace(",", "."))
    if spec.get("volt"):
        parts.append(f"{spec['volt']}V")
    return ", ".join(parts) or "Không yêu cầu"
