// Brauzerdagi xatolar jurnali: API so'rovi xatolari (api.js), sahifa yiqilishi (ErrorBoundary), ushlanmagan
// xatolar (window "error" / "unhandledrejection") va qizil xabarchalar («✖ …»). localStorage'da — sahifa
// yangilansa ham qoladi (faqat shu brauzerda). Server tomonidagi xatolar — /api/errors (apps/api errorLog.js).
import { useSyncExternalStore } from "react";
import { entryFromError, ignoreIn, recordInto, removeFrom, unignoreIn } from "./errorInfo.js";

const STORAGE_KEY = "yuk-admin-errors";
const SEEN_KEY = "yuk-admin-errors-seen";
const IGNORED_KEY = "yuk-admin-errors-ignored"; // «E'tiborsiz qoldirish» qoidalari (errorInfo.js ignoreIn)
const DUPLICATE_MS = 3000; // xabarcha matni shuncha vaqt ichida yozilgan xato bilan bir xil — qayta yozilmaydi

// localStorage yopiq bo'lishi mumkin (maxfiy oyna, sozlama) — unda faqat xotirada
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // to'lgan yoki yopiq — xotirada qoladi
  }
}

// Hozirgi sahifa manzili (testlarda — Node'da window yo'q)
const currentPage = () => (typeof window === "undefined" ? null : window.location.pathname);

let journal = read(STORAGE_KEY, []);
let ignored = read(IGNORED_KEY, []);
let seenAt = read(SEEN_KEY, 0);
const listeners = new Set();
const uncaughtListeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

function subscribe(fn) {
  listeners.add(fn);
  // Boshqa oynada (ikkinchi tab) yozilsa ham yangilansin
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY) journal = read(STORAGE_KEY, []);
    if (event.key === IGNORED_KEY) ignored = read(IGNORED_KEY, []);
    if (event.key === SEEN_KEY) seenAt = read(SEEN_KEY, 0);
    if ([STORAGE_KEY, IGNORED_KEY, SEEN_KEY].includes(event.key)) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

// Jurnal va qoidalarni almashtirish (errorInfo.js funksiyalari yangi holat qaytaradi) — o'zgarganini yozadi
function update(next) {
  if (next.journal !== journal) write(STORAGE_KEY, next.journal);
  if (next.ignored !== ignored) write(IGNORED_KEY, next.ignored);
  journal = next.journal;
  ignored = next.ignored;
  emit();
}

const save = (entry) => update(recordInto({ journal, ignored }, entry));

// Xatoni jurnalga yozish. options: { kind, page, componentStack } (errorInfo.js entryFromError)
export function recordError(error, options = {}) {
  if (error && typeof error === "object") {
    if (error.__recorded) return;
    try {
      Object.defineProperty(error, "__recorded", { value: true }); // bir xato ikki joyda ushlansa — bir marta
    } catch {
      // muzlatilgan obyekt — mayli
    }
  }
  save(entryFromError(error, { page: currentPage(), ...options }));
}

// Qizil xabarcha matni (ui.jsx ToastProvider): API xatosi bo'lsa u allaqachon yozilgan — takrorlamaymiz
export function recordMessage(text) {
  const now = Date.now();
  if (journal.some((e) => e.text === text && now - e.last < DUPLICATE_MS)) return;
  save({ source: "browser", level: "error", kind: "action", text, where: currentPage(), details: null, first: now, last: now, count: 1 });
}

// «Tozalash» — jurnal bo'shaydi, «e'tiborsiz» qoidalari qoladi
export const clearLocalErrors = () => update({ journal: [], ignored });

// «O'chirish» (xato yana chiqsa — qaytadi), «E'tiborsiz qoldirish» (boshqa ko'rsatilmaydi), «Qaytarish»
export const removeLocalError = (id) => update(removeFrom({ journal, ignored }, id));
export const ignoreLocalError = (id) => update(ignoreIn({ journal, ignored }, id));
export const unignoreLocalError = (key) => update(unignoreIn({ journal, ignored }, key));

// «Xatolar» bo'limi ochilganda: shu paytgacha bo'lganlar «ko'rilgan» (yon paneldagi son nolga tushadi)
export function markErrorsSeen(at = Date.now()) {
  seenAt = at;
  write(SEEN_KEY, seenAt);
  emit();
}

export const useLocalErrors = () => useSyncExternalStore(subscribe, () => journal);
export const useIgnoredLocal = () => useSyncExternalStore(subscribe, () => ignored);
export const useErrorsSeenAt = () => useSyncExternalStore(subscribe, () => seenAt);

// Ushlanmagan xato chiqqanda (App xabarcha ko'rsatadi)
export function onUncaughtError(fn) {
  uncaughtListeners.add(fn);
  return () => uncaughtListeners.delete(fn);
}

// main.jsx bir marta chaqiradi: React'dan tashqaridagi xatolar (tugma bosilganda, setTimeout, Promise)
export function installGlobalHandlers() {
  const uncaught = (error) => {
    if (error && typeof error === "object" && error.__recorded) return; // api.js allaqachon yozgan
    recordError(error, { kind: error?.kind && error.method ? error.kind : "js" });
    uncaughtListeners.forEach((fn) => fn(error));
  };
  window.addEventListener("error", (event) => {
    // Rasm / skript yuklanmasa ham "error" — lekin u window'ga ko'tarilmaydi; bu yerda faqat dastur xatolari
    uncaught(event.error ?? new Error(`${event.message} (${event.filename}:${event.lineno})`));
  });
  window.addEventListener("unhandledrejection", (event) => uncaught(event.reason));
}
