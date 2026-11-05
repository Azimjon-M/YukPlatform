// Yukni Telegram xabariga aylantiradi (HTML). Haydovchiga ham, kanalga ham shu matn ketadi.
// Telefon matnda +998901234567 ko'rinishida yoziladi — Telegram uni o'zi bosiladigan qiladi (bosganda qo'ng'iroq).
// Inline tugmada tel: ishlamaydi, shuning uchun tugma faqat asl e'longa olib boradi.
import { BODY_TYPES, LOADING_SIDES, PAYMENT_TYPES, REGIONS, TRUCK_CLASSES, placeKey } from "@yuk/shared";

const TIME_ZONE = "Asia/Tashkent";

export function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
const groupDigits = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function weightText(weightT) {
  if (weightT == null) return null;
  return weightT < 1 ? `${groupDigits(weightT * 1000)} kg` : `${String(weightT).replace(".", ",")} t`;
}

const UNIT_TEXT = { reys: "reys", tonna: "tonnasi", kg: "kilosi", kub: "kubi" };

export function priceText(load) {
  const parts = [];
  if (load.price != null) {
    const amount = groupDigits(load.price);
    const money =
      load.currency === "USD" ? `$${amount}` : load.currency === "RUB" ? `${amount} ₽` : load.currency === "KZT" ? `${amount} ₸` : `${amount} so'm`;
    parts.push(load.priceUnit && load.priceUnit !== "reys" ? `${money} / ${UNIT_TEXT[load.priceUnit]}` : money);
  }
  if (load.negotiable) parts.push("kelishiladi");
  const payment = PAYMENT_TYPES.find((p) => p.id === load.payment)?.name;
  if (payment) parts.push(payment.toLowerCase());
  return parts.length ? parts.join(" · ") : "narx yozilmagan";
}

function vehicleText(load) {
  const parts = [];
  if (load.vehicleCount > 1) parts.push(`${load.vehicleCount} ta`);
  const cls = TRUCK_CLASSES.find((t) => t.id === load.truckClass)?.name;
  // "Ploshatka / shalanda / kontenerovoz" → "ploshatka": xabarda birinchi nomi yetadi
  const body = BODY_TYPES.find((b) => b.id === load.bodyType)?.name.split(" / ")[0];
  if (cls) parts.push(cls);
  if (body) parts.push(body.toLowerCase());
  if (load.loadingSides?.length) {
    parts.push(load.loadingSides.map((s) => LOADING_SIDES.find((x) => x.id === s)?.name.toLowerCase() ?? s).join("/"));
  }
  if (load.partial) parts.push("dogruz");
  return parts.join(" · ");
}

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

// Telefonni bosiladigan ko'rinishga keltiradi: bo'sh joysiz, + bilan
const phoneText = (phone) => (String(phone).startsWith("+") ? phone : `+${phone}`);

// → { text, url } — url: asl e'lon (tugma uchun), bo'lmasa null
export function formatLoad(load, post = {}) {
  const lines = [`🚛 <b>${escapeHtml(placeText(load, "from"))} → ${escapeHtml(placeText(load, "to"))}</b>`];

  const cargo = [load.cargo, weightText(load.weightT), load.volumeM3 != null ? `${load.volumeM3} kub` : null, load.pallets ? `${load.pallets} palet` : null]
    .filter(Boolean)
    .join(" · ");
  if (cargo) lines.push(`📦 ${escapeHtml(cargo)}`);

  const vehicle = vehicleText(load);
  if (vehicle) lines.push(`🚚 ${escapeHtml(vehicle)}`);

  lines.push(`💰 ${escapeHtml(priceText(load))}`);
  if (load.when) lines.push(`📅 ${escapeHtml(load.when)}`);
  if (load.note) lines.push(`📝 ${escapeHtml(load.note)}`);
  if (load.phones?.length) lines.push(`📞 ${load.phones.map(phoneText).join(", ")}`);
  else lines.push("📞 telefon yozilmagan — asl e'lonni oching");

  const source = post.source?.startsWith("@") ? post.source : null;
  if (post.postedAt) lines.push(`🕒 ${escapeHtml(postedText(post.postedAt, source))}`);

  return { text: lines.join("\n"), url: post.link ?? null };
}
