// Foydalanuvchining O'Z telefon raqami (ixtiyoriy). Bot profil saqlangach bir marta so'raydi:
// «📱 Raqam ulashish» (Telegram kontakt tugmasi) yoki «⏭ Keyinroq». Keyin — /raqam yoki ilovadagi Sozlamalar.
// Nima uchun: botni o'chirib qo'ysa ham u bilan bog'lanish, keyin ilovaga kirish, obuna va yordam.
// Raqam faqat boshqaruv markazida (localhost) ko'rinadi; yuk e'lonlariga va Mini App'dagi admin ro'yxatiga qo'shilmaydi.
// E'lonlardagi (begona) raqamlar — boshqa narsa: ular @yuk/parser phones.js da.

// Telegram kontaktidagi raqam: "998901234567", "+998 90 123-45-67" → "+998901234567". Noto'g'ri bo'lsa — null
export function normalizeContactPhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

// Ko'rsatish uchun: O'zbekiston raqami "+998 90 123 45 67", boshqa davlatniki — o'zgarishsiz
export function formatContactPhone(phone) {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone ?? "");
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : (phone ?? "");
}

// Kontakt yuborganning o'ziniki-mi. Telegram'da ilova menyusidan BIROVNING kontaktini ham yuborish mumkin —
// unda user_id boshqa (yoki umuman yo'q: telefon kitobidagi Telegram'siz kontakt). Faqat o'zinikini saqlaymiz.
export function isOwnContact(contact, fromId) {
  return contact?.user_id != null && fromId != null && Number(contact.user_id) === Number(fromId);
}

// Bot raqamni o'zi so'raydimi: sozlamalari saqlangan, raqami yo'q va hali hech so'ralmagan (faqat bir marta)
export function shouldAskPhone(user) {
  return Boolean(user?.profile) && !user.phone && !user.phoneAskedAt;
}
