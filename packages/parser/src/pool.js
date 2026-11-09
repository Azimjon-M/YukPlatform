// Bir nechta AI ulanishi bilan ishlash. Ulanish = kalit + model, har birining o'z limiti bor.
// Biri limitga tushsa (429), band bo'lsa (503) yoki xato qaytarsa, faqat o'sha "dam oladi", qolganlari ishlayveradi.
// Gemini'da limit har bir model uchun alohida: bitta kalitda 3 ta model = kuniga 3 barobar ko'p so'rov.
//
//   const pool = createParserPool({ connections: () => store.aiConnections(...), onState: store.saveAiSlot })
//   const lease = pool.acquire()          // bo'sh va dam olmayotgan ulanish (yoki null)
//   await lease.parser.parseBatch(texts)  // xato bo'lsa: lease.fail(error) → { ms, reason } — e'lonlar boshqa ulanishga
//   lease.release({ posts: 10 })
//
// Ulanish "sog'lig'i": tez-tez xato beradigan model avtomatik «muammoli» deb belgilanadi (state.problem) —
// u oxirgi navbatda ishlatiladi va xatodan keyin uzoqroq dam oladi. Belgi 24 soat xatosiz o'tsa yoki
// boshqaruv markazida «Belgini olib tashlash» bosilsa yechiladi.
import { createParser, resolveSettings } from "./parse.js";
import { getProvider } from "./providers/index.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Xato turiga qarab qancha dam olish kerak
export const PAUSES = {
  busyMs: 5 * MINUTE, // model band (503) — tez orada bo'shaydi
  dailyMs: 30 * MINUTE, // kunlik limit, lekin yangilanish vaqti noma'lum
  // Kunlik limit: Google "Tinch okeani yarim tunida yangilanadi" deydi, lekin 2026-11-06 da 21:21 da tugagan limit
  // 13:00 dan ancha oldin qaytdi. Shuning uchun 13:00 gacha kutmasdan, har 30 daqiqada bitta so'rov bilan tekshiramiz:
  // rad etilgan so'rov limitdan sarflanmaydi, e'lonlar esa darhol boshqa ulanishga o'tadi.
  probeMs: 30 * MINUTE,
  brokenMs: 6 * HOUR, // kalit noto'g'ri yoki model yo'q — odam tuzatmaguncha qayta urinmaymiz
  errorMs: MINUTE, // kutilmagan xato (500, 400...) — e'lonlar boshqa ulanishga beriladi, bu biroz dam oladi
  networkMs: 30_000, // internet uzildi — modelning aybi emas, tez qayta urinamiz
  problemMs: 15 * MINUTE, // «muammoli» ulanish har bir xatodan keyin kamida shuncha dam oladi
};

// «Muammoli» belgisi: 24 soatda 4 ta xato yoki oxirgi 10 so'rovdan 3 tasi xato (kam ishlatilganda ham sezadi).
// Limitlar (daqiqalik, kunlik) va internet uzilishi xato hisoblanmaydi — ular modelning nosozligi emas.
export const HEALTH = { windowMs: 24 * HOUR, maxFaults: 4, recentSize: 10, maxRecentFaults: 3 };
const FAULTS = new Set(["busy", "key", "model", "error"]);

// Google kunlik bepul limitni Tinch okeani vaqti bilan yarim tunda yangilaydi (Toshkentda 12:00 yoki 13:00)
const pacific = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const pacificParts = (time) => Object.fromEntries(pacific.formatToParts(new Date(time)).map((p) => [p.type, p.value]));

// "2026-11-05" — bugungi so'rovlar shu kun bo'yicha sanaladi (limit kuni bilan bir xil)
export function pacificDay(time = Date.now()) {
  const p = pacificParts(time);
  return `${p.year}-${p.month}-${p.day}`;
}

export function nextPacificMidnight(time = Date.now()) {
  const p = pacificParts(time);
  const elapsed = ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 + (time % 1000);
  let next = time - elapsed + 24 * HOUR;
  // Yozgi/qishki vaqtga o'tish kuni 23 yoki 25 soat bo'ladi — bir soatga to'g'rilaymiz
  const hour = Number(pacificParts(next).hour);
  if (hour === 23) next += HOUR;
  else if (hour === 1) next -= HOUR;
  return next;
}

// Internet (bizning tomonda) uzildimi: javob umuman kelmagan. HTTP javob kelgan bo'lsa (status bor) — tarmoq ishlayapti.
// 2026-11-06 10:36–11:06 da "fetch failed" bilan 162 ta e'lon yo'qolgan edi — endi ular navbatda kutadi.
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
]);
export function isNetworkError(error) {
  if (!error) return false;
  if (error.network === true) return true;
  if (error.status != null) return false;
  const code = error.code ?? error.cause?.code;
  return NETWORK_CODES.has(code) || /fetch failed|socket hang up|network/i.test(String(error.message ?? ""));
}

// Xato shu ulanishning muammosimi (limit, band, kalit, tarmoq) → { ms, reason, resetAt? } yoki null (noma'lum xato).
// reason: minute | daily | busy | key | model | network. resetAt — kunlik limit qachon yangilanishi kutiladi
export function pauseFor(provider, error, now = Date.now()) {
  if (isNetworkError(error)) return { ms: PAUSES.networkMs, reason: "network" };
  const retry = provider.retryAfterMs?.(error);
  if (retry != null) return { ms: retry, reason: "minute" };
  if (provider.isDailyLimit?.(error)) {
    // Provayder aniq vaqtni bilsa (1pro — Retry-After) unga ishonamiz, bilmasa (Gemini) — har 30 daqiqada tekshiramiz
    const exact = provider.dailyResetAt?.(error, now) ?? null;
    const resetAt = exact ?? nextPacificMidnight(now);
    const ms = exact != null ? resetAt - now : Math.min(resetAt - now, PAUSES.probeMs);
    return { ms: Math.max(ms, MINUTE), reason: "daily", resetAt };
  }
  if (!provider.isFatal?.(error)) return null;
  const status = error?.status;
  if (status === 429) return { ms: PAUSES.dailyMs, reason: "daily" };
  // 502/504 — server (yoki uning oldidagi nginx) hozir ishlamayapti; tez orada tiklanishi mumkin
  if ([502, 503, 504, 529].includes(status)) return { ms: PAUSES.busyMs, reason: "busy" };
  if (status === 404) return { ms: PAUSES.brokenMs, reason: "model" };
  return { ms: PAUSES.brokenMs, reason: "key" };
}

// Sog'liq hisobi: 24 soatdagi xatolar va oxirgi so'rovlar ("o" — yaxshi, "x" — xato)
function countFaults(state, now) {
  const faults = (state.faults ?? []).filter((t) => now - t < HEALTH.windowMs);
  const recent = [...(state.recent ?? "")].filter((c) => c === "x").length;
  return { faults, recent };
}
function pushRecent(state, mark) {
  state.recent = `${state.recent ?? ""}${mark}`.slice(-HEALTH.recentSize);
}

const emptyStats = (day) => ({ day, requests: 0, posts: 0, errors: 0 });

// connections — ro'yxat yoki uni qaytaradigan funksiya: [{ id, label, provider, model, apiKey?, state?, control? }].
//   Funksiya bo'lsa har refreshMs da qayta o'qiladi: boshqaruv markazida qo'shilgan kalit botni qayta ishga tushirmasdan ishlaydi.
//   state — bazada saqlangan holat (bot qayta ishga tushsa ham kunlik limitga tushgan ulanish dam olishda qoladi).
//   control — boshqaruv markazining buyrug'i: { wakeAt } («Sinash» muvaffaqiyatli — dam olish bekor),
//   { healthResetAt } («muammoli» belgisini olib tashlash). Bot uni ko'rgan vaqtini state'ga yozadi (qayta bajarmaydi).
// onState(state) — ulanish holati o'zgarganda (bot bazaga yozadi, boshqaruv markazi ko'rsatadi).
// attempts — SDK ichidagi qayta urinishlar: 1 — xato darhol qaytadi va e'lonlar boshqa ulanishga o'tadi.
export function createParserPool({
  connections,
  makeParser = createParser,
  now = Date.now,
  onState = null,
  refreshMs = 15_000,
  attempts = 1,
  batchSize,
  batchWaitMs,
  liveWaitMs,
} = {}) {
  const settings = resolveSettings({});
  const slots = new Map(); // id → { id, label, fingerprint, provider, parser, busy, removed, state }
  let loadedAt = null;

  const describe = (slot, error) => slot.provider.describeError?.(error) ?? error?.message ?? String(error);
  const emit = (slot) => onState?.({ ...slot.state, busy: slot.busy });

  // Kun almashsa (Tinch okeani vaqti) bugungi hisoblar noldan boshlanadi
  function today(slot) {
    const day = pacificDay(now());
    if (slot.state.day !== day) Object.assign(slot.state, emptyStats(day));
    return slot.state;
  }

  // «Muammoli» belgisi 24 soat yangi xatosiz o'tsa — o'zi yechiladi
  function heal(slot, time) {
    const { problem } = slot.state;
    if (problem && time - (problem.lastFaultAt ?? problem.since) >= HEALTH.windowMs) {
      slot.state.problem = null;
      return true;
    }
    return false;
  }

  // Boshqaruv markazi buyruqlari (bir marta bajariladi — ko'rilgan vaqt state'da)
  function applyControl(slot, control) {
    if (!control) return false;
    let changed = false;
    if (control.wakeAt && control.wakeAt > (slot.state.wakeSeen ?? 0)) {
      Object.assign(slot.state, { cooldownUntil: null, reason: null, resetAt: null, wakeSeen: control.wakeAt });
      changed = true;
    }
    if (control.healthResetAt && control.healthResetAt > (slot.state.healthSeen ?? 0)) {
      Object.assign(slot.state, { problem: null, faults: [], recent: "", healthSeen: control.healthResetAt });
      changed = true;
    }
    return changed;
  }

  function sync() {
    const dynamic = typeof connections === "function";
    if (loadedAt != null && (!dynamic || now() - loadedAt < refreshMs)) return;
    loadedAt = now();
    const list = (dynamic ? connections() : connections) ?? [];
    const seen = new Set();
    for (const c of list) {
      seen.add(c.id);
      // Kalit yoki model o'zgarsa — yangi parser; holat (bugungi so'rovlar) saqlanadi, dam olish bekor bo'ladi
      const fingerprint = `${typeof c.provider === "string" ? c.provider : c.provider?.id}|${c.model}|${c.apiKey ?? ""}`;
      const old = slots.get(c.id);
      if (old && old.fingerprint === fingerprint) {
        Object.assign(old, { label: c.label ?? old.label, removed: false });
        if (applyControl(old, c.control) && !old.busy) emit(old);
        continue;
      }
      const provider = typeof c.provider === "string" ? getProvider(c.provider) : (c.provider ?? {});
      const slot = {
        id: c.id,
        label: c.label ?? c.model ?? c.id,
        fingerprint,
        provider,
        busy: old?.busy ?? false,
        removed: false,
        state: {
          ...emptyStats(pacificDay(now())),
          ...(old?.state ?? c.state ?? {}),
          id: c.id,
          label: c.label ?? c.model ?? c.id,
          provider: provider.id ?? null,
          model: c.model ?? null,
          ...(old ? { cooldownUntil: null, reason: null } : {}),
        },
      };
      slot.parser = makeParser({
        provider: c.provider,
        model: c.model,
        apiKey: c.apiKey,
        attempts,
        // So'rov xatosida guruhni shu ulanishda bo'lib qayta yubormaydi — xato ishchiga qaytadi va e'lonlar
        // boshqa ulanishga beriladi (bitta ulanish bo'lsa, ishchi ularni bittadan tahlil qiladi)
        splitOnError: false,
        onRequest() {
          const state = today(slot);
          state.requests++;
          state.lastUsedAt = now();
          emit(slot);
        },
      });
      if (applyControl(slot, c.control)) emit(slot);
      slots.set(c.id, slot);
    }
    // Ro'yxatdan chiqarilgan ulanish: ishlayotgan bo'lsa — tugashini kutamiz, keyin o'chadi
    for (const [id, slot] of slots) {
      if (seen.has(id)) continue;
      if (slot.busy) slot.removed = true;
      else slots.delete(id);
    }
  }

  const live = () => [...slots.values()].filter((s) => !s.removed);
  const resting = (slot, time) => (slot.state.cooldownUntil ?? 0) > time;

  function lease(slot) {
    let released = false;
    let failed = false;
    return {
      id: slot.id,
      label: slot.label,
      parser: slot.parser,
      provider: slot.provider,
      // Shu ulanish bir so'rovda nechta e'lon oladi (provayder chegarasi bilan, masalan 1pro — 6). null — umumiy o'lcham
      batchSize: slot.parser.batchSize ?? null,
      describe: (error) => describe(slot, error),
      // Xatoni yozib qo'yadi va ulanishni dam oldiradi → { ms, reason } (e'lonlar boshqa ulanishga beriladi).
      // null — noma'lum xato va boshqa ulanish yo'q: chaqiruvchi e'lonlarni bittadan tahlil qiladi (eski usul).
      fail(error) {
        failed = true;
        const time = now();
        const state = today(slot);
        let pause = pauseFor(slot.provider, error, time);
        if (!pause && live().length > 1) pause = { ms: PAUSES.errorMs, reason: "error" };
        state.errors++;
        state.lastError = describe(slot, error);
        state.lastErrorAt = time;
        const fault = !pause || FAULTS.has(pause.reason);
        if (fault) {
          const { faults } = countFaults(state, time);
          state.faults = [...faults, time].slice(-50);
          pushRecent(state, "x");
          const recent = countFaults(state, time).recent;
          if (state.problem) {
            state.problem.lastFaultAt = time;
            state.problem.faults = state.faults.length;
          } else if (state.faults.length >= HEALTH.maxFaults || recent >= HEALTH.maxRecentFaults) {
            state.problem = { since: time, lastFaultAt: time, faults: state.faults.length, error: state.lastError };
            if (pause) pause = { ...pause, flagged: true };
          }
          // Muammoli ulanish xatodan keyin uzoqroq dam oladi — boshqalar ishlayveradi
          if (pause && state.problem) pause = { ...pause, ms: Math.max(pause.ms, PAUSES.problemMs) };
        }
        if (pause) Object.assign(state, { cooldownUntil: time + pause.ms, reason: pause.reason, resetAt: pause.resetAt ?? null });
        emit(slot);
        return pause;
      },
      // posts — shu ulanish tahlil qilgan e'lonlar soni
      release({ posts = 0 } = {}) {
        if (released) return;
        released = true;
        slot.busy = false;
        if (slot.removed) slots.delete(slot.id);
        if (posts > 0) {
          today(slot).posts += posts;
          slot.state.lastUsedAt = now();
          if (!failed) pushRecent(slot.state, "o");
        }
        emit(slot);
      },
    };
  }

  return {
    batchSize: batchSize ?? settings.batchSize,
    batchWaitMs: batchWaitMs ?? settings.batchWaitMs,
    liveWaitMs: liveWaitMs ?? settings.liveWaitMs,

    // Bo'sh va dam olmayotgan ulanish: avval sog'lomlari, ular ichida eng uzoq ishlatilmagani (yuk teng taqsimlanadi).
    // «Muammoli» ulanish faqat sog'lomi bo'sh bo'lmasa beriladi. Hech biri bo'lmasa — null
    acquire() {
      sync();
      const time = now();
      for (const slot of live()) if (heal(slot, time)) emit(slot);
      const ready = live()
        .filter((s) => !s.busy && !resting(s, time))
        .sort((a, b) => (a.state.problem ? 1 : 0) - (b.state.problem ? 1 : 0) || (a.state.lastUsedAt ?? 0) - (b.state.lastUsedAt ?? 0));
      const slot = ready[0];
      if (!slot) return null;
      slot.busy = true;
      if (slot.state.reason) Object.assign(slot.state, { cooldownUntil: null, reason: null, resetAt: null });
      return lease(slot);
    },

    // Eng yaqin bo'shaydigan ulanishgacha ms (0 — hozir bor). null — ulanish yo'q yoki hammasi ishlayapti
    nextReadyIn() {
      sync();
      const time = now();
      const waits = live()
        .filter((s) => !s.busy)
        .map((s) => Math.max((s.state.cooldownUntil ?? 0) - time, 0));
      return waits.length ? Math.min(...waits) : null;
    },

    size() {
      sync();
      return live().length;
    },

    // Hamma ulanish holati (kalitsiz)
    list() {
      sync();
      return live().map((s) => ({ ...s.state, busy: s.busy }));
    },
  };
}

// Bitta tayyor parser (eski usul, testlar va --dry-run) — bitta ulanishli pool
export function poolFromParser(parser) {
  return createParserPool({
    connections: [{ id: "asosiy", label: parser.model ?? "AI", provider: parser.provider ?? {}, model: parser.model }],
    makeParser: () => parser,
    batchSize: parser.batchSize,
    batchWaitMs: parser.batchWaitMs,
    liveWaitMs: parser.liveWaitMs,
  });
}
