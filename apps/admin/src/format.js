// Boshqaruv markazidagi matnlar: yuk qanday ko'rinadi, vaqt ("5 daq oldin"), ishlash vaqti, raqamlar.
// Bot'dagi apps/bot/src/format.js ning foydali qismlari (HTML'siz) — admin uni import qilmaydi, alohida dastur.
// Hammasi oddiy funksiyalar: brauzersiz test qilinadi (test/format.test.js).
import {
  BODY_TYPES,
  CATEGORIES,
  INTL_OPTIONS,
  LOADING_SIDES,
  MODE_OPTIONS,
  PAYMENT_TYPES,
  REGIONS,
  TRUCK_CLASSES,
  intlOption,
  placeKey,
  regionLabel,
} from "@yuk/shared";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// --- Raqamlar ---
// 3800000 → "3 800 000"; 14.62 → "14,6" (o'zbekcha: kasr vergul bilan, oxiridagi nollar tashlanadi)
export function formatNumber(value, digits = 0) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  const [whole, fraction = ""] = Number(value).toFixed(digits).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${grouped},${trimmed}` : grouped;
}

// --- Joy nomlari (bot bilan bir xil qoida) ---
const regionName = (id) => REGIONS.find((r) => r.id === id)?.name;
// "Farg'ona viloyati" → "Farg'ona", "Toshkent shahri" → "Toshkent"
const regionBase = (id) => regionName(id)?.replace(/ (viloyati|shahri|Respublikasi)$/, "") ?? null;
const sameName = (a, b) => placeKey(a) === placeKey(b);

// "Farg'ona, Beshariq", "Toshkent vil., Chirchiq", "Samarqand", "Rossiya, Moskva", "Surxondaryo viloyati"
export function placeText(load, side) {
  const city = load[`${side}City`];
  const place = load[`${side}Place`];
  const region = regionName(load[`${side}Region`]) ? load[`${side}Region`] : null;
  const country = load[`${side}Country`];
  const parts = [];
  if (region === "xorij" || (country && country !== "O'zbekiston")) {
    if (country) parts.push(country);
    if (city && !sameName(city, country ?? "")) parts.push(city);
  } else if (city && region) {
    const base = regionBase(region);
    const area = region === "toshkent" ? "Toshkent vil." : base;
    if (sameName(city, base)) parts.push(area);
    else parts.push(area, city.replace(/\s*\([^)]*\)$/, ""));
  } else if (city) {
    parts.push(city);
  } else if (region) {
    parts.push(regionName(region));
  }
  if (!parts.length) return place ?? country ?? "?";
  const text = parts.join(", ");
  return place && !sameName(place, city ?? "") ? `${text} (${place})` : text;
}

// 0.7 → "700 kg", 22 → "22 t", 1.5 → "1,5 t"
export function weightText(weightT) {
  if (weightT == null) return null;
  return weightT < 1 ? `${formatNumber(weightT * 1000)} kg` : `${String(weightT).replace(".", ",")} t`;
}

const UNIT_TEXT = { reys: "reys", tonna: "tonnasi", kg: "kilosi", kub: "kubi" };

export function moneyText(amount, currency) {
  const value = formatNumber(amount);
  if (currency === "USD") return `$${value}`;
  if (currency === "RUB") return `${value} ₽`;
  if (currency === "KZT") return `${value} ₸`;
  return `${value} so'm`;
}

// "3 800 000 so'm · kelishiladi · naqd", "200 so'm / kilosi", "narx yozilmagan"
export function priceText(load) {
  const parts = [];
  if (load.price != null) {
    const money = moneyText(load.price, load.currency);
    parts.push(load.priceUnit && load.priceUnit !== "reys" ? `${money} / ${UNIT_TEXT[load.priceUnit] ?? load.priceUnit}` : money);
  }
  if (load.negotiable) parts.push("kelishiladi");
  const payment = PAYMENT_TYPES.find((p) => p.id === load.payment)?.name;
  if (payment) parts.push(payment.toLowerCase());
  return parts.length ? parts.join(" · ") : "narx yozilmagan";
}

export const truckClassName = (id) => TRUCK_CLASSES.find((t) => t.id === id)?.name ?? null;
// "Ploshatka / shalanda / kontenerovoz" → "Ploshatka": ro'yxatda birinchi nomi yetadi
export const bodyTypeName = (id) => BODY_TYPES.find((b) => b.id === id)?.name.split(" / ")[0] ?? null;
export const categoryName = (id) => CATEGORIES.find((c) => c.id === id)?.name ?? null;

// "2 ta · Fura · tent · orqadan · dogruz"
export function vehicleText(load) {
  const parts = [];
  if (load.vehicleCount > 1) parts.push(`${load.vehicleCount} ta`);
  const cls = truckClassName(load.truckClass);
  const body = bodyTypeName(load.bodyType);
  if (cls) parts.push(cls);
  if (body) parts.push(cls ? body.toLowerCase() : body);
  if (load.loadingSides?.length) {
    parts.push(load.loadingSides.map((s) => LOADING_SIDES.find((x) => x.id === s)?.name.toLowerCase() ?? s).join("/"));
  }
  if (load.partial) parts.push("dogruz");
  return parts.join(" · ");
}

// "Sement · 22 t · 80 kub · 33 palet"
export function cargoText(load) {
  return [
    load.cargo,
    weightText(load.weightT),
    load.volumeM3 != null ? `${formatNumber(load.volumeM3, 1)} kub` : null,
    load.pallets ? `${load.pallets} palet` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Telefon: matnda "+998901234567", havolada "tel:+998901234567"
export function phoneLinks(phones) {
  return (phones ?? [])
    .map((phone) => String(phone).replace(/[^\d+]/g, ""))
    .filter((digits) => digits.replace(/\D/g, "").length >= 7)
    .map((digits) => {
      const text = digits.startsWith("+") ? digits : `+${digits}`;
      return { text, href: `tel:${text}` };
    });
}

// Yuk kartochkasi uchun hamma matnlar bir joyda
export function loadView(load = {}) {
  return {
    from: placeText(load, "from"),
    to: placeText(load, "to"),
    cargo: cargoText(load),
    vehicle: vehicleText(load),
    price: priceText(load),
    phones: phoneLinks(load.phones),
    when: load.when ?? null,
    note: load.note ?? null,
    category: categoryName(load.category),
  };
}

// --- Haydovchi profili ---
// "Andijon vil., Rossiya" yoki "Hamma joy" (bo'sh ro'yxat = cheklov yo'q)
export function areasText(areas) {
  return areas?.length ? areas.map(regionLabel).join(", ") : "Hamma joy";
}

export function capacityText(capacityKg) {
  if (capacityKg == null) return null;
  return weightText(Math.round(capacityKg / 100) / 10);
}

export function profileSummary(profile) {
  if (!profile) return null;
  // Yuk beruvchi: o'z mashinasi yo'q — qanday mashina va kuzov kerak (bo'sh ro'yxat — istalgani)
  if (Array.isArray(profile.truckClasses)) {
    const names = (ids, name) => ids.map((id) => name(id) ?? id).join(", ");
    return {
      vehicle: profile.truckClasses.length ? `Kerak: ${names(profile.truckClasses, truckClassName)}` : "Istalgan mashina",
      size: profile.bodyTypes?.length ? `Kuzov: ${names(profile.bodyTypes, bodyTypeName).toLowerCase()}` : null,
      from: areasText(profile.fromAreas),
      to: areasText(profile.toAreas),
      intl: INTL_OPTIONS[intlOption(profile)]?.label ?? null,
      mode: null,
    };
  }
  const v = profile.vehicle ?? {};
  const body = bodyTypeName(v.bodyType);
  const vehicle = [truckClassName(v.truckClass), body ? body.toLowerCase() : null, capacityText(v.capacityKg)].filter(Boolean).join(" · ");
  const size = v.body ? `${formatNumber(v.body.lengthM, 2)} × ${formatNumber(v.body.widthM, 2)} × ${formatNumber(v.body.heightM, 2)} m` : null;
  return {
    vehicle: vehicle || "—",
    size,
    from: areasText(profile.fromAreas),
    to: areasText(profile.toAreas),
    intl: INTL_OPTIONS[intlOption(profile)]?.label ?? null,
    mode: MODE_OPTIONS[profile.mode] ?? null,
  };
}

// --- Vaqt ---
// Brauzer o'z vaqt mintaqasini ishlatadi (Toshkent). Testlarda timeZone beriladi.
export function formatTime(ts, { seconds = false, timeZone } = {}) {
  if (ts == null) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined }).format(new Date(ts));
}

// "05.11 14:30"
export function formatDateTime(ts, { timeZone } = {}) {
  if (ts == null) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(ts))
    .replace(",", "");
}

// "hozirgina", "5 daq oldin", "3 soat oldin", "2 kun oldin", bir haftadan eski — sana
export function timeAgo(ts, now = Date.now(), options = {}) {
  if (ts == null) return "—";
  const diff = Math.max(0, now - ts);
  if (diff < MINUTE) return "hozirgina";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} daq oldin`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} soat oldin`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} kun oldin`;
  return formatDateTime(ts, options);
}

// Daqiqalar: 45 → "45 daq", 65 → "1 soat 5 daq", 120 → "2 soat", 1500 → "1 kun 1 soat"
export function durationMin(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} daq`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} soat ${rest} daq` : `${h} soat`;
  }
  const d = Math.floor(m / (24 * 60));
  const h = Math.floor((m % (24 * 60)) / 60);
  return h ? `${d} kun ${h} soat` : `${d} kun`;
}

// Jarayon qancha vaqtdan beri ishlayapti: "12 s", "5 daq", "2 soat 5 daq", "3 kun 4 soat"
export function uptimeText(startedAt, now = Date.now()) {
  if (startedAt == null) return "—";
  const ms = Math.max(0, now - startedAt);
  if (ms < MINUTE) return `${Math.floor(ms / 1000)} s`;
  return durationMin(Math.floor(ms / MINUTE));
}
