// Yukni Telegram xabariga aylantiradi (HTML). Haydovchiga ham, kanalga ham shu matn ketadi.
// Telefon matnda +998901234567 ko'rinishida yoziladi — Telegram uni o'zi bosiladigan qiladi (bosganda qo'ng'iroq).
// Inline tugmada tel: ishlamaydi, shuning uchun tugma faqat asl e'longa olib boradi.
import { cargoText, phoneText, placeText, postedText, priceText, vehicleText } from "@yuk/shared";

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
