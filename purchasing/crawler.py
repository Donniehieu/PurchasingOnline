"""Mở từng trang NCC và trích xuất thông tin mua hàng (giá, thông số, bảo hành, VAT, ngày cập nhật)."""

import json
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from . import search_engines

USER_AGENT = search_engines.USER_AGENT
TIMEOUT = 15
PRICE_MIN, PRICE_MAX = 50_000, 20_000_000
PRICE_RE = re.compile(r"(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|₫|vnđ|vnd)", re.IGNORECASE)
PRICE_LABEL_RE = re.compile(r"giá[^0-9]{0,30}?(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|₫|vnđ|vnd)", re.IGNORECASE)
MAH_RE = re.compile(r"(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*m\s?ah", re.IGNORECASE)
VOLT_RE = re.compile(r"\b(\d{1,2})\s*V(?:DC)?\b")
WARRANTY_RE = re.compile(r"bảo\s*hành[^.\n]{0,25}?(\d{1,2})\s*(tháng|năm)", re.IGNORECASE)
DATE_TEXT_RE = re.compile(
    r"(?:cập nhật|đăng|ngày|updated|published)[^0-9]{0,15}(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})",
    re.IGNORECASE,
)
GENERIC_WORDS = {"gia", "mua", "cho", "va", "loai", "tot", "re", "nhat", "ban", "hang", "chinh"}


def _strip_accents(text):
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.replace("đ", "d").replace("Đ", "D").lower()


def query_keywords(query):
    """Từ khóa kiểm tra đúng sản phẩm (bỏ từ chung và số)."""
    tokens = []
    for token in _strip_accents(query).split():
        if len(token) < 2 or token in GENERIC_WORDS or any(c.isdigit() for c in token):
            continue
        tokens.append(token)
    return tokens


def crawl(query, engines, product_code="", max_sites=8, min_relevance=0.5, seed_urls=()):
    """Tìm trên các engine đã chọn, cộng link NCC người dùng nhập, rồi đọc song song.

    Trả về (danh sách NCC đã trích, lỗi theo engine, mọi URL đã thử đọc).
    """
    tokens = query_keywords(query)
    seeds = [u for u in seed_urls if u.startswith("http")]
    searched, errors = ([], {}) if not engines else search_engines.search(engines, query, max_sites)
    urls = list(dict.fromkeys(seeds + searched))
    code = _strip_accents(product_code).strip() if product_code else ""

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda u: _safe_extract(u, tokens, code), urls))
    found = [r for r in results if r is not None and r["relevance"] >= min_relevance]
    return found, errors, urls


def _safe_extract(url, tokens, code):
    try:
        return extract_supplier_info(url, tokens, code)
    except Exception:  # noqa: BLE001 - một trang lỗi không làm hỏng cả lượt tìm kiếm
        return None


def extract_supplier_info(url, query_tokens, product_code=""):
    """Đọc một trang và trích toàn bộ thông tin cần cho form báo giá."""
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    if resp.status_code != 200 or "html" not in resp.headers.get("Content-Type", ""):
        return None
    soup = BeautifulSoup(resp.text, "html.parser")
    meta_description = _meta(soup, "og:description", "description")
    date_found = _page_date(soup)
    title = soup.title.get_text(strip=True) if soup.title else ""
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = " ".join(soup.get_text(" ", strip=True).split())
    norm = _strip_accents(text)

    relevance = _phrase_relevance(query_tokens, norm)
    if product_code:
        relevance = min(relevance, 1.0 if re.search(rf"\b{re.escape(product_code)}\b", norm) else 0.5)
    if relevance == 0:
        return None

    prices = _find_prices(text)
    mah_values = [_to_int(m) for m in MAH_RE.findall(text)]
    volt = VOLT_RE.search(text)
    warranty = WARRANTY_RE.search(text)

    vat = None
    if re.search(r"không\s*(xuất\s*)?hóa\s*đơn", text, re.IGNORECASE):
        vat = False
    if re.search(r"hóa\s*đơn\s*(vat|gtgt)|xuất\s*hóa\s*đơn|có\s*hóa\s*đơn", text, re.IGNORECASE):
        vat = True
    vat_included = bool(re.search(r"đã\s*(bao\s*gồm\s*|gồm\s*)?vat", text, re.IGNORECASE))

    months = None
    if warranty:
        months = int(warranty.group(1)) * (12 if warranty.group(2).lower() == "năm" else 1)

    domain = urlparse(url).netloc.lower().removeprefix("www.")
    return {
        "name": domain,
        "title": (title or domain)[:120],
        "url": url,
        "description": (meta_description or "")[:240],
        "date": date_found,
        "price": min(prices) if prices else None,
        "vat": vat,
        "vat_included": vat_included,
        "mah": mah_values[0] if mah_values else None,
        "volt": int(volt.group(1)) if volt else None,
        "warranty_months": months,
        "relevance": round(relevance, 2),
        "contacts": extract_contacts(soup, url, text),
    }


def _meta(soup, *names):
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return tag["content"].strip()
    return ""


def _page_date(soup):
    """Ngày đăng/cập nhật của bài trên trang (YYYY-MM-DD). Không có thì trả về None."""
    candidates = []
    for name in ("article:modified_time", "article:published_time", "og:updated_time", "last-modified", "date", "pubdate"):
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            candidates.append(tag["content"])
    for time_tag in soup.find_all("time", attrs={"datetime": True}):
        candidates.append(time_tag["datetime"])
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "")
        except (ValueError, TypeError):
            continue
        for item in data if isinstance(data, list) else [data]:
            if isinstance(item, dict):
                candidates += [str(item.get(k)) for k in ("dateModified", "datePublished") if item.get(k)]
    for raw in candidates:
        match = re.match(r"(\d{4})-(\d{2})-(\d{2})", raw.strip())
        if match:
            return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    body = soup.get_text(" ", strip=True)[:20000]
    match = DATE_TEXT_RE.search(body)
    if match:
        day, month, year = (int(x) for x in match.groups())
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d")
        except ValueError:
            return None
    return None


def _find_prices(text):
    """Ưu tiên giá đứng ngay sau chữ 'giá' (giá bán); nếu không có thì lấy mọi giá hợp lý."""
    near_label = [_to_int(m) for m in PRICE_LABEL_RE.findall(text)]
    near_label = [p for p in near_label if PRICE_MIN <= p <= PRICE_MAX]
    if near_label:
        return near_label
    anywhere = [_to_int(m) for m in PRICE_RE.findall(text)]
    return [p for p in anywhere if PRICE_MIN <= p <= PRICE_MAX]


def _phrase_relevance(tokens, norm_text):
    """Tỷ lệ cụm 2 từ liên tiếp (VD 'quat ao', 'ao bao') xuất hiện trên trang."""
    if not tokens:
        return 1.0
    if len(tokens) == 1:
        return 1.0 if re.search(rf"\b{re.escape(tokens[0])}\b", norm_text) else 0.0
    phrases = [f"{a} {b}" for a, b in zip(tokens, tokens[1:])]
    matched = sum(1 for p in phrases if re.search(rf"\b{re.escape(p)}\b", norm_text))
    return matched / len(phrases)


def _to_int(raw):
    return int(re.sub(r"[.,]", "", raw))


PHONE_RE = re.compile(r"(?<![\d.])(?:\+?84|0)(?:[\s.\-]?\d){8,10}(?![\d])")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def _normalize_phone(raw):
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("84") and len(digits) in (11, 12):
        digits = "0" + digits[2:]
    return digits if digits.startswith("0") and len(digits) in (10, 11) else None


def extract_contacts(soup, page_url, text):
    """Thu thập cách liên hệ NCC có trên trang: điện thoại, Zalo, Messenger, Facebook, email, Skype."""
    phones, zalo, messenger, facebook, emails, skype = [], [], [], [], [], []

    def add(bucket, value, limit=4):
        if value and value not in bucket and len(bucket) < limit:
            bucket.append(value)

    for anchor in soup.find_all("a", href=True):
        href = anchor["href"].strip()
        lower = href.lower()
        if lower.startswith("tel:"):
            add(phones, _normalize_phone(href[4:]))
        elif lower.startswith("mailto:"):
            add(emails, href[7:].split("?")[0])
        elif lower.startswith("skype:"):
            add(skype, href[6:].split("?")[0])
        elif "zalo.me/" in lower or "chat.zalo.me" in lower:
            add(zalo, href)
        elif "m.me/" in lower or "facebook.com/messages" in lower:
            add(messenger, href)
        elif "facebook.com/" in lower and not any(k in lower for k in ("sharer", "share.php", "plugins", "tr?")):
            add(facebook, href)

    for match in PHONE_RE.findall(text[:30000]):
        add(phones, _normalize_phone(match))
    for match in EMAIL_RE.findall(text[:30000]):
        if not match.lower().endswith((".png", ".jpg", ".webp")):
            add(emails, match)

    zalo_guess = False
    if not zalo and phones:
        zalo = [f"https://zalo.me/{phones[0]}"]
        zalo_guess = True
    parsed = urlparse(page_url)
    return {
        "phones": phones,
        "zalo": zalo,
        "zalo_guess": zalo_guess,
        "messenger": messenger,
        "facebook": facebook,
        "emails": emails,
        "skype": skype,
        "website": f"{parsed.scheme}://{parsed.netloc}",
    }


def fetch_text(url):
    """Tải một trang và trả về (tiêu đề, văn bản). Dùng cho phần nghiên cứu kiến thức sản phẩm."""
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    if resp.status_code != 200 or "html" not in resp.headers.get("Content-Type", ""):
        return None, None
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else ""
    return title, " ".join(soup.get_text(" ", strip=True).split())
