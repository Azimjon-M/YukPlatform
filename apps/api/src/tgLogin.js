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
// Bir vaqtda bitta kirish. Holat server xotirasida: Mini App yopilib qayta ochilsa (bitta telefonda kodni ko'rish uchun
// Telegram'da boshqa akkauntga o'tib, qaytib kelsa) — shu bosqichdan davom etadi. 15 daqiqa harakatsiz — bekor.
// Kod va parol hech qayerga yozilmaydi va javobga qaytmaydi; raqam javobda yashirilgan (+998 90 ••• •• 67).
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { devCollectorProblem } from "@yuk/shared";
import { MAIN_TG_ACCOUNT, TG_ACCOUNT_NAME } from "@yuk/store";

const COLLECTOR = fileURLToPath(new URL("../../collector/", import.meta.url));
const WORKER = path.join(COLLECTOR, "src/loginWorker.js");
// apps/collector/src/telegram.js SESSIONS_DIR bilan bir xil (u yerni import qilsak, server GramJS'ni yuklab olardi)
const SESSIONS_DIR = path.join(COLLECTOR, "sessions");

const MINUTE = 60_000;
export const STEP_TIMEOUT_MS = 90_000; // Telegram shu vaqtda javob bermasa — kirish bekor
export const IDLE_MS = 15 * MINUTE; // kod/parol shu vaqtda kiritilmasa — bekor (Telegram kodi ham eskiradi)
export const STARTS_PER_HOUR = 5; // kod so'rash: Telegram ko'p so'ralgan raqamni va API kalitini bloklaydi
const ACTIVE = new Set(["sending", "code", "checking", "password"]);

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
export function createTgLogin({
  store,
  env = process.env,
  spawn = spawnWorker,
  sessionExists = (name) => existsSync(path.join(SESSIONS_DIR, `${name}.session`)),
  now = Date.now,
  stepTimeoutMs = STEP_TIMEOUT_MS,
  idleMs = IDLE_MS,
  startsPerHour = STARTS_PER_HOUR,
  log = console.log,
} = {}) {
  let login = null; // { id, name, phone, step, via, codeLength, hint, error, user, by, startedAt, expiresAt, child, pending }
  let idleTimer = null;
  const starts = []; // kod so'ralgan vaqtlar (oxirgi soat)

  const view = () =>
    login && {
      id: login.id,
      name: login.name,
      phone: login.phone,
      step: login.step, // sending | code | checking | password | done | failed
      via: login.via, // kod qayerga ketdi: app | sms | call | email | …
      codeLength: login.codeLength,
      hint: login.hint, // 2FA parol eslatmasi (egasi o'zi qo'ygan)
      error: login.error,
      user: login.user, // kirilgan akkaunt: { userId, username, firstName }
      busy: Boolean(login.pending),
      startedAt: login.startedAt,
      expiresAt: login.expiresAt,
    };

  function stopChild(target = login) {
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

  function fail(message) {
    if (!login) return;
    login.step = "failed";
    login.error = message;
    touch(); // xato matni yana 15 daqiqa ko'rinib tursin (Mini App qayta ochilsa ham)
    stopChild();
  }

  // Muddati o'tgan kirish: davom etayotgan bo'lsa — bekor, tugaganini esa ro'yxatdan olib tashlaymiz
  function sweep() {
    if (!login || now() < login.expiresAt || login.pending) return;
    if (ACTIVE.has(login.step)) fail(`${Math.round(idleMs / MINUTE)} daqiqa ichida tugatilmadi — qaytadan boshlang`);
    else login = null;
  }

  function touch() {
    login.expiresAt = now() + idleMs;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(sweep, idleMs + 1000);
    idleTimer.unref?.();
  }

  // Worker'ga bitta so'rov va uning bitta javobi (yoki vaqt tugashi / jarayon yiqilishi)
  function ask(message) {
    const target = login;
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
    if (login !== target) return; // shu orada bekor qilingan
    target.error = null;
    switch (reply?.type) {
      case "code":
        Object.assign(target, { step: "code", via: reply.via ?? null, codeLength: reply.length ?? null });
        break;
      case "password":
        Object.assign(target, { step: "password", hint: reply.hint ?? null });
        break;
      case "done":
        Object.assign(target, { step: "done", user: reply.user ?? null });
        target.child = null; // worker o'zi tugaydi
        log(`Telegram akkaunt qo'shildi: «${target.name}» (Mini App, admin ${target.by})`);
        break;
      case "error":
        // retry — noto'g'ri kod/parol: shu bosqich qoladi, xato matni ko'rsatiladi
        if (reply.retry && target.step === "checking") Object.assign(target, { step: target.lastStep, error: reply.message });
        else fail(reply.message);
        break;
      case "timeout":
        fail(`Telegram ${Math.round(stepTimeoutMs / 1000)} soniyada javob bermadi — qaytadan urinib ko'ring`);
        break;
      default:
        fail("Kirish jarayoni kutilmaganda to'xtadi — qaytadan urinib ko'ring");
    }
  }

  function ongoing(id) {
    sweep();
    if (!login || login.id !== id) throw httpError(404, "Bu kirish endi yo'q (bekor qilingan yoki muddati o'tgan) — qaytadan boshlang");
    if (login.pending) throw httpError(409, "Oldingi so'rov hali tugamadi — bir oz kuting");
    return login;
  }

  // Serverda kirish mumkinmi: null — mumkin, aks holda — nega emas (Mini App shuni ko'rsatadi)
  function unavailable() {
    if (!env.TG_API_ID || !env.TG_API_HASH) return "Serverning .env faylida TG_API_ID va TG_API_HASH yo'q — Telegram akkauntiga kirib bo'lmaydi.";
    if (devCollectorProblem("live", env)) {
      return "🧪 Bu server dasturlash rejimida (YUK_ENV=dev): bu yerda ulangan akkauntni collector ishlatmaydi. Akkauntni ishlab turgan serverdagi botning Mini App'idan qo'shing.";
    }
    return null;
  }

  async function step(id, expected, message) {
    const target = ongoing(id);
    if (target.step !== expected) throw httpError(409, "Bu bosqich allaqachon o'tgan — sahifani yangilang");
    target.lastStep = expected;
    target.step = "checking";
    touch();
    apply(target, await ask(message));
    return view();
  }

  return {
    unavailable,

    current() {
      sweep();
      return view();
    },

    // { name, phone, by } → kod yuborilgan holat (yoki xato bilan «failed»). Tekshiruv xatolari — 400/409/429
    async start({ name, phone, by = null } = {}) {
      const problem = unavailable();
      if (problem) throw httpError(409, problem);
      sweep();
      if (login && ACTIVE.has(login.step)) {
        throw httpError(409, `«${login.name}» akkauntiga kirish davom etyapti — avval uni tugating yoki «Bekor qilish» ni bosing`);
      }
      const account = String(name ?? "").trim().toLowerCase();
      if (account === MAIN_TG_ACCOUNT) throw httpError(400, `«${MAIN_TG_ACCOUNT}» — asosiy akkaunt nomi. Qo'shimcha akkauntga boshqa nom bering, masalan: ikkinchi`);
      if (!TG_ACCOUNT_NAME.test(account)) throw httpError(400, "Nom kichik lotin harfi bilan boshlansin: 2–20 belgi (harf, raqam, _ yoki -). Masalan: ikkinchi");
      const row = store.listTgAccounts().find((a) => a.name === account);
      // Ishlab turgan akkauntning sessiyasi ustidan yozilmaydi; sessiyasi yo'qolgan (logged_out …) — qayta kirsa bo'ladi
      if (sessionExists(account) && (!row || row.status === "ok")) {
        throw httpError(409, `«${account}» nomli akkaunt allaqachon ulangan — boshqa nom tanlang`);
      }
      const number = normalizeLoginPhone(phone);
      if (!number) throw httpError(400, "Telefon raqam tushunarsiz. Masalan: +998 90 123 45 67");
      while (starts.length && now() - starts[0] > 60 * MINUTE) starts.shift();
      if (starts.length >= startsPerHour) {
        throw httpError(429, `Bir soatda ${startsPerHour} marta kod so'raldi — Telegram bloklamasligi uchun birozdan keyin urinib ko'ring`);
      }
      starts.push(now());

      // Ishlab turgan akkauntlar: bir akkaunt ikki nom bilan ulanmasin (worker tekshiradi)
      const taken = Object.fromEntries(
        store
          .listTgAccounts()
          .filter((a) => a.userId && ["ok", "error"].includes(a.status))
          .map((a) => [a.userId, a.name]),
      );
      const target = {
        id: randomUUID(),
        name: account,
        phone: maskPhone(number),
        step: "sending",
        via: null,
        codeLength: null,
        hint: null,
        error: null,
        user: null,
        by,
        startedAt: now(),
        expiresAt: now() + idleMs,
        child: null,
        pending: null,
      };
      login = target;
      touch();
      try {
        target.child = spawn({ log });
      } catch (error) {
        fail(`Kirish jarayonini ochib bo'lmadi: ${error.message}`);
        return view();
      }
      target.child.on("message", (reply) => target.pending?.(reply));
      target.child.on("exit", (code) => {
        const was = target.child;
        target.child = null;
        if (target.pending) target.pending({ type: "crash", code });
        else if (was && login === target && ACTIVE.has(target.step)) fail("Kirish jarayoni kutilmaganda to'xtadi — qaytadan urinib ko'ring");
      });
      target.child.on("error", () => {}); // «exit» baribir keladi
      apply(target, await ask({ type: "start", name: account, phone: number, taken }));
      return view();
    },

    async code(id, input) {
      const code = cleanCode(input);
      if (!code) throw httpError(400, "Kodni kiriting — Telegram yuborgan raqamlar");
      return step(id, "code", { type: "code", code });
    },

    async password(id, input) {
      const password = typeof input === "string" ? input : "";
      if (!password) throw httpError(400, "Parolni kiriting");
      if (password.length > 256) throw httpError(400, "Parol juda uzun");
      return step(id, "password", { type: "password", password });
    },

    // «Bekor qilish» / «Yopish»: davom etayotgan kirish to'xtatiladi, tugagani ro'yxatdan olinadi
    cancel(id) {
      if (!login || login.id !== id) return false;
      const target = login;
      login = null;
      target.pending?.({ type: "cancelled" });
      stopChild(target);
      return true;
    },

    // Server to'xtayapti
    close() {
      clearTimeout(idleTimer);
      if (login) stopChild(login);
      login = null;
    },
  };
}
