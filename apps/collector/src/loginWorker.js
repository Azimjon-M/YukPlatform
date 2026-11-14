// Telegram akkauntiga kirish — Mini App'ning «🛠 Boshqaruv» bo'limidan (2026-11-13, Azimjon: «3 ta telegram accountni
// terminaldan bog'lash qiyin … faqat kompyuterimdan» → «Faqat raqam + kod» → «O'zimizni MiniApp da qil»).
//
// Server (apps/api/src/tgLogin.js) bu faylni ALOHIDA jarayon qilib ishga tushiradi (fork) va IPC orqali
// bosqichma-bosqich gaplashadi (har so'rovga bitta javob):
//   server → { type: "start", name, phone, taken }   javob: { type: "code", via, length, next, timeout }
//   server → { type: "resend" }                      javob: { type: "code", … } — «Kod kelmadi»: keyingi yo'l bilan
//   server → { type: "qr", name, taken }             javob: { type: "qr", url, expires } — QR / havola (kodsiz kirish);
//     keyin worker O'ZI yuboradi: yangi QR (har ~30 s) { type: "qr", … }, tasdiqlansa { type: "done" } yoki
//     { type: "password", hint } (2FA), xato — { type: "error", retry: false }
//   server → { type: "code", code }                  javob: { type: "password", hint } | { type: "done", user }
//   server → { type: "password", password }          javob: { type: "done", user }
//   server → { type: "cancel" }                      jarayon tugaydi
//   xato: { type: "error", retry, message } — retry: true — shu bosqich qaytadan (noto'g'ri kod yoki parol),
//   false — kirish tugadi (qaytadan boshlash kerak). «done» yoki retry: false dan keyin jarayon o'zi tugaydi.
//
// Nega alohida jarayon: GramJS ba'zan ushlanmagan xato tashlaydi — server (bot va collector'ning otasi) yiqilmasin.
// Kod va parol faqat IPC trubasidan o'tadi: faylga, logga va buyruq qatoriga (ps) tushmaydi.
// Kirilsa — sessiya apps/collector/sessions/<nom>.session ga yoziladi; ishlab turgan collector uni 30 soniya ichida
// o'zi ulaydi (accounts.js superviseAccounts) — qayta ishga tushirish shart emas.
import { authErrorAction } from "./authErrors.js";
import { accountTitle } from "./accounts.js";

const QR_REFRESH_MS = 30_000;
const QR_MIN_WAIT_MS = 5_000;

// Xato matnida «qaytadan qanday boshlash» (terminaldagi «npm run tg:login» o'rniga)
export const AGAIN = "«➕ Akkaunt qo'shish» ni qayta bosing";

// telegram — { createClient, sendLoginCode, signInWithCode, signInWithPassword, userInfo, saveSession,
//   closeAuthorization, disconnect } (telegram.js; testda — soxtasi). send(message) → Promise (IPC javobi)
export function createLoginSession({ telegram, send }) {
  let step = "start"; // start → code → password → done | failed
  let client = null;
  let name = null;
  let phone = null;
  let hash = null;
  let taken = {}; // { userId: nom } — ishlab turgan akkauntlar (bir akkaunt ikki nom bilan ulanmasin)
  let retries = 0;
  let wake = null; // QR kutilayotganda: egasi tasdiqladi (yoki to'xtatildi) — darhol tekshirish

  async function fail(error) {
    const action = authErrorAction(error, retries, { again: AGAIN });
    // Raqam bosqichida qayta so'rab bo'lmaydi (yangi kirish kerak) — xato matni baribir tushunarli
    if (action.retry && (step === "code" || step === "password")) {
      retries++;
      return send({ type: "error", retry: true, message: action.message });
    }
    step = "failed";
    return send({ type: "error", retry: false, message: action.message });
  }

  async function finish(user) {
    const me = telegram.userInfo(user);
    const owner = taken[me.userId];
    if (owner && owner !== name) {
      // Kerak bo'lmagan yangi sessiya akkauntning «Qurilmalar» ro'yxatida qolib ketmasin
      await Promise.resolve(telegram.closeAuthorization(client)).catch(() => {});
      step = "failed";
      return send({ type: "error", retry: false, message: `Bu akkaunt (${accountTitle(me)}) allaqachon «${owner}» nomi bilan ulangan — ikkinchi marta ulanmaydi. Hozir ochilgan sessiya yopildi.` });
    }
    try {
      await telegram.saveSession(client, name);
    } catch (error) {
      await Promise.resolve(telegram.closeAuthorization(client)).catch(() => {});
      throw error;
    }
    step = "done";
    return send({ type: "done", user: me });
  }

  async function handle(message) {
    try {
      if (message?.type === "start" && step === "start") {
        ({ name, phone } = message);
        taken = message.taken ?? {};
        client = await telegram.createClient("");
        const sent = await telegram.sendLoginCode(client, phone);
        hash = sent.phoneCodeHash;
        step = "code";
        return await send({ type: "code", via: sent.via ?? null, length: sent.length ?? null, next: sent.next ?? null, timeout: sent.timeout ?? null });
      }
      if (message?.type === "qr" && step === "start") {
        ({ name } = message);
        taken = message.taken ?? {};
        client = await telegram.createClient("");
        telegram.onLoginTokenAccepted(client, () => wake?.());
        step = "qr";
        return await qrLoop();
      }
      if (message?.type === "resend" && step === "code") {
        const sent = await telegram.resendLoginCode(client, { phoneNumber: phone, phoneCodeHash: hash });
        hash = sent.phoneCodeHash;
        return await send({ type: "code", via: sent.via ?? null, length: sent.length ?? null, next: sent.next ?? null, timeout: sent.timeout ?? null });
      }
      if (message?.type === "code" && step === "code") {
        const result = await telegram.signInWithCode(client, { phoneNumber: phone, phoneCodeHash: hash, code: String(message.code ?? "") });
        if (!result.password) return await finish(result.user);
        step = "password";
        retries = 0; // parol urinishlari alohida sanaladi
        return await send({ type: "password", hint: result.hint ?? null });
      }
      if (message?.type === "password" && step === "password") {
        return await finish((await telegram.signInWithPassword(client, String(message.password ?? ""))).user);
      }
      return await send({ type: "error", retry: true, message: "Bu bosqichda kutilmagan so'rov — sahifani yangilang" });
    } catch (error) {
      return fail(error);
    }
  }

  // QR tasdiqlanguncha: token eskirsa — yangisi (Telegram tokeni ~30 s yashaydi). Tasdiqlanganini UpdateLoginToken
  // aytadi; u kelmasa ham keyingi eksportda LoginTokenSuccess qaytadi
  async function qrLoop() {
    while (step === "qr") {
      const result = await telegram.exportLoginToken(client);
      if (result.user) return finish(result.user);
      if (result.password) {
        step = "password";
        retries = 0;
        return send({ type: "password", hint: result.hint ?? null });
      }
      await send({ type: "qr", url: result.url, expires: result.expires ?? null });
      const left = result.expires ? result.expires * 1000 - Date.now() - 2000 : QR_REFRESH_MS;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, Math.min(QR_REFRESH_MS, Math.max(QR_MIN_WAIT_MS, left)));
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
    }
  }

  return {
    handle,
    get step() {
      return step;
    },
    get finished() {
      return step === "done" || step === "failed";
    },
    async close() {
      if (step === "qr") step = "failed";
      wake?.();
      const open = client;
      client = null;
      if (open) await Promise.resolve(telegram.disconnect(open)).catch(() => {});
    },
  };
}

// Server ishga tushirgandagina (YUK_TG_LOGIN_WORKER=1 va IPC bor) — testlar faylni oddiy import qiladi
async function runWorker() {
  const tg = await import("./telegram.js");
  const send = (message) => new Promise((resolve) => process.send(message, () => resolve()));
  const session = createLoginSession({ telegram: { ...tg, disconnect: (client) => client.disconnect() }, send });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await session.close();
    process.exit(0);
  };
  let queue = Promise.resolve();
  process.on("message", (message) => {
    if (message?.type === "cancel") return void stop();
    queue = queue.then(() => session.handle(message)).then(() => (session.finished ? stop() : undefined));
  });
  process.on("disconnect", () => void stop()); // server yopildi yoki bizni tashlab ketdi
  // GramJS ichidagi ushlanmagan xato (masalan, tarmoq TIMEOUT) kirishni buzmasin — faqat logga
  process.on("unhandledRejection", (error) => console.error(`GramJS: ${error?.errorMessage ?? error?.message ?? error}`));
}

if (process.env.YUK_TG_LOGIN_WORKER === "1" && process.send) runWorker();
