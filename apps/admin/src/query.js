// So'rov qatori: { from: "andijon", q: "", hours: null } → "?from=andijon". Bo'sh qiymatlar tashlanadi.
// params — null ham bo'lishi mumkin («parametr yo'q» deb yuborilganda), shuning uchun ?? {}
export function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// Sahifalash: offset/limit/total → "51–100 / 1 234" uchun raqamlar va tugmalar holati
export function pageInfo({ offset = 0, limit = 50, total = 0 }) {
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + limit, total);
  return {
    first,
    last,
    total,
    hasPrev: offset > 0,
    hasNext: offset + limit < total,
    prevOffset: Math.max(0, offset - limit),
    nextOffset: offset + limit,
  };
}
