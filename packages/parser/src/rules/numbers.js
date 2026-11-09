// Qoidaviy parser: matndagi sonlar nimani bildiradi — og'irlik, hajm, palet, narx, uzunlik, soni, sana.
// Har bir topilgan narsa qator ichidagi o'rni (start, end) bilan qaytadi: o'sha joydagi so'zlar «tushunilgan» bo'ladi.
// Hech qaysi qoidaga tushmagan son qolsa, e'lon AI'ga beriladi (masalan, "3,8" — narxmi, og'irlikmi, aniq emas).

// Son: "21 600" (minglik bo'sh joy bilan), "22,5", "23.5", "25"
const N = String.raw`(\d{1,3}(?:[  ]\d{3})+(?![\d.,])|\d+(?:[.,]\d+)?)`;
const END = String.raw`(?![\p{L}'])`; // so'z shu yerda tugaydi: "5 t" — ha, "5 ta" — yo'q

export function toNumber(text) {
  return Number(String(text).replace(/[  ]/g, "").replace(",", "."));
}

const TONNE = String.raw`(?:tonnagacha|tonnaliq|tonnali|tonali|tonnalik|tonnaga|tonnadan|tonnasi|tonnani|tonna|tonnn|tonni|tonn|to'nna|to'na|tonalik|tona|ton|tn|t)`;
const RANGE = String.raw`(?:\s*(?:-|–|—|/|\\|yoki|ili|dan|do|gacha)\s*|\s+)`;
const TONNE_AFTER = new RegExp(String.raw`\d\s*\.?\s*${TONNE}${END}`, "u");

// Qoidalar tartibi muhim: avval narx (mln, ming, so'm), keyin og'irlik — "3 mln" og'irlik emas
const RULES = [
  // --- Narx ---
  {
    kind: "price",
    re: new RegExp(String.raw`${N}\s*(?:mln|million|milion|mlin|mil)\.?(?:\s*${N}\s*(?:ming|minng|min|mng|tis|k)?${END})?`, "gu"),
    value: (m) => {
      const extra = m[2] ? toNumber(m[2]) : 0;
      return { price: toNumber(m[1]) * 1e6 + (extra < 1000 ? extra * 1000 : extra), currency: "UZS", priceUnit: "reys" };
    },
  },
  // Kilosiga narx: "kilosiga 200 so'm", "kg 170somdn", "180 so'mdan" — ko'paytirilmaydi
  {
    kind: "price",
    re: new RegExp(String.raw`(?:kilosiga|kilogramiga|kgsi|kg)\s*[:=-]?\s*${N}\s*(?:so'm|som|sum|swm)?(?:dan|dn)?${END}`, "gu"),
    value: (m) => ({ price: toNumber(m[1]), currency: "UZS", priceUnit: "kg" }),
  },
  {
    kind: "price",
    re: new RegExp(String.raw`${N}\s*(?:so'm|som|sum)(?:dan|dn)${END}`, "gu"),
    value: (m) => ({ price: toNumber(m[1]), currency: "UZS", priceUnit: "kg" }),
  },
  {
    kind: "price",
    re: new RegExp(String.raw`${N}\s*(?:ming|minng|mng|tis|tisyach|tisach)${END}(?:\s*(?:so'm|som|sum)${END})?`, "gu"),
    value: (m) => ({ price: toNumber(m[1]) * 1000, currency: "UZS", priceUnit: "reys" }),
  },
  {
    kind: "price",
    re: new RegExp(String.raw`${N}\s*(?:so'm|som|sum|so'mga)${END}`, "gu"),
    // Reys narxi so'mda odatda mingda yoziladi: "3800 so'm" = 3 800 000 (AI qoidasi bilan bir xil)
    value: (m) => {
      const n = toNumber(m[1]);
      return { price: n < 100000 ? n * 1000 : n, currency: "UZS", priceUnit: "reys" };
    },
  },
  {
    kind: "price",
    re: new RegExp(String.raw`(?:\$\s*${N}|${N}\s*(?:\$|usd|dollar|dollor|doll|dol)${END})`, "gu"),
    value: (m) => ({ price: toNumber(m[1] ?? m[2]), currency: "USD", priceUnit: "reys" }),
  },

  // --- Og'irlik ---
  // "Ves: 23.5", "Og'irligi 22" (birliksiz): 60 dan kichik — tonna, 100 dan katta — kg
  {
    kind: "weight",
    re: new RegExp(String.raw`(?:ves|og'irligi|ogirligi|vazni|massa|tonnaj|tonnaji|tonaj)\s*[:=-]?\s*${N}(?:\s*[-/]\s*${N})?(?:\s*(?:${TONNE}|kg|kilo)${END})?`, "gu"),
    value: (m, text) => {
      const n = Math.max(toNumber(m[1]), m[2] ? toNumber(m[2]) : 0);
      const tail = text.slice(text.search(/\d/));
      if (/kg|kilo/.test(tail) || (n >= 100 && !TONNE_AFTER.test(tail))) return { weightT: n / 1000 };
      return n > 0 && n <= 60 ? { weightT: n } : null;
    },
  },
  // "20 tonna", "20-22 т", "20 22 тонна" (oraliq — kattasi), "22,5Т", "10.Тон."
  {
    kind: "weight",
    re: new RegExp(String.raw`${N}(?:${RANGE}${N})?\s*\.?\s*${TONNE}${END}`, "gu"),
    value: (m) => {
      const n = Math.max(toNumber(m[1]), m[2] ? toNumber(m[2]) : 0);
      return n > 0 && n <= 60 ? { weightT: n } : null;
    },
  },
  {
    kind: "weight",
    re: new RegExp(String.raw`${N}\s*(?:kg|kilogramm|kilo|kgdan|kgli)${END}`, "gu"),
    value: (m) => ({ weightT: toNumber(m[1]) / 1000 }),
  },

  // --- Hajm va palet ---
  {
    kind: "volume",
    re: new RegExp(String.raw`${N}(?:\s*[-/]\s*${N})*\s*\.?\s*(?:kubalik|kubali|kubli|kubik|kubov|kuba|kub|m3|m³|kubometr)${END}`, "gu"),
    value: (m) => {
      const all = m[0].match(/\d+(?:[.,]\d+)?/g).map(toNumber);
      return { volumeM3: Math.max(...all) };
    },
  },
  {
    kind: "pallets",
    re: new RegExp(String.raw`${N}\s*(?:ta\s*)?(?:paddon|poddon|podon|palet|pallet|paleta|palleta)[\p{L}']*`, "gu"),
    value: (m) => ({ pallets: Math.round(toNumber(m[1])) }),
  },

  // --- Izohga ketadigan sonlar (moslashga ta'sir qilmaydi) ---
  // Uzunlik, o'lcham: "12 metrlik", "80x1.30", "13.6 m"
  {
    kind: "size",
    re: new RegExp(String.raw`${N}(?:\s*[x×*х]\s*${N})+(?:\s*(?:m|metr|sm))?${END}|${N}\s*(?:metrlik|metrli|metr|metaril|metrovka|m|km|osey|os|gradus|klass|remney)(?![\p{L}'\d³])`, "gu"),
    value: () => ({}),
  },
  // Soni: "2 ta fura", "11 bosh qo'y", "3ta"
  {
    kind: "count",
    re: new RegExp(String.raw`${N}\s*(?:ta|tasi|tadan|dona|sht|shtuk|bosh)${END}`, "gu"),
    value: (m) => ({ count: Math.round(toNumber(m[1])) }),
  },
  // Sana va vaqt: "10.11", "10-noyabr", "8:00", "soat 9 da"
  {
    kind: "when",
    re: new RegExp(String.raw`\b\d{1,2}[./]\d{2}(?:[./]\d{2,4})?\b|\b\d{1,2}\s*-?\s*(?:noyabr|noya|dekabr|dek|oktyabr|yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentyabr)[\p{L}']*|\b\d{1,3}\s*(?:daqiqa|minut|soat|kun|chislo|chisla|sutka)[\p{L}']*|\b\d{1,2}:\d{2}\b|soat\s*\d{1,2}`, "gu"),
    value: (m) => ({ when: m[0] }),
  },
  // Foiz: "avans 50%"
  { kind: "size", re: /\d+\s*%/gu, value: () => ({}) },
];

// Qatordagi hamma son-qoidalar. → { facts: [{ kind, start, end, ...qiymat }], masked } —
// masked: topilgan joylari bo'sh joy bilan almashtirilgan qator (so'zlarni ajratishda ular qayta sanalmaydi)
export function readNumbers(line) {
  const facts = [];
  let masked = line;
  for (const rule of RULES) {
    for (const m of masked.matchAll(rule.re)) {
      const value = rule.value(m, m[0]);
      if (!value) continue;
      facts.push({ kind: rule.kind, start: m.index, end: m.index + m[0].length, text: m[0], ...value });
    }
    for (const fact of facts) masked = masked.slice(0, fact.start) + " ".repeat(fact.end - fact.start) + masked.slice(fact.end);
  }
  facts.sort((a, b) => a.start - b.start);
  return { facts, masked };
}
