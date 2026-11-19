// Collector uchun Telegram akkaunt qo'shish — Mini App'ning «🛠 Boshqaruv» bo'limidan (2026-11-13, Azimjon:
// «3 ta telegram accountni terminaldan bog'lash qiyin … faqat kompyuterimdan» → «Faqat raqam + kod» →
// «Browser qilma, O'zimizni MiniApp da qil»).
//
// Bosqichlar: nom + raqam → Telegram kod yuboradi (o'sha akkauntning Telegram ilovasiga) → kod → (2FA bo'lsa) parol →
// sessiya apps/collector/sessions/<nom>.session ga yoziladi → ishlab turgan collector uni 30 soniyada o'zi ulaydi.
//
// Nega bot chatida emas: login kodi chatga yozilsa Telegram uni bekor qiladi (firibgarlikka qarshi), 2FA parol esa chat
// tarixida qolardi. Mini App — oddiy web sahifa: kod va parol HTTPS orqali shu serverga, undan Telegram'ga ketadi.
//
// Kirishning o'zi alohida jarayonda (apps/collector/src/loginWorker.js, IPC): GramJS xatosi serverni yiqitmaydi.
// Har foydalanuvchida bir vaqtda bitta kirish (bir nechta foydalanuvchi — parallel). Holat server xotirasida: Mini App yopilib qayta ochilsa (bitta telefonda kodni ko'rish uchun
// Telegram'da boshqa akkauntga o'tib, qaytib kelsa) — shu bosqichdan davom etadi. 15 daqiqa harakatsiz — bekor.
// Kod va parol hech qayerga yozilmaydi va javobga qaytmaydi; raqam javobda yashirilgan (+998 90 ••• •• 67).
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { devCollectorProblem } from "@yuk/shared";
import { hashPhone, MAIN_TG_ACCOUNT, TG_ACCOUNT_NAME } from "@yuk/store";

const COLLECTOR = fileURLToPath(new URL("../../collector/", import.meta.url));
const WORKER = path.join(COLLECTOR, "src/loginWorker.js");
// apps/collector/src/telegram.js SESSIONS_DIR bilan bir xil (u yerni import qilsak, server GramJS'ni yuklab olardi)
const SESSIONS_DIR = path.join(COLLECTOR, "sessions");

const MINUTE = 60_000;
export const STEP_TIMEOUT_MS = 90_000; // Telegram shu vaqtda javob bermasa — kirish bekor
export const IDLE_MS = 15 * MINUTE; // kod/parol shu vaqtda kiritilmasa — bekor (Telegram kodi ham eskiradi)
export const STARTS_PER_HOUR = 5; // kod so'rash (adminlar): Telegram ko'p so'ralgan raqamni va API kalitini bloklaydi
// Oddiy foydalanuvchilar (Sozlamalar → «Telegram akkauntlarim», 2026-11-13): har biriga alohida va hammasiga birga chegara —
// bitta odam adminlarning limitini ham, boshqalarnikini ham yeb qo'ya olmaydi
export const USER_STARTS_PER_HOUR = 10; // 3 edi — Azimjon, 2026-11-13: «10 taga ko'tar»
export const USERS_STARTS_PER_HOUR = 30;
export const USER_MAX_ACCOUNTS = 3; // bir foydalanuvchi nechta akkaunt ulay oladi
export const MAX_USER_LOGINS = 3; // bir vaqtda nechta foydalanuvchi kirishi davom etishi mumkin (har biri — alohida jarayon)
export const MAX_RESENDS = 3; // bitta kirishda «Kodni qayta yuborish» necha marta
const ACTIVE = new Set(["sending", "code", "qr", "checking", "password"]);

const httpError = (status, message) => Object.assign(new Error(message), { status });

// "+998 90 123-45-67", "90 123 45 67", "998901234567", "00998…" → "+998901234567"; tushunarsiz → null.
// Akkaunt istalgan davlatniki bo'lishi mumkin: + bilan 7–15 raqam; 9 raqam — O'zbekiston (998 qo'shiladi)
export function normalizeLoginPhone(input) {
  const compact = String(input ?? "").trim().replace(/[\s()\-.]/g, "");
  if (/^\+\d{7,15}$/.test(compact)) return compact;
  if (/^00\d{7,15}$/.test(compact)) return `+${compact.slice(2)}`;
  if (/^\d{9}$/.test(compact)) return `+998${compact}`;
  if (/^\d{10,15}$/.test(compact)) return `+${compact}`;
  return null;
}

// Javobda raqamning faqat boshi va oxiri: "+998 90 ••• •• 67"
export function maskPhone(phone) {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 9) return "•••";
  if (d.startsWith("998") && d.length === 12) return `+998 ${d.slice(3, 5)} ••• •• ${d.slice(-2)}`;
  return `+${d.slice(0, -7)} ••• •• ${d.slice(-2)}`;
}

// Kod: "12345", "12 345", yoki Telegram xabarining o'zi nusxalangan bo'lsa — undagi raqam. Topilmasa — null
export function cleanCode(input) {
  const text = String(input ?? "").trim();
  const compact = text.replace(/[\s-]/g, "");
  if (/^\d{3,10}$/.test(compact)) return compact;
  return /\d{4,10}/.exec(text)?.[0] ?? null;
}

// Haqiqiy worker: alohida Node jarayoni. Uning loglari server oynasida «[tg-login] …» bo'lib chiqadi
function spawnWorker({ log }) {
  const child = fork(WORKER, [], {
    cwd: COLLECTOR,
    env: { ...process.env, YUK_TG_LOGIN_WORKER: "1" },
    execArgv: ["--disable-warning=ExperimentalWarning"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) createInterface({ input: stream }).on("line", (line) => line.trim() && log(`[tg-login] ${line}`));
  }
  return child;
}

// store — @yuk/store (listTgAccounts). spawn({ log }) → child (send, kill, on("message"|"exit")) — testda soxtasi.
// sessionExists(nom) — sessions/<nom>.session bormi
// Oddiy foydalanuvchi akkauntining nomi — server o'zi beradi: "u" + chat id (36-lik) + "-" + tartib raqami.
// Foydalanuvchi nom tanlay olmaydi: aks holda boshqa birovning sessiya fayli nomini yozib, ustidan yozishga urinardi
export function userAccountName(chatId, n) {
  return `u${Math.abs(Number(chatId)).toString(36)}-${n}`;
}

export function createTgLogin({
  store,
  env = process.env,
  spawn = spawnWorker,
  sessionExists = (name) => existsSync(path.join(SESSIONS_DIR, `${name}.session`)),
  now = Date.now,
  stepTimeoutMs = STEP_TIMEOUT_MS,
  idleMs = IDLE_MS,
  startsPerHour = STARTS_PER_HOUR,
  userStartsPerHour = USER_STARTS_PER_HOUR,
  usersStartsPerHour = USERS_STARTS_PER_HOUR,
  userMaxAccounts = USER_MAX_ACCOUNTS,
  maxUserLogins = MAX_USER_LOGINS,
  log = console.log,
} = {}) {
  // id → { id, name, phone, step, via, codeLength, hint, error, user, by, mine, startedAt, expiresAt, child, pending, timer }
  // mine — oddiy foydalanuvchi o'zi uchun boshlagan (Sozlamalar); aks holda — admin («🛠 Boshqaruv»)
  const logins = new Map();
  const starts = { admin: [], users: [] }; // kod so'ralgan vaqtlar (oxirgi soat); har foydalanuvchiniki — perUser
  const perUser = new Map();

  const view = (login) =>
    login && {
      id: login.id,
      name: login.name,
      phone: login.phone,
      step: login.step, // sending | code | qr | checking | password | done | failed
      qrUrl: login.step === "qr" ? login.qrUrl : null, // tg://login?token=… — QR shu matndan chiziladi (~30 s da yangilanadi; havola sifatida Telegram uni qabul qilmaydi)
      via: login.via, // kod qayerga ketdi: app | sms | call | email | …
      next: login.next, // «Kodni qayta yuborish» bosilsa qayerga ketadi (sms | call | …; null — boshqa yo'l yo'q)
      resendIn: login.resendAt ? Math.max(0, Math.ceil((login.resendAt - now()) / 1000)) : 0, // shuncha soniyadan keyin qayta yuborish mumkin
      resends: login.resends,
      codeLength: login.codeLength,
      hint: login.hint, // 2FA parol eslatmasi (egasi o'zi qo'ygan)
      error: login.error,
      user: login.user, // kirilgan akkaunt: { userId, username, firstName }
      busy: Boolean(login.pending),
      startedAt: login.startedAt,
      expiresAt: login.expiresAt,
    };

  function stopChild(target) {
    const child = target?.child;
    if (!child) return;
    target.child = null;
    try {
      child.send({ type: "cancel" });
    } catch {
      // jarayon allaqachon yopilgan
    }
    const timer = setTimeout(() => child.kill?.(), 3000);
    timer.unref?.();
  }

  function fail(target, message) {
    if (logins.get(target.id) !== target) return;
    target.step = "failed";
    target.error = message;
    touch(target); // xato matni yana 15 daqiqa ko'rinib tursin (Mini App qayta ochilsa ham)
    stopChild(target);
  }

  function drop(target) {
    logins.delete(target.id);
    clearTimeout(target.timer);
  }

  // Muddati o'tgan kirishlar: davom etayotgani — bekor, tugaganlari esa ro'yxatdan olib tashlanadi
  function sweep() {
    for (const target of [...logins.values()]) {
      if (now() < target.expiresAt || target.pending) continue;
      if (ACTIVE.has(target.step)) fail(target, `${Math.round(idleMs / MINUTE)} daqiqa ichida tugatilmadi — qaytadan boshlang`);
      else drop(target);
    }
  }

  function touch(target) {
    target.expiresAt = now() + idleMs;
    clearTimeout(target.timer);
    target.timer = setTimeout(sweep, idleMs + 1000);
    target.timer.unref?.();
  }

  // Worker'ga bitta so'rov va uning bitta javobi (yoki vaqt tugashi / jarayon yiqilishi)
  function ask(target, message) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => target.pending?.({ type: "timeout" }), stepTimeoutMs);
      timer.unref?.();
      target.pending = (reply) => {
        clearTimeout(timer);
        target.pending = null;
        resolve(reply);
      };
      try {
        target.child.send(message);
      } catch (error) {
        target.pending({ type: "crash", message: error.message });
      }
    });
  }

  function apply(target, reply) {
    if (logins.get(target.id) !== target) return; // shu orada bekor qilingan
    target.error = null;
    switch (reply?.type) {
      case "code":
        Object.assign(target, {
          step: "code",
          via: reply.via ?? null,
          codeLength: reply.length ?? null,
          next: reply.next ?? null,
          resendAt: now() + (reply.timeout ?? 0) * 1000,
        });
        // Raqamsiz: faqat qayerga ketgani — «kod kelmadi» deyilganda tekshirish uchun
        log(`Telegram kod yuborildi: «${target.name}» → ${reply.via ?? "?"}${reply.next ? ` (qayta yuborilsa — ${reply.next})` : ""}`);
        break;
      case "qr":
        Object.assign(target, { step: "qr", qrUrl: reply.url ?? null });
        break;
      case "password":
        Object.assign(target, { step: "password", hint: reply.hint ?? null });
        break;
      case "done":
        Object.assign(target, { step: "done", user: reply.user ?? null });
        target.child = null; // worker o'zi tugaydi
        // Kim qo'shgani — Sozlamalarda har kim faqat o'zinikini ko'rishi uchun; raqam xeshi — keyingi dublikatni erta to'xtatish uchun
        if (target.by != null) store.setTgAccountOwner?.(target.name, target.by, target.phoneHash);
        else store.setTgAccountPhoneHash?.(target.name, target.phoneHash);
        log(`Telegram akkaunt qo'shildi: «${target.name}» (Mini App, ${target.mine ? "foydalanuvchi" : "admin"} ${target.by})`);
        break;
      case "error":
        // retry — noto'g'ri kod/parol: shu bosqich qoladi, xato matni ko'rsatiladi
        if (reply.retry && target.step === "checking") Object.assign(target, { step: target.lastStep, error: reply.message });
        else fail(target, reply.message);
        break;
      case "timeout":
        fail(target, `Telegram ${Math.round(stepTimeoutMs / 1000)} soniyada javob bermadi — qaytadan urinib ko'ring`);
        break;
      default:
        fail(target, "Kirish jarayoni kutilmaganda to'xtadi — qaytadan urinib ko'ring");
    }
  }

  // Shu odamning kirishi. by berilmasa (admin yo'li, eski chaqiruvlar) — istalgani
  const owns = (target, by) => by === undefined || target.by === by;
  const latestOf = (by) => [...logins.values()].filter((t) => owns(t, by)).at(-1) ?? null;

  function ongoing(id, by) {
    sweep();
    const target = logins.get(id);
    if (!target || !owns(target, by)) throw httpError(404, "Bu kirish endi yo'q (bekor qilingan yoki muddati o'tgan) — qaytadan boshlang");
    if (target.pending) throw httpError(409, "Oldingi so'rov hali tugamadi — bir oz kuting");
    return target;
  }

  // Serverda kirish mumkinmi: null — mumkin, aks holda — nega emas (Mini App shuni ko'rsatadi)
  function unavailable() {
    if (!env.TG_API_ID || !env.TG_API_HASH) return "Serverning .env faylida TG_API_ID va TG_API_HASH yo'q — Telegram akkauntiga kirib bo'lmaydi.";
    if (devCollectorProblem("live", env)) {
      return "🧪 Bu server dasturlash rejimida (YUK_ENV=dev): bu yerda ulangan akkauntni collector ishlatmaydi. Akkauntni ishlab turgan serverdagi botning Mini App'idan qo'shing.";
    }
    return null;
  }

  async function step(id, by, expected, message) {
    const target = ongoing(id, by);
    if (target.step !== expected) throw httpError(409, "Bu bosqich allaqachon o'tgan — sahifani yangilang");
    target.lastStep = expected;
    target.step = "checking";
    touch(target);
    apply(target, await ask(target, message));
    return view(target);
  }

  // Soatlik chegara: list — vaqtlar ro'yxati (eskilari tashlanadi); to'lgan bo'lsa — 429
  function within(list, limit, text) {
    while (list.length && now() - list[0] > 60 * MINUTE) list.shift();
    if (list.length >= limit) throw httpError(429, text);
  }

  // Oddiy foydalanuvchi: nom — o'zining yangi nomi yoki o'zi qo'shgan (sessiyasi yo'qolgan) akkaunt nomi
  function userName(requested, by) {
    const own = store.listTgAccounts().filter((a) => a.addedBy === Number(by));
    if (requested) {
      const row = own.find((a) => a.name === String(requested).trim().toLowerCase());
      if (!row) throw httpError(404, "Bunday akkauntingiz yo'q");
      return row.name;
    }
    const working = own.filter((a) => a.status !== "logged_out");
    if (working.length >= userMaxAccounts) throw httpError(409, `Bitta foydalanuvchi ko'pi bilan ${userMaxAccounts} ta akkaunt ulay oladi`);
    const busy = new Set([...store.listTgAccounts().map((a) => a.name), ...[...logins.values()].map((t) => t.name)]);
    for (let n = 1; ; n++) {
      const name = userAccountName(by, n);
      if (!busy.has(name) && !sessionExists(name)) return name;
    }
  }

  return {
    unavailable,

    // by berilsa — shu odamning kirishi (Sozlamalar), aks holda — oxirgisi (admin «🛠 Boshqaruv»)
    current(by) {
      sweep();
      return view(latestOf(by));
    },

    // { name, phone, by, mine } → kod yuborilgan holat (yoki xato bilan «failed»). Tekshiruv xatolari — 400/404/409/429.
    // mine — oddiy foydalanuvchi: nomni server beradi (name — faqat o'z akkauntiga qayta kirish uchun).
    // qr: true — raqamsiz, kodsiz: QR / havola (step «qr», qrUrl); tasdiqlangach worker o'zi done/password yuboradi
    async start({ name, phone, by = null, mine = false, qr = false } = {}) {
      const problem = unavailable();
      if (problem) throw httpError(409, problem);
      if (mine && by == null) throw httpError(401, "Kirish kerak");
      sweep();
      const previous = [...logins.values()].find((t) => t.by === by);
      if (previous && ACTIVE.has(previous.step)) {
        throw httpError(409, `«${previous.name}» akkauntiga kirish davom etyapti — avval uni tugating yoki «Bekor qilish» ni bosing`);
      }
      if (mine && [...logins.values()].filter((t) => t.mine && ACTIVE.has(t.step)).length >= maxUserLogins) {
        throw httpError(429, "Hozir boshqa foydalanuvchilar ham akkaunt ulayapti — bir necha daqiqadan keyin urinib ko'ring");
      }

      let account;
      if (mine) account = userName(name, by);
      else {
        account = String(name ?? "").trim().toLowerCase();
        if (account === MAIN_TG_ACCOUNT) throw httpError(400, `«${MAIN_TG_ACCOUNT}» — asosiy akkaunt nomi. Qo'shimcha akkauntga boshqa nom bering, masalan: ikkinchi`);
        if (!TG_ACCOUNT_NAME.test(account)) throw httpError(400, "Nom kichik lotin harfi bilan boshlansin: 2–20 belgi (harf, raqam, _ yoki -). Masalan: ikkinchi");
      }
      const row = store.listTgAccounts().find((a) => a.name === account);
      // Ishlab turgan akkauntning sessiyasi ustidan yozilmaydi; sessiyasi yo'qolgan (logged_out …) — qayta kirsa bo'ladi
      if (sessionExists(account) && (!row || row.status === "ok")) {
        throw httpError(409, `«${account}» nomli akkaunt allaqachon ulangan — boshqa nom tanlang`);
      }
      if ([...logins.values()].some((t) => t.name === account && t.by !== by && ACTIVE.has(t.step))) {
        throw httpError(409, `«${account}» nomli akkauntga hozir boshqa kirish davom etyapti`);
      }
      const number = qr ? null : normalizeLoginPhone(phone);
      if (!qr && !number) throw httpError(400, "Telefon raqam tushunarsiz. Masalan: +998 90 123 45 67");

      // Shu telefon raqamli akkaunt allaqachon collectorga ulangan bo'lsa — kod/parol so'ramasdan, yangi (dublikat) sessiya
      // ochilmasdan rad etamiz. Raqamning o'zi emas, xeshi solishtiriladi (hashPhone). Faqat BOSHQA nom bilan ishlab
      // turgan (ok/error) akkaunt to'xtatadi; sessiyasi yo'qolgani (logged_out) yoki o'z nomiga qayta kirish — mumkin.
      const phoneHash = qr ? null : hashPhone(number);
      const already = !qr && store.listTgAccounts().find((a) => a.phoneHash && a.phoneHash === phoneHash && a.name !== account && ["ok", "error"].includes(a.status));
      if (already) throw httpError(409, `Bu raqam allaqachon «${already.name}» nomi bilan ulangan — ikkinchi marta ulanmaydi`);
      // Hozir boshqa nom bilan shu raqamga kirish ketayotgan bo'lsa (xotiradagi davom etayotgan kirishlar)
      if (!qr && [...logins.values()].some((t) => t.phoneHash === phoneHash && ACTIVE.has(t.step))) {
        throw httpError(409, "Bu raqamga hozir boshqa kirish davom etyapti");
      }

      const wait = "Telegram bloklamasligi uchun birozdan keyin urinib ko'ring";
      // QR kod yubormaydi — Telegram raqamni bloklamaydi, soatlik chegara kerak emas
      if (qr) {
        // chegarasiz
      } else if (mine) {
        if (!perUser.has(by)) perUser.set(by, []);
        within(perUser.get(by), userStartsPerHour, `Bir soatda ${userStartsPerHour} marta kod so'radingiz — ${wait}`);
        within(starts.users, usersStartsPerHour, `Hozir juda ko'p kod so'ralgan — ${wait}`);
        perUser.get(by).push(now());
        starts.users.push(now());
      } else {
        within(starts.admin, startsPerHour, `Bir soatda ${startsPerHour} marta kod so'raldi — ${wait}`);
        starts.admin.push(now());
      }

      // Ishlab turgan akkauntlar: bir akkaunt ikki nom bilan ulanmasin (worker tekshiradi)
      const taken = Object.fromEntries(
        store
          .listTgAccounts()
          .filter((a) => a.userId && ["ok", "error"].includes(a.status))
          .map((a) => [a.userId, a.name]),
      );
      if (previous) drop(previous); // shu odamning tugagan (done/failed) kirishi o'rniga yangisi
      const target = {
        id: randomUUID(),
        name: account,
        phone: qr ? null : maskPhone(number),
        qrUrl: null,
        phoneHash, // raqamning xeshi: kirish tugaganda saqlanadi, in-flight dublikat tekshiruvi uchun ham
        step: "sending",
        via: null,
        next: null,
        resendAt: null,
        resends: 0,
        codeLength: null,
        hint: null,
        error: null,
        user: null,
        by,
        mine,
        startedAt: now(),
        expiresAt: now() + idleMs,
        child: null,
        pending: null,
        timer: null,
      };
      logins.set(target.id, target);
      touch(target);
      try {
        target.child = spawn({ log });
      } catch (error) {
        fail(target, `Kirish jarayonini ochib bo'lmadi: ${error.message}`);
        return view(target);
      }
      // QR bosqichida worker o'zi ham yozadi (yangi QR, tasdiqlandi, 2FA kerak) — so'rov kutilmayotgan paytda
      target.child.on("message", (reply) => (target.pending ? target.pending(reply) : apply(target, reply)));
      target.child.on("exit", (code) => {
        const was = target.child;
        target.child = null;
        if (target.pending) target.pending({ type: "crash", code });
        else if (was && logins.get(target.id) === target && ACTIVE.has(target.step)) fail(target, "Kirish jarayoni kutilmaganda to'xtadi — qaytadan urinib ko'ring");
      });
      target.child.on("error", () => {}); // «exit» baribir keladi
      apply(target, await ask(target, qr ? { type: "qr", name: account, taken } : { type: "start", name: account, phone: number, taken }));
      return view(target);
    },

    // by — oddiy foydalanuvchi yo'lida: faqat o'z kirishi (boshqaning id'si — 404)
    async code(id, input, by) {
      const code = cleanCode(input);
      if (!code) throw httpError(400, "Kodni kiriting — Telegram yuborgan raqamlar");
      return step(id, by, "code", { type: "code", code });
    },

    // «Kod kelmadi» — Telegram keyingi yo'l bilan (SMS / qo'ng'iroq) qayta yuboradi. Ko'pi bilan MAX_RESENDS marta
    async resend(id, by) {
      const target = ongoing(id, by);
      if (target.step !== "code") throw httpError(409, "Bu bosqich allaqachon o'tgan — sahifani yangilang");
      if (target.resends >= MAX_RESENDS) throw httpError(429, "Kod bir necha marta qayta yuborildi — «Bekor qilish» ni bosib, birozdan keyin qaytadan boshlang");
      if (target.resendAt && now() < target.resendAt) {
        throw httpError(429, `Qayta yuborish ${Math.ceil((target.resendAt - now()) / 1000)} soniyadan keyin mumkin`);
      }
      target.resends++;
      return step(id, by, "code", { type: "resend" });
    },

    async password(id, input, by) {
      const password = typeof input === "string" ? input : "";
      if (!password) throw httpError(400, "Parolni kiriting");
      if (password.length > 256) throw httpError(400, "Parol juda uzun");
      return step(id, by, "password", { type: "password", password });
    },

    // «Bekor qilish» / «Yopish»: davom etayotgan kirish to'xtatiladi, tugagani ro'yxatdan olinadi
    cancel(id, by) {
      const target = logins.get(id);
      if (!target || !owns(target, by)) return false;
      drop(target);
      target.pending?.({ type: "cancelled" });
      stopChild(target);
      return true;
    },

    // Server to'xtayapti
    close() {
      for (const target of logins.values()) {
        clearTimeout(target.timer);
        stopChild(target);
      }
      logins.clear();
    },
  };
}
