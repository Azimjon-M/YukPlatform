// Bir so'rovda bir nechta e'lon (batch): so'rov matnini tuzish va javobni e'lonlarga qaytarib taqsimlash.
// Nega kerak: bepul Gemini'da so'rovlar soni cheklangan (daqiqasiga ~15 ta). 10 ta e'lon bitta so'rovda —
// 10 baravar kam so'rov, ko'rsatma (~5 600 token) ham har e'lon uchun emas, bir marta yuboriladi.
// Bu fayl AI'ni chaqirmaydi — faqat matn bilan ishlaydi, shuning uchun testlarda oson tekshiriladi.

export const batchHeader = (n) => `=== POST ${n} ===`;

// ["matn1", "matn2"] → "=== POST 1 ===\nmatn1\n\n=== POST 2 ===\nmatn2"
// Raqamlar 1 dan boshlanadi (modelga bazadagi id emas, oddiy tartib raqami ko'rsatiladi)
export function formatBatch(texts) {
  return texts.map((text, i) => `${batchHeader(i + 1)}\n${text.trim()}`).join("\n\n");
}

// AI javobini (JSON matn) e'lonlarga taqsimlaydi.
// → { items: [javob | null, ...] (count ta, e'lonlar tartibida), problem: null | "nima buzilgan" }
// Javob ishonchli bo'lmasa — HAMMA items null bo'ladi, ya'ni e'lonlar bittadan qayta tahlil qilinadi.
// Qattiq bo'lishimiz sababi: e'lon raqami adashsa, bir e'londagi yo'nalish boshqa e'londagi telefonga
// yopishib qoladi va haydovchi noto'g'ri odamga qo'ng'iroq qiladi. Bitta qo'shimcha so'rov bundan arzon.
export function readBatchAnswer(json, count) {
  const none = (problem) => ({ items: new Array(count).fill(null), problem });

  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return none("JSON o'qilmadi");
  }
  if (!Array.isArray(data?.posts)) return none("javobda posts ro'yxati yo'q");

  const items = new Array(count).fill(null);
  for (const item of data.posts) {
    const id = item?.id;
    if (!Number.isInteger(id) || id < 1 || id > count) return none(`noma'lum raqam: ${JSON.stringify(id)}`);
    if (items[id - 1]) return none(`${id}-e'lon ikki marta qaytdi`);
    if (typeof item.postType !== "string" || !Array.isArray(item.loads)) return none(`${id}-e'lon javobi to'liq emas`);
    items[id - 1] = item;
  }
  const missing = items.flatMap((item, i) => (item ? [] : [i + 1]));
  if (missing.length) return none(`javobda yo'q: ${missing.join(", ")}-e'lon`);
  return { items, problem: null };
}
