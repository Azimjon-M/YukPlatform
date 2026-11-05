// Soatma-soat grafik uchun hisoblar (SVG chizishdan alohida — test qilinadi).
const HOUR = 60 * 60 * 1000;

// Y o'qi uchun "chiroyli" qadam: 1, 2, 5, 10, 20, 50...
export function niceStep(max, count = 4) {
  const raw = Math.max(max, 1) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  return Math.max(1, step);
}

// [0, 5, 10, 15, 20] — oxirgisi max dan kichik emas
export function yTicks(max, count = 4) {
  const step = niceStep(max, count);
  const top = Math.max(step, Math.ceil(Math.max(max, 1) / step) * step);
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

// API'dagi bucket: index = hours-1 - floor((now - t) / soat). Ya'ni oxirgi bucket — oxirgi 60 daqiqa.
// → [{ start, end }] eng eskisidan
export function bucketRanges(now, hours) {
  return Array.from({ length: hours }, (_, i) => {
    const end = now - (hours - 1 - i) * HOUR;
    return { start: end - HOUR, end };
  });
}

// Pastdagi yozuvlar orasi kamida minPx bo'lsin: har nechanchi bucket'ga yozuv qo'yiladi
export function labelEvery(spacingPx, minPx = 56) {
  return [1, 2, 3, 4, 6, 8, 12, 24].find((n) => n * spacingPx >= minPx) ?? 24;
}

// Sichqoncha x koordinatasi → eng yaqin nuqta raqami
export function nearestIndex(px, left, spacing, count) {
  if (count <= 1 || spacing <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((px - left) / spacing)));
}

// [[x, y], ...] → "M10 20L30 40..."
export function linePath(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

// Chiziqlar oxiridagi yozuvlar bir-birini bosib qolmaydimi (y lar orasi kamida gap px)
export function labelsCollide(ys, gap = 14) {
  const sorted = [...ys].sort((a, b) => a - b);
  return sorted.some((y, i) => i > 0 && y - sorted[i - 1] < gap);
}
