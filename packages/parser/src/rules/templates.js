// Avto-joylash xizmatlarining shablonlari (2026-11-09). GLogistics, Logistik.uz va ba'zi kanal botlari bitta e'lonni
// o'z shablonida 50+ guruhga tarqatadi: tepada sarlavha, «Qayerdan: / Qayerga:» yorliqlari, pastda reklama.
// Reklama so'zlari ("guruhlarga", "joyga", "qayerdan") qoidaviy parserga noma'lum joy bo'lib ko'rinardi va bunday
// e'lonlarning hammasi AI'ga ketardi (bir kunda minglab). Bu yerda:
//   1) reklama qatorlari olib tashlanadi (yuk ma'lumoti emas);
//   2) yorliqli qatorga yo'nalish «maslahati» beriladi: "Qayerdan: X" — X qayerdan, "Qayerga: Y" — Y qayerga,
//      "Yuk turi: Z" — Z yuk nomi;
//   3) kanal botining qisqa sarlavhasi ("🅰️ Samarqand → 🅱️ Koson") olib tashlanadi — asl matn pastda turibdi,
//      sarlavha ikkinchi yuk bo'lib ko'rinmasin.
// Qolganini odatdagi qoidalar o'qiydi. Matn toLatin dan o'tgan bo'ladi (kichik harf, lotin, apostrof bitta xil ').

// Qator boshidagi emoji, belgi va bo'sh joylarsiz: "📍 qayerdan: 🇺🇿 xorazm" → "qayerdan: 🇺🇿 xorazm".
// Faqat lotin harfi qoldiriladi: "ℹ️" (U+2139) Unicode'da harf hisoblanadi, lekin bu yerda belgi
const bare = (line) => line.replace(/^[^a-z0-9#@]+/u, "").trim();

// Reklama qatorlari — qaysi guruhda bo'lmasin, yuk haqida hech narsa demaydi
export const AD_LINES = [
  /^batafsil ma'lumot va bog'lanish/, // GLogistics: "ℹ️ Batafsil ma'lumot va bog'lanish:"
  /glogistics\.xyz/, // "👉 https://glogistics.xyz/uz/cargo/…"
  /^aloqa: bog'lanish/, // Logistik.uz: "📞 Aloqa: Bog'lanish / Связаться" (raqam havolada, matnda yo'q)
  /^ilovani yuklab olish/,
  /^vaqtingizni tejang/,
  /^logistik\.uz'?da e'?lon joylang/,
  /guruhlarga avtomatik (?:tashlaydi|tarqatamiz)/,
  /^kanalga qo'shilish/, // kanal boti: "📢 Kanalga qo`shilish: @…"
  /^kuchli qidiruv/,
  /^filtrlangan e'lonlar/,
  /orqali joylashtirildi$/,
];
// Shu qatordan e'lon oxirigacha — reklama bloki ("⚡️ YUKBOR & GLOGISTICS — TEZKOR LOGISTIKA" va ostidagi havolalar)
export const AD_TAIL = [/^yukbor & glogistics/];

// Yorliqlar: qator boshidagi "Qayerdan:", "Откуда:" ... → shu qatordagi joylar qaysi tomon
const LABELS = [
  [/^(?:qayerdan|qaerdan|qayerdam|otkuda|yuklash joyi|yuklanish joyi|yuklash manzili)\s*:/, "from"],
  [/^(?:qayerga|qaerga|kuda|tushirish joyi|tushirish manzili)\s*:/, "to"],
  [/^(?:yuk turi|yuk nomi)\s*:/, "cargo"],
];

// Faqat heshteglardan iborat qator ("#samarqand #самарканд #qarshi #fura #yukbor") — kanal boti qo'shadi, asl matndagi
// joylarni takrorlaydi va ortiqcha joy nomlari yo'nalishni chalkashtiradi
const HASHTAGS_ONLY = /^(?:#[\p{L}\p{N}_']+[\s,.]*)+$/u;
// Shablon raqami: "#ID3CF23F", "#id44dad7"
const TEMPLATE_ID = /#id[0-9a-f]{4,}\b/g;

// Kanal botining sarlavhasi: "🅰️ samarqand → 🅱️ koson"
const isAbHeader = (line) => /🅰/u.test(line) && /🅱/u.test(line);

// → [{ text, hint }] — har qator uchun (olib tashlangani bo'sh qator bo'lib qoladi, qatorlar soni o'zgarmaydi).
// hint: "from" | "to" | "cargo" | null
export function cleanTemplates(latin) {
  const lines = latin.split(/\r?\n/);
  const out = lines.map((text) => ({ text, hint: null }));
  const drop = (i) => {
    out[i] = { text: "", hint: null };
  };
  const abHeader = lines.findIndex(isAbHeader);
  for (let i = 0; i < lines.length; i++) {
    const line = bare(lines[i]);
    if (AD_TAIL.some((re) => re.test(line))) {
      for (let k = i; k < lines.length; k++) drop(k);
      break;
    }
    if (AD_LINES.some((re) => re.test(line)) || HASHTAGS_ONLY.test(line)) {
      drop(i);
      continue;
    }
    let text = lines[i].replace(TEMPLATE_ID, " ");
    for (const [re, hint] of LABELS) {
      const m = line.match(re);
      if (!m) continue;
      // Yorliq so'zlari ("qayerdan") noma'lum joy bo'lib qolmasin — olib tashlanadi
      text = line.slice(m[0].length);
      out[i] = { text, hint };
      break;
    }
    if (!out[i].hint) out[i] = { text, hint: null };
  }
  if (abHeader >= 0) {
    drop(abHeader);
    // Sarlavhadan keyingi "🚛 fura" / "🚛 chakman" — botning qisqa mashina qatori (asl matnda ham bor)
    const next = abHeader + 1;
    if (next < lines.length && /^\s*🚛/u.test(lines[next]) && bare(lines[next]).split(/\s+/).length <= 3) drop(next);
    // "✍️ Ism Familiya" / "✍️ @user" — e'lon muallifi, yuk ma'lumoti emas
    for (let i = 0; i < lines.length; i++) if (/^\s*✍/u.test(lines[i])) drop(i);
  }
  return out;
}
