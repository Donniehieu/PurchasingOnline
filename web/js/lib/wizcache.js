// Nhớ các câu trả lời ở thẻ hỏi để lần sau tự điền lại, không bắt người dùng nhập lại:
//   - theo từ khóa (cùng sản phẩm tìm lại: điền đúng như lần trước)
//   - theo loại hàng + câu hỏi (sản phẩm khác cùng loại: gợi ý lại lựa chọn hay dùng, ví dụ cùng hãng, cùng mục đích)
const KEY = "po-wizard-v1";
const MAX_KEYS = 80;

function read(storage) {
  try { const j = JSON.parse(storage.getItem(KEY) || "{}"); return { byKey: j.byKey ?? {}, byType: j.byType ?? {} }; }
  catch { return { byKey: {}, byType: {} }; }
}
function write(storage, data) {
  const keys = Object.entries(data.byKey).sort((a, b) => (b[1].ts ?? 0) - (a[1].ts ?? 0)).slice(0, MAX_KEYS);
  try { storage.setItem(KEY, JSON.stringify({ byKey: Object.fromEntries(keys), byType: data.byType })); } catch { /* chế độ riêng tư */ }
}

const plain = (a) => ({ value: a.value ?? "", add: a.add ?? "", custom: a.custom ?? "" });
const fills = (a) => !!(a && (a.value || a.custom));

/** Ghi lại câu trả lời vừa chọn. answers: { idThẻ: {value, add, custom} }; chỉ ghi câu có trả lời. */
export function saveWizard({ baseKey, typeId = "", answers = {}, adds = [] }, storage = globalThis.localStorage) {
  if (!storage || !baseKey) return;
  const data = read(storage);
  const clean = Object.fromEntries(Object.entries(answers).filter(([, a]) => fills(a) && !a.replace).map(([id, a]) => [id, plain(a)]));
  data.byKey[baseKey] = { ts: Date.now(), typeId, answers: clean, adds };
  if (typeId) data.byType[typeId] = { ...(data.byType[typeId] ?? {}), ...clean };
  write(storage, data);
}

// một câu trả lời cũ còn dùng được với thẻ hiện tại không (lựa chọn còn tồn tại, hoặc là chữ tự nhập)
function usable(card, a) {
  if (!card || card.kind !== "query" || card.options.some((o) => o.replace) || !fills(a)) return null;
  const opt = card.options.find((o) => o.value === a.value);
  if (a.value && opt) return { value: opt.value, add: opt.add, custom: a.custom || "" };
  if (a.custom) return { value: "", add: "", custom: a.custom };
  return null;
}

/**
 * Điền lại câu trả lời cho các thẻ. Ưu tiên lần tìm đúng từ khóa này, rồi tới lựa chọn gần nhất của cùng loại hàng.
 * Trả về { answers, exact } — exact = true khi lấy từ chính từ khóa này.
 */
export function recallWizard({ baseKey, typeId = "", cards = [] }, storage = globalThis.localStorage) {
  if (!storage) return { answers: {}, exact: false };
  const data = read(storage);
  const mine = data.byKey[baseKey]?.answers ?? {};
  const kind = data.byType[typeId] ?? {};
  const answers = {};
  let exact = false;
  for (const c of cards) {
    const own = usable(c, mine[c.id]);
    if (own) { answers[c.id] = own; exact = true; continue; }
    const typed = usable(c, kind[c.id]);
    if (typed) answers[c.id] = typed;
  }
  return { answers, exact };
}

/** Câu trả lời đã lưu cho đúng từ khóa này (dùng khi tìm lại từ cache mà không hỏi lại). */
export function savedFor(baseKey, storage = globalThis.localStorage) {
  if (!storage) return null;
  const s = read(storage).byKey[baseKey];
  return s && s.adds?.length ? s : null;
}

/** Xóa câu trả lời đã lưu: theo danh sách khóa, hoặc toàn bộ (keys = null). */
export function forgetWizard(keys = null, storage = globalThis.localStorage) {
  if (!storage) return;
  if (!keys) { try { storage.removeItem(KEY); } catch { /* bỏ qua */ } return; }
  const data = read(storage);
  for (const k of keys) delete data.byKey[k];
  write(storage, data);
}
