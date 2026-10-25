"""Các engine tìm kiếm có thể chọn: Google, Brave, Bing, Yahoo.

- Google và Brave dùng API chính thức, cần khóa (xem TODO.md phần hướng dẫn cấu hình).
- Bing và Yahoo đọc trang kết quả HTML, không cần khóa nhưng dễ bị chặn hoặc đổi cấu trúc.
"""

import base64
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup

from . import settings_store

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
TIMEOUT = 15
SKIP_DOMAINS = (
    "youtube.com", "facebook.com", "tiktok.com", "wikipedia.org",
    "pinterest.", "bing.com", "yahoo.com", "google.", "reddit.com",
    # kết quả rác/người lớn thỉnh thoảng lọt vào từ Bing HTML
    "porn", "xxx", "xhamster", "xhofficial", "sex", "baidu.com", "zhihu.com",
)

ENGINE_LABELS = {
    "google": "Google (Custom Search API)",
    "brave": "Brave Search API",
    "duckduckgo": "DuckDuckGo (không cần khóa)",
    "bing": "Bing (HTML, không cần khóa)",
    "yahoo": "Yahoo (HTML, không cần khóa)",
}


def engine_status():
    """Trạng thái từng engine để hiển thị checkbox trên giao diện."""
    status = []
    for engine_id, label in ENGINE_LABELS.items():
        available, reason = True, ""
        if engine_id == "google" and not (settings_store.get("GOOGLE_CSE_API_KEY") and settings_store.get("GOOGLE_CSE_ID")):
            available, reason = False, "Chưa nhập Google API key hoặc Search engine ID (tab Cài đặt)"
        if engine_id == "brave" and not settings_store.get("BRAVE_API_KEY"):
            available, reason = False, "Chưa nhập Brave API key (tab Cài đặt)"
        if engine_id == "bing":
            reason = "Từ một số máy trả kết quả không liên quan đến từ khóa"
        if engine_id == "yahoo":
            reason = "Thường bị Yahoo chặn, có thể không có kết quả"
        status.append({"id": engine_id, "label": label, "available": available, "reason": reason})
    return status


def search(engine_ids, query, max_per_engine=8):
    """Tìm trên các engine đã chọn. Trả về (danh sách URL đã gộp, danh sách lỗi theo engine)."""
    per_engine, errors = {}, {}
    for engine_id in engine_ids:
        try:
            per_engine[engine_id] = _SEARCHERS[engine_id](query, max_per_engine)
        except Exception as exc:  # noqa: BLE001 - một engine lỗi không làm hỏng các engine khác
            errors[engine_id] = str(exc)
            per_engine[engine_id] = []
    return _merge_round_robin(per_engine, engine_ids), errors


def _merge_round_robin(per_engine, engine_ids):
    """Xen kẽ kết quả các engine để không engine nào chiếm hết danh sách; bỏ link trùng."""
    merged, seen = [], set()
    lists = [per_engine.get(e, []) for e in engine_ids]
    for position in range(max((len(l) for l in lists), default=0)):
        for results in lists:
            if position < len(results) and results[position] not in seen:
                seen.add(results[position])
                merged.append(results[position])
    return merged


def filter_domains(urls, max_results):
    """Bỏ domain không phải NCC và mỗi domain chỉ giữ một link."""
    kept, seen_domains = [], set()
    for url in urls:
        domain = urlparse(url).netloc.lower().removeprefix("www.")
        if not domain or any(skip in domain for skip in SKIP_DOMAINS) or domain in seen_domains:
            continue
        seen_domains.add(domain)
        kept.append(url)
        if len(kept) >= max_results:
            break
    return kept


def _google(query, count):
    resp = requests.get(
        "https://www.googleapis.com/customsearch/v1",
        params={
            "key": settings_store.get("GOOGLE_CSE_API_KEY"),
            "cx": settings_store.get("GOOGLE_CSE_ID"),
            "q": query,
            "num": min(count, 10),
            "gl": "vn",
            "lr": "lang_vi",
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return filter_domains([item["link"] for item in resp.json().get("items", [])], count)


def _brave(query, count):
    resp = requests.get(
        "https://api.search.brave.com/res/v1/web/search",
        params={"q": query, "count": min(count * 2, 20), "country": "vn", "search_lang": "vi"},
        headers={"X-Subscription-Token": settings_store.get("BRAVE_API_KEY"), "Accept": "application/json"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    urls = [item["url"] for item in resp.json().get("web", {}).get("results", [])]
    return filter_domains(urls, count)


def _bing(query, count):
    resp = requests.get(
        "https://www.bing.com/search",
        params={"q": query, "setlang": "vi", "cc": "VN"},
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    urls = [_decode_bing_link(a.get("href", "")) for a in soup.select("li.b_algo h2 a")]
    return filter_domains(urls, count)


def _yahoo(query, count):
    resp = requests.get(
        "https://search.yahoo.com/search",
        params={"p": query, "vl": "lang_vi"},
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    urls = [a.get("href", "") for a in soup.select("div.algo h3 a, h3.title a")]
    return filter_domains([u for u in urls if u.startswith("http")], count)


def _duckduckgo(query, count):
    from ddgs import DDGS
    results = DDGS().text(query, region="vn-vi", max_results=count * 2)
    return filter_domains([r["href"] for r in results if r.get("href")], count)


def _decode_bing_link(href):
    """Bing bọc link đích trong tham số u (base64 url-safe, bắt đầu bằng 'a1')."""
    parsed = urlparse(href)
    if "bing.com" not in parsed.netloc or not parsed.path.startswith("/ck/a"):
        return href
    token = parse_qs(parsed.query).get("u", [""])[0]
    if token.startswith("a1"):
        token = token[2:]
    token += "=" * (-len(token) % 4)
    try:
        return base64.urlsafe_b64decode(token).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return href


_SEARCHERS = {"google": _google, "brave": _brave, "duckduckgo": _duckduckgo, "bing": _bing, "yahoo": _yahoo}
