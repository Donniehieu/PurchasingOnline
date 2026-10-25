// Cloudflare Worker: proxy GET cho ứng dụng chạy trên GitHub Pages (thêm CORS).
// Triển khai: dán file này vào Worker, sửa ALLOWED_ORIGIN thành địa chỉ trang GitHub Pages của bạn.
// Chỉ cho phép đúng origin đó gọi, chỉ nhận GET, chỉ http/https, chặn địa chỉ mạng nội bộ.

const ALLOWED_ORIGIN = "https://TEN_BAN.github.io"; // sửa dòng này, không có dấu / ở cuối
const FORWARD_HEADERS = ["x-subscription-token", "accept"]; // header được chuyển tiếp (cho Brave Search API)
const ALLOWED_HOSTS_FOR_HEADERS = ["api.search.brave.com"]; // chỉ chuyển tiếp khóa tới host này

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "x-subscription-token, accept",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
}
function isPrivateHost(host) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i.test(host) || host.endsWith(".local") || host.endsWith(".internal");
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== ALLOWED_ORIGIN) return new Response("Forbidden origin", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors(origin) });

    const target = new URL(request.url).searchParams.get("url");
    let url;
    try { url = new URL(target); } catch { return new Response("Bad url", { status: 400, headers: cors(origin) }); }
    if (!["http:", "https:"].includes(url.protocol) || isPrivateHost(url.hostname)) return new Response("Blocked", { status: 400, headers: cors(origin) });

    const headers = new Headers({ "User-Agent": "Mozilla/5.0 (compatible; PurchasingOnline)" });
    if (ALLOWED_HOSTS_FOR_HEADERS.includes(url.hostname)) for (const h of FORWARD_HEADERS) if (request.headers.get(h)) headers.set(h, request.headers.get(h));
    const upstream = await fetch(url.toString(), { headers, redirect: "follow" });
    const out = new Headers(cors(origin));
    out.set("Content-Type", upstream.headers.get("Content-Type") || "text/plain");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
