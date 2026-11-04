// Telefon raqamlarini matndan ajratib, bitta ko'rinishga keltiradi: +998901234567
// Bu yerda AI ishlatilmaydi: regex tez, bepul va raqamni "o'ylab topmaydi".

// 998 dan keyingi 2 ta raqam: mobil operatorlar + Toshkent shahar raqami (71)
const UZ_CODES = new Set(["20", "33", "50", "55", "71", "77", "88", "90", "91", "93", "94", "95", "97", "98", "99"]);

// "Bo'lak" — raqamlar va ular orasidagi bo'sh joy, chiziqcha, qavs, nuqta.
// Yangi qator (\n) kirmaydi, aks holda har xil qatordagi sonlar qo'shilib ketadi.
const CHUNK_RE = /\+?\d[\d \t \-().]*\d/g;

// Raqamlar qatori to'liq telefon bo'lsa, uni +... ko'rinishida qaytaradi, aks holda null.
function toPhone(d) {
  let phone = null;
  if (d.length === 12 && d.startsWith("998")) phone = "+" + d; // 998 90 123 45 67
  else if (d.length === 11 && /^[78]/.test(d)) phone = "+7" + d.slice(1); // Rossiya / Qozog'iston
  else if (d.length === 10 && d[0] === "8" && UZ_CODES.has(d.slice(1, 3))) phone = "+998" + d.slice(1); // eski: 8 90 ...
  else if (d.length === 9 && UZ_CODES.has(d.slice(0, 2))) phone = "+998" + d; // 90 123 45 67

  // "900 000 000" telefonga o'xshaydi, lekin bu narx
  if (phone && /0{6}$/.test(phone)) return null;
  return phone;
}

// Bitta bo'lak ichidan telefonlarni topadi. O'ngdan chapga qarab qidiradi,
// chunki raqam oldiga ko'pincha boshqa son yopishadi: "20 90 123 45 67" (20 — tonna).
function phonesInChunk(chunk) {
  const groups = chunk.split(/\D+/).filter(Boolean);
  const found = [];
  let end = groups.length - 1;

  while (end >= 0) {
    let best = null;
    let bestStart = end;
    let digits = "";
    for (let start = end; start >= 0; start--) {
      digits = groups[start] + digits;
      if (digits.length > 12) break;
      const phone = toPhone(digits);
      if (phone) {
        best = phone; // eng uzun mos keladigani olinadi: "+998 90..." > "90..."
        bestStart = start;
      }
    }
    if (best) {
      found.unshift(best);
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
    for (const phone of phonesInChunk(match[0])) {
      if (!result.includes(phone)) result.push(phone);
    }
  }
  return result;
}
