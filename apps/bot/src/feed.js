// Haydovchining yetkazish rejimi botda (qoidalari — @yuk/shared feed.js; Azimjon, 2026-11-14: «yukni kim birinchi olsa,
// yuk o'shaniki»). 2026-11-27 dan filtr (transport, qayerdan, guruhlar) FAQAT Mini App'da («🎛 Filtr» bo'limi, apps/web
// FilterPage.jsx) — chatdagi oynalar olib tashlandi. Bu yerda: eski xabarlardagi tugmalar va saqlangandan keyingi matn.
import { FEED_MODES, feedOf, regionsText, trucksText } from "@yuk/shared";

// Eski chat-filtr tugmalari: fm: (rejim), fg: (guruhlar), fr: (viloyatlar), ft: (transport) — bosilsa ilova ochiladi
export const FILTER_CALLBACK = /^f[mgrt]:/;

const modeTitle = (id) => `${FEED_MODES[id].icon} ${FEED_MODES[id].name}`;

// Saqlangach yoziladigan matn: nima keladi
export function feedSavedText(feed, { needsVehicle = false } = {}) {
  const f = feedOf({ feed });
  // 2026-11-19 (soddalashtirish): «✅ Tayyor!» + nima tanlangani + ikki tugma nomi
  const mine = f.mode === "guruhlarim" || f.mode === "guruhlarim_plus";
  const filters = [
    `🚚 Mashina: <b>${trucksText(f.trucks)}</b>`,
    `📍 Qayerdan: <b>${regionsText(f.regions)}</b>`,
    `📌 Guruhlar: <b>${mine ? `tanlangan ${f.sources.length} ta` : "Hamma guruhlar"}</b>`,
  ].join("\n");
  if (f.mode === "tezkor" || f.mode === "guruhlarim") {
    return `✅ <b>Tayyor!</b> Yuk e'lonlari shu yerga keladi.\n\n${filters}\n\nKamroq kerak bo'lsa — «🎛 Filtr».\nTo'xtatish — «⏸ Pauza».`;
  }
  const head = `✅ Rejim: <b>${modeTitle(f.mode)}</b>`;
  if (f.mode === "guruhlarim_plus") {
    const sorted = needsVehicle ? "Boshqa guruhlardan mos yuklar uchun mashinangizni kiriting — pastdagi «🚚 Ro'yxatdan o'tish»." : "Boshqa guruhlardan — mashinangiz va yo'nalishingizga moslari.";
    return `${head}\n\nTanlagan ${f.sources.length} ta guruhingizdagi yuk e'lonlari darhol keladi.\n${sorted}`;
  }
  return needsVehicle ? `${head}\n\nMos yuklarni topish uchun mashinangizni kiriting.` : `${head}\n\nMashinangiz va yo'nalishingizga mos yuklar keladi.`;
}
