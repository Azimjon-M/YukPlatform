// Bir nechta AI ulanishi bilan ishlash. Ulanish = kalit + model, har birining o'z limiti bor.
// Biri limitga tushsa (429) yoki band bo'lsa (503), faqat o'sha "dam oladi", qolganlari ishlashda davom etadi.
// Gemini'da limit har bir model uchun alohida: bitta kalitda 3 ta model = kuniga 3 barobar ko'p so'rov.
//
//   const pool = createParserPool({ connections: () => store.aiConnections(...), onState: store.saveAiSlot })
//   const lease = pool.acquire()          // bo'sh va dam olmayotgan ulanish (yoki null)
//   await lease.parser.parseBatch(texts)  // xato bo'lsa: lease.fail(error) → dam olish muddati yoki null
//   lease.release({ posts: 10 })
import { createParser, resolveSettings } from "./parse.js";
import { getProvider } from "./providers/index.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Xato turiga qarab qancha dam olish kerak
export const PAUSES = {
  busyMs: 5 * MINUTE, // model band (503) — tez orada bo'shaydi
  dailyMs: 30 * MINUTE, // kunlik limit, lekin yangilanish vaqti noma'lum (Gemini emas)
  brokenMs: 6 * HOUR, // kalit noto'g'ri yoki model yo'q — odam tuzatmaguncha qayta urinmaymiz
};

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

// Xato shu ulanishning muammosimi (limit, band, kalit) → { ms, reason } yoki null (e'lonning o'z xatosi).
// reason: minute (daqiqalik limit) | daily (kunlik limit) | busy (band) | key (kalit) | model (model yo'q)
export function pauseFor(provider, error, now = Date.now()) {
  const retry = provider.retryAfterMs?.(error);
  if (retry != null) return { ms: retry, reason: "minute" };
  if (provider.isDailyLimit?.(error)) return { ms: Math.max(nextPacificMidnight(now) - now, MINUTE), reason: "daily" };
  if (!provider.isFatal?.(error)) return null;
  const status = error?.status;
  if (status === 429) return { ms: PAUSES.dailyMs, reason: "daily" };
  if (status === 503 || status === 529) return { ms: PAUSES.busyMs, reason: "busy" };
  if (status === 404) return { ms: PAUSES.brokenMs, reason: "model" };
  return { ms: PAUSES.brokenMs, reason: "key" };
}

const emptyStats = (day) => ({ day, requests: 0, posts: 0, errors: 0 });

// connections — ro'yxat yoki uni qaytaradigan funksiya: [{ id, label, provider, model, apiKey?, state? }].
//   Funksiya bo'lsa har refreshMs da qayta o'qiladi: boshqaruv markazida qo'shilgan kalit botni qayta ishga tushirmasdan ishlaydi.
//   state — bazada saqlangan holat (bot qayta ishga tushsa ham kunlik limitga tushgan ulanish dam olishda qoladi).
// onState(state) — ulanish holati o'zgarganda (bot bazaga yozadi, boshqaruv markazi ko'rsatadi).
export function createParserPool({
  connections,
  makeParser = createParser,
  now = Date.now,
  onState = null,
  refreshMs = 15_000,
  attempts = 2,
  batchSize,
  batchWaitMs,
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
        onRequest() {
          const state = today(slot);
          state.requests++;
          state.lastUsedAt = now();
          emit(slot);
        },
      });
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
    return {
      id: slot.id,
      label: slot.label,
      parser: slot.parser,
      provider: slot.provider,
      describe: (error) => describe(slot, error),
      // Xatoni yozib qo'yadi. Ulanishning muammosi bo'lsa (limit, band, kalit) — dam oladi → { ms, reason }, aks holda null
      fail(error) {
        const time = now();
        const state = today(slot);
        const pause = pauseFor(slot.provider, error, time);
        state.errors++;
        state.lastError = describe(slot, error);
        state.lastErrorAt = time;
        if (pause) Object.assign(state, { cooldownUntil: time + pause.ms, reason: pause.reason });
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
        }
        emit(slot);
      },
    };
  }

  return {
    batchSize: batchSize ?? settings.batchSize,
    batchWaitMs: batchWaitMs ?? settings.batchWaitMs,

    // Bo'sh va dam olmayotgan ulanish — eng uzoq ishlatilmagani (yuk teng taqsimlanadi). Hech biri bo'lmasa — null
    acquire() {
      sync();
      const time = now();
      const ready = live()
        .filter((s) => !s.busy && !resting(s, time))
        .sort((a, b) => (a.state.lastUsedAt ?? 0) - (b.state.lastUsedAt ?? 0));
      const slot = ready[0];
      if (!slot) return null;
      slot.busy = true;
      if (slot.state.reason) Object.assign(slot.state, { cooldownUntil: null, reason: null });
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
  });
}
