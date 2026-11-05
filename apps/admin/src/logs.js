// Jarayon loglarini yig'ish. API: GET /api/processes/:name/logs?after=<seq> → { lines, last }.
// Har safar faqat yangi qatorlar keladi; after = oxirgi ko'rgan raqam.
export const MAX_LOG_LINES = 1000;

export const emptyLog = () => ({ lines: [], last: 0 });

// → { lines, last, added, reset } ; added — nechta yangi qator qo'shildi; reset: true — server qayta ishga tushgan (raqamlar boshidan), after=0 bilan qayta so'rash kerak
export function mergeLogs(prev, response, max = MAX_LOG_LINES) {
  const last = Number(response?.last) || 0;
  if (last < prev.last) return { ...emptyLog(), added: 0, reset: true };
  const fresh = (response?.lines ?? []).filter((line) => line.seq > prev.last);
  if (!fresh.length) return { lines: prev.lines, last: Math.max(prev.last, last), added: 0, reset: false };
  const lines = [...prev.lines, ...fresh];
  return { lines: lines.length > max ? lines.slice(lines.length - max) : lines, last: Math.max(last, fresh.at(-1).seq), added: fresh.length, reset: false };
}

// Pastga yopishib turish: foydalanuvchi pastdan threshold px ichida bo'lsa — avtomatik aylantiramiz
export function isNearBottom({ scrollTop, scrollHeight, clientHeight }, threshold = 24) {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
