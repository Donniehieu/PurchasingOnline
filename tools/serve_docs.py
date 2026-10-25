"""Chạy thử thư mục docs/ trên máy (http://localhost:8080), sửa lỗi MIME của file .js trên Windows."""

import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"


class Handler(SimpleHTTPRequestHandler):
    # Windows lấy kiểu file từ registry nên .js đôi khi thành text/plain, trình duyệt từ chối nạp module.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json"}


if __name__ == "__main__":
    print("http://localhost:8080  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", 8080), functools.partial(Handler, directory=str(DOCS))).serve_forever()
