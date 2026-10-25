"""Crawl ảnh sản phẩm trên mạng theo từ khóa để đối chiếu, lưu vào album của từng yêu cầu.

Nguồn ảnh theo engine người dùng đã chọn: Brave và Google (API, cần khóa), Bing (HTML, không cần khóa).
Mỗi ảnh tải về được kiểm tra là ảnh thật, đủ lớn, không trùng, rồi so độ giống với ảnh người dùng upload (dHash).
"""

import hashlib
import io
import ipaddress
import json
import socket
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image

from . import search_engines, settings_store

USER_AGENT = search_engines.USER_AGENT
TIMEOUT = 12
MAX_BYTES = 6 * 1024 * 1024
MIN_SIDE = 150
IMAGE_ENGINES = ("duckduckgo", "brave", "google", "bing")
FORMAT_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}


# ---------------------------------------------------------------- tìm URL ảnh
def _brave_images(query, count):
    resp = requests.get(
        "https://api.search.brave.com/res/v1/images/search",
        params={"q": query, "count": min(count, 50), "country": "vn", "search_lang": "vi"},
        headers={"X-Subscription-Token": settings_store.get("BRAVE_API_KEY"), "Accept": "application/json"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return [
        {"image_url": (r.get("properties") or {}).get("url") or r.get("thumbnail", {}).get("src"),
         "page_url": r.get("url", ""), "title": r.get("title", "")}
        for r in resp.json().get("results", [])
    ]


def _google_images(query, count):
    found = []
    for start in range(1, count + 1, 10):
        resp = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": settings_store.get("GOOGLE_CSE_API_KEY"), "cx": settings_store.get("GOOGLE_CSE_ID"),
                    "q": query, "searchType": "image", "num": min(10, count - start + 1), "start": start, "gl": "vn"},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        found += [{"image_url": i.get("link"), "page_url": (i.get("image") or {}).get("contextLink", ""),
                   "title": i.get("title", "")} for i in resp.json().get("items", [])]
    return found


def _bing_images(query, count):
    resp = requests.get(
        "https://www.bing.com/images/async",
        params={"q": query, "first": 1, "count": min(count, 35), "mmasync": 1, "setlang": "vi", "cc": "VN"},
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    found = []
    for anchor in BeautifulSoup(resp.text, "html.parser").select("a.iusc"):
        try:
            meta = json.loads(anchor.get("m", "{}"))
        except ValueError:
            continue
        found.append({"image_url": meta.get("murl") or meta.get("turl"), "page_url": meta.get("purl", ""),
                      "title": meta.get("t", "")})
    return found


def _duckduckgo_images(query, count):
    from ddgs import DDGS
    return [{"image_url": r.get("image"), "page_url": r.get("url", ""), "title": r.get("title", "")}
            for r in DDGS().images(query, region="vn-vi", max_results=count)]


_FINDERS = {"duckduckgo": _duckduckgo_images, "brave": _brave_images, "google": _google_images, "bing": _bing_images}


def find_image_urls(engines, query, per_engine=20):
    """Gom URL ảnh từ các engine hỗ trợ, xen kẽ và bỏ trùng. Trả về (danh sách ảnh, lỗi theo engine)."""
    per, errors = {}, {}
    usable = [e for e in IMAGE_ENGINES if e in engines]
    for engine_id in usable:
        try:
            per[engine_id] = [dict(r, engine=engine_id) for r in _FINDERS[engine_id](query, per_engine) if r.get("image_url")]
        except Exception as exc:  # noqa: BLE001 - một engine lỗi không làm hỏng các engine khác
            errors[engine_id] = str(exc)
            per[engine_id] = []
    merged, seen = [], set()
    lists = [per.get(e, []) for e in usable]
    for position in range(max((len(l) for l in lists), default=0)):
        for results in lists:
            if position < len(results) and results[position]["image_url"] not in seen:
                seen.add(results[position]["image_url"])
                merged.append(results[position])
    return merged, errors


# ---------------------------------------------------------------- tải và kiểm tra ảnh
def _is_public_host(url):
    """Chặn tải từ địa chỉ nội bộ (localhost, mạng LAN) để một kết quả tìm kiếm không bắt app gọi vào máy mình."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except OSError:
        return False
    return all(ipaddress.ip_address(info[4][0]).is_global for info in infos)


def dhash(image, size=8):
    """Dấu vân tay ảnh 64 bit: ảnh giống nhau (dù khác kích thước/nén) cho dấu gần nhau."""
    small = image.convert("L").resize((size + 1, size), Image.LANCZOS)
    pixels = list(small.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            bits = (bits << 1) | (pixels[row * (size + 1) + col] > pixels[row * (size + 1) + col + 1])
    return bits


def similarity(hash_a, hash_b):
    """Độ giống 0-100 (%) giữa hai dấu dHash."""
    return round((1 - bin(hash_a ^ hash_b).count("1") / 64) * 100)


def _download(item):
    """Tải một ảnh. Trả về (bytes, PIL image, định dạng) hoặc None nếu không dùng được."""
    url = item["image_url"]
    if not _is_public_host(url):
        return None
    try:
        with requests.get(url, headers={"User-Agent": USER_AGENT, "Referer": item.get("page_url") or url},
                          timeout=TIMEOUT, stream=True) as resp:
            if resp.status_code != 200 or not resp.headers.get("Content-Type", "").startswith("image/"):
                return None
            data = b""
            for chunk in resp.iter_content(64 * 1024):
                data += chunk
                if len(data) > MAX_BYTES:
                    return None
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:  # noqa: BLE001 - ảnh hỏng hoặc trang chặn thì bỏ qua
        return None
    if image.format not in FORMAT_EXT or min(image.size) < MIN_SIDE:
        return None
    return data, image, image.format


def crawl_album(album_dir, engines, query, reference_images=(), limit=12, existing=()):
    """Tìm và tải ảnh về album_dir.

    reference_images: đường dẫn ảnh người dùng upload, dùng để tính độ giống.
    existing: danh sách ảnh đã có trong album (bỏ qua ảnh trùng).
    Trả về (ảnh mới, lỗi theo engine, số URL đã thử).
    """
    album_dir = Path(album_dir)
    album_dir.mkdir(parents=True, exist_ok=True)
    candidates, errors = find_image_urls(engines, query, per_engine=max(limit * 2, 20))

    references = []
    for path in reference_images:
        try:
            with Image.open(path) as img:
                references.append(dhash(img))
        except Exception:  # noqa: BLE001 - ảnh tham chiếu hỏng thì bỏ qua
            continue

    known_urls = {e["image_url"] for e in existing}
    known_hashes = {e["hash"] for e in existing if e.get("hash")}
    candidates = [c for c in candidates if c["image_url"] not in known_urls]

    with ThreadPoolExecutor(max_workers=6) as pool:
        downloaded = list(pool.map(_download, candidates[: limit * 3]))

    added = []
    for item, result in zip(candidates, downloaded):
        if result is None:
            continue
        data, image, fmt = result
        digest = hashlib.sha1(data).hexdigest()[:16]
        if digest in known_hashes:
            continue
        hash_bits = dhash(image)
        name = f"{digest}{FORMAT_EXT[fmt]}"
        (album_dir / name).write_bytes(data)
        known_hashes.add(digest)
        added.append({
            "file": name, "image_url": item["image_url"], "page_url": item.get("page_url", ""),
            "title": item.get("title", "")[:160], "engine": item["engine"], "query": query,
            "width": image.width, "height": image.height, "hash": digest,
            "match": max((similarity(hash_bits, r) for r in references), default=None),
        })
        if len(added) >= limit:
            break
    return added, errors, len(candidates)
