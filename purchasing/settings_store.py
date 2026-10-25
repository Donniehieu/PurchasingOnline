"""Lưu cấu hình (khóa API, SMTP) trong file local để cập nhật từ giao diện, không cần sửa code.

Thứ tự ưu tiên: file data/settings.json (nhập từ giao diện) rồi tới biến môi trường.
File này nằm trong .gitignore, không được đưa lên GitHub. Khóa chỉ lưu dạng văn bản
trên máy chạy app, nên đừng triển khai công khai khi chưa có đăng nhập.
"""

import json
import os
import threading
from pathlib import Path

SETTINGS_FILE = Path(__file__).resolve().parent.parent / "data" / "settings.json"
_LOCK = threading.Lock()

# Tên khóa -> (nhãn hiển thị, là bí mật?)
FIELDS = {
    "GOOGLE_CSE_API_KEY": ("Google API key", True),
    "GOOGLE_CSE_ID": ("Google Search engine ID (cx)", False),
    "BRAVE_API_KEY": ("Brave Search API key", True),
    "ANTHROPIC_API_KEY": ("Anthropic API key", True),
    "BOSS_EMAIL": ("Email sếp", False),
    "SMTP_HOST": ("SMTP host", False),
    "SMTP_PORT": ("SMTP port", False),
    "SMTP_USER": ("SMTP user", False),
    "SMTP_PASSWORD": ("SMTP password", True),
    "SMTP_FROM": ("Email người gửi", False),
}


def _read():
    with _LOCK:
        if not SETTINGS_FILE.exists():
            return {}
        try:
            return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except ValueError:
            return {}


def get(name, default=""):
    value = _read().get(name) or os.environ.get(name)
    return value if value else default


def update(changes):
    """changes: {tên: giá trị}. Giá trị None giữ nguyên, chuỗi rỗng xóa khóa."""
    unknown = set(changes) - set(FIELDS)
    if unknown:
        raise ValueError(f"Khóa không hợp lệ: {', '.join(sorted(unknown))}")
    current = _read()
    for name, value in changes.items():
        if value is None:
            continue
        value = str(value).strip()
        if value:
            current[name] = value
        else:
            current.pop(name, None)
    with _LOCK:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")


def mask(value):
    if len(value) <= 8:
        return "*" * len(value)
    return value[:3] + "*" * 6 + value[-3:]


def public_view():
    """Trạng thái hiển thị trên giao diện: không bao giờ trả về khóa đầy đủ."""
    stored = _read()
    view = {}
    for name, (label, secret) in FIELDS.items():
        value = get(name)
        view[name] = {
            "label": label,
            "secret": secret,
            "configured": bool(value),
            "source": "giao diện" if stored.get(name) else ("biến môi trường" if value else ""),
            "display": mask(value) if (value and secret) else value,
        }
    return view
