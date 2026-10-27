// Xem ảnh to (lightbox) và hiệu ứng chờ khi mở link ra trang khác.
//  - Bấm vào ảnh: mở ảnh lớn, có vòng quay lúc tải, nút "Ẩn ảnh" (hoặc Esc / bấm nền) để quay lại đúng chỗ cũ, mũi tên chuyển ảnh cùng nhóm.
//  - Bấm vào link ra ngoài: làm mờ nền + vòng quay "Đang mở trang…" tới khi trang mở xong (quay lại ứng dụng) hoặc hết thời gian chờ.

const LINK_WAIT_MS = 6000;

export function mountViewer(doc = document) {
  const $ = (id) => doc.getElementById(id);
  const lb = $("lightbox"), img = $("lbImg"), spin = $("lbSpin"), cap = $("lbCap"), count = $("lbCount"), open = $("lbOpen"), err = $("lbErr");
  let list = [], idx = 0, lastFocus = null;

  function show(i) {
    idx = (i + list.length) % list.length;
    const it = list[idx];
    spin.hidden = false; err.hidden = true; img.classList.add("loading");
    img.onload = () => { spin.hidden = true; img.classList.remove("loading"); };
    img.onerror = () => { spin.hidden = true; err.hidden = false; img.classList.add("loading"); };
    img.referrerPolicy = "no-referrer";
    img.src = it.src;
    img.alt = it.alt;
    cap.textContent = it.alt;
    open.href = it.href;
    count.textContent = list.length > 1 ? `${idx + 1}/${list.length}` : "";
    $("lbPrev").hidden = $("lbNext").hidden = list.length < 2;
  }
  function openAt(items, i) {
    list = items; lastFocus = doc.activeElement;
    lb.hidden = false;
    doc.body.classList.add("noscroll");
    show(i);
    $("lbClose").focus();
  }
  function close() {
    if (lb.hidden) return;
    lb.hidden = true;
    img.removeAttribute("src");
    doc.body.classList.remove("noscroll");
    lastFocus?.focus?.({ preventScroll: true });
  }

  // ----- chờ mở link -----
  const lk = $("linkBusy");
  let lkTimer;
  function hideLink() { clearTimeout(lkTimer); lk.hidden = true; }
  function showLink(host) {
    $("linkBusyText").textContent = host;
    lk.hidden = false;
    clearTimeout(lkTimer);
    lkTimer = setTimeout(hideLink, LINK_WAIT_MS);
  }
  doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") hideLink(); });
  window.addEventListener("pageshow", hideLink);
  $("linkBusyClose").addEventListener("click", hideLink);

  // ----- bắt sự kiện bấm -----
  doc.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button) return;
    const a = e.target.closest?.("a[href]");
    if (!a || a.closest("#lightbox") || a.closest("#linkBusy")) return;
    const thumb = a.querySelector("img");
    if (thumb && a.closest("#result")) {
      e.preventDefault();
      // các ảnh cùng nhóm (cùng thẻ) để chuyển qua lại
      const scope = a.closest(".gallery, .images-grid") ?? a.parentElement;
      const links = [...scope.querySelectorAll("a[href]")].filter((x) => x.querySelector("img"));
      const items = links.map((x) => ({ src: x.querySelector("img").currentSrc || x.href, href: x.href, alt: x.querySelector("img").alt || "" }));
      openAt(items, Math.max(0, links.indexOf(a)));
      return;
    }
    // link ra trang ngoài mở ở tab mới: hiện hiệu ứng chờ
    if (/^https?:$/.test(a.protocol) && a.target === "_blank" && !a.hasAttribute("download") && !e.ctrlKey && !e.metaKey && !e.shiftKey) showLink(a.hostname || a.href);
  });
  $("lbClose").addEventListener("click", close);
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.classList.contains("lb-stage")) close(); });
  $("lbPrev").addEventListener("click", () => show(idx - 1));
  $("lbNext").addEventListener("click", () => show(idx + 1));
  doc.addEventListener("keydown", (e) => {
    if (lb.hidden) { if (e.key === "Escape") hideLink(); return; }
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft" && list.length > 1) show(idx - 1);
    else if (e.key === "ArrowRight" && list.length > 1) show(idx + 1);
  });
  // vuốt trái/phải trên điện thoại để chuyển ảnh
  let x0 = null;
  lb.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (x0 == null || list.length < 2) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 60) show(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });
  return { openAt, close, showLink, hideLink };
}
