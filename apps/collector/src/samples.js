// Telegram xabarlarini elonlar.txt formatiga keltiradi (e'lonlar orasida alohida qatorda ---).
import { splitPosts } from "@yuk/parser/posts";

export const SEPARATOR = "\n---\n";

// Matnni tozalaydi. Xabar ichidagi "---" qatorini almashtiradi, aks holda u e'lonni ikkiga bo'lib yuboradi.
export function cleanText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, "—")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Taqqoslash uchun kalit: bir xil e'lon bo'sh joy yoki katta-kichik harf bilan farq qilsa ham bitta deb hisoblanadi
const keyOf = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

// Yangi xabarlardan: qisqalarini tashlaydi, takrorlarini (fayldagilar bilan ham) olib tashlaydi.
export function selectNewPosts(texts, existingFileText = "", { minLength = 20 } = {}) {
  const seen = new Set(splitPosts(existingFileText).map(keyOf));
  const result = [];
  let short = 0;
  let duplicate = 0;

  for (const text of texts.map(cleanText)) {
    if (text.length < minLength) {
      short++;
      continue;
    }
    const key = keyOf(text);
    if (seen.has(key)) {
      duplicate++;
      continue;
    }
    seen.add(key);
    result.push(text);
  }
  return { posts: result, short, duplicate };
}

// Mavjud fayl matnining oxiriga yangi e'lonlarni qo'shadi
export function appendPosts(existingFileText, posts) {
  if (posts.length === 0) return existingFileText;
  const body = posts.join(SEPARATOR) + "\n";
  const existing = existingFileText.trimEnd();
  return existing ? existing + SEPARATOR + body : body;
}
