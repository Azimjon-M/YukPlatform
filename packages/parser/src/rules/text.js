// Qoidaviy parser (AI'siz) uchun matn bilan ishlash: kiril → lotin, so'z kaliti, so'zlarga bo'lish, o'xshashlik.
// E'lonlar lotin, kiril yoki aralash yoziladi ("Тошкентдан Samarqandga"), shuning uchun avval hammasi
// bitta ko'rinishga keltiriladi: kichik harf, lotin, apostrof bitta xil (').

// O'zbek kirili + rus + qozoq/qirg'iz harflari. "е" alohida: so'z boshida va unlidan keyin "ye" (Ереван, Янгиер)
const CYRILLIC = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "'", ы: "i",
  ь: "", э: "e", ю: "yu", я: "ya", ў: "o'", қ: "q", ғ: "g'", ҳ: "h", ә: "a", ө: "o", ү: "u", ұ: "u", ң: "n", і: "i",
  ї: "i", є: "ye", һ: "h",
};
// Turk, turkman, ozarbayjon harflari (e'lonlarda uchraydi: "Şaxrizab", "araç")
// + «o'» va «g'» ning telefon klaviaturasidagi ko'rinishlari: "Qôqon", "qòqon", "Qœqon", "ĝijduvon", "tőnna"
const LATIN = {
  ş: "sh", ç: "ch", ı: "i", ğ: "g'", ö: "o", ü: "u", ä: "a", ñ: "n", ý: "y", ž: "j", é: "e",
  ô: "o'", ò: "o'", ó: "o'", õ: "o'", œ: "o'", ő: "o'", ō: "o'", ĝ: "g'", ǵ: "g'", ġ: "g'",
};
const VOWELS = new Set([..."aeiouаеёиоуыэюяўәөүұі"]);
// Apostrofning hamma turi: ʻ ʼ ’ ‘ ` ´ → '
const APOSTROPHES = /[ʻʼ’‘`´]/g;

// "Тошкентдан" → "toshkentdan", "QOʻQON" → "qo'qon"
export function toLatin(text) {
  const lower = String(text).toLowerCase().replace(APOSTROPHES, "'");
  let out = "";
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (ch === "е") {
      const prev = lower[i - 1];
      out += !prev || !/\p{L}/u.test(prev) || VOWELS.has(prev) || prev === "ъ" || prev === "ь" ? "ye" : "e";
      continue;
    }
    out += CYRILLIC[ch] ?? LATIN[ch] ?? ch;
  }
  return out;
}

// So'z kaliti — imlo farqlari yo'qoladi: apostrof, q/k, x/h, w/v, dj/j, qo'sh harf, unlilar orasidagi y.
// "Qo'qon" = "Кукон"? yo'q (o/u farqi qoladi), lekin "Qo'qon" = "Qoqon" = "Коқон", "Jizzax" = "Жиззах" = "Jizax".
// Bu kalit faqat solishtirish uchun, ekranga chiqmaydi.
export function wordKey(word) {
  return toLatin(word)
    .replace(/'/g, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/q/g, "k")
    .replace(/x/g, "h")
    .replace(/w/g, "sh") // telefon yozuvida w = sh: "Towkent", "Riwton", "qarwi" (2026-11-19; ilgari v edi)
    .replace(/dj/g, "j")
    .replace(/([aeiou])y(?=[aeiou])/g, "$1")
    .replace(/(.)\1+/g, "$1");
}

// Bitta qatorni (toLatin dan o'tgan) bo'laklarga ajratadi. Bo'lak: so'z, son, ajratuvchi (- → / =) yoki [telefon].
// → [{ type: "word"|"num"|"sep"|"phone", text, start, end }] — start/end: qator ichidagi o'rni
const TOKEN_RE = /\[telefon\]|\d+(?:[.,]\d+)?|[\p{L}']+|->|=>|[-–—→➡⇒➜➔➝➞⟶=/|()>]/gu;
export function tokenizeLine(line) {
  const tokens = [];
  for (const match of line.matchAll(TOKEN_RE)) {
    const raw = match[0];
    let type = "word";
    if (raw === "[telefon]") type = "phone";
    else if (/^\d/.test(raw)) type = "num";
    else if (!/\p{L}/u.test(raw)) type = "sep";
    let text = raw;
    let start = match.index;
    if (type === "word") {
      // So'z chetidagi apostrof ("'Toshkent'") — tirnoq, so'zning qismi emas
      const lead = raw.match(/^'*/)[0].length;
      text = raw.replace(/^'+|'+$/g, "");
      start += lead;
      if (!text) continue;
    }
    tokens.push({ type, text, start, end: start + text.length });
  }
  return tokens;
}

// Ikki so'z orasidagi farq: nechta harfni qo'shish / o'chirish / almashtirish / yonma-yon ikkitasini almashtirish kerak
// (Damerau-Levenshtein). "adijon" → "andijon" = 1, "toshkent" → "tashkent" = 1.
// max dan oshsa — max + 1 (hisobni erta to'xtatadi)
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

// Qancha xatoga ruxsat: qisqa so'zda — hech qancha (Pop, Juma, Uzun — oddiy so'zlarga o'xshaydi),
// 6–8 harfda — 1 ta, 9 va undan uzunida — 2 ta
export function allowedTypos(key) {
  if (key.length >= 9) return 2;
  if (key.length >= 6) return 1;
  return 0;
}
