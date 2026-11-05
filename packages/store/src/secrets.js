// AI kalitlarini bazada shifrlab saqlash (AES-256-GCM).
// Shifrlash kaliti data/secret.key faylida — birinchi marta o'zi yaratiladi, gitga tushmaydi.
// Bu baza fayli (data/yuk.db) qo'lga tushsa ham kalitlar o'qilmasin degani; kompyuterning o'ziga kirgan odamdan himoya qilmaydi.
// secret.key o'chib ketsa, saqlangan kalitlarni qayta qo'shish kerak bo'ladi (bazadagilari o'qilmaydi).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SECRET_FILE = path.join(ROOT, "data", "secret.key");
const VERSION = "v1";

function decodeSecret(text, file) {
  const key = Buffer.from(String(text).trim(), "base64");
  if (key.length !== 32) throw new Error(`${file} buzilgan: 32 baytli kalit kutilgan`);
  return key;
}

// Bor bo'lsa o'qiydi, yo'q bo'lsa yaratadi. Bot va API bir vaqtda ochilsa ham bitta kalit chiqadi ("wx" — faqat yangi fayl).
export function loadSecret({ file = SECRET_FILE } = {}) {
  try {
    return decodeSecret(readFileSync(file, "utf8"), file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const key = randomBytes(32);
  try {
    writeFileSync(file, `${key.toString("base64")}\n`, { flag: "wx", mode: 0o600 });
    return key;
  } catch (error) {
    if (error.code === "EEXIST") return decodeSecret(readFileSync(file, "utf8"), file);
    throw error;
  }
}

// → "v1:<base64(iv 12 bayt | tag 16 bayt | shifrlangan matn)>"
export function encryptText(text, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}

// Kalit boshqa bo'lsa yoki matn o'zgartirilgan bo'lsa — xato
export function decryptText(blob, secret) {
  const [version, body] = String(blob).split(":");
  if (version !== VERSION || !body) throw new Error("Shifrlangan matn formati noma'lum");
  const raw = Buffer.from(body, "base64");
  const decipher = createDecipheriv("aes-256-gcm", secret, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

// Ekranda ko'rsatish uchun: "…a1B2" (kalitning o'zi hech qachon ko'rsatilmaydi)
export const keyHint = (key) => `…${String(key).trim().slice(-4)}`;
