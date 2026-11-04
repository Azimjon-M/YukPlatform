// Yuk turlari. Platforma boshidan hammasini biladi, lekin ish faqat "fura" bilan boshlanadi.
export const CATEGORIES = [
  { id: "fura", name: "Fura", hint: "og'ir yuk mashinalari, taxminan 10 tonnadan ortiq" },
  { id: "yengil", name: "Yengil yuk", hint: "Isuzu, Labo, Damas, Gazel, Porter — 10 tonnagacha" },
  { id: "pochta", name: "Pochta", hint: "posilka yoki kichik narsani taksi/avtobusda jo'natish" },
  { id: "yolovchi", name: "Yo'lovchi", hint: "shaharlararo taksi, odam tashish" },
];

// E'lon turi: yuk egasi mashina qidiryaptimi yoki haydovchi yuk qidiryaptimi
export const POST_TYPES = [
  { id: "yuk_bor", name: "Yuk bor, mashina kerak" },
  { id: "mashina_bor", name: "Mashina bo'sh, yuk kerak" },
  { id: "boshqa", name: "Boshqa (reklama, savol, suhbat)" },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const POST_TYPE_IDS = POST_TYPES.map((p) => p.id);
