// Bot va collector bir vaqtda faqat BITTA nusxada ishlashi kerak:
//   ikkinchi bot — Telegram "409 Conflict"; ikkinchi collector — bitta Telegram sessiyasi ikki joyda (sessiya bekor qilinishi mumkin).
// Har bir dastur ishga tushganda data/run/<nom>.json ga o'z PID'ini yozadi. Boshqaruv markazi ham shu fayldan
// dastur terminalda ishlayotganini biladi.
//
// Yurak urishi (2026-11-09): faqat PID ga ishonib bo'lmaydi. Dastur majburan o'ldirilsa (oyna yopildi, 8 s da
// to'xtamadi) fayl qolib ketadi, Windows esa o'sha PID raqamini tezda BOSHQA jarayonga beradi. 09.11 da shunday
// bo'ldi: eski botning PID'i (6200) `npm start` ning o'ziga tushdi, boshqaruv markazi «bot terminalda ishlayapti»
// deb o'yladi va botni yoqmadi. Endi egasi har BEAT_MS da fayl vaqtini (mtime) yangilaydi; PID tirik bo'lsa ham,
// fayl 4 urish (40 s) davomida yangilanmagan bo'lsa — egasi o'lgan, PID esa boshqa jarayonniki.
import { mkdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const RUN_DIR = path.join(ROOT, "data", "run");
export const BEAT_MS = 10_000;
const STALE_BEATS = 4;

export function isAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 — faqat tekshiradi, jarayonga tegmaydi
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

const lockFile = (dir, name) => path.join(dir, `${name}.json`);

// → { pid, startedAt, beatMs, beatAt, alive, stale } yoki null
//   alive — egasi haqiqatan ishlayapti; stale — PID band, lekin fayl yangilanmayapti (PID boshqa jarayonga o'tgan)
export function readRunLock(name, { dir = RUN_DIR, now = Date.now() } = {}) {
  const file = lockFile(dir, name);
  try {
    const info = JSON.parse(readFileSync(file, "utf8"));
    const pidAlive = isAlive(info.pid);
    // Yurak urishisiz eski fayl (shu o'zgarishdan oldin ishga tushgan jarayon) — avvalgidek faqat PID bo'yicha
    if (!info.beatMs) return { ...info, alive: pidAlive, stale: false };
    const beatAt = statSync(file).mtimeMs;
    const fresh = now - beatAt < info.beatMs * STALE_BEATS;
    return { ...info, beatAt, alive: pidAlive && fresh, stale: pidAlive && !fresh };
  } catch {
    return null;
  }
}

// Faylni faqat u shu PID niki bo'lsa o'chiradi (boshqa nusxaning faylini bexosdan o'chirmaslik uchun).
// Boshqaruv markazi ham ishlatadi: o'z bolasini majburan to'xtatganda u o'zi o'chira olmaydi.
export function removeRunLock(name, { dir = RUN_DIR, pid = process.pid } = {}) {
  const file = lockFile(dir, name);
  try {
    if (JSON.parse(readFileSync(file, "utf8")).pid === pid) unlinkSync(file);
  } catch {
    // fayl allaqachon yo'q
  }
}

// Ishlayotgan boshqa nusxa bo'lsa — xato (code: "ALREADY_RUNNING"). → release() (dastur tugaganda o'zi chaqiriladi)
export function acquireRunLock(name, { dir = RUN_DIR, beatMs = BEAT_MS } = {}) {
  const current = readRunLock(name, { dir });
  if (current?.alive && current.pid !== process.pid) {
    const since = new Date(current.startedAt).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
    const error = new Error(`${name} allaqachon ishlayapti (PID ${current.pid}, ${since} dan beri). Ikkinchi nusxani ochmang.`);
    error.code = "ALREADY_RUNNING";
    error.pid = current.pid;
    throw error;
  }
  mkdirSync(dir, { recursive: true });
  const file = lockFile(dir, name);
  const content = JSON.stringify({ pid: process.pid, startedAt: Date.now(), beatMs });
  writeFileSync(file, content);
  // Yurak urishi: faqat fayl vaqti o'zgaradi (mazmuni emas) — o'qiyotgan jarayon hech qachon yarim yozilgan faylni ko'rmaydi
  const beat = setInterval(() => {
    try {
      const time = new Date();
      utimesSync(file, time, time);
    } catch {
      // kimdir faylni o'chirib qo'ygan — biz hali ishlayapmiz, qayta yozamiz
      try {
        writeFileSync(file, content);
      } catch {
        // papka ham yo'q — keyingi urishda yana urinamiz
      }
    }
  }, beatMs);
  beat.unref(); // dastur faqat shu taymer uchun ochiq qolib ketmasin
  const release = () => {
    clearInterval(beat);
    removeRunLock(name, { dir });
  };
  process.once("exit", release);
  return release;
}
