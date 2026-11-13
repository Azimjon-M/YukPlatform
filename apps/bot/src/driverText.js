// Haydovchi «✍️ Shu chatga yozish» bilan ro'yxatdan o'tganda: u mashinasini oddiy matn bilan yozadi, biz uni AI'ga
// (yoki qoidaviy parserga) beramiz — parseLoad —, natijadagi mashina ma'lumotini (truckClass/bodyType/weightT) haydovchi
// PROFILIGA aylantiramiz. Yo'nalish bu yerda so'ralmaydi (u «📋 Mos yuklar» da tanlanadi) — faqat transport va xalqaro.
// Preview bilan tasdiqlanadi (bot.js), shuning uchun AI ozroq adashsa ham foydalanuvchi ko'rib tuzatadi.
import { sanitizeProfile } from "@yuk/shared";

// Matnda «xalqaro / qo'shni davlatlar / chet» belgilari bo'lsa — international (xomroq, lekin preview tasdiqlaydi).
// scope UZ-only bo'lsa, sanitizeProfile baribir international'ni o'chiradi.
const INTL_RE =
  /xalqaro|qo['’ʻ`]?shni|chet\s*el|xorij|chegaradan|qozog|qozoq|qirg'?iz|qirgiz|tojik|turkman|afg|rossiy|kazax|qazaq|казах|росси|междунар|киргиз|таджик|туркмен/i;

// parsed — parseLoad natijasi: { postType, loads: [{ truckClass, bodyType, weightT, loadingSides, ... }] } yoki null.
// rawText — foydalanuvchi yozgan matn (xalqaromi — shundan aniqlanadi). scope — yo'nalish doirasi (.env ROUTE_SCOPE).
// → { profile } (sanitizeProfile) yoki { error } (nima yetishmayotgani tushunarli matn bilan).
export function profileFromText(parsed, rawText, { scope } = {}) {
  const loads = Array.isArray(parsed?.loads) ? parsed.loads : [];
  // Mashina turi aytilgan birinchi yuk (bo'lmasa — birinchisi); hech biri — mashina tushunilmagan
  const load = loads.find((l) => l?.truckClass) ?? loads[0] ?? null;
  if (!load?.truckClass) {
    return {
      error:
        "Mashinangizni tushunmadim. Transport turini yozing — masalan: «Fura, tent, 20 tonna». " +
        "Yoki «🚚 Ro'yxatdan o'tish» formasidan to'ldiring.",
    };
  }
  const international = INTL_RE.test(String(rawText ?? ""));
  return sanitizeProfile(
    {
      vehicle: {
        truckClass: load.truckClass,
        bodyType: load.bodyType ?? null,
        // weightT — tonnada (parser); profil kg so'raydi. Aytilmasa NaN → sanitizeProfile «tonnani kiriting» deydi
        capacityKg: load.weightT != null ? Math.round(Number(load.weightT) * 1000) : NaN,
        loadingSides: Array.isArray(load.loadingSides) ? load.loadingSides : [],
      },
      domestic: true,
      international,
      fromAreas: [],
      toAreas: [],
    },
    { scope },
  );
}
