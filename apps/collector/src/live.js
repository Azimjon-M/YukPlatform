// Jonli rejim: guruhlardan yangi e'lonlarni olib, bazadagi navbatga qo'yadi.
// Bot (apps/bot) navbatdan olib tahlil qiladi va yuboradi — collector to'xtasa yoki bloklansa, bot ishlashda davom etadi.
//
// Ikki yo'l (2026-11-09):
//   1) So'rab turish (polling) — har intervalMs (60 s) da «oxirgi ko'rganimdan keyingi xabarlarni ber». A'zo bo'lmasdan
//      ham ishlaydi: ochiq guruh tarixini hamma o'qiy oladi. Kechikish o'rtacha ~36 s, eng ko'pi ~72 s.
//   2) Jonli (update) — akkaunt A'ZO bo'lgan guruhdagi yangi xabarni Telegram o'zi ~1 s da yuboradi.
//      Bunday guruhlar har joinedIntervalMs (3 daq) da baribir so'raladi: katta guruhlarda Telegram ba'zan update'ni
//      kechiktiradi yoki tashlab yuboradi, aloqa uzilganda ham yo'qoladi — zaxira tekshiruv tushib qolganini to'ldiradi.
//      Bir xabar ikki yo'ldan kelsa ham bazaga bir marta yoziladi (posts: UNIQUE source + message_id).
// Kim a'zo — har membershipMs (10 daq) da bitta so'rov bilan tekshiriladi: guruhga qo'shilsangiz, 10 daqiqa ichida jonliga o'tadi.
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
    const result = addMessage(source, message, store, { minLength, dedupeWindowMs, via: "poll" });
    if (result === "short") counts.short++;
    else if (result) counts[result.status === "duplicate" ? "duplicate" : "added"]++;
    // null — bu xabar allaqachon bor (jonli kelgan yoki bot ham shu guruhdan olgan)
  }
  store.setCursor(label, cursor);
  return counts;
}

// Bitta xabarni navbatga yozadi (so'rab olingan ham, jonli kelgan ham shu yerdan o'tadi).
// → { id, status } | "short" (e'lon uchun juda qisqa) | null (allaqachon bor)
export function addMessage(source, message, store, { minLength = 20, dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS, via = null } = {}) {
  const text = cleanText(message.text);
  if (text.length < minLength) return "short";
  const link = source.kind === "username" ? `https://t.me/${source.value}/${message.id}` : null;
  return store.addPost({ source: sourceLabel(source), messageId: message.id, link, text, postedAt: message.date * 1000, via }, { dedupeWindowMs });
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
// reader.membership / reader.listen bo'lmasa (testlardagi soxta o'quvchi) — faqat so'rab turadi.
//
// Qo'riqchi (2026-11-06): Telegram ulanishi uzilganda GramJS so'rovi abadiy javob kutib qolgan, jarayon esa "tirik"
// ko'rinib turgan — boshqaruv markazi uni qayta ishga tushirmagan, e'lonlar yig'ilmagan. Endi:
//   pollTimeoutMs — bitta guruhni o'qish shundan uzoq cho'zilsa, xato deb hisoblanadi;
//   deadAfterMs — shuncha vaqt birorta guruh o'qilmasa, StalledError tashlanadi (cli.js chiqib ketadi → qayta ishga tushadi).
//   Jonli guruhlar ham har joinedIntervalMs da so'raladi, shuning uchun qo'riqchi ular uchun ham ishlaydi.
export async function runLive({
  sources,
  reader,
  store,
  intervalMs = 60_000,
  joinedIntervalMs = 3 * 60_000,
  membershipMs = 10 * 60_000,
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
  const timeoutText = `${pollTimeoutMs / 1000} s ichida javob kelmadi`;
  let empty = false;
  let lastOk = now(); // oxirgi muvaffaqiyatli o'qish
  let active = new Set(); // hozir kuzatilayotgan manbalar (o'chirilgan manbaning jonli xabari olinmaydi)
  const joined = new Set(); // akkaunt a'zo bo'lgan manbalar — jonli tinglanadi
  // Telegram katta guruhlardan update'ni ba'zan umuman yubormaydi (2026-11-09: @TutGruz'dan 4 daqiqada birorta ham
  // kelmadi, @Uzbyukmarkazi'dan esa 0 s da keldi). Shuning uchun a'zolikning o'zi yetmaydi: guruh faqat jonli xabar
  // haqiqatan kelgan (liveSeen) va oxirgi tekshiruvda hech narsa tushib qolmagan (missed) bo'lsa siyrak tekshiriladi.
  // Tushib qolgan bo'lsa — yana siyrak tekshirishdan oldin ketma-ket CLEAN_POLLS marta toza chiqishi kerak
  // (Telegram ba'zi xabarlarni yuborib, ba'zilarini tashlab yuboradigan guruh 3 daqiqa kutib qolmasin).
  const CLEAN_POLLS = 3;
  const liveSeen = new Set();
  const missed = new Map(); // manba → ketma-ket toza tekshiruvlar soni
  const polledAt = new Map(); // manba → oxirgi marta so'rab tekshirilgan vaqt
  let membershipAt = -Infinity;
  let membershipKnown = false;
  // Tashxis: Telegram qancha update yuboryapti (reader.liveStats). Birinchi hisobot 2 daqiqada, keyin har membershipMs
  let statsAt = now();
  let statsEvery = 2 * 60_000;

  // Jonli xabar: darhol navbatga. Qavs ichida — guruhga yozilganidan bizga kelguncha o'tgan vaqt
  const onLive = (source, message) => {
    const label = sourceLabel(source);
    if (!active.has(label)) return;
    lastOk = now();
    liveSeen.add(label);
    try {
      const result = addMessage(source, message, store, { via: "live" });
      if (result?.status === "new") log(`${label}: +1 yangi e'lon (jonli, ${Math.max(0, Math.round(now() / 1000 - message.date))} s)`);
    } catch (error) {
      log(`${label}: jonli xabarni yozib bo'lmadi — ${error.message}`);
    }
  };
  let stopListening = null;
  if (reader.listen && reader.membership) {
    try {
      stopListening = await withTimeout(reader.listen(onLive), pollTimeoutMs, timeoutText);
    } catch (error) {
      log(`Jonli tinglash yoqilmadi — ${error.errorMessage ?? error.message}. Hamma guruh so'rab turiladi`);
    }
  }

  // Kim a'zo: o'zgarsa — logga, holati — bazaga (boshqaruv markazining «Manbalar» bo'limi ko'rsatadi)
  async function checkMembership(list) {
    membershipAt = now();
    let map;
    try {
      map = await withTimeout(reader.membership(list), pollTimeoutMs, timeoutText);
    } catch (error) {
      log(`A'zolikni tekshirib bo'lmadi — ${error.errorMessage ?? error.message}`);
      return;
    }
    lastOk = now();
    let changed = false;
    for (const source of list) {
      const label = sourceLabel(source);
      const isJoined = map.get(source.value) === true;
      store.setSourceMembership?.(label, isJoined);
      if (isJoined === joined.has(label)) continue;
      changed = true;
      if (isJoined) joined.add(label);
      else joined.delete(label);
      if (membershipKnown) log(isJoined ? `${label}: akkaunt guruhga qo'shilgan — endi jonli` : `${label}: akkaunt guruhda yo'q — endi har ${intervalMs / 1000} s tekshiriladi`);
    }
    if (!membershipKnown || changed) {
      const live = list.map(sourceLabel).filter((label) => joined.has(label));
      log(
        live.length
          ? `A'zo (jonli tinglanadi): ${live.join(", ")}. Jonli xabar to'liq kelayotgani har ${joinedIntervalMs / 60_000} daqiqada, qolganlari har ${intervalMs / 1000} s tekshiriladi`
          : `Jonli guruh yo'q (akkaunt hech biriga a'zo emas) — ${list.length} tasi ham har ${intervalMs / 1000} s tekshiriladi`,
      );
    }
    membershipKnown = true;
  }

  try {
    while (!signal?.aborted) {
      const list = current();
      active = new Set(list.map(sourceLabel));
      if (!list.length && !empty) log("Kuzatiladigan guruh yo'q: boshqaruv markazining «Manbalar» bo'limidan qo'shing.");
      empty = !list.length;
      if (!list.length) lastOk = now(); // kuzatadigan narsa yo'q — bu uzilish emas
      if (stopListening && list.length && now() - membershipAt >= membershipMs) await checkMembership(list);
      if (stopListening && reader.liveStats && now() - statsAt >= statsEvery) {
        const st = reader.liveStats();
        const minutes = Math.round((now() - statsAt) / 60_000);
        statsAt = now();
        statsEvery = membershipMs;
        const types = Object.entries(st.types).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([type, n]) => `${type} ${n}`).join(", ");
        const bySource = Object.entries(st.bySource ?? {})
          .map(([value, counts]) => `@${value}: ${Object.entries(counts).map(([type, n]) => `${type} ${n}`).join(", ")}`)
          .join("; ");
        log(
          `Jonli tinglash: ${minutes} daqiqada Telegram ${st.updates} ta update yubordi${types ? ` (${types})` : ""}; ` +
            `yangi xabar ${st.messages} ta, manbalardan ${st.matched} ta${bySource ? ` — ${bySource}` : ""}`,
        );
      }
      for (const source of list) {
        if (signal?.aborted) break;
        const label = sourceLabel(source);
        // Jonli xabari to'liq kelayotgan guruh — faqat zaxira tekshiruv vaqti kelganda so'raladi
        const live = stopListening != null && joined.has(label);
        const trusted = live && liveSeen.has(label) && !missed.has(label);
        if (trusted && now() - (polledAt.get(label) ?? -Infinity) < joinedIntervalMs) continue;
        // Ishga tushgandagi birinchi tekshiruv — collector o'chiq turgan paytdagilarni oladi, bu «tushib qolgan» emas
        const backup = live && polledAt.has(label);
        try {
          const c = await withTimeout(pollSource(source, reader, store, { backfill }), pollTimeoutMs, timeoutText);
          lastOk = now();
          polledAt.set(label, now());
          if (c.started && backfill === 0) log(`${label}: kuzatish boshlandi`);
          const wasMissed = missed.has(label);
          if (backup && c.added) missed.set(label, 0);
          else if (backup && wasMissed && liveSeen.has(label)) missed.set(label, missed.get(label) + 1);
          if (backup && c.added && !wasMissed) {
            log(`${label}: jonli kelmay qolgan ${c.added} ta e'lon so'rab olindi — endi har ${intervalMs / 1000} s tekshiriladi`);
          } else if (missed.get(label) >= CLEAN_POLLS) {
            missed.delete(label);
            log(`${label}: jonli xabarlar to'liq kelyapti — endi har ${joinedIntervalMs / 60_000} daqiqada tekshiriladi`);
          } else if (c.added || c.duplicate) log(`${label}: +${c.added} yangi e'lon${c.duplicate ? `, ${c.duplicate} takror` : ""}`);
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
  } finally {
    stopListening?.();
  }
}
