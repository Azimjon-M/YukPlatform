// Bir nechta Telegram akkaunti (2026-11-13, Azimjon: do'stining yopiq haydovchilar guruhlari).
// Ochiq guruhni a'zo bo'lmasdan ham o'qisa bo'ladi, yopig'ini — faqat unga a'zo akkaunt. Shuning uchun:
//   asosiy akkaunt — avvalgidek hamma ochiq guruh, foydalanuvchi qo'shgan guruhlarni tekshirish, a'zo bo'lish navbati;
//   qo'shimcha akkaunt (apps/collector/sessions/<nom>.session) — faqat o'ziga biriktirilgan (sources.account) guruhlar.
// Har akkaunt o'z halqasida (runLive) va o'z sur'atida ishlaydi: Telegram cheklovlari akkaunt bo'yicha.
// Qo'shimcha akkauntning xatosi asosiyni to'xtatmaydi (supervisor qayta ulaydi), asosiyniki — avvalgidek jarayonni
// to'xtatadi (boshqaruv markazi qayta yoqadi).
// Kirish (kod, 2FA) — faqat akkaunt egasining o'zi: Mini App «🛠 Boshqaruv» → «Telegram akkauntlari» (apps/api tgLogin.js →
// loginWorker.js, sessiya sessions/<nom>.session ga yoziladi — shu supervisor 30 s ichida ko'radi) yoki terminalda:
// npm run tg:login -- --account <nom>. Asosiy akkaunt — faqat terminalda.
import { setTimeout as wait } from "node:timers/promises";
import { TRANSCRIBE_MODELS } from "@yuk/parser";
import { MAIN_TG_ACCOUNT, MEDIA_DIR } from "@yuk/store";
import { durationText, runLive, withTimeout } from "./live.js";
import { createAvatarRefresher } from "./avatars.js";
import { createMediaQueue } from "./media.js";
import { normalizeSource } from "./sources.js";

const MINUTE = 60_000;
export const DIALOGS_EVERY_MS = 30 * MINUTE; // guruhlar ro'yxati shuncha vaqtda bir (yoki boshqaruv markazi so'rasa) yangilanadi

// Sessiya yaroqsiz (egasi chiqib ketgan, Telegram bekor qilgan, boshqa joyda ishlatilgan) — qayta urinish foydasiz.
// code "SESSION" — telegram.js connectSaved; 401 — Telegram'ning avtorizatsiya xatolari
const SESSION_GONE = /SESSION_(REVOKED|EXPIRED)|AUTH_KEY_(UNREGISTERED|DUPLICATED|INVALID)|USER_DEACTIVATED/;
export const sessionGone = (error) => error?.code === "SESSION" || error?.code === 401 || SESSION_GONE.test(error?.errorMessage ?? error?.message ?? "");

export const accountTitle = (me) => [me.firstName, me.username ? `@${me.username}` : null].filter(Boolean).join(" ") || `id ${me.userId}`;

// O'quvchi akkauntlar (2026-11-20, Azimjon: «bizda 2 ta asosiy account bor ular … guruhlarga a'zo qilingan»): ochiq guruhni
// a'zo akkaunt o'qisin — a'zo guruhning yangi xabari «yangisi bormi» (tops) so'rovida keladi (~4 s), a'zo bo'lmagan guruh
// esa navbat bilan so'raladi (median 45 s, ba'zan 5+ daqiqa) va har qayta yoqilishda manzili so'ralib, Telegram FLOOD_WAIT
// beradi. .env TG_READERS=asosiy,u47qx60v-1 — tartib muhim: guruhga birinchisi a'zo bo'lsa — o'sha o'qiydi
export function readerAccounts(env = process.env) {
  const list = String(env.TG_READERS ?? "").split(/[,\s]+/).filter(Boolean);
  return list.includes(MAIN_TG_ACCOUNT) ? list : [MAIN_TG_ACCOUNT, ...list];
}

// Ochiq guruh (account NULL) kimga: o'quvchilardan birinchi a'zo va ishlab turgani; hech kim a'zo emas — asosiy
export function openSourceReader(name, { members, readers, working }) {
  const accounts = members.get(String(name).toLowerCase());
  if (accounts) for (const reader of readers) if (accounts.has(reader) && working(reader)) return reader;
  return MAIN_TG_ACCOUNT;
}

// Shu akkaunt o'qiydigan yoqilgan manbalar: o'ziga biriktirilganlari (yopiq guruh — sources.account) va ochiq guruhlardan
// openSourceReader shu akkauntga berganlari. Har aylanishda qayta o'qiladi (a'zolik tg_dialogs dan, 30 daqiqada yangilanadi)
export function accountSources(store, account, { readers = readerAccounts() } = {}) {
  const own = account === MAIN_TG_ACCOUNT ? null : account;
  return () => {
    const members = readers.length > 1 && store.openSourceMembers ? store.openSourceMembers() : new Map();
    const status = new Map((store.listTgAccounts?.() ?? []).map((a) => [a.name, a.status]));
    const working = (name) => name === MAIN_TG_ACCOUNT || status.get(name) === "ok";
    return store
      .listSources()
      .filter((s) => {
        if (!s.enabled) return false;
        if ((s.account ?? null) !== null) return s.account === own;
        return openSourceReader(s.name, { members, readers, working }) === account;
      })
      .flatMap((s) => {
        try {
          return [normalizeSource(s.name)];
        } catch {
          return [];
        }
      });
  };
}

// Bitta akkaunt: kimligi va guruhlari ro'yxati bazaga, keyin runLive (signal kelguncha yoki xatogacha).
// telegram — { createReader, listChats, whoAmI } (cli.js telegram.js funksiyalarini beradi, testda — soxtasi).
// me — oldindan bilinsa (whoAmI qayta so'ralmaydi); sources — berilmasa, bazadan accountSources
// connections() — Gemini ulanishlari (ovozli xabar uchun, media.js; cli.js store.aiConnections bilan beradi)
export async function runAccount({ name, client, telegram, store, me = null, sources = null, log = console.log, signal, now = Date.now, dialogsEveryMs = DIALOGS_EVERY_MS, listTimeoutMs = 90_000, connections = null, ...live }) {
  me ??= await telegram.whoAmI(client);
  store.saveTgAccount(name, { ...me, status: "ok", error: null });
  const main = name === MAIN_TG_ACCOUNT;

  let dialogsAt = -Infinity;
  let shown = null;
  const tick = async () => {
    avatarTick().catch(() => {});
    const asked = store.dialogsRefreshRequest?.() ?? null;
    const due = now() - dialogsAt >= dialogsEveryMs || (asked != null && asked > dialogsAt && now() - dialogsAt >= MINUTE);
    if (!due) return;
    dialogsAt = now();
    try {
      const chats = await withTimeout(telegram.listChats(client), listTimeoutMs, `${listTimeoutMs / 1000} s ichida javob kelmadi`);
      store.setTgDialogs(name, chats);
      const closed = chats.filter((c) => !c.username).length;
      const text = `guruh va kanallari: ${chats.length} ta (yopig'i ${closed} ta)`;
      if (text !== shown) log(`Akkaunt ${text}`);
      shown = text;
    } catch (error) {
      log(`Akkauntning guruhlar ro'yxatini olib bo'lmadi — ${error?.errorMessage ?? error?.message}`);
    }
  };

  const reader = telegram.createReader(client);
  const readSources = sources ?? accountSources(store, name);
  // Yopiq guruh rasmlari (boshqaruv markazidagi ro'yxat uchun) — sekin, bittadan
  const avatarTick = createAvatarRefresher({ reader, sources: readSources, log, now });
  // Ovozli xabar / dumaloq video → matn (Premium bo'lsa Telegram, bo'lmasa Gemini) → odatdagi navbat
  // MEDIA_MODELS — faqat o'girish uchun Gemini modellari (vergul bilan; bo'sh qoldirilsa @yuk/parser TRANSCRIBE_MODELS)
  const models = process.env.MEDIA_MODELS?.trim() ? process.env.MEDIA_MODELS.split(/[,\s]+/).filter(Boolean) : TRANSCRIBE_MODELS;
  if (connections) reader.media = createMediaQueue({ reader, store, connections, log, now, models, compare: process.env.MEDIA_COMPARE === "1", mediaDir: process.env.MEDIA_DIR?.trim() || MEDIA_DIR, voiceSources: store.voiceSourceNames ? () => store.voiceSourceNames() : null });
  await runLive({
    ...live,
    sources: readSources,
    reader,
    store,
    log,
    signal,
    now,
    tick,
    // Foydalanuvchi qo'shgan guruhni tekshirish: asosiy — ochiqlarini, qo'shimcha — o'ziga biriktirilgan yopiqlarini
    probe: true,
    probeAccount: main ? null : name,
    joins: main,
    scan: name, // «🔎 Auto scan» — boshqaruv markazidan so'ralganda (live.js scanNext)
    scanWaitMs: 3 * MINUTE, // scan oldidan tick ro'yxatni yangilab olsin (yangi qo'shilgan guruhlar)
    // Tasdiqlangan guruhga qo'shilish (TG_READERS dagi akkauntlar; live.js readerJoinNext)
    readerJoins: readerAccounts().includes(name) ? name : null,
    ...(main
      ? {}
      : { emptyText: "Bu akkauntga biriktirilgan guruh yo'q: boshqaruv markazi → «Manbalar» → «Yopiq guruh qo'shish» dan tanlang." }),
  });
}

// Qo'shimcha akkauntlar: sessions/*.session fayllari har scanMs (30 s) da qaraladi — yangi fayl (egasi kirdi) darhol
// ulanadi, o'chirilgani (tg:logout) to'xtatiladi. Ulanib bo'lmasa — 1, 2, 4 … 30 daqiqadan keyin qayta; sessiyasi
// yaroqsiz yoki boshqa nom bilan ulangan akkauntning o'zi bo'lsa — fayl o'zgarmaguncha (egasi qayta kirmaguncha) urinilmaydi.
// telegram — { listAccounts, connectSaved, whoAmI, createReader, listChats, disconnect }.
// owners — Map(userId → nom): asosiy akkaunt cli.js da oldindan yoziladi (bir akkaunt ikki joyda ishlamasin)
export async function superviseAccounts({ telegram, store, owners = new Map(), log = console.log, signal, now = Date.now, sleep, scanMs = 30_000, stopTimeoutMs = 10_000, live = {} }) {
  const pause = sleep ?? ((ms) => wait(ms, undefined, { signal }).catch(() => {}));
  const runners = new Map(); // nom → { running, controller, done, failures, retryAt, blockedFor, startedAt, gone }
  const say = (name) => (message) => log(`[${name}] ${message}`);

  function start(name, changedAt) {
    const r = runners.get(name) ?? { failures: 0, retryAt: -Infinity, blockedFor: null };
    runners.set(name, r);
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true });
    Object.assign(r, { running: true, controller, startedAt: now(), gone: false });
    r.done = (async () => {
      let client = null;
      let me = null;
      try {
        client = await telegram.connectSaved(name);
        me = await telegram.whoAmI(client);
        const owner = owners.get(me.userId);
        if (owner && owner !== name) {
          throw Object.assign(new Error(`bu «${owner}» akkauntining o'zi (${accountTitle(me)}) — bir akkaunt ikki marta ulanmaydi`), { code: "DUPLICATE" });
        }
        owners.set(me.userId, name);
        say(name)(`ulandi: ${accountTitle(me)}`);
        await runAccount({ name, client, me, telegram, store, log: say(name), signal: controller.signal, now, sleep, ...live });
        r.failures = 0;
      } catch (error) {
        if (controller.signal.aborted) return;
        const text = error?.errorMessage ?? error?.message ?? String(error);
        if (error?.code === "DUPLICATE" || sessionGone(error)) {
          const status = error?.code === "DUPLICATE" ? "duplicate" : "logged_out";
          r.blockedFor = changedAt;
          store.saveTgAccount(name, { ...(me ?? {}), status, error: text });
          say(name)(`${text} — egasi qayta kirmaguncha ulanmaydi: npm run tg:login -- --account ${name}`);
          return;
        }
        // Uzoq ishlab keyin uzilgan bo'lsa — hisob boshidan (1 daqiqada qayta)
        if (now() - r.startedAt >= 10 * MINUTE) r.failures = 0;
        r.failures++;
        const backoff = Math.min(30 * MINUTE, MINUTE * 2 ** (r.failures - 1));
        r.retryAt = now() + backoff;
        store.saveTgAccount(name, { ...(me ?? {}), status: "error", error: text });
        say(name)(`ishlamay qoldi — ${text}; ${durationText(backoff)} dan keyin qayta ulanadi`);
      } finally {
        if (me && owners.get(me.userId) === name) owners.delete(me.userId);
        signal?.removeEventListener("abort", stop);
        if (client) await Promise.resolve(telegram.disconnect(client)).catch(() => {});
        r.running = false;
      }
    })();
  }

  let first = true;
  while (!signal?.aborted) {
    let files = null;
    try {
      files = await telegram.listAccounts();
    } catch (error) {
      log(`Qo'shimcha akkauntlar ro'yxatini o'qib bo'lmadi — ${error.message}`);
    }
    if (files) {
      const present = new Map(files.map((f) => [f.name, f.changedAt]));
      // Collector o'chiq turganda sessiya fayli o'chirilgan akkaunt bazada «ok» bo'lib qolmasin
      if (first) {
        for (const account of store.listTgAccounts()) {
          if (account.name !== MAIN_TG_ACCOUNT && !present.has(account.name) && account.status !== "logged_out") {
            store.saveTgAccount(account.name, { status: "logged_out", error: `Sessiya fayli yo'q (npm run tg:login -- --account ${account.name})` });
          }
        }
        first = false;
      }
      for (const [name, changedAt] of present) {
        const r = runners.get(name);
        if (r?.running) continue;
        if (r?.blockedFor != null) {
          if (r.blockedFor === changedAt) continue; // egasi hali qayta kirmagan
          Object.assign(r, { blockedFor: null, failures: 0, retryAt: -Infinity });
        }
        if (r && now() < r.retryAt) continue;
        start(name, changedAt);
      }
      for (const [name, r] of runners) {
        if (present.has(name)) continue;
        if (r.running) r.controller.abort();
        if (!r.gone) {
          r.gone = true;
          store.saveTgAccount(name, { status: "logged_out", error: "Sessiya fayli o'chirilgan (npm run tg:logout)" });
          say(name)("sessiya fayli o'chirildi — akkaunt to'xtatildi");
        }
        if (!r.running) runners.delete(name);
      }
    }
    await pause(scanMs);
  }

  // To'xtash: har akkaunt o'z halqasini tugatadi (ko'pi bilan stopTimeoutMs kutiladi)
  for (const r of runners.values()) r.controller?.abort();
  let timer;
  await Promise.race([
    Promise.allSettled([...runners.values()].map((r) => r.done)),
    new Promise((resolve) => {
      timer = setTimeout(resolve, stopTimeoutMs);
      timer.unref?.();
    }),
  ]);
  clearTimeout(timer);
}
