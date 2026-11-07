// Yuk matnlari (HTML'siz): qayerdan/qayerga, og'irlik, narx, mashina, vaqt.
// Bot xabari (apps/bot format.js) va haydovchilar web'i (apps/web) bir xil yozsin deb shu yerda.
import { placeKey } from "./places.js";
import { REGIONS } from "./regions.js";
import { PAYMENT_TYPES } from "./categories.js";
import { BODY_TYPES, LOADING_SIDES, TRUCK_CLASSES, bodyId } from "./vehicles.js";

const TIME_ZONE = "Asia/Tashkent";

const regionName = (id) => REGIONS.find((r) => r.id === id)?.name;
// "Farg'ona viloyati" → "Farg'ona", "Qoraqalpog'iston Respublikasi" → "Qoraqalpog'iston", "Toshkent shahri" → "Toshkent"
const regionBase = (id) => regionName(id)?.replace(/ (viloyati|shahri|Respublikasi)$/, "") ?? null;
const sameName = (a, b) => placeKey(a) === placeKey(b);

// Avval viloyat, keyin shahar — haydovchi har bir tuman qayerdaligini bilmaydi:
//   "Farg'ona, Beshariq", "Xorazm, Urganch", "Toshkent vil., Chirchiq", "Toshkent (Sergeli)",
//   viloyat markazi: "Samarqand"; faqat viloyat: "Surxondaryo viloyati"; xorij: "Rossiya, Moskva"
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
    // Toshkent viloyati — "Toshkent vil.", aks holda shahar bilan adashtiriladi
    const area = region === "toshkent" ? "Toshkent vil." : base;
    if (sameName(city, base)) parts.push(area);
    else parts.push(area, city.replace(/\s*\([^)]*\)$/, "")); // "Yangibozor (Xorazm)" → "Yangibozor"
  } else if (city) {
    parts.push(city);
  } else if (region) {
    parts.push(regionName(region));
  }
  if (!parts.length) return place ?? country ?? "?";
  const text = parts.join(", ");
  return place && !sameName(place, city ?? "") ? `${text} (${place})` : text;
}

// 3800000 → "3 800 000"
export const groupDigits = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// 0.7 → "700 kg", 22 → "22 tonna", 1.5 → "1,5 tonna" (Azimjon: "t" emas, "tonna" — hamma joyda)
export function weightText(weightT) {
  if (weightT == null) return null;
  return weightT < 1 ? `${groupDigits(weightT * 1000)} kg` : `${String(Math.round(weightT * 1000) / 1000).replace(".", ",")} tonna`;
}

// Transport turining yuk ko'tarishi: [0.3, 0.7] → "300–700 kg", [20, 40] → "20–40 tonna"
export function capacityRangeText([min, max]) {
  if (max < 1) return `${groupDigits(min * 1000)}–${groupDigits(max * 1000)} kg`;
  const t = (n) => String(n).replace(".", ",");
  return min < 1 ? `${groupDigits(min * 1000)} kg – ${t(max)} tonna` : `${t(min)}–${t(max)} tonna`;
}

const UNIT_TEXT = { reys: "reys", tonna: "tonnasi", kg: "kilosi", kub: "kubi" };

export function moneyText(amount, currency) {
  const value = groupDigits(amount);
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

// "2 ta · Fura · tent · orqadan · dogruz"
export function vehicleText(load) {
  const parts = [];
  if (load.vehicleCount > 1) parts.push(`${load.vehicleCount} ta`);
  const cls = TRUCK_CLASSES.find((t) => t.id === load.truckClass)?.name;
  // "Plashatka / shalanda" → "plashatka": birinchi nomi yetadi (eski kodlar: bort → plashatka)
  const body = BODY_TYPES.find((b) => b.id === bodyId(load.bodyType))?.name.split(" / ")[0];
  if (cls) parts.push(cls);
  if (body) parts.push(body.toLowerCase());
  if (load.loadingSides?.length) {
    parts.push(load.loadingSides.map((s) => LOADING_SIDES.find((x) => x.id === s)?.name.toLowerCase() ?? s).join("/"));
  }
  if (load.partial) parts.push("dogruz");
  return parts.join(" · ");
}

// --- Bo'sh mashina (mashina_bor e'loni, yuk beruvchiga). Parser uni yuk maydonlarida yozadi: weightT — necha tonna ko'taradi ---
const knownPlace = (load, side) => load[`${side}City`] || load[`${side}Region`] || load[`${side}Country`] || load[`${side}Place`];

// "Qayerga" ko'pincha yozilmaydi ("Samarqanddan yuk olaman") — demak istalgan joyga
export function truckPlaceText(truck, side) {
  if (knownPlace(truck, side)) return placeText(truck, side);
  return side === "to" ? "istalgan joyga" : "?";
}

// "Fura · tent · 22 tonna ko'taradi"
export function truckVehicleText(truck) {
  return [vehicleText(truck), truck.weightT != null ? `${weightText(truck.weightT)} ko'taradi` : null].filter(Boolean).join(" · ");
}

// "un · 22 tonna · 80 kub · 33 palet"
export function cargoText(load) {
  return [load.cargo, weightText(load.weightT), load.volumeM3 != null ? `${load.volumeM3} kub` : null, load.pallets ? `${load.pallets} palet` : null]
    .filter(Boolean)
    .join(" · ");
}

// "05.11 14:32 · @guruh" (Toshkent vaqti)
export function postedText(postedAt, sourceLabel) {
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(postedAt));
  return sourceLabel ? `${time.replace(",", "")} · ${sourceLabel}` : time.replace(",", "");
}

// "hozirgina", "5 daq oldin", "2 soat oldin", "kecha 14:32"
export function agoText(ts, now = Date.now()) {
  const min = Math.max(0, Math.round((now - ts) / 60000));
  if (min < 1) return "hozirgina";
  if (min < 60) return `${min} daq oldin`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} soat oldin`;
  return postedText(ts);
}

// Telefon: bo'sh joysiz, + bilan (Telegram va brauzer uni bosiladigan qiladi)
export const phoneText = (phone) => (String(phone).startsWith("+") ? String(phone) : `+${phone}`);
