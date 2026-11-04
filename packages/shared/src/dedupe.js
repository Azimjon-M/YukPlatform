// Bitta yuk ko'p guruhga, ko'p marta tashlanadi. Haydovchiga uni BIR MARTA yuboramiz
// (yuk yopilganmi, bilmaymiz — takror yuborsak, eskisini ham yangi deb o'ylaydi). Manba: docs/haydovchi-suhbati.md.
//
// Kalit = telefonlar + qayerdan + qayerga + kuzov + og'irlik.
// - Telefon kalitda bor: boshqa odamning shu yo'nalishdagi yuki — boshqa yuk, uni yo'qotib qo'ymaslik kerak.
// - Narx, yuk nomi, sana kalitda yo'q: qayta tashlaganda narxni o'zgartirishadi yoki AI boshqacha yozadi, yuk esa o'sha.
import { placeKey } from "./places.js";

export const DEFAULT_DEDUPE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 kun

function placePart(city, region, country) {
  if (city) return placeKey(city);
  return region ?? (country ? placeKey(country) : "?");
}

// Bitta yukning kaliti
export function loadKey(load) {
  const phones = [...new Set(load.phones ?? [])].map((p) => p.replace(/\D/g, "")).sort().join(",");
  const from = placePart(load.fromCity, load.fromRegion, load.fromCountry);
  const to = placePart(load.toCity, load.toRegion, load.toCountry);
  const weight = load.weightT == null ? "" : String(Math.round(load.weightT * 10) / 10);
  return [phones || "-", from, to, load.bodyType ?? "", weight].join("|");
}

// E'londagi barcha yuklarning kalitlari. Bitta e'londa bir xil yuk ikki marta yozilgan bo'lsa
// (masalan, Farg'ona → Toshkent ploshatka ikki qatorda), ikkinchisiga "#2" qo'shiladi:
// ular alohida yuk, lekin e'lon qayta tashlansa, yana o'sha kalitlar chiqadi.
export function loadKeys(loads) {
  const count = new Map();
  return loads.map((load) => {
    const key = loadKey(load);
    const n = (count.get(key) ?? 0) + 1;
    count.set(key, n);
    return n === 1 ? key : `${key}#${n}`;
  });
}

// Xotirada ishlaydigan takror tekshiruvchi. Keyinroq kalitlar bazada saqlanadi, qoida esa shu.
export function createDeduper({ windowMs = DEFAULT_DEDUPE_WINDOW_MS, now = () => Date.now() } = {}) {
  const seenAt = new Map(); // kalit → birinchi ko'rilgan vaqt

  function forget(time) {
    for (const [key, at] of seenAt) if (time - at > windowMs) seenAt.delete(key);
  }

  // Yangi bo'lsa true (va eslab qoladi), oxirgi windowMs ichida ko'rilgan bo'lsa false
  function isNew(key, time = now()) {
    forget(time);
    if (seenAt.has(key)) return false;
    seenAt.set(key, time);
    return true;
  }

  return {
    isNew,
    // E'londagi yuklardan faqat yangilarini qaytaradi
    fresh(loads, time = now()) {
      const keys = loadKeys(loads);
      return loads.filter((_, i) => isNew(keys[i], time));
    },
    get size() {
      return seenAt.size;
    },
  };
}
