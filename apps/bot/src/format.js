// Yukni Telegram xabariga aylantiradi (HTML). Haydovchiga ham, kanalga ham shu matn ketadi.
// Telefon matnda +998901234567 ko'rinishida yoziladi — Telegram uni o'zi bosiladigan qiladi (bosganda qo'ng'iroq).
// Xabar ostidagi tugmalar («📄 Asl e'lon», «📞 Telefon qilish») — bot.js loadButtons.
import {
  cargoText,
  phoneText,
  placeText,
  postedText,
  priceText,
  senderLink,
  truckPlaceText,
  truckVehicleText,
  vehicleText,
} from "@yuk/shared";

// Matn qismlari @yuk/shared (loadText.js) da — haydovchilar web'i ham xuddi shunday yozadi
export { placeText, postedText, priceText, weightText } from "@yuk/shared";

export function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// E'lon guruhda chiqqan vaqt: «🕒 Asl e'lon: 09.11 12:05». Guruh nomi yozilmaydi (Azimjon, 2026-11-09: «@TutGruz kerak emas»)
export const postedLine = (postedAt) => `🕒 Asl e'lon: ${escapeHtml(postedText(postedAt))}`;
// Yuk egasining o'zi botga yoki formaga yozgan yuk («📦 Yuk berish», 2026-11-10): guruhdan olinmagan — «asl e'lon» yo'q,
// vositachisiz ekani haydovchi uchun muhim
export const ownerLine = (postedAt) => `✅ Yuk egasining o'zi yubordi · ${escapeHtml(postedText(postedAt))}`;
const timeLine = (post) => (post.fromShipper ? ownerLine(post.postedAt) : postedLine(post.postedAt));

// E'lonni guruhga yozgan odamning shaxsiy chati: «💬 Lichkasi» (havola). Username'i yo'q bo'lsa — qator yo'q.
// t.me havolasi Telegram ichida «Havolani ochish» so'ramasdan darhol o'sha odam bilan chatni ochadi
export const SENDER_TEXT = "Lichkasi";
export function senderLine(sender) {
  const url = senderLink(sender);
  return url ? `💬 <a href="${escapeHtml(url)}">${SENDER_TEXT}</a>` : null;
}

// → { text, url } — url: asl e'lon (tugma uchun), bo'lmasa null
export function formatLoad(load, post = {}) {
  const lines = [`🚛 <b>${escapeHtml(placeText(load, "from"))} → ${escapeHtml(placeText(load, "to"))}</b>`];

  const cargo = cargoText(load);
  if (cargo) lines.push(`📦 ${escapeHtml(cargo)}`);

  const vehicle = vehicleText(load);
  if (vehicle) lines.push(`🚚 ${escapeHtml(vehicle)}`);

  lines.push(`💰 ${escapeHtml(priceText(load))}`);
  if (load.when) lines.push(`📅 ${escapeHtml(load.when)}`);
  if (load.note) lines.push(`📝 ${escapeHtml(load.note)}`);
  if (load.phones?.length) lines.push(`📞 ${load.phones.map(phoneText).join(", ")}`);
  else lines.push("📞 telefon yozilmagan — asl e'lonni oching");
  const sender = senderLine(post.sender);
  if (sender) lines.push(sender);

  if (post.postedAt) lines.push(timeLine(post));

  return { text: lines.join("\n"), url: post.link ?? null };
}

// «⚡ Tezkor» / «📌 Mening guruhlarim» xabari (2026-11-14): e'lonning ASL matni, AI'siz — tushunilmagan, shuning uchun
// yo'nalish/mashina qatorlari yo'q. Ostida: telefonlar +998… ko'rinishida (matndagi «90 123 45 67» Telegram'da bosilmaydi),
// «💬 Lichkasi», rejim va vaqt. Guruh nomi yozilmaydi (2026-11-09 qoidasi) — «📄 Asl e'lon» tugmasi o'sha guruhni ochadi.
// Telegram xabari 4096 belgigacha — uzun e'lon qisqartiriladi (to'liqi — «📄 Asl e'lon» da)
export const RAW_TEXT_MAX = 3500;
export function formatRaw(post, { phones = [], label = "⚡ Tezkor" } = {}) {
  const body = String(post.text ?? "").trim();
  const text = body.length > RAW_TEXT_MAX ? `${body.slice(0, RAW_TEXT_MAX).trimEnd()}…` : body;
  const lines = [escapeHtml(text), ""];
  if (phones.length) lines.push(`📞 ${phones.map(phoneText).join(", ")}`);
  const sender = senderLine(post.sender);
  if (sender) lines.push(sender);
  lines.push(`${label}${post.postedAt ? ` · 🕒 ${escapeHtml(postedText(post.postedAt))}` : ""}`);
  return { text: lines.join("\n"), url: post.link ?? null };
}

// Bo'sh mashina (yuk beruvchiga). Matnlar @yuk/shared loadText.js da — web ham xuddi shunday yozadi.
// → { text, url }
export function formatTruck(truck, post = {}) {
  const route = `${truckPlaceText(truck, "from")} → ${truckPlaceText(truck, "to")}`;
  const lines = [`🚚 <b>Bo'sh mashina: ${escapeHtml(route)}</b>`];

  const vehicle = truckVehicleText(truck);
  if (vehicle) lines.push(`🚛 ${escapeHtml(vehicle)}`);
  if (truck.price != null || truck.negotiable) lines.push(`💰 ${escapeHtml(priceText(truck))}`);
  if (truck.when) lines.push(`📅 ${escapeHtml(truck.when)}`);
  if (truck.note) lines.push(`📝 ${escapeHtml(truck.note)}`);
  if (truck.phones?.length) lines.push(`📞 ${truck.phones.map(phoneText).join(", ")}`);
  else lines.push("📞 telefon yozilmagan — asl e'lonni oching");
  const sender = senderLine(post.sender);
  if (sender) lines.push(sender);

  if (post.postedAt) lines.push(timeLine(post));

  return { text: lines.join("\n"), url: post.link ?? null };
}
