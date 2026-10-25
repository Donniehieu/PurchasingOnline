"""Nghiên cứu kiến thức sản phẩm theo các chủ đề cố định (người dùng tick trên giao diện).

Mỗi chủ đề thêm một cụm từ khóa vào lượt tìm riêng, sau đó trích các câu liên quan từ trang
tìm được kèm link nguồn. Câu trích là nguyên văn từ web, cần người mua đọc và đánh giá lại.
"""

import re
import statistics
from concurrent.futures import ThreadPoolExecutor

from . import crawler, search_engines

TOPICS = {
    "tech": {
        "label": "Công nghệ, phân loại, ưu nhược điểm",
        "keywords": "ưu nhược điểm các loại",
        "pattern": r"công nghệ|phân loại|loại|ưu điểm|nhược điểm|so sánh",
    },
    "price": {
        "label": "Giá trung bình",
        "keywords": "giá bao nhiêu",
        "pattern": r"giá|đồng|vnđ|₫|trung bình|khoảng",
    },
    "using": {
        "label": "Sử dụng công nghệ gì",
        "keywords": "công nghệ nguyên lý hoạt động",
        "pattern": r"công nghệ|nguyên lý|hoạt động|cấu tạo|động cơ|pin",
    },
}
MAX_SNIPPETS = 4
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def topic_list():
    return [{"id": key, "label": topic["label"]} for key, topic in TOPICS.items()]


def run_research(topic_ids, product, extra_keywords, engines, max_pages=3):
    """Trả về {topic_id: {"label", "snippets": [{"text", "url"}]}}."""
    selected = [t for t in topic_ids if t in TOPICS]
    if not selected or not engines:
        return {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda t: _research_topic(t, product, extra_keywords, engines, max_pages), selected))
    return dict(zip(selected, results))


def _research_topic(topic_id, product, extra_keywords, engines, max_pages):
    topic = TOPICS[topic_id]
    query = f"{product} {topic['keywords']} {extra_keywords}".strip()
    urls, errors = search_engines.search(engines, query, max_pages)
    pattern = re.compile(topic["pattern"], re.IGNORECASE)
    product_tokens = crawler.query_keywords(product)
    snippets = []
    for url in urls[:max_pages]:
        try:
            _, text = crawler.fetch_text(url)
        except Exception:  # noqa: BLE001 - trang lỗi thì bỏ qua
            continue
        if not text:
            continue
        # trang phải thật sự nói về sản phẩm (cụm 2 từ liên tiếp), tránh trích câu từ trang không liên quan
        if crawler._phrase_relevance(product_tokens, crawler._strip_accents(text)) < 0.5:
            continue
        for sentence in SENTENCE_SPLIT.split(text[:40000]):
            clean = sentence.strip()
            if not 50 <= len(clean) <= 300 or not pattern.search(clean):
                continue
            if product_tokens and not any(tok in crawler._strip_accents(clean) for tok in product_tokens):
                continue
            snippets.append({"text": clean, "url": url})
            if len([s for s in snippets if s["url"] == url]) >= 2:
                break
        if len(snippets) >= MAX_SNIPPETS:
            break
    return {"label": topic["label"], "query": query, "snippets": snippets[:MAX_SNIPPETS], "errors": errors}


def price_stats(suppliers):
    """Giá trung bình tính từ các NCC đã đọc được (đơn giá trên trang, có thể gồm VAT)."""
    prices = [s["price"] for s in suppliers if s.get("price")]
    if not prices:
        return None
    return {
        "count": len(prices),
        "mean": round(statistics.mean(prices)),
        "median": round(statistics.median(prices)),
        "min": min(prices),
        "max": max(prices),
    }
