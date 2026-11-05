// Bot va collector bir vaqtda faqat BITTA nusxada ishlashi kerak:
//   ikkinchi bot — Telegram "409 Conflict"; ikkinchi collector — bitta Telegram sessiyasi ikki joyda (sessiya bekor qilinishi mumkin).
// Har bir dastur ishga tushganda data/run/<nom>.json ga o'z PID'ini yozadi. Boshqaruv markazi ham shu fayldan
// dastur terminalda ishlayotganini biladi.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const RUN_DIR = path.join(ROOT, "data", "run");

export function isAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 — faqat tekshiradi, jarayonga tegmaydi
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// → { pid, startedAt, alive } yoki null
export function readRunLock(name, { dir = RUN_DIR } = {}) {
  try {
    const info = JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8"));
    return { ...info, alive: isAlive(info.pid) };
  } catch {
    return null;
  }
}

// Ishlayotgan boshqa nusxa bo'lsa — xato (code: "ALREADY_RUNNING"). → release() (dastur tugaganda o'zi chaqiriladi)
export function acquireRunLock(name, { dir = RUN_DIR } = {}) {
  const current = readRunLock(name, { dir });
  if (current?.alive && current.pid !== process.pid) {
    const since = new Date(current.startedAt).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
    const error = new Error(`${name} allaqachon ishlayapti (PID ${current.pid}, ${since} dan beri). Ikkinchi nusxani ochmang.`);
    error.code = "ALREADY_RUNNING";
    error.pid = current.pid;
    throw error;
  }
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  const release = () => {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid) unlinkSync(file);
    } catch {
      // fayl allaqachon yo'q
    }
  };
  process.once("exit", release);
  return release;
}
