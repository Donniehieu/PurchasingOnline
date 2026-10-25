"""Web app mua hàng tự động: tên/mã/ảnh sản phẩm -> tìm web -> điền form báo giá -> gửi sếp."""

import os

from flask import Flask, Response, jsonify, render_template, request, send_from_directory

from purchasing import history, insights, links, notifier, pipeline, research, search_engines, settings_store, vision

app = Flask(__name__)
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_LINK_EXT = {".xlsx", ".csv", ".txt"}


def _lines(text):
    return [line.strip() for line in (text or "").splitlines() if line.strip()]


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/topics")
def topics():
    return jsonify(research.topic_list())


@app.get("/api/jobs")
def jobs():
    return jsonify(pipeline.list_jobs())


@app.get("/api/settings")
def get_settings():
    return jsonify(settings_store.public_view())


@app.post("/api/settings")
def save_settings():
    """Ô để trống nghĩa là giữ nguyên giá trị cũ. Để xóa khóa, gửi {"clear": ["TÊN_KHÓA"]}."""
    body = request.get_json(silent=True) or {}
    changes = {k: (v if v else None) for k, v in (body.get("values") or {}).items()}
    for name in body.get("clear") or []:
        changes[name] = ""
    try:
        settings_store.update(changes)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(settings_store.public_view())


@app.post("/api/settings/test/<service>")
def test_service(service):
    """Gọi thử một lượt để kiểm tra khóa hợp lệ. Không trả khóa về giao diện."""
    try:
        if service == "google":
            if not (settings_store.get("GOOGLE_CSE_API_KEY") and settings_store.get("GOOGLE_CSE_ID")):
                return jsonify(ok=False, message="Cần nhập cả Google API key và Search engine ID"), 400
            search_engines._google("quạt", 1)
        elif service == "brave":
            if not settings_store.get("BRAVE_API_KEY"):
                return jsonify(ok=False, message="Chưa nhập Brave API key"), 400
            search_engines._brave("quạt", 1)
        elif service == "anthropic":
            key = settings_store.get("ANTHROPIC_API_KEY")
            if not key:
                return jsonify(ok=False, message="Chưa nhập Anthropic API key"), 400
            vision.test_anthropic_key(key)
        else:
            return jsonify(ok=False, message="Dịch vụ không hợp lệ"), 404
    except KeyError:
        return jsonify(ok=False, message="Chưa nhập đủ thông tin"), 400
    except Exception as exc:  # noqa: BLE001 - trả nguyên nhân lỗi cho người dùng sửa khóa
        return jsonify(ok=False, message=_explain_error(exc)), 400
    return jsonify(ok=True, message="Kết nối thành công")


def _explain_error(exc):
    response = getattr(exc, "response", None)
    if response is not None:
        hints = {400: "Yêu cầu không hợp lệ, kiểm tra khóa và ID", 401: "Khóa không đúng", 422: "Khóa sai hoặc sai định dạng", 403: "Khóa chưa được cấp quyền hoặc hết hạn mức", 429: "Hết hạn mức tạm thời"}
        return f"HTTP {response.status_code}: {hints.get(response.status_code, 'Lỗi từ nhà cung cấp')}"
    return str(exc)


@app.get("/api/engines")
def engines():
    return jsonify(search_engines.engine_status())


@app.post("/api/links/import")
def import_links():
    file = request.files.get("file")
    if file is None:
        return jsonify(error="Chưa chọn file"), 400
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_LINK_EXT:
        return jsonify(error="Chỉ nhận file .xlsx, .csv hoặc .txt"), 400
    try:
        urls = links.parse_link_file(file.filename, file.read())
    except Exception as exc:  # noqa: BLE001 - file lỗi định dạng trả về cho người dùng
        return jsonify(error=f"Không đọc được file: {exc}"), 400
    return jsonify(urls=urls)


@app.post("/api/jobs")
def create_job():
    try:
        quantity = int(request.form.get("quantity") or 1)
        if quantity < 1:
            raise ValueError
    except ValueError:
        return jsonify(error="Số lượng phải là số nguyên dương"), 400

    request_data = {
        "query": (request.form.get("query") or "").strip(),
        "product_code": (request.form.get("product_code") or "").strip(),
        "purpose": (request.form.get("purpose") or "").strip(),
        "quantity": quantity,
        "engines": request.form.getlist("engines"),
        "seed_urls": _lines(request.form.get("seed_urls")),
        "topics": request.form.getlist("topics"),
        "extra_keywords": (request.form.get("extra_keywords") or "").strip(),
        "crawl_images": request.form.get("crawl_images") == "on",
    }
    uploads = []
    for file in request.files.getlist("images"):
        if os.path.splitext(file.filename or "")[1].lower() in ALLOWED_IMAGE_EXT:
            uploads.append((file.filename, file.read()))

    if not (request_data["query"] or request_data["product_code"] or uploads):
        return jsonify(error="Nhập tên hoặc mã sản phẩm, hoặc upload ít nhất một ảnh"), 400

    job_id = pipeline.create_job(request_data, uploads)
    return jsonify(id=job_id, status="awaiting_confirmation"), 202


@app.post("/api/jobs/<job_id>/confirm")
def confirm_job(job_id):
    body = request.get_json(silent=True) or {}
    answers = body.get("answers")
    if not isinstance(answers, dict):
        return jsonify(error="Thiếu câu trả lời xác nhận"), 400
    try:
        pipeline.confirm_job(job_id, answers)
    except LookupError as exc:
        return jsonify(error=str(exc)), 404
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(id=job_id, status="queued"), 202


@app.get("/api/jobs/<job_id>")
def get_job(job_id):
    job = pipeline.load_job(job_id)
    if job is None:
        return jsonify(error="Không tìm thấy yêu cầu"), 404
    return jsonify(job)


@app.get("/api/jobs/<job_id>/file")
def download_file(job_id):
    job = pipeline.load_job(job_id)
    if job is None or not job.get("file"):
        return jsonify(error="Chưa có file báo giá"), 404
    return send_from_directory(pipeline.JOBS_DIR / job_id, job["file"], as_attachment=True)


@app.get("/api/jobs/<job_id>/album/<name>")
def album_image(job_id, name):
    job = pipeline.load_job(job_id)
    if job is None or not any(a["file"] == name for a in job.get("album", [])):
        return jsonify(error="Không có ảnh này"), 404
    return send_from_directory(pipeline.album_dir(job_id), name)


@app.get("/api/jobs/<job_id>/images/<name>")
def uploaded_image(job_id, name):
    job = pipeline.load_job(job_id)
    if job is None or name not in job["images"]:
        return jsonify(error="Không có ảnh này"), 404
    return send_from_directory(pipeline.JOBS_DIR / job_id / "images", name)


@app.post("/api/jobs/<job_id>/album")
def crawl_more_images(job_id):
    """Crawl thêm ảnh vào album theo từ khóa người dùng nhập (để trống: dùng từ khóa của yêu cầu)."""
    body = request.get_json(silent=True) or {}
    try:
        job = pipeline.add_album_images(job_id, body.get("query"))
    except LookupError as exc:
        return jsonify(error=str(exc)), 404
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(job)


@app.post("/api/jobs/<job_id>/album/upload")
def upload_to_album(job_id):
    uploads = [(f.filename, f.read()) for f in request.files.getlist("images")
               if os.path.splitext(f.filename or "")[1].lower() in ALLOWED_IMAGE_EXT]
    try:
        job = pipeline.upload_album_images(job_id, uploads)
    except LookupError as exc:
        return jsonify(error=str(exc)), 404
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(job)


@app.delete("/api/jobs/<job_id>/album/<name>")
def delete_album_image(job_id, name):
    try:
        job = pipeline.remove_album_image(job_id, name)
    except LookupError as exc:
        return jsonify(error=str(exc)), 404
    return jsonify(job)


@app.get("/api/jobs/<job_id>/links.xlsx")
def export_links(job_id):
    job = pipeline.load_job(job_id)
    if job is None:
        return jsonify(error="Không tìm thấy yêu cầu"), 404
    rows = [(s["name"], s["url"]) for s in job["suppliers"]]
    return _xlsx_response(links.links_to_xlsx(rows), f"link_ncc_{job_id}.xlsx")


@app.patch("/api/jobs/<job_id>/supplier")
def edit_supplier(job_id):
    """Sửa một ô trong bảng. Tự lưu, chấm điểm lại và cập nhật file Excel."""
    body = request.get_json(silent=True) or {}
    try:
        job = pipeline.update_supplier(job_id, body.get("url", ""), body.get("field", ""), body.get("value"))
    except LookupError as exc:
        return jsonify(error=str(exc)), 404
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(job)


@app.get("/api/history/groups")
def history_groups():
    return jsonify(history.group_history(pipeline.iter_jobs()))


@app.get("/api/history/groups.xlsx")
def history_groups_xlsx():
    return _xlsx_response(history.history_to_xlsx(history.group_history(pipeline.iter_jobs())), "lich_su_tim_kiem.xlsx")


@app.get("/api/history/edits")
def history_edits():
    return jsonify(pipeline.list_edits())


@app.get("/api/history/edits.xlsx")
def history_edits_xlsx():
    return _xlsx_response(history.edits_to_xlsx(pipeline.list_edits(1000)), "lich_su_dieu_chinh.xlsx")


def _xlsx_response(data, filename):
    return Response(
        data,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.post("/api/jobs/<job_id>/send")
def send_to_boss(job_id):
    job = pipeline.load_job(job_id)
    if job is None or job["status"] != "done":
        return jsonify(error="Yêu cầu chưa xử lý xong"), 400
    body = request.get_json(silent=True) or {}
    if body.get("confirm") is not True:
        return jsonify(error="Cần xác nhận trước khi gửi"), 400

    to_address = body.get("to") or settings_store.get("BOSS_EMAIL")
    if not to_address:
        return jsonify(error="Chưa có email sếp nên không gửi. Hãy dùng nút Xuất file để tải file xlsx và gửi thủ công.", no_email=True), 400

    lines = ["Kính gửi anh/chị,", "", f"Đính kèm form duyệt báo giá: {job['keywords']} (số lượng {job['quantity']}).", ""]
    lines.append(insights.persuasion_text(job["analysis"]["persuasion"]))
    lines += ["", "Trân trọng."]
    try:
        notifier.send_quote(
            to_address,
            f"Duyệt báo giá: {job['keywords']}",
            "\n".join(lines),
            pipeline.JOBS_DIR / job_id / job["file"],
        )
    except notifier.MailNotConfigured as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # noqa: BLE001 - trả lỗi gửi mail về UI
        return jsonify(error=f"Gửi mail thất bại: {exc}"), 500
    return jsonify(sent_to=to_address)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
