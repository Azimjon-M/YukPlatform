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

// E'lonni guruhga yozgan odam (jo'natuvchi). Uning username'i bo'lsa, yuk xabarida «💬 Lichkasi» havolasi chiqadi:
// https://t.me/<username> — bosganda o'sha odam bilan shaxsiy chat ochiladi.
// Telegram username: harf bilan boshlanadi, lotin harf / raqam / «_», 4–32 belgi (4 talik — Fragment'da sotib olinganlar).
// "@Ali_99" → "Ali_99"; noto'g'ri yoki bo'sh → null (xabarga hech narsa qo'shilmaydi)
export function telegramUsername(value) {
  const name = String(value ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? name : null;
}

// Jo'natuvchining shaxsiy chati havolasi yoki null
export function senderLink(username) {
  const name = telegramUsername(username);
  return name ? `https://t.me/${name}` : null;
}
