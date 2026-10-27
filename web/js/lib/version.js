// So sánh phiên bản tiện ích và quyết định có báo "có bản mới" không.
export function compareVersions(a, b) {
  const pa = String(a ?? "0").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b ?? "0").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * status: kết quả bridge.status() { installed, allowed, version, store }
 * latest: nội dung ext/version.json do chính máy chủ app phát hành
 * Trả về null nếu không cần báo, hoặc { kind: "store" | "folder" | "install", current, latest }.
 */
export function extUpdateNotice(status, latest, dismissed = "") {
  if (!latest?.version) return null;
  if (!status?.installed) return { kind: "install", current: null, latest: latest.version };
  if (compareVersions(latest.version, status.version) <= 0) return null;
  if (dismissed && compareVersions(dismissed, latest.version) >= 0) return null;
  return { kind: status.store ? "store" : "folder", current: status.version, latest: latest.version };
}
