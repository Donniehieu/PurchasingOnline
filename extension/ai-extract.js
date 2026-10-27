// Chạy TRONG trang Google (qua chrome.scripting.executeScript). Hàm phải tự chứa, không dùng biến ngoài.
// Đọc: Chế độ AI (udm=50) hoặc kết quả tìm kiếm thường. Không bấm, không nhập gì, chỉ đọc chữ đang hiển thị.
function extractGoogle() {
  const url = location.href;
  if (/\/sorry\//.test(url) || document.querySelector("form[action*='sorry'], #captcha-form, iframe[src*='recaptcha']")) return { url, state: "blocked" };
  if (/(^|\.)consent\.google\./.test(location.hostname)) return { url, state: "consent" };

  const isGoogle = (h) => /(^|\.)google\.[a-z.]+$/.test(h);
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const main = document.querySelector("[role=main]") || document.body;
  const raw = main.innerText || "";

  // Trích dẫn của Chế độ AI: liên kết /goto?url=<mã hóa>, nhãn là tên nguồn
  const cites = [...main.querySelectorAll("a[href^='/goto'], a[href*='google.com/goto']")].map((a) => ({
    label: clean(a.getAttribute("aria-label") || a.innerText),
    href: a.href,
  }));

  // Kết quả tìm kiếm thường: h3 nằm trong liên kết trực tiếp ra ngoài
  const results = [];
  const seen = new Set();
  for (const h of main.querySelectorAll("h3")) {
    const a = h.closest("a");
    if (!a || !/^https?:/.test(a.href) || isGoogle(a.hostname) || seen.has(a.href)) continue;
    seen.add(a.href);
    const box = a.closest("[data-hveid], .g, div[jscontroller]") || a.parentElement;
    const full = clean(box ? box.innerText : "");
    results.push({ url: a.href, title: clean(h.innerText), snippet: full.replace(clean(h.innerText), "").slice(0, 300) });
  }

  const isAI = /udm=50/.test(url) || /Chế độ AI|AI Mode/i.test(document.title + " " + (document.querySelector("h1")?.innerText || ""));

  // Tách thành dòng; gắn mỗi nhãn nguồn (chip) vào dòng nội dung ngay trước nó
  let all = raw.split("\n").map(clean).filter(Boolean);
  const start = all.findIndex((l) => /^Câu trả lời của Chế độ AI|^AI Mode response/i.test(l));
  if (start >= 0) all = all.slice(start + 1);
  const end = all.findIndex((l) => /^AI có thể mắc sai sót|^AI responses may include mistakes/i.test(l));
  const hasEnd = end >= 0;
  if (hasEnd) all = all.slice(0, end);

  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const lines = [];
  let ci = 0;
  for (let i = 0; i < all.length; i++) {
    const cite = cites[ci];
    if (cite && lines.length) {
      const want = norm(cite.label);
      let joined = "", n = 0;
      while (n < 4 && i + n < all.length) {
        joined += norm(all[i + n]);
        n++;
        if (joined === want) break;
      }
      if (want && joined === want) {
        const last = lines[lines.length - 1];
        last.c.push(ci);
        ci++;
        i += n - 1;
        if (/^\+\d+$/.test(all[i + 1] || "")) i++;
        continue;
      }
    }
    if (/^\+\d+$/.test(all[i])) continue;
    lines.push({ t: all[i], c: [] });
  }

  const loading = !!document.querySelector("[aria-busy='true'], [role=progressbar]");
  return { url, state: "ok", mode: isAI && lines.length ? "ai" : "organic", lines, cites, results: results.slice(0, 12), textLen: raw.length, done: hasEnd, loading };
}
