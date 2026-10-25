"""Nhận diện sản phẩm và đọc chữ (OCR) trong ảnh upload để bổ sung từ khóa tìm kiếm.

Ưu tiên Claude (cần Anthropic API key trong tab Cài đặt). Nếu không có key thì thử
pytesseract (cần cài Tesseract OCR và gói ngôn ngữ vie). Không có cả hai thì trả về rỗng.
"""

import base64
import json
import mimetypes
import re

import requests

from . import settings_store

API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-5-5"
PROMPT = (
    "Đây là ảnh một sản phẩm cần mua. Trả về đúng một đối tượng JSON, không giải thích thêm, dạng "
    '{"keyword": "...", "text": "..."}. "keyword" là một dòng tiếng Việt ngắn làm từ khóa tìm kiếm '
    "(loại sản phẩm kèm thông số nhìn thấy như dung lượng pin, điện áp, model). "
    '"text" là toàn bộ chữ đọc được trong ảnh (nhãn, model, thông số), để trống nếu không có chữ.'
)


def analyze_images(image_paths):
    """Trả về {"keyword": str, "text": str}. Rỗng nếu không nhận diện được."""
    empty = {"keyword": "", "text": ""}
    if not image_paths:
        return empty
    api_key = settings_store.get("ANTHROPIC_API_KEY")
    if api_key:
        return _claude(image_paths, api_key)
    return {"keyword": "", "text": _tesseract(image_paths)}


def _claude(image_paths, api_key):
    content = []
    for path in image_paths[:4]:
        mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
        with open(path, "rb") as fh:
            data = base64.standard_b64encode(fh.read()).decode("ascii")
        content.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": data}})
    content.append({"type": "text", "text": PROMPT})
    resp = requests.post(
        API_URL,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": MODEL, "max_tokens": 400, "messages": [{"role": "user", "content": content}]},
        timeout=60,
    )
    resp.raise_for_status()
    text = "".join(block.get("text", "") for block in resp.json().get("content", []))
    match = re.search(r"\{.*\}", text, re.DOTALL)
    try:
        data = json.loads(match.group(0)) if match else {}
    except ValueError:
        data = {}
    return {"keyword": str(data.get("keyword", "")).strip(), "text": str(data.get("text", "")).strip()}


def _tesseract(image_paths):
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return ""
    chunks = []
    for path in image_paths[:4]:
        try:
            chunks.append(pytesseract.image_to_string(Image.open(path), lang="vie+eng"))
        except Exception:  # noqa: BLE001 - thiếu Tesseract hoặc gói ngôn ngữ thì bỏ qua OCR
            return ""
    return " ".join(" ".join(chunks).split())


def test_anthropic_key(api_key):
    """Kiểm tra khóa hợp lệ bằng một yêu cầu rất ngắn."""
    resp = requests.post(
        API_URL,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": MODEL, "max_tokens": 5, "messages": [{"role": "user", "content": "ping"}]},
        timeout=30,
    )
    resp.raise_for_status()
