// Yuk turlari. Platforma boshidan hammasini biladi, lekin ish faqat "fura" bilan boshlanadi.
// fura = fura va mini fura sinfi (8 t dan ortiq), yengil = Isuzu, Kia, Porter, Gazel, Labo, Damas.
export const CATEGORIES = [
  { id: "fura", name: "Fura", hint: "fura yoki mini fura kerak bo'lgan yuk, taxminan 10 tonnadan ortiq (8 t dan kam yukka fura chaqirilmaydi)" },
  { id: "yengil", name: "Yengil yuk", hint: "Isuzu, Kia, Porter, Gazel, Labo, Damas — 10 tonnagacha" },
  { id: "pochta", name: "Pochta", hint: "posilka yoki kichik narsani taksi/avtobusda jo'natish" },
  { id: "yolovchi", name: "Yo'lovchi", hint: "shaharlararo taksi, odam tashish" },
];

// E'lon turi: yuk egasi mashina qidiryaptimi yoki haydovchi yuk qidiryaptimi
export const POST_TYPES = [
  { id: "yuk_bor", name: "Yuk bor, mashina kerak" },
  { id: "mashina_bor", name: "Mashina bo'sh, yuk kerak" },
  { id: "boshqa", name: "Boshqa (reklama, savol, suhbat)" },
];

// Narx nimaga yozilgan: butun reysgami yoki kilosiga, tonnasiga, kubiga
export const PRICE_UNITS = [
  { id: "reys", name: "Reysiga (jami)" },
  { id: "tonna", name: "Tonnasiga" },
  { id: "kg", name: "Kilosiga" },
  { id: "kub", name: "Kubiga (m³)" },
];

// To'lov turi. Zavod yuki odatda o'tkazma (perechisleniye), shaxsiy yuk naqd.
export const PAYMENT_TYPES = [
  { id: "naqd", name: "Naqd", words: ["naqd", "нал", "наличка", "наличные", "qo'lga"] },
  { id: "karta", name: "Kartaga", words: ["kartaga", "на карту", "карта"] },
  { id: "otkazma", name: "O'tkazma (perechisleniye)", words: ["perechisleniye", "перечисление", "безнал", "с НДС", "bank orqali", "hisob raqamga"] },
];

export const CURRENCIES = ["UZS", "USD", "RUB", "KZT"];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const POST_TYPE_IDS = POST_TYPES.map((p) => p.id);
export const PRICE_UNIT_IDS = PRICE_UNITS.map((u) => u.id);
export const PAYMENT_TYPE_IDS = PAYMENT_TYPES.map((p) => p.id);
