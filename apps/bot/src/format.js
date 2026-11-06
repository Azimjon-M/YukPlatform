// Yukni Telegram xabariga aylantiradi (HTML). Haydovchiga ham, kanalga ham shu matn ketadi.
// Telefon matnda +998901234567 ko'rinishida yoziladi — Telegram uni o'zi bosiladigan qiladi (bosganda qo'ng'iroq).
// Inline tugmada tel: ishlamaydi, shuning uchun tugma faqat asl e'longa olib boradi.
import { cargoText, phoneText, placeText, postedText, priceText, vehicleText, weightText } from "@yuk/shared";

// Matn qismlari @yuk/shared (loadText.js) da — haydovchilar web'i ham xuddi shunday yozadi
export { placeText, postedText, priceText, weightText } from "@yuk/shared";

export function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

  const source = post.source?.startsWith("@") ? post.source : null;
  if (post.postedAt) lines.push(`🕒 ${escapeHtml(postedText(post.postedAt, source))}`);

  return { text: lines.join("\n"), url: post.link ?? null };
}

const known = (load, side) => load[`${side}City`] || load[`${side}Region`] || load[`${side}Country`] || load[`${side}Place`];

// Bo'sh mashina (yuk beruvchiga). Parser uni yuk maydonlarida yozadi: weightT — necha tonna ko'taradi.
// "Qayerga" ko'pincha yozilmaydi ("Samarqanddan yuk olaman") — demak istalgan joyga.
// → { text, url }
export function formatTruck(truck, post = {}) {
  const from = known(truck, "from") ? placeText(truck, "from") : "?";
  const to = known(truck, "to") ? placeText(truck, "to") : "istalgan joyga";
  const lines = [`🚚 <b>Bo'sh mashina: ${escapeHtml(from)} → ${escapeHtml(to)}</b>`];

  const vehicle = [vehicleText(truck), truck.weightT != null ? `${weightText(truck.weightT)} ko'taradi` : null].filter(Boolean).join(" · ");
  if (vehicle) lines.push(`🚛 ${escapeHtml(vehicle)}`);
  if (truck.price != null || truck.negotiable) lines.push(`💰 ${escapeHtml(priceText(truck))}`);
  if (truck.when) lines.push(`📅 ${escapeHtml(truck.when)}`);
  if (truck.note) lines.push(`📝 ${escapeHtml(truck.note)}`);
  if (truck.phones?.length) lines.push(`📞 ${truck.phones.map(phoneText).join(", ")}`);
  else lines.push("📞 telefon yozilmagan — asl e'lonni oching");

  const source = post.source?.startsWith("@") ? post.source : null;
  if (post.postedAt) lines.push(`🕒 ${escapeHtml(postedText(post.postedAt, source))}`);

  return { text: lines.join("\n"), url: post.link ?? null };
}
