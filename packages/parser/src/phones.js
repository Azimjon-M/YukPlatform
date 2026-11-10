// Telefon raqamlarini matndan ajratib, bitta ko'rinishga keltiradi: +998901234567
// Bu yerda AI ishlatilmaydi: regex tez, bepul va raqamni "o'ylab topmaydi".

// 998 dan keyingi 2 ta raqam: mobil operatorlar + Toshkent shahar (71) va viloyati (70).
// 87 va 70 haqiqiy yuk e'lonlarida "+998 87 ..." / "+998 70 ..." ko'rinishida uchradi (2026-11).
const UZ_CODES = new Set(["20", "33", "50", "55", "70", "71", "77", "87", "88", "90", "91", "93", "94", "95", "97", "98", "99"]);

// "Bo'lak" — raqamlar va ular orasidagi bo'sh joy, chiziqcha, qavs, nuqta.
// Yangi qator (\n) kirmaydi, aks holda har xil qatordagi sonlar qo'shilib ketadi.
const CHUNK_RE = /\+?\d[\d \t \-().]*\d/g;

// Raqamlar qatori to'liq telefon bo'lsa, uni +... ko'rinishida qaytaradi, aks holda null.
function toPhone(d) {
  let phone = null;
  if (d.length === 12 && d.startsWith("998")) phone = "+" + d; // 998 90 123 45 67
  // Qo'shnilar: 992 Tojikiston, 993 Turkmaniston, 994 Ozarbayjon, 995 Gruziya, 996 Qirg'iziston
  else if (d.length === 12 && /^99[2-6]/.test(d)) phone = "+" + d;
  else if (d.length === 11 && /^[78]/.test(d)) phone = "+7" + d.slice(1); // Rossiya / Qozog'iston
  else if (d.length === 10 && d[0] === "8" && UZ_CODES.has(d.slice(1, 3))) phone = "+998" + d.slice(1); // eski: 8 90 ...
  else if (d.length === 9 && UZ_CODES.has(d.slice(0, 2))) phone = "+998" + d; // 90 123 45 67

  // "900 000 000" telefonga o'xshaydi, lekin bu narx
  if (phone && /0{6}$/.test(phone)) return null;
  return phone;
}

// Bitta bo'lak ichidan telefonlarni topadi. O'ngdan chapga qarab qidiradi,
// chunki raqam oldiga ko'pincha boshqa son yopishadi: "20 90 123 45 67" (20 — tonna).
// Natija: [{ phone, from, to }] — from/to raqamning bo'lak ichidagi o'rni (maskPhones uchun).
function phonesInChunk(chunk) {
  const groups = [...chunk.matchAll(/\d+/g)].map((m) => ({ digits: m[0], from: m.index, to: m.index + m[0].length }));
  const found = [];
  let end = groups.length - 1;

  while (end >= 0) {
    let best = null;
    let bestStart = end;
    let digits = "";
    for (let start = end; start >= 0; start--) {
      digits = groups[start].digits + digits;
      if (digits.length > 12) break;
      const phone = toPhone(digits);
      if (phone) {
        best = phone; // eng uzun mos keladigani olinadi: "+998 90..." > "90..."
        bestStart = start;
      }
    }
    if (best) {
      found.unshift({ phone: best, from: groups[bestStart].from, to: groups[end].to });
      end = bestStart - 1;
    } else {
      end--;
    }
  }
  return found;
}

export function extractPhones(text) {
  const result = [];
  for (const match of text.matchAll(CHUNK_RE)) {
    for (const { phone } of phonesInChunk(match[0])) {
      if (!result.includes(phone)) result.push(phone);
    }
  }
  return result;
}

// E'londa aloqa bormi: matnda telefon raqami yoki e'lonni yozgan odamning username'i (sender — «💬 Lichkasi»).
// Ikkalasi ham yo'q yuk bilan haydovchi hech narsa qila olmaydi: bot bunday e'lonni AI'ga ham, haydovchiga ham
// yubormaydi (Azimjon, 2026-11-10: «Aloqasiz yuklarni to'xtat»). Telefon raqami har doim regex bilan olinadi
// (AI'dan emas), shuning uchun buni AI'dan OLDIN bilsa bo'ladi.
export function hasContact({ text, sender } = {}) {
  return Boolean(sender) || extractPhones(text ?? "").length > 0;
}

// Matndagi telefon raqamlarini "[telefon]" bilan almashtiradi; qolgan sonlar (tonna, narx) joyida qoladi.
// AI'ga yuborishdan oldin ishlatiladi: raqamlar regex bilan allaqachon olingan, AI'ga kerak emas,
// begona odamlarning raqamlari esa tashqi xizmatga chiqmaydi (bepul Gemini'da Google matnlarni o'qishi mumkin).
export function maskPhones(text, placeholder = "[telefon]") {
  return text.replace(CHUNK_RE, (chunk) => {
    let out = "";
    let last = 0;
    for (const { from, to } of phonesInChunk(chunk)) {
      const start = chunk[from - 1] === "+" ? from - 1 : from; // "+998" dagi "+" ham ketadi
      out += chunk.slice(last, start) + placeholder;
      last = to;
    }
    return out + chunk.slice(last);
  });
}
