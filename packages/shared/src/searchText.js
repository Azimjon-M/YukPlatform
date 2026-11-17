// Qidiruv uchun matnni bitta ko'rinishga keltirish (2026-11-16, Azimjon: «kril alfbosi bilan muammo bo'lmasligiga ishonch
// hosil qil»). E'lonlar lotin, kirill yoki aralash yoziladi; qidiruv ham. SQLite'ning LIKE'i katta-kichik harfni faqat
// lotinda farqlamaydi («тошкент» «Тошкент» ni topmasdi), lotin so'z kirillcha e'lonni umuman topmasdi.
// foldText: kichik harf → kirill lotinga → apostrof (o', g', ʻ, ’ …) tashlanadi.
//   «Тошкентдан» → «toshkentdan», «ҚЎҚОН» → «qoqon», «Qoʻqon» → «qoqon», «Farg'ona» → «fargona»
// Faqat solishtirish uchun — ekranga chiqmaydi (@yuk/parser rules/text.js toLatin bilan bir xil harflar).
const CYRILLIC = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i",
  ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h", ә: "a", ө: "o", ү: "u", ұ: "u", ң: "n", і: "i",
  ї: "i", є: "ye", һ: "h",
};
const APOSTROPHES = /['ʻʼ’‘`´]/g;

export function foldText(text) {
  const lower = String(text ?? "").toLowerCase();
  let out = "";
  for (const ch of lower) out += CYRILLIC[ch] ?? ch;
  return out.replace(APOSTROPHES, "");
}
