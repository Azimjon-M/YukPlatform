// Jonli rejim: guruhlardan yangi e'lonlarni olib, bazadagi navbatga qo'yadi.
// Bot (apps/bot) navbatdan olib tahlil qiladi va yuboradi — collector to'xtasa yoki bloklansa, bot ishlashda davom etadi.
//
// Uch yo'l (2026-11-09):
//   1) So'rab turish — «oxirgi ko'rganimdan keyingi xabarlarni ber». A'zo bo'lmasdan ham ishlaydi: ochiq guruh tarixini
//      hamma o'qiy oladi. Har guruhning O'Z NAVBATI bor: qancha ko'p yozsa, shuncha tez-tez so'raladi (pollIntervals).
//      Oldin hamma guruh bitta aylanishda so'ralardi — 27 guruhda bitta aylanish ~2,5 daqiqa, jim guruhga ham, kuniga
//      10 000 e'lon yozadigan guruhga ham bir xil.
//   2) «Yangisi bormi» (tops) — a'zo bo'lingan guruhlarning oxirgi xabar raqamini Telegram BITTA so'rovda beradi
//      (reader.tops → messages.getPeerDialogs). Har topsMs (15 s) da shu bitta so'rov; guruh faqat yangi xabar bo'lsa
//      o'qiladi. A'zo bo'lmagan guruhlar uchun ham ishlasa (ishga tushganda bir marta sinab ko'riladi) — ular ham shunday.
//   3) Jonli (update) — a'zo bo'lingan guruhdagi yangi xabarni Telegram ba'zan o'zi ~1 s da yuboradi. Katta guruhlarda
//      ko'pincha yubormaydi (09.11: @TutGruz'dan bitta ham kelmadi), shuning uchun bu faqat qo'shimcha tezlik.
//   Bir xabar bir necha yo'ldan kelsa ham bazaga bir marta yoziladi (posts: UNIQUE source + message_id).
// Kim a'zo — har membershipMs (10 daq) da bitta so'rov bilan tekshiriladi.
import { setTimeout as wait } from "node:timers/promises";
import { DEFAULT_DEDUPE_WINDOW_MS, telegramUsername } from "@yuk/shared";
import { MISSING_ERROR, PROBE, judgeProbe } from "./probe.js";
import { cleanText } from "./samples.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// source — sources.js normalizeSource natijasi; bazadagi nomi "@guruh"
export const sourceLabel = (source) => (source.kind === "username" ? `@${source.value}` : source.value);

// Bitta guruhdan yangi xabarlarni olib, navbatga qo'yadi.
// reader: { latestId(source) → oxirgi xabar raqami, since(source, minId) → [{ id, text, date, sender }] (eskisidan yangisiga) }
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

  // Matnsiz xabarlar (izohsiz rasm, «X guruhga qo'shildi») ham keladi — e'lon emas, lekin kursor ulardan ham o'tadi,
  // aks holda «yangisi bormi» guruhning oxirgi xabari rasm bo'lsa, uni har safar qayta o'qitardi
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
// → { id, status } | "short" (e'lon uchun juda qisqa yoki matnsiz) | null (allaqachon bor)
// message.sender — yozgan odamning username'i (senderUsername), bo'lmasa null
export function addMessage(source, message, store, { minLength = 20, dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS, via = null } = {}) {
  const text = cleanText(message.text ?? "");
  if (text.length < minLength) return "short";
  const link = source.kind === "username" ? `https://t.me/${source.value}/${message.id}` : null;
  const sender = telegramUsername(message.sender);
  return store.addPost({ source: sourceLabel(source), messageId: message.id, link, text, postedAt: message.date * 1000, via, sender }, { dedupeWindowMs });
}

// GramJS xabarining jo'natuvchisi (message.sender) → username yoki null.
// Faqat oddiy odam: guruhga kanal nomidan yozilgan (Channel), bot yoki o'chirilgan akkaunt — «lichka» emas.
// username bo'lmasa, Telegram'ning yangi «usernames» ro'yxatidan faol birinchisi (bir nechta username'li akkauntlar).
// Username'siz odamni id bo'yicha ochish (tg://user?id=) bot xabarida kafolatlanmagan — shuning uchun ular chiqmaydi.
export function senderUsername(sender) {
  if (sender?.className !== "User" || sender.bot || sender.deleted) return null;
  return telegramUsername(sender.username ?? sender.usernames?.find((u) => u.active)?.username);
}

// Telegram bilan aloqa "osilib" qoldi: jarayon o'zi to'xtaydi, boshqaruv markazi uni qayta ishga tushiradi
export class StalledError extends Error {}

// promise ms ichida tugamasa — xato. (Osilgan so'rov fonda qolib ketadi, lekin aylanish davom etadi)
export function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 20000 → "20 s", 240000 → "4 daq"
export const durationText = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / MINUTE)} daq`);

// --- Navbat: qaysi guruh qancha oraliqda so'raladi ---
//
// Kvadrat ildiz qoidasi: daqiqasiga budgetPerMin ta so'rovni guruhlarga shunday bo'lamizki, e'lonlarning o'rtacha
// kechikishi eng kam bo'lsin. Javobi: guruhning oralig'i ~ 1/√(daqiqadagi e'lonlar) — 4 barobar ko'p yozadigan guruh
// 2 barobar tez so'raladi. (Hammasiga teng — jim guruhlarga so'rov isrof; faqat e'lon soniga mutanosib — jim guruhning
// kamdan-kam e'loni juda kechikadi.) Har oraliqni 1/T deb qo'shsak, jami aynan budgetPerMin chiqadi.
// rates: Map(nomi → daqiqasiga e'lon | null — yangi guruh, faolligi hali bilinmaydi → defaultMs)
// floorPerMin — umuman yozmayotgan guruh ham «3 soatda bitta» deb olinadi (bo'lmasa oralig'i cheksiz bo'lardi)
// → Map(nomi → oraliq, ms), har biri minMs … maxMs
export function pollIntervals(rates, { budgetPerMin = 20, minMs = 20_000, maxMs = 10 * MINUTE, defaultMs = MINUTE, floorPerMin = 1 / 180 } = {}) {
  const out = new Map();
  const known = [];
  for (const [label, rate] of rates) {
    if (rate == null) out.set(label, defaultMs);
    else known.push([label, Math.sqrt(Math.max(rate, floorPerMin))]);
  }
  // Yangi guruhlar o'z ulushini (defaultMs da bir) oladi, qolgani — tarixi borlarga, lekin kamida chorak
  const budget = Math.max(budgetPerMin - (rates.size - known.length) * (MINUTE / defaultMs), budgetPerMin / 4);
  const sum = known.reduce((total, [, root]) => total + root, 0);
  for (const [label, root] of known) {
    const ms = (sum / (budget * root)) * MINUTE;
    out.set(label, Math.round(Math.min(maxMs, Math.max(minMs, ms))));
  }
  return out;
}

// Har guruh daqiqasiga nechta e'lon yozadi (bazadagi posts bo'yicha, takrorlari bilan — ularni ham o'qish kerak).
// Oxirgi 3 soat — kun vaqtiga moslashadi (kechasi hamma jim); lekin kunlik o'rtachaning yarmidan kam emas: collector
// o'chiq turgan bo'lsa, 3 soatlik hisob noto'g'ri «jim» chiqmasin. 15 daqiqadan yosh guruh — null (hali bilinmaydi).
const YOUNG_MS = 15 * MINUTE;
export function activityRates(labels, { activity = {}, createdAt = new Map(), time, recentMs = 3 * HOUR, dayMs = 24 * HOUR }) {
  const rates = new Map();
  for (const label of labels) {
    const age = time - (createdAt.get(label) ?? -Infinity);
    if (age < YOUNG_MS) {
      rates.set(label, null);
      continue;
    }
    const { recent = 0, day = 0 } = activity[label] ?? {};
    const recentRate = recent / (Math.min(age, recentMs) / MINUTE);
    const dayRate = day / (Math.min(age, dayMs) / MINUTE);
    rates.set(label, Math.max(recentRate, dayRate / 2));
  }
  return rates;
}

// Telegram «sekinroq» desa (FLOOD_WAIT_N) — necha soniya kutish kerak; boshqa xato — null
export function floodSeconds(error) {
  if (Number.isFinite(error?.seconds)) return error.seconds;
  const match = /FLOOD_WAIT_(\d+)/.exec(error?.errorMessage ?? error?.message ?? "");
  return match ? Number(match[1]) : null;
}

// Hamma guruhni kuzatadi. signal — to'xtatish uchun (Ctrl+C).
// sources — ro'yxat yoki har qadamda chaqiriladigan funksiya (boshqaruv markazida qo'shilgan guruh bir necha soniyada kuzatiladi)
// reader.membership / reader.tops / reader.listen bo'lmasa (testlardagi soxta o'quvchi) — hamma guruh o'z navbati bilan so'raladi.
//   intervalMs — yangi guruhning (faolligi hali bilinmaydi) oralig'i; budgetPerMin — daqiqasiga taxminan nechta so'rov;
//   minMs / maxMs — eng tez / eng siyrak; topsMs — «yangisi bormi» qanchada bir; safetyMs — «yangisi bormi» bilan
//   kuzatiladigan guruh ham shuncha vaqtda bir baribir o'qiladi; gapMs — Telegram'ga ikki so'rov orasidagi eng kam vaqt.
//
// Qo'riqchi (2026-11-06): Telegram ulanishi uzilganda GramJS so'rovi abadiy javob kutib qolgan, jarayon esa "tirik"
// ko'rinib turgan — boshqaruv markazi uni qayta ishga tushirmagan, e'lonlar yig'ilmagan. Endi:
//   pollTimeoutMs — bitta so'rov shundan uzoq cho'zilsa, xato deb hisoblanadi;
//   deadAfterMs — shuncha vaqt davomida so'rovlar faqat xato bersa (kamida 3 ta), StalledError tashlanadi
//   (cli.js chiqib ketadi → qayta ishga tushadi). Jim turgan vaqt (so'raladigan guruh yo'q) uzilish hisoblanmaydi.
export async function runLive({
  sources,
  reader,
  store,
  intervalMs = MINUTE,
  budgetPerMin = 20,
  minMs = 20_000,
  maxMs = 10 * MINUTE,
  topsMs = 15_000,
  safetyMs = 10 * MINUTE,
  membershipMs = 10 * MINUTE,
  ratesMs = 5 * MINUTE,
  reportMs = 10 * MINUTE,
  joinGapMs = 5 * MINUTE,
  joinsPerDay = 15,
  probeGapMs = 30_000,
  probeBackfillMs = 3 * HOUR,
  requireContact = true, // probe: faqat aloqasi bor yuk e'lonlari sanaladi (probe.js judgeProbe; .env REQUIRE_CONTACT)
  // Qo'shimcha akkaunt (accounts.js, 2026-11-13) faqat o'ziga biriktirilgan yopiq guruhlarni o'qiydi: foydalanuvchi
  // qo'shgan guruhlarni tekshirish (probe) va a'zo bo'lish navbati (joins) — faqat asosiy akkauntda
  probe = true,
  joins = true,
  // Har aylanish boshida chaqiriladi (accounts.js: guruhlar ro'yxatini vaqti-vaqti bilan yangilash). Xatosi — o'zida
  tick = null,
  emptyText = "Kuzatiladigan guruh yo'q: boshqaruv markazining «Manbalar» bo'limidan qo'shing.",
  gapMs = 2_000,
  backfill = 0,
  log = console.log,
  signal,
  pollTimeoutMs = 90_000,
  deadAfterMs = 5 * MINUTE,
  now = Date.now,
  sleep: sleepFn,
}) {
  const sleep = sleepFn ?? ((ms) => wait(ms, undefined, { signal }).catch(() => {}));
  const current = typeof sources === "function" ? sources : () => sources;
  const timeoutText = `${pollTimeoutMs / 1000} s ichida javob kelmadi`;
  const call = (promise) => withTimeout(promise, pollTimeoutMs, timeoutText);
  const errorText = (error) => error?.errorMessage ?? error?.message ?? String(error);
  const IDLE_MS = 5_000; // hech narsa so'ralmayotganda ham ro'yxat va to'xtatish buyrug'i shuncha vaqtda bir tekshiriladi

  // --- Telegram'ga so'rovlar sur'ati ---
  let lastRequestAt = -Infinity;
  let pauseUntil = -Infinity; // FLOOD_WAIT: Telegram aytgan vaqtgacha hech narsa so'ralmaydi
  let slowUntil = -Infinity; // FLOOD_WAIT'dan keyin 1 soat so'rovlar ikki barobar kam
  let requests = 0;
  async function pace() {
    const waitMs = Math.max(lastRequestAt + gapMs, pauseUntil) - now();
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAt = now();
    requests++;
  }
  function handleFlood(error) {
    const seconds = floodSeconds(error);
    if (seconds == null) return false;
    pauseUntil = now() + seconds * 1000;
    slowUntil = now() + HOUR;
    ratesAt = -Infinity; // oraliqlar qayta hisoblansin
    log(`Telegram «sekinroq» dedi (FLOOD_WAIT ${seconds} s): shuncha kutiladi, keyingi 1 soat so'rovlar ikki barobar kam`);
    return true;
  }

  // --- Qo'riqchi ---
  let failingSince = null;
  let failures = 0;
  const ok = () => {
    failingSince = null;
    failures = 0;
  };
  function failed() {
    failingSince ??= now();
    failures++;
    if (failures >= 3 && now() - failingSince >= deadAfterMs) {
      throw new StalledError(`Telegram bilan aloqa uzildi: ${Math.round(deadAfterMs / MINUTE)} daqiqa ichida birorta guruh o'qilmadi — collector qayta ishga tushadi`);
    }
  }

  // --- Guruhlar holati ---
  const state = new Map(); // nomi → { lastPoll, errors, retryAt }
  const stateOf = (label) => {
    if (!state.has(label)) state.set(label, { lastPoll: -Infinity, errors: 0, retryAt: -Infinity });
    return state.get(label);
  };
  let active = new Set(); // hozir kuzatilayotganlar (o'chirilgan guruhning jonli xabari olinmaydi)
  let rates = new Map();
  let intervals = new Map();
  let ratesAt = -Infinity;
  let ratesKey = "";
  const saved = new Map(); // bazaga yozilgan navbat (o'zgarmasa qayta yozilmaydi)

  function refreshRates(list) {
    ratesAt = now();
    const labels = list.map(sourceLabel);
    ratesKey = labels.join(",");
    const createdAt = new Map((store.listSources?.() ?? []).map((s) => [s.name, s.createdAt]));
    rates = activityRates(labels, { activity: store.sourceActivity?.() ?? {}, createdAt, time: now() });
    const budget = budgetPerMin * (now() < slowUntil ? 0.5 : 1);
    intervals = pollIntervals(rates, { budgetPerMin: budget, minMs, maxMs, defaultMs: intervalMs });
  }

  // --- A'zolik va «yangisi bormi» ---
  const joined = new Set();
  let membershipAt = -Infinity;
  let membershipKnown = false;
  const tops = new Map(); // nomi → { top, at }: Telegram aytgan oxirgi xabar raqami
  let topsAt = -Infinity;
  let topsBrokenUntil = -Infinity;
  let topsAll = reader.tops ? null : false; // a'zo bo'lmagan guruhlar uchun ham ishlaydimi; null — hali sinalmagan
  const covered = (label) => {
    const entry = tops.get(label);
    return entry != null && now() - entry.at <= Math.max(3 * topsMs, MINUTE);
  };

  // Kim a'zo: o'zgarsa — logga, holati — bazaga (boshqaruv markazining «Manbalar» bo'limi ko'rsatadi)
  async function checkMembership(list) {
    membershipAt = now();
    let map;
    await pace();
    try {
      map = await call(reader.membership(list));
    } catch (error) {
      if (!handleFlood(error)) log(`A'zolikni tekshirib bo'lmadi — ${errorText(error)}`);
      return;
    }
    ok();
    let changed = false;
    // So'rov yuborilgan guruh admini tasdiqlagan bo'lsa — endi a'zo: holati va bildirishnomasi
    const requested = new Set((store.listSources?.() ?? []).filter((s) => s.joinState === "requested").map((s) => s.name));
    const approved = [];
    for (const source of list) {
      const label = sourceLabel(source);
      const isJoined = map.get(source.value) === true;
      store.setSourceMembership?.(label, isJoined);
      if (isJoined && requested.has(label)) {
        store.setJoinState(label, "joined");
        approved.push(source);
      }
      if (isJoined === joined.has(label)) continue;
      changed = true;
      if (isJoined) joined.add(label);
      else joined.delete(label);
      if (membershipKnown) log(isJoined ? `${label}: akkaunt guruhga qo'shilgan — endi yangisi bo'lsa darhol o'qiladi` : `${label}: akkaunt guruhda yo'q — o'z navbati bilan so'raladi`);
    }
    if (!membershipKnown || changed) {
      const names = list.map(sourceLabel).filter((label) => joined.has(label));
      log(names.length ? `A'zo guruhlar (yangisi bo'lsa darhol o'qiladi): ${names.join(", ")}` : "Akkaunt kuzatilayotgan guruhlarning hech biriga a'zo emas");
    }
    membershipKnown = true;
    for (const source of approved) {
      const muted = await mute(source);
      log(`${sourceLabel(source)}: guruh admini a'zolik so'rovini tasdiqladi${muted ? ", bildirishnomasi o'chirildi" : ""}`);
    }
  }

  // --- A'zo bo'lish navbati (2026-11-09, «sekin qo'sh») ---
  // Boshqaruv markazida «A'zo bo'lish» bosilgan guruhlar (join_state = wanted) — joinGapMs (5 daq) da bittadan va
  // 24 soatda joinsPerDay (15) tadan ko'p emas: bir kunda ko'p guruhga qo'shilish Telegram'ga spam-akkauntdek ko'rinadi.
  // Eng faol guruh birinchi (foydasi ko'proq). Qo'shilgach — bildirishnomasi o'chiriladi (arxivga solinmaydi — u shunday tanladi).
  let nextJoinAt = now() + MINUTE;
  let joinsStopped = false; // akkaunt guruhlar limitiga yetdi — shu ishga tushishda boshqa urinilmaydi
  let limitNoticeAt = -Infinity;

  // → true (o'chirildi) / false
  async function mute(source) {
    if (!reader.mute) return false;
    await pace();
    try {
      await call(reader.mute(source));
      return true;
    } catch (error) {
      if (!handleFlood(error)) log(`${sourceLabel(source)}: bildirishnomani o'chirib bo'lmadi — ${errorText(error)}`);
      return false;
    }
  }

  async function joinNext(list) {
    nextJoinAt = now() + joinGapMs;
    const rows = (store.listSources?.() ?? []).filter((s) => s.joinState === "wanted");
    if (!rows.length) return;
    const byLabel = new Map(list.map((s) => [sourceLabel(s), s]));
    const todo = [];
    for (const row of rows) {
      if (joined.has(row.name)) store.setJoinState(row.name, "joined"); // o'zi qo'shilib bo'lgan — so'rov kerak emas
      else if (byLabel.has(row.name)) todo.push(byLabel.get(row.name)); // o'chirilgan manba yoqilguncha kutadi
    }
    if (!todo.length) return;
    if (store.joinsSince(now() - DAY) >= joinsPerDay) {
      if (now() - limitNoticeAt >= 6 * HOUR) {
        limitNoticeAt = now();
        log(`A'zo bo'lish: 24 soatda ${joinsPerDay} ta limit tugadi — navbatdagi ${todo.length} tasi keyinroq`);
      }
      nextJoinAt = now() + 30 * MINUTE;
      return;
    }
    todo.sort((a, b) => (rates.get(sourceLabel(b)) ?? 0) - (rates.get(sourceLabel(a)) ?? 0));
    const source = todo[0];
    const label = sourceLabel(source);
    const tail = todo.length > 1 ? `; navbatda yana ${todo.length - 1} ta, keyingisi ${durationText(joinGapMs)} dan keyin` : "";
    await pace();
    let result;
    try {
      result = await call(reader.join(source));
      ok();
    } catch (error) {
      const seconds = floodSeconds(error);
      if (seconds != null) {
        nextJoinAt = now() + seconds * 1000 + joinGapMs;
        log(`A'zo bo'lish: Telegram vaqtincha chekladi (FLOOD_WAIT ${seconds} s) — keyingisi ${durationText(nextJoinAt - now())} dan keyin`);
        return;
      }
      const code = errorText(error);
      if (/CHANNELS_TOO_MUCH/.test(code)) {
        joinsStopped = true;
        store.setJoinState(label, "error", { error: "Akkaunt guruhlar limitiga yetgan (500 ta, Premium'da 1000)" });
        log("A'zo bo'lish to'xtadi: akkaunt guruhlar limitiga yetgan (CHANNELS_TOO_MUCH)");
        return;
      }
      store.setJoinState(label, "error", { error: code });
      log(`${label}: a'zo bo'lib bo'lmadi — ${code}${tail}`);
      return;
    }
    store.setJoinState(label, result);
    if (result === "requested") {
      log(`${label}: guruhda a'zolikni admin tasdiqlaydi — so'rov yuborildi${tail}`);
      return;
    }
    joined.add(label);
    store.setSourceMembership?.(label, true);
    const muted = await mute(source);
    log(`${label}: akkaunt guruhga qo'shildi${muted ? ", bildirishnomasi o'chirildi" : ""}${tail}`);
  }

  // --- Foydalanuvchi qo'shgan guruh (probe.js; bot havolani qabul qilib, «probe» holatida qo'ygan) ---
  // Oxirgi 50 ta xabar BITTA so'rov bilan o'qiladi va baholanadi: yuk e'lonlari bor — sinov boshlanadi (manba yoqiladi,
  // oxirgi probeBackfillMs (3 soat — bot shundan eskisini baribir tashlaydi) dagi xabarlari darhol navbatga: qo'shgan odam
  // mos yuklarni kutib o'tirmaydi), yo'q — rad etiladi. Natijani bot qo'shgan odamga yozadi.
  // Har probeGapMs (30 s) da ko'pi bilan bitta: guruh nomini aniqlash (resolveUsername) Telegram'da qattiq cheklangan.
  // Telegram «bunday guruh yo'q» desa — darhol rad; boshqa xato — 1, 2 daqiqadan keyin qayta, uchinchisida rad.
  const probeTries = new Map(); // nomi → { tries, retryAt }
  let nextProbeAt = -Infinity;
  async function probeNext() {
    if (!probe || !store.sourcesToProbe || !reader.since || now() < nextProbeAt || now() < pauseUntil) return;
    const row = store.sourcesToProbe({ limit: 20 }).find((r) => now() >= (probeTries.get(r.name)?.retryAt ?? -Infinity));
    if (!row) return;
    nextProbeAt = now() + probeGapMs;
    const source = { kind: "username", value: row.name.replace(/^@/, "") };
    const label = sourceLabel(source);
    await pace();
    if (signal?.aborted) return;
    try {
      const messages = await call(reader.since(source, 0, PROBE.limit));
      const verdict = judgeProbe(messages, { now: now(), requireContact });
      let queued = 0;
      if (verdict.ok) {
        for (const message of messages) {
          if (message.date * 1000 < now() - probeBackfillMs) continue;
          const result = addMessage(source, message, store, { via: "poll" });
          if (result && result !== "short" && result.status === "new") queued++;
        }
        store.setCursor(label, Math.max(...messages.map((m) => m.id)));
      }
      store.finishProbe(label, { ok: verdict.ok, note: verdict.note, stats: { ...verdict.stats, queued } });
      probeTries.delete(label);
      ok();
      const tail = queued ? `; oxirgi ${Math.round(probeBackfillMs / HOUR)} soatdagi ${queued} ta e'lon navbatga qo'yildi` : "";
      log(`${label}: foydalanuvchi qo'shgan guruh ${verdict.ok ? "sinovga olindi" : "rad etildi"} — ${verdict.note}${tail}`);
    } catch (error) {
      if (handleFlood(error)) return;
      const tries = (probeTries.get(label)?.tries ?? 0) + 1;
      const missing = MISSING_ERROR.test(errorText(error));
      if (missing || tries >= 3) {
        const note = missing ? "Bunday ochiq guruh yoki kanal topilmadi (yopiq bo'lishi mumkin)" : `Guruhni o'qib bo'lmadi (${errorText(error)})`;
        store.finishProbe(label, { ok: false, note, stats: { error: errorText(error) } });
        probeTries.delete(label);
        log(`${label}: foydalanuvchi qo'shgan guruh rad etildi — ${note}`);
        return;
      }
      const backoff = MINUTE * 2 ** (tries - 1);
      probeTries.set(label, { tries, retryAt: now() + backoff });
      log(`${label}: foydalanuvchi qo'shgan guruhni o'qib bo'lmadi — ${errorText(error)} (${durationText(backoff)} dan keyin qayta)`);
    }
  }

  async function checkTops(list) {
    topsAt = now();
    // Bir marta sinab ko'riladi: Telegram a'zo bo'lmagan guruhning ham oxirgi xabar raqamini beradimi
    // (bersa va u biz o'qiganimizdan kichik bo'lmasa — hamma guruh shu bitta so'rov bilan kuzatiladi)
    if (topsAll === null && membershipKnown) {
      const probe = list.find((s) => !joined.has(sourceLabel(s)) && store.getCursor(sourceLabel(s)) != null);
      if (probe) {
        await pace();
        try {
          const answer = await call(reader.tops([probe]));
          const top = answer.get(probe.value);
          topsAll = top != null && top >= store.getCursor(sourceLabel(probe));
          ok();
        } catch (error) {
          if (handleFlood(error)) return;
          topsAll = false;
        }
        log(
          topsAll
            ? "«Yangisi bormi»: Telegram a'zo bo'lmagan guruhlarning ham oxirgi xabar raqamini beryapti — hamma guruh bitta so'rov bilan kuzatiladi"
            : "«Yangisi bormi» faqat a'zo bo'lingan guruhlar uchun ishlaydi — qolganlari o'z navbati bilan so'raladi",
        );
      }
    }
    const candidates = list.filter((s) => topsAll === true || joined.has(sourceLabel(s)));
    if (!candidates.length) return;
    await pace();
    try {
      const answer = await call(reader.tops(candidates));
      ok();
      for (const source of candidates) {
        const top = answer.get(source.value);
        if (top != null) tops.set(sourceLabel(source), { top, at: now() });
      }
    } catch (error) {
      if (handleFlood(error)) return;
      topsBrokenUntil = now() + 10 * MINUTE;
      tops.clear();
      log(`«Yangisi bormi» tekshiruvi ishlamadi — ${errorText(error)}. 10 daqiqa hamma guruh o'z navbati bilan so'raladi`);
      failed();
    }
  }

  // --- Qaysi guruh navbatda ---
  // → { score } (hozir so'rash kerak; katta score — ko'proq kechikkan) yoki { at } (qachon navbati keladi)
  function planOf(source) {
    const label = sourceLabel(source);
    const s = stateOf(label);
    if (now() < s.retryAt) return { at: s.retryAt };
    const cursor = store.getCursor(label);
    if (cursor == null) return { score: Infinity }; // yangi guruh: darhol boshlanadi
    const interval = intervals.get(label) ?? intervalMs;
    const since = now() - s.lastPoll;
    if (covered(label)) {
      // Yangisi bor: jim guruh darhol o'qiladi (kam xarajat), faol guruh — o'z oralig'idan tez emas (so'rovlar me'yoridan oshmasin)
      const rate = rates.get(label);
      const busy = rate != null && rate * (interval / MINUTE) >= 1;
      const spacing = busy ? interval : Math.min(interval, minMs);
      if (tops.get(label).top > cursor) return since >= spacing ? { score: since / spacing } : { at: s.lastPoll + spacing };
      return since >= safetyMs ? { score: since / safetyMs } : { at: s.lastPoll + safetyMs };
    }
    return since >= interval ? { score: since / interval } : { at: s.lastPoll + interval };
  }

  async function pollOne(source) {
    const label = sourceLabel(source);
    const s = stateOf(label);
    await pace();
    if (signal?.aborted) return;
    try {
      const c = await call(pollSource(source, reader, store, { backfill }));
      s.lastPoll = now();
      s.errors = 0;
      ok();
      if (c.started && backfill === 0) log(`${label}: kuzatish boshlandi`);
      else if (c.added || c.duplicate) log(`${label}: +${c.added} yangi e'lon${c.duplicate ? `, ${c.duplicate} takror` : ""}`);
    } catch (error) {
      s.lastPoll = now();
      if (handleFlood(error)) return;
      // Bitta guruh xatosi (yopilgan, nomi o'zgargan) boshqalarini to'xtatmaydi; takrorlansa — tobora siyrakroq urinadi
      // (Telegram topilmagan nomni qayta-qayta qidirishni yoqtirmaydi)
      s.errors++;
      const backoff = Math.min(30 * MINUTE, Math.max(intervals.get(label) ?? intervalMs, MINUTE) * 2 ** (s.errors - 1));
      s.retryAt = now() + backoff;
      log(`${label}: o'qib bo'lmadi — ${errorText(error)}${s.errors > 1 ? ` (${s.errors}-marta, keyingisi ${durationText(backoff)} dan keyin)` : ""}`);
      failed();
    }
  }

  // Navbat o'zgarsa — bazaga (boshqaruv markazida «har 25 s» / «yangisi bo'lsa darhol»)
  function saveSchedule(list) {
    if (!store.setSourceSchedule) return;
    for (const source of list) {
      const label = sourceLabel(source);
      const next = { pollMs: intervals.get(label) ?? intervalMs, watch: covered(label) ? "tops" : "poll" };
      const prev = saved.get(label);
      if (prev?.pollMs === next.pollMs && prev?.watch === next.watch) continue;
      store.setSourceSchedule(label, next);
      saved.set(label, next);
    }
  }

  // Har reportMs da bitta qator: so'rovlar soni va navbat (birinchisi 2 daqiqada)
  let reportAt = now();
  let reportEvery = 2 * MINUTE;
  let reportRequests = 0;
  function report(list) {
    if (now() - reportAt < reportEvery) return;
    const minutes = (now() - reportAt) / MINUTE;
    const made = requests - reportRequests;
    reportAt = now();
    reportRequests = requests;
    reportEvery = reportMs;
    const watched = list.filter((s) => covered(sourceLabel(s))).length;
    const polled = list
      .filter((s) => !covered(sourceLabel(s)))
      .map((s) => [sourceLabel(s), intervals.get(sourceLabel(s)) ?? intervalMs])
      .sort((a, b) => a[1] - b[1]);
    const parts = [`Navbat: ${list.length} guruh, ${Math.round(minutes)} daqiqada ${made} ta so'rov (daqiqasiga ${(made / minutes).toFixed(1)})`];
    if (watched) parts.push(`yangisi bo'lsa darhol: ${watched} tasi`);
    if (polled.length) {
      const [fast, slow] = [polled[0], polled.at(-1)];
      parts.push(polled.length === 1 ? `${fast[0]} har ${durationText(fast[1])}` : `o'z navbati bilan: ${polled.length} tasi, ${fast[0]} har ${durationText(fast[1])} … ${slow[0]} har ${durationText(slow[1])}`);
    }
    const live = reader.liveStats?.();
    if (live) parts.push(`Telegram o'zi yuborgan xabarlar: ${live.matched} ta`);
    log(parts.join("; "));
  }

  // Jonli xabar: darhol navbatga. Qavs ichida — guruhga yozilganidan bizga kelguncha o'tgan vaqt
  const onLive = (source, message) => {
    const label = sourceLabel(source);
    if (!active.has(label)) return;
    ok();
    try {
      const result = addMessage(source, message, store, { via: "live" });
      // Ketma-ket kelgan bo'lsa — kursor ham suriladi: «yangisi bormi» shu xabar uchun guruhni qayta o'qitmaydi
      // (oraliqda tushib qolgan xabar bo'lsa, kursor surilmaydi va so'rab turish uni topadi)
      if (store.getCursor(label) === message.id - 1) store.setCursor(label, message.id);
      if (result?.status === "new") log(`${label}: +1 yangi e'lon (jonli, ${Math.max(0, Math.round(now() / 1000 - message.date))} s)`);
    } catch (error) {
      log(`${label}: jonli xabarni yozib bo'lmadi — ${error.message}`);
    }
  };
  let stopListening = null;
  if (reader.listen) {
    try {
      stopListening = await call(reader.listen(onLive));
    } catch (error) {
      log(`Jonli tinglash yoqilmadi — ${errorText(error)}. Guruhlar so'rab turiladi`);
    }
  }

  let empty = false;
  try {
    while (!signal?.aborted) {
      if (tick) await tick();
      if (signal?.aborted) break;
      // Yangi (foydalanuvchi qo'shgan) guruhni ko'rib chiqish — kuzatiladigan guruh bo'lmasa ham
      await probeNext();
      if (signal?.aborted) break;
      const list = current();
      active = new Set(list.map(sourceLabel));
      if (!list.length) {
        if (!empty) log(emptyText);
        empty = true;
        ok(); // kuzatadigan narsa yo'q — bu uzilish emas
        await sleep(IDLE_MS);
        continue;
      }
      empty = false;
      if (list.map(sourceLabel).join(",") !== ratesKey || now() - ratesAt >= ratesMs) {
        refreshRates(list);
        saveSchedule(list);
      }
      if (reader.membership && now() - membershipAt >= membershipMs) await checkMembership(list);
      if (reader.tops && now() - topsAt >= topsMs && now() >= topsBrokenUntil && !signal?.aborted) {
        await checkTops(list);
        saveSchedule(list);
      }
      if (joins && reader.join && store.setJoinState && !joinsStopped && now() >= nextJoinAt && !signal?.aborted) await joinNext(list);
      report(list);
      if (signal?.aborted) break;

      let next = null;
      let nextScore = -Infinity;
      let wakeAt = now() + IDLE_MS;
      for (const source of list) {
        const plan = planOf(source);
        if (plan.score != null && plan.score > nextScore) [next, nextScore] = [source, plan.score];
        else if (plan.at != null) wakeAt = Math.min(wakeAt, plan.at);
      }
      if (reader.tops && (joined.size || topsAll)) wakeAt = Math.min(wakeAt, Math.max(topsAt + topsMs, topsBrokenUntil));
      if (next) await pollOne(next);
      else await sleep(Math.max(200, wakeAt - now()));
    }
  } finally {
    stopListening?.();
  }
}
