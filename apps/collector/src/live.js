// Jonli rejim: ochiq guruhlarni har daqiqada tekshirib, yangi e'lonlarni bazadagi navbatga qo'yadi.
// Bot (apps/bot) navbatdan olib tahlil qiladi va yuboradi — collector to'xtasa yoki bloklansa, bot ishlashda davom etadi.
//
// Nega obuna (update) emas, so'rab turish (polling): Telegram yangi xabar haqidagi xabarni faqat akkaunt A'ZO bo'lgan
// chatlar uchun yuboradi. Biz guruhlarga qo'shilmaymiz (asosiy akkauntni xavf ostiga qo'ymaslik uchun), ochiq guruh
// tarixini esa a'zo bo'lmasdan o'qish mumkin. Keyin alohida akkaunt bilan guruhlarga qo'shilib, update'ga o'tiladi.
import { setTimeout as wait } from "node:timers/promises";
import { DEFAULT_DEDUPE_WINDOW_MS } from "@yuk/shared";
import { cleanText } from "./samples.js";

// source — sources.js normalizeSource natijasi; bazadagi nomi "@guruh"
export const sourceLabel = (source) => (source.kind === "username" ? `@${source.value}` : source.value);

// Bitta guruhdan yangi xabarlarni olib, navbatga qo'yadi.
// reader: { latestId(source) → oxirgi xabar raqami, since(source, minId) → [{ id, text, date }] (eskisidan yangisiga) }
// Birinchi marta: oxirgi `backfill` ta xabardan boshlaydi (0 — faqat bundan keyingi yangilaridan).
export async function pollSource(source, reader, store, { minLength = 20, backfill = 0, dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS } = {}) {
  const label = sourceLabel(source);
  const counts = { added: 0, duplicate: 0, short: 0, started: false };
  let cursor = store.getCursor(label);

  if (cursor == null) {
    const latest = await reader.latestId(source);
    if (latest == null) return counts;
    // Guruhdagi xabar raqamlari ketma-ket: latest - backfill ≈ oxirgi backfill ta xabar
    cursor = Math.max(0, latest - backfill);
    store.setCursor(label, cursor);
    counts.started = true;
    if (backfill === 0) return counts;
  }

  const messages = await reader.since(source, cursor);
  for (const message of messages) {
    cursor = Math.max(cursor, message.id);
    const text = cleanText(message.text);
    if (text.length < minLength) {
      counts.short++;
      continue;
    }
    const link = source.kind === "username" ? `https://t.me/${source.value}/${message.id}` : null;
    const result = store.addPost({ source: label, messageId: message.id, link, text, postedAt: message.date * 1000 }, { dedupeWindowMs });
    if (!result) continue; // bu xabar allaqachon bor (masalan, bot ham shu guruhdan olgan)
    counts[result.status === "duplicate" ? "duplicate" : "added"]++;
  }
  store.setCursor(label, cursor);
  return counts;
}

// Telegram bilan aloqa "osilib" qoldi: jarayon o'zi to'xtaydi, boshqaruv markazi uni qayta ishga tushiradi
export class StalledError extends Error {}

// promise ms ichida tugamasa — xato. (Osilgan so'rov fonda qolib ketadi, lekin aylanish davom etadi)
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Hamma guruhni aylanib chiqadi, keyin intervalMs kutadi. signal — to'xtatish uchun (Ctrl+C).
// sources — ro'yxat yoki har aylanishda chaqiriladigan funksiya (boshqaruv markazida qo'shilgan guruh darhol kuzatiladi)
//
// Qo'riqchi (2026-11-06): Telegram ulanishi uzilganda GramJS so'rovi abadiy javob kutib qolgan, jarayon esa "tirik"
// ko'rinib turgan — boshqaruv markazi uni qayta ishga tushirmagan, e'lonlar yig'ilmagan. Endi:
//   pollTimeoutMs — bitta guruhni o'qish shundan uzoq cho'zilsa, xato deb hisoblanadi;
//   deadAfterMs — shuncha vaqt birorta guruh o'qilmasa, StalledError tashlanadi (cli.js chiqib ketadi → qayta ishga tushadi).
export async function runLive({
  sources,
  reader,
  store,
  intervalMs = 60_000,
  gapMs = 2_000,
  backfill = 0,
  log = console.log,
  signal,
  pollTimeoutMs = 90_000,
  deadAfterMs = 5 * 60_000,
  now = Date.now,
}) {
  const sleep = (ms) => wait(ms, undefined, { signal }).catch(() => {});
  const current = typeof sources === "function" ? sources : () => sources;
  let empty = false;
  let lastOk = now(); // oxirgi muvaffaqiyatli o'qish
  while (!signal?.aborted) {
    const list = current();
    if (!list.length && !empty) log("Kuzatiladigan guruh yo'q: boshqaruv markazining «Manbalar» bo'limidan qo'shing.");
    empty = !list.length;
    if (!list.length) lastOk = now(); // kuzatadigan narsa yo'q — bu uzilish emas
    for (const source of list) {
      if (signal?.aborted) break;
      const label = sourceLabel(source);
      try {
        const c = await withTimeout(pollSource(source, reader, store, { backfill }), pollTimeoutMs, `${pollTimeoutMs / 1000} s ichida javob kelmadi`);
        lastOk = now();
        if (c.started && backfill === 0) log(`${label}: kuzatish boshlandi`);
        if (c.added || c.duplicate) log(`${label}: +${c.added} yangi e'lon${c.duplicate ? `, ${c.duplicate} takror` : ""}`);
      } catch (error) {
        // Bitta guruh xatosi (yopilgan, nomi o'zgargan, FLOOD_WAIT) boshqalarini to'xtatmaydi
        log(`${label}: o'qib bo'lmadi — ${error.errorMessage ?? error.message}`);
      }
      if (now() - lastOk >= deadAfterMs) {
        throw new StalledError(`Telegram bilan aloqa uzildi: ${Math.round(deadAfterMs / 60_000)} daqiqa ichida birorta guruh o'qilmadi — collector qayta ishga tushadi`);
      }
      await sleep(gapMs);
    }
    await sleep(intervalMs);
  }
}
