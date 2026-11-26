// Telegram bilan ishlaydigan HAMMA kod shu faylda.
// Kutubxona: GramJS ("telegram" paketi). U 2026-yilda arxivlangan; davomi — "teleproto" forki.
// Keyinroq o'tish kerak bo'lsa, faqat shu fayl o'zgaradi.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Api, TelegramClient, utils } from "telegram";
import { NewMessage, Raw } from "telegram/events/index.js";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { computeCheck } from "telegram/Password.js";
import { StringSession } from "telegram/sessions/index.js";
import { MAIN_TG_ACCOUNT, TG_ACCOUNT_NAME } from "@yuk/store";
import { authErrorAction } from "./authErrors.js";
import { senderUsername } from "./live.js";

// Sessiya fayli = akkauntga kirish kaliti. U gitga tushmaydi (.gitignore: *.session).
export const SESSION_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../telegram.session");
// Qo'shimcha akkauntlar (2026-11-13, yopiq guruhlar uchun): har biri o'z faylida — sessions/<nom>.session.
// «asosiy» — yuqoridagi SESSION_FILE (yoki .env TG_SESSION), avvalgidek
export const SESSIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sessions");
export const MAIN_ACCOUNT = MAIN_TG_ACCOUNT;

// my.telegram.org dagi ilova kalitlari (.env). 8a236e5 da tasodifan o'chib ketgan edi — createClient
// «readConfig is not defined» bilan yiqilardi (collector umuman ulanmasdi); telegram.test.js endi buni tutadi
export function readConfig(env = process.env) {
  const apiId = Number(env.TG_API_ID);
  const apiHash = env.TG_API_HASH;
  if (!apiId || !apiHash) {
    throw new Error(
      "TG_API_ID va TG_API_HASH topilmadi.\n" +
        "my.telegram.org → API development tools → ilova yarating, keyin ikkalasini .env ga yozing.",
    );
  }
  return { apiId, apiHash };
}

// --account qiymatini tekshiradi: bo'sh — asosiy. Nom fayl nomiga aylanadi, shuning uchun faqat xavfsiz belgilar
export function accountName(input) {
  const name = String(input ?? "").trim().toLowerCase();
  if (!name || name === MAIN_ACCOUNT) return MAIN_ACCOUNT;
  if (!TG_ACCOUNT_NAME.test(name)) {
    throw new Error(`Akkaunt nomi "${input}" yaroqsiz: kichik lotin harfi bilan boshlansin, 2–20 belgi (harf, raqam, _ yoki -). Masalan: --account ikkinchi`);
  }
  return name;
}

export const sessionFile = (account = MAIN_ACCOUNT) => (account === MAIN_ACCOUNT ? SESSION_FILE : path.join(SESSIONS_DIR, `${account}.session`));
// Buyruqlarda ko'rsatish uchun: asosiy akkauntga --account kerak emas
const accountFlag = (account) => (account === MAIN_ACCOUNT ? "" : ` -- --account ${account}`);

export async function loadSession(account = MAIN_ACCOUNT) {
  if (account === MAIN_ACCOUNT && process.env.TG_SESSION) return process.env.TG_SESSION;
  const file = sessionFile(account);
  return existsSync(file) ? (await readFile(file, "utf8")).trim() : "";
}

// 0o600 — serverda (Linux) faylni faqat egasi o'qiy oladi
export async function saveSession(client, account = MAIN_ACCOUNT) {
  const file = sessionFile(account);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, client.session.save(), { encoding: "utf8", mode: 0o600 });
}

export async function deleteSession(account = MAIN_ACCOUNT) {
  const file = sessionFile(account);
  if (existsSync(file)) await unlink(file);
}

// Qo'shimcha akkauntlar (sessions/*.session): [{ name, changedAt }] — changedAt: fayl o'zgargan vaqt
// (qayta kirilsa yangilanadi — «sessiya bekor qilingan» holatidagi akkaunt shunda qayta ulanadi)
export async function listAccounts() {
  const files = await readdir(SESSIONS_DIR).catch(() => []);
  const out = [];
  for (const file of files.sort()) {
    const name = file.replace(/\.session$/, "");
    if (!file.endsWith(".session") || !TG_ACCOUNT_NAME.test(name) || name === MAIN_ACCOUNT) continue;
    const info = await stat(path.join(SESSIONS_DIR, file)).catch(() => null);
    if (info?.size) out.push({ name, changedAt: info.mtimeMs });
  }
  return out;
}

export async function createClient(sessionString) {
  const { apiId, apiHash } = readConfig();
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
    // Node'da GramJS standart holatda 80-portdan ulanadi. Ba'zi tarmoqlarda (bizda ham, 2026-11-04)
    // 80-portdagi MTProto javobsiz qoladi va ulanish "New auth_key attempt" da osilib turadi.
    // Node'da useWSS: true TLS yoqmaydi — oddiy TCP'ni 443-portga o'tkazadi, xolos.
    useWSS: true,
    baseLogger: new Logger(LogLevel.ERROR), // GramJS'ning ortiqcha loglarini o'chiradi
  });
  await client.connect();
  return client;
}

// Saqlangan sessiya bilan ulanadi; sessiya bo'lmasa yoki bekor qilingan bo'lsa — xato (code "SESSION": qayta urinish
// foydasiz, egasi qayta kirishi kerak). GramJS checkAuthorization har qanday xatoda (tarmoq ham) false qaytaradi —
// shuning uchun tekshiruv so'rovini o'zimiz yuboramiz: tarmoq xatosi oddiy xato bo'lib qoladi (keyin qayta urinadi)
const AUTH_ERROR = /AUTH_KEY|SESSION_|USER_DEACTIVATED/;
export async function connectSaved(account = MAIN_ACCOUNT) {
  const session = await loadSession(account);
  const sessionError = (message) => Object.assign(new Error(message), { code: "SESSION" });
  if (!session) throw sessionError(`Avval Telegram'ga kiring: npm run tg:login${accountFlag(account)}`);
  const client = await createClient(session);
  try {
    await client.invoke(new Api.updates.GetState());
  } catch (error) {
    await client.disconnect().catch(() => {});
    if (error?.code === 401 || AUTH_ERROR.test(error?.errorMessage ?? "")) {
      throw sessionError(`Sessiya bekor qilingan (${error.errorMessage ?? error.message}). Qayta kiring: npm run tg:login${accountFlag(account)}`);
    }
    throw error;
  }
  return client;
}

// Akkaunt kimligi (boshqaruv markazida ko'rsatish va bir akkaunt ikki nom bilan ulanmasligi uchun)
export async function whoAmI(client) {
  const me = await client.getMe();
  // phone — akkauntning o'z raqami (QR bilan kirganda ham Telegram beradi). Bazaga faqat xeshi yoziladi (accounts.js)
  return { userId: String(me.id), username: me.username ?? null, firstName: me.firstName ?? null, phone: me.phone ?? null };
}

// ask(savol, { hidden }) — terminaldan javob o'qiydigan funksiya (cli.js beradi).
// account — qaysi nom bilan saqlanadi (standart — asosiy; serverdagi loginFlow.js shunday chaqiradi)
export async function login(ask, { account = MAIN_ACCOUNT } = {}) {
  const client = await createClient(await loadSession(account));
  let retries = 0;
  let stopMessage = null;
  try {
    await client.start({
      phoneNumber: () => ask("Telefon raqam (+998...): "),
      phoneCode: () => ask("Telegram yuborgan kod: "),
      password: (hint) => ask(`2FA parol${hint ? ` (eslatma: ${hint})` : ""}: `, { hidden: true }),
      // Raqamda akkaunt bo'lmasa, GramJS o'zi "first name" nomli yangi akkaunt ochib yuboradi.
      // Bunga yo'l qo'ymaymiz: xato berib, kirishni to'xtatamiz.
      firstAndLastNames: async () => {
        throw new Error("Bu raqamda Telegram akkaunt yo'q. Avval Telegram ilovasida ro'yxatdan o'ting.");
      },
      // false — savolni qayta beradi, true — kirishni to'xtatadi.
      // Oldin bu yerda hech narsa qaytmas edi, shuning uchun GramJS xatoda cheksiz qayta urinardi.
      onError: (error) => {
        const action = authErrorAction(error, retries);
        if (action.retry) {
          retries += 1;
          console.error(action.message);
          return false;
        }
        stopMessage = action.message;
        return true;
      },
    });
  } catch (error) {
    await client.disconnect();
    throw new Error(stopMessage ?? authErrorAction(error).message);
  }
  await saveSession(client, account);
  return client;
}

// --- Mini App'dan kirish (loginWorker.js, 2026-11-13): raqam → kod → (2FA bo'lsa) parol, bosqichma-bosqich ---
// client.start() hamma savolni bitta chaqiruvda so'raydi; Mini App'da esa har bosqich alohida so'rov bo'lib keladi.
// Kod qayerga ketdi: app — akkauntning Telegram ilovasidagi «Telegram» xizmat chatiga, sms, call — qo'ng'iroq, email…
const CODE_VIA = {
  SentCodeTypeApp: "app",
  SentCodeTypeSms: "sms",
  SentCodeTypeFirebaseSms: "sms",
  SentCodeTypeSmsWord: "sms",
  SentCodeTypeSmsPhrase: "sms",
  SentCodeTypeCall: "call",
  SentCodeTypeFlashCall: "call",
  SentCodeTypeMissedCall: "call",
  SentCodeTypeEmailCode: "email",
  SentCodeTypeSetUpEmailRequired: "setup_email",
  SentCodeTypeFragmentSms: "fragment",
};
// GramJS className — "auth.SentCodeTypeApp" ko'rinishida
const codeVia = (type) => (type ? (CODE_VIA[String(type.className).replace(/^auth\./, "")] ?? "other") : null);

// Kod yuborish → { phoneCodeHash, via, length }. AUTH_RESTART — Telegram «boshidan boshlang» dedi: bir marta qayta
export async function sendLoginCode(client, phoneNumber) {
  const { apiId, apiHash } = readConfig();
  const ask = () => client.invoke(new Api.auth.SendCode({ phoneNumber, apiId, apiHash, settings: new Api.CodeSettings({}) }));
  let sent;
  try {
    sent = await ask();
  } catch (error) {
    if (error?.errorMessage !== "AUTH_RESTART") throw error;
    sent = await ask();
  }
  if (!(sent instanceof Api.auth.SentCode)) throw new Error("Telegram kod yubormadi (kutilmagan javob)");
  return sentCodeInfo(sent);
}

// SentCode → { phoneCodeHash, via, length, next, timeout }. next — «qayta yuborish» bosilsa kod qayerga ketadi
// (sms/call; null — boshqa yo'l yo'q), timeout — shuncha soniyadan keyin qayta yuborish mumkin
const NEXT_VIA = { CodeTypeSms: "sms", CodeTypeCall: "call", CodeTypeFlashCall: "call", CodeTypeMissedCall: "call", CodeTypeFragmentSms: "fragment" };
function sentCodeInfo(sent) {
  const next = sent.nextType ? (NEXT_VIA[String(sent.nextType.className).replace(/^auth\./, "")] ?? "other") : null;
  return { phoneCodeHash: sent.phoneCodeHash, via: codeVia(sent.type), length: sent.type?.length ?? null, next, timeout: sent.timeout ?? null };
}

// «Kod kelmadi» — Telegram kodni keyingi yo'l bilan (odatda SMS yoki qo'ng'iroq) qayta yuboradi; yangi phoneCodeHash
export async function resendLoginCode(client, { phoneNumber, phoneCodeHash }) {
  const sent = await client.invoke(new Api.auth.ResendCode({ phoneNumber, phoneCodeHash }));
  if (!(sent instanceof Api.auth.SentCode)) throw new Error("Telegram kodni qayta yubormadi (kutilmagan javob)");
  return sentCodeInfo(sent);
}

// --- QR / havola orqali kirish (2026-11-13, Azimjon: kod «yuborildi» deyiladi-yu, kelmaydi → «QR va Link orqali kirish»).
// Telegram Desktop'ni ulash bilan bir xil: auth.exportLoginToken → tg://login?token=… (QR) → egasi BOSHQA qurilmadagi
// Telegram'da skanerlaydi (Sozlamalar → Qurilmalar → «Qurilma ulash»; havolani bosish ishlamaydi — Telegram Android/iOS
// tg://login havolasida faqat «QR'ni skanerlang» deydi, fishingdan himoya) → UpdateLoginToken keladi →
// yana exportLoginToken → LoginTokenSuccess (boshqa DC bo'lsa — MigrateTo → importLoginToken). Kod kerak emas.
// → { url, expires } (hali tasdiqlanmagan; expires — unix soniya) | { user } | { password: true, hint } (2FA bor)
export async function exportLoginToken(client) {
  const { apiId, apiHash } = readConfig();
  try {
    let result = await client.invoke(new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }));
    if (result instanceof Api.auth.LoginTokenMigrateTo) {
      await client._switchDC(result.dcId);
      result = await client.invoke(new Api.auth.ImportLoginToken({ token: result.token }));
    }
    if (result instanceof Api.auth.LoginToken) {
      const token = Buffer.from(result.token).toString("base64url");
      return { url: `tg://login?token=${token}`, expires: result.expires };
    }
    if (result instanceof Api.auth.LoginTokenSuccess && result.authorization instanceof Api.auth.Authorization) {
      return { user: result.authorization.user };
    }
    throw new Error(`Telegram kutilmagan javob berdi (${result?.className})`);
  } catch (error) {
    if (error?.errorMessage !== "SESSION_PASSWORD_NEEDED") throw error;
    const info = await client.invoke(new Api.account.GetPassword());
    return { password: true, hint: info.hint || null };
  }
}

// Egasi QR/havolani tasdiqlaganda (UpdateLoginToken) callback chaqiriladi
export function onLoginTokenAccepted(client, callback) {
  client.addEventHandler((update) => {
    if (update instanceof Api.UpdateLoginToken) callback();
  }, new Raw({}));
}

// Kod bilan kirish → { user } yoki { password: true, hint } (akkauntda 2FA bor).
// Raqamda akkaunt yo'q bo'lsa — xato: GramJS'dagidek yangi akkaunt OCHMAYMIZ
export async function signInWithCode(client, { phoneNumber, phoneCodeHash, code }) {
  try {
    const result = await client.invoke(new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode: code }));
    if (result instanceof Api.auth.AuthorizationSignUpRequired) {
      throw Object.assign(new Error("Bu raqamda Telegram akkaunt yo'q"), { errorMessage: "SIGN_UP_REQUIRED" });
    }
    return { user: result.user };
  } catch (error) {
    if (error?.errorMessage !== "SESSION_PASSWORD_NEEDED") throw error;
    const info = await client.invoke(new Api.account.GetPassword());
    return { password: true, hint: info.hint || null };
  }
}

// 2FA parol: Telegram parolning o'zini emas, undan hisoblangan isbotni (SRP) oladi → { user }
export async function signInWithPassword(client, password) {
  const info = await client.invoke(new Api.account.GetPassword());
  const result = await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(info, password) }));
  return { user: result.user };
}

// Kirilgan akkaunt (whoAmI bilan bir xil ko'rinishda)
export const userInfo = (user) => ({ userId: String(user.id), username: user.username ?? null, firstName: user.firstName ?? null });

// Yangi ochilgan sessiyani yopish (kerak bo'lmay qolsa: masalan, bu akkaunt boshqa nom bilan allaqachon ulangan)
export async function closeAuthorization(client) {
  await client.invoke(new Api.auth.LogOut());
}

export async function logout(client, account = MAIN_ACCOUNT) {
  await client.invoke(new Api.auth.LogOut());
  await deleteSession(account);
}

// Akkaunt a'zo bo'lgan guruh va kanallar
export async function listChats(client) {
  const chats = [];
  for await (const dialog of client.iterDialogs({})) {
    if (!dialog.isGroup && !dialog.isChannel) continue;
    chats.push({
      id: String(dialog.id),
      title: dialog.title ?? dialog.name ?? "",
      username: dialog.entity?.username ?? null,
      type: dialog.isGroup ? "guruh" : "kanal",
      members: dialog.entity?.participantsCount ?? null,
    });
  }
  return chats;
}

// Telegram global qidiruvi: nomida yoki manzilida `query` bo'lgan OCHIQ guruh/kanallar.
// Qo'shilmasdan topadi; ochiq guruhni o'qish uchun ham qo'shilish shart emas.
export async function searchPublicChats(client, query, { limit = 50 } = {}) {
  const result = await client.invoke(new Api.contacts.Search({ q: query, limit }));
  const chats = [];
  for (const chat of result.chats) {
    // Ba'zi chatlarda bir nechta manzil bo'ladi (usernames), asosiysi — faol bo'lgani
    const username = chat.username ?? chat.usernames?.find((u) => u.active)?.username;
    if (!username) continue; // manzilsiz = yopiq chat
    chats.push({
      username,
      title: chat.title ?? "",
      type: chat.broadcast ? "kanal" : "guruh",
      members: chat.participantsCount ?? null,
    });
  }
  return chats;
}

// source — sources.js dagi normalizeSource natijasi
// Raqamli id faqat akkaunt a'zo bo'lgan chatlar ro'yxatidan topiladi. Ro'yxat bir marta to'liq o'qilib, eslab qolinadi
// (akkaunt guruhlarini avtomatik tekshirish yuzlab id so'raydi — har biriga butun ro'yxatni qayta varaqlamaymiz);
// topilmasa — ko'pi bilan DIALOGS_TTL_MS da bir marta qayta o'qiladi (yangi qo'shilgan guruh)
const DIALOGS_TTL_MS = 10 * 60_000;
const dialogCache = new WeakMap(); // client → { at, byId: Map("-100…" → entity), byUsername: Map("nom" → entity) }

const dialogLoads = new WeakMap(); // client → yuklanayotgan ro'yxat (bir vaqtda bittadan; 4 ta parallel o'qish bor)
function loadDialogs(client) {
  if (!dialogLoads.has(client)) dialogLoads.set(client, readDialogs(client).finally(() => dialogLoads.delete(client)));
  return dialogLoads.get(client);
}

async function readDialogs(client) {
  const byId = new Map();
  const byUsername = new Map();
  for await (const dialog of client.iterDialogs({})) {
    byId.set(String(dialog.id), dialog.entity);
    const username = dialog.entity?.username;
    if (username) byUsername.set(username.toLowerCase(), dialog.entity);
  }
  const cached = { at: Date.now(), byId, byUsername };
  dialogCache.set(client, cached);
  return cached;
}

// A'zo bo'lgan ochiq guruh @nomi bo'yicha — dialoglar ro'yxatidan (2026-11-20): resolveUsername so'ralmaydi, shuning uchun
// Telegram uni cheklagan paytda ham (FLOOD_WAIT) a'zo guruhlar o'qilaveradi. Topilmasa — null
async function memberEntity(client, username) {
  let cached = dialogCache.get(client);
  if (!cached || Date.now() - cached.at >= DIALOGS_TTL_MS) cached = await loadDialogs(client);
  return cached.byUsername?.get(String(username).toLowerCase()) ?? null;
}

async function resolveEntity(client, source) {
  if (source.kind === "username") return client.getEntity(source.value);
  const cached = dialogCache.get(client);
  if (cached?.byId.has(source.value)) return cached.byId.get(source.value);
  if (!cached || Date.now() - cached.at >= DIALOGS_TTL_MS) {
    const fresh = await loadDialogs(client);
    if (fresh.byId.has(source.value)) return fresh.byId.get(source.value);
  }
  throw new Error(`id ${source.value} topilmadi: akkaunt bu chatga a'zo emas (npm run tg:dialogs)`);
}

// --- Ovozli xabar va dumaloq video (2026-11-16, Azimjon: «audio va telegramni dumaloq videoni chek qilib u e'lon va
// e'lon emasligini check qilamiz … juda tez») ---
// GramJS xabari → { kind: "voice" | "round", duration (s), size (bayt), mime } yoki null (boshqa media / matn)
export function mediaOf(message) {
  const doc = message?.media instanceof Api.MessageMediaDocument ? message.media.document : null;
  if (!(doc instanceof Api.Document)) return null;
  for (const attr of doc.attributes ?? []) {
    if (attr instanceof Api.DocumentAttributeAudio && attr.voice) return { kind: "voice", duration: attr.duration ?? 0, size: Number(doc.size ?? 0), mime: doc.mimeType || "audio/ogg" };
    if (attr instanceof Api.DocumentAttributeVideo && attr.roundMessage) return { kind: "round", duration: Math.round(attr.duration ?? 0), size: Number(doc.size ?? 0), mime: doc.mimeType || "video/mp4" };
  }
  return null;
}

function senderIdOf(m) {
  const user = m.sender;
  if (user?.className !== "User" || user.bot || user.deleted || m.senderId == null) return null;
  return String(m.senderId);
}

// live.js uchun oddiy obyekt: matn, yozgan odam va (bo'lsa) media. raw — GramJS xabarining o'zi (yuklab olish uchun),
// sanab chiqilmaydi (JSON / deepEqual'ga tushmaydi)
function plainMessage(m) {
  const media = mediaOf(m);
  const out = { id: m.id, text: m.message ?? "", date: m.date, sender: m.message || media ? senderUsername(m.sender) : null };
  // Yozgan odamning Telegram ID'si (faqat oddiy odam: kanal nomidan, bot, o'chirilgan akkaunt — yo'q). Username'i bo'lmasa,
  // bot «💬 Lichkasi» tugmasini tg://user?id= bilan beradi; bir odamning ketma-ket ovozli xabarlari ham shu bilan birlashadi
  out.senderId = senderIdOf(m);
  // Profil raqami (2026-11-20): Telegram uni faqat egasi «hamma ko'rsin» qilgan bo'lsa yoki o'quvchi akkaunt kontaktida
  // bo'lsa beradi. Ko'rinmas (enumerable emas) — live.js uni faqat yopiq guruh e'loniga yozadi
  const phone = String(m.sender?.phone ?? "").replace(/\D/g, "");
  if (out.senderId && phone.length >= 9) Object.defineProperty(out, "senderPhone", { value: `+${phone}`, enumerable: false });
  if (media) {
    out.media = media;
    Object.defineProperty(out, "raw", { value: m, enumerable: false });
  }
  return out;
}

const TRANSCRIBE_POLL_MS = 1_500;
const TRANSCRIBE_WAIT_MS = 25_000;

// Jonli rejim (live.js) uchun o'quvchi. Guruh manzili bir marta aniqlanadi va eslab qolinadi:
// Telegram manzil bo'yicha qidirishni (resolveUsername) qattiq cheklaydi, har daqiqada so'rash mumkin emas.
export function createReader(client) {
  const entities = new Map(); // source.value → guruh (Api.Channel / Api.Chat)
  const byPeer = new Map(); // "-100123…" → source: jonli xabar qaysi manbaga tegishli
  const freshStats = () => ({ updates: 0, messages: 0, matched: 0, types: {}, bySource: {} });
  let premium;
  const stats = freshStats();
  // Manzil so'rash (resolveUsername) uchun FLOOD_WAIT (2026-11-20): Telegram aynan shu so'rovni soatlab cheklaydi — a'zo
  // bo'lmagan guruhning @nomini har qayta yoqilishda qayta so'raymiz (a'zolari dialoglar ro'yxatidan keladi). O'sha kuni
  // uchta restart 08:08 da ~4 soatlik cheklov oldi va collector HAMMA so'rovni to'xtatib qo'ydi — a'zo guruhlar ham
  // o'qilmadi. Endi muddat shu yerda eslab qolinadi: shu vaqtgacha yangi manzil Telegram'ga so'ralmaydi (xato darhol,
  // error.resolveFlood bilan), live.js esa faqat o'sha guruhni keyinga suradi
  let resolveBlockedUntil = 0;
  // GramJS FloodWaitError: { errorMessage: "FLOOD", seconds } (live.js floodSeconds bilan bir xil o'qiladi)
  const floodOf = (error) =>
    Number.isFinite(error?.seconds) && /FLOOD/.test(error?.errorMessage ?? "")
      ? error.seconds
      : Number(/FLOOD_WAIT_(\d+)/.exec(error?.errorMessage ?? error?.message ?? "")?.[1] ?? NaN);
  async function entityOf(source) {
    if (!entities.has(source.value) && source.kind === "username") {
      // A'zo guruh — dialoglar ro'yxatidan, manzil so'ralmaydi (xato bo'lsa — odatdagi yo'l)
      const entity = await memberEntity(client, source.value).catch(() => null);
      if (entity) {
        entities.set(source.value, entity);
        byPeer.set(utils.getPeerId(entity), source);
      }
    }
    if (!entities.has(source.value)) {
      // Cheklov faqat @nom so'rashga (resolveUsername). id bo'yicha guruh dialoglar ro'yxatidan olinadi — cheklanmaydi
      // (2026-11-20: shu tekshiruv id ni ham to'xtatib, asosiy akkauntning «🔎 Auto scan»i 2 soat jim turib qoldi)
      const left = source.kind === "username" ? Math.ceil((resolveBlockedUntil - Date.now()) / 1000) : 0;
      if (left > 0) throw Object.assign(new Error(`FLOOD_WAIT_${left}`), { errorMessage: `FLOOD_WAIT_${left}`, resolveFlood: true });
      let entity;
      try {
        entity = await resolveEntity(client, source);
      } catch (error) {
        const seconds = floodOf(error);
        if (Number.isFinite(seconds) && source.kind === "username") {
          resolveBlockedUntil = Date.now() + seconds * 1000;
          error.resolveFlood = true;
        }
        throw error;
      }
      entities.set(source.value, entity);
      byPeer.set(utils.getPeerId(entity), source);
    }
    return entities.get(source.value);
  }
  return {
    async latestId(source) {
      const [message] = await client.getMessages(await entityOf(source), { limit: 1 });
      return message?.id ?? null;
    },
    // minId dan keyingi xabarlar (eskisidan yangisiga). Daqiqada 200 tadan ko'p xabar yozilmaydi.
    // m.sender — yozgan odam: Telegram uni javobning o'zida (users ro'yxati) beradi, qo'shimcha so'rov yo'q.
    // Matnsiz xabarlar (izohsiz rasm, xizmat xabari) ham qaytadi — text "" : e'lon emas, lekin kursor ulardan o'tadi
    async since(source, minId, limit = 200) {
      const messages = await client.getMessages(await entityOf(source), { minId, limit });
      return messages.map(plainMessage).reverse();
    },

    // Akkaunt Telegram Premium'mi (ovozni Telegram'ning o'zi matnga o'giradi) — bir marta so'raladi
    async isPremium() {
      if (premium === undefined) premium = Boolean((await client.getMe())?.premium);
      return premium;
    },

    // Telegram Premium: ovozli xabar / dumaloq videoni matnga (messages.transcribeAudio). Javob «pending» bo'lsa —
    // o'sha so'rov qayta yuboriladi (Telegram tayyor matnni qaytaradi), ko'pi bilan 25 s. → matn | null
    async transcribe(source, messageId, { pollMs = TRANSCRIBE_POLL_MS, waitMs = TRANSCRIBE_WAIT_MS } = {}) {
      const peer = await entityOf(source);
      const started = Date.now();
      for (;;) {
        const result = await client.invoke(new Api.messages.TranscribeAudio({ peer, msgId: messageId }));
        if (!result.pending) return (result.text ?? "").trim() || null;
        if (Date.now() - started + pollMs > waitMs) return null;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },

    // Guruh/kanalning kichik rasmi (yopiq guruhlar uchun — bot ko'ra olmaydi; avatars.js) → Buffer | null
    async photo(source) {
      const entity = await entityOf(source);
      if (!entity?.photo || entity.photo instanceof Api.ChatPhotoEmpty) return null;
      const data = await client.downloadProfilePhoto(entity, { isBig: false });
      return data?.length ? Buffer.from(data) : null;
    },

    // Faylni yuklab olish (Gemini uchun). raw — plainMessage().raw → Buffer
    async download(raw) {
      return client.downloadMedia(raw, {});
    },
    // Xabarni botga forward qilib, darhol o'chiradi (media.js: bot yozuvchini «ko'rsin» — «💬 Lichkasi» tugmasi uchun).
    // → true — bot yozuvchini ko'rdi (forward'da muallif ochiq), false — muallif yashirin (forward maxfiyligi «Hech kim»)
    async showToBot(source, messageId, bot) {
      const [sent] = await client.forwardMessages(bot, { messages: [messageId], fromPeer: await entityOf(source) });
      if (!sent) return false;
      const visible = sent.fwdFrom?.fromId?.className === "PeerUser";
      await client.deleteMessages(bot, [sent.id], { revoke: true }).catch(() => {});
      return visible;
    },

    // Yopiq guruhning taklif havolasi (t.me/+hash) — qaysi guruh va akkaunt unga a'zomi (messages.checkChatInvite,
    // qo'shilmaydi). → { member: true, peerId, title, chatType, members } | { member: false, title }
    // Havola yaroqsiz / muddati o'tgan — Telegram xatosi (INVITE_HASH_INVALID / INVITE_HASH_EXPIRED) tashlanadi
    async checkInvite(hash) {
      const result = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
      if (result instanceof Api.ChatInviteAlready) {
        const chat = result.chat;
        return {
          member: true,
          peerId: String(utils.getPeerId(chat)),
          title: chat.title ?? null,
          chatType: chat.broadcast ? "channel" : "group",
          members: chat.participantsCount ?? null,
        };
      }
      return { member: false, title: result.title ?? result.chat?.title ?? null };
    },

    // «Yangisi bormi»: guruhlarning oxirgi xabar raqami — hammasi BITTA so'rovda (messages.getPeerDialogs, 50 tadan).
    // Akkaunt a'zo bo'lgan guruhlarda aniq ishlaydi; a'zo bo'lmaganlarida ishlashini live.js bir marta sinab ko'radi.
    // → Map(source.value → oxirgi xabar raqami). Javobda yo'q guruh (masalan, dialogi yo'q) Map'ga tushmaydi.
    async tops(sources) {
      const items = [];
      for (const source of sources) {
        try {
          items.push([source, await entityOf(source)]);
        } catch {
          // topilmagan guruh — so'rab turish xatoni o'zi yozadi
        }
      }
      const out = new Map();
      // out.messages — Map(source.value → oxirgi xabar, plainMessage) (Map'ning o'z xossasi: eski chaqiruvlar o'zgarmaydi)
      const messages = new Map();
      out.messages = messages;
      for (let i = 0; i < items.length; i += 50) {
        const chunk = items.slice(i, i + 50);
        const result = await client.invoke(
          new Api.messages.GetPeerDialogs({ peers: chunk.map(([, entity]) => new Api.InputDialogPeer({ peer: utils.getInputPeer(entity) })) }),
        );
        const top = new Map(result.dialogs.filter((d) => d.peer).map((d) => [utils.getPeerId(d.peer), d.topMessage]));
        // Javobda har guruhning OXIRGI XABARINING O'ZI ham bor (2026-11-19, Azimjon: e'lon botga ~2 daqiqada keladi) —
        // live.js uni alohida so'rovsiz darhol navbatga qo'yadi. Yozgan odam (sender) javobdagi users'dan
        const known = new Map([...(result.users ?? []), ...(result.chats ?? [])].map((e) => [utils.getPeerId(e), e]));
        const last = new Map();
        for (const m of result.messages ?? []) {
          if (!(m instanceof Api.Message) || !m.peerId) continue;
          try {
            m._finishInit?.(client, known, undefined);
            last.set(`${utils.getPeerId(m.peerId)}:${m.id}`, plainMessage(m));
          } catch {}
        }
        for (const [source, entity] of chunk) {
          const peer = utils.getPeerId(entity);
          const value = top.get(peer);
          if (value == null) continue;
          out.set(source.value, value);
          const message = last.get(`${peer}:${value}`);
          if (message) messages.set(source.value, message);
        }
      }
      return out;
    },

    // Akkaunt qaysi manbalarga a'zo → Map(source.value → true/false).
    // Hammasi bitta so'rovda (channels.getChannels): guruh ma'lumoti yangidan keladi, a'zo emas bo'lsa — `left`.
    async membership(sources) {
      const joined = new Map();
      const channels = [];
      for (const source of sources) {
        try {
          const entity = await entityOf(source);
          if (entity instanceof Api.Channel) channels.push([source, entity]);
          // Oddiy (kichik) guruh faqat a'zo bo'lganlar ro'yxatidan topiladi
          else joined.set(source.value, entity instanceof Api.Chat && !entity.left);
        } catch {
          joined.set(source.value, false); // topilmadi (nomi o'zgargan, yopilgan) — so'rab turish xatoni o'zi yozadi
        }
      }
      if (channels.length) {
        const ids = channels.map(([, e]) => new Api.InputChannel({ channelId: e.id, accessHash: e.accessHash }));
        const { chats } = await client.invoke(new Api.channels.GetChannels({ id: ids }));
        const fresh = new Map(chats.map((chat) => [String(chat.id), chat]));
        for (const [source, entity] of channels) {
          const chat = fresh.get(String(entity.id));
          // ChannelForbidden — guruhdan haydalgan / guruh yopilgan
          joined.set(source.value, chat instanceof Api.Channel && !chat.left);
        }
      }
      return joined;
    },

    // A'zo bo'lingan guruhlardagi yangi xabarni Telegram o'zi yuboradi (bildirishnoma o'chiq bo'lsa ham).
    // onMessage(source, { id, text, date, sender }) — faqat manbalarimizdan (byPeer) kelgan matnli xabarlar.
    // → stop() (tinglashni to'xtatadi)
    async listen(onMessage) {
      const event = new NewMessage({});
      const handler = (update) => {
        const message = update.message;
        if (!message?.peerId || !(message.message || mediaOf(message))) return;
        stats.messages++;
        let peer;
        try {
          peer = utils.getPeerId(message.peerId);
        } catch {
          return;
        }
        const source = byPeer.get(peer);
        if (!source) return;
        stats.matched++;
        // Jonli update'da ham yozgan odam update'ning o'zida keladi (message.sender), getSender() tarmoqqa chiqmaydi
        onMessage(source, plainMessage(message));
      };
      // Tashxis uchun: Telegram umuman nima yuboryapti (turi bo'yicha sanaymiz, mazmuniga qaramaymiz)
      const raw = (update) => {
        stats.updates++;
        const type = update?.className ?? "?";
        stats.types[type] = (stats.types[type] ?? 0) + 1;
        // Qaysi manbadan qanday update keldi (masalan, katta guruhda faqat UpdateChannelTooLong bo'lishi mumkin)
        const channelId = update?.channelId ?? update?.message?.peerId?.channelId;
        const source = channelId != null ? byPeer.get(`-100${channelId}`) : null;
        if (source) {
          const counts = (stats.bySource[source.value] ??= {});
          counts[type] = (counts[type] ?? 0) + 1;
        }
      };
      client.addEventHandler(handler, event);
      client.addEventHandler(raw);
      // Telegram'ga «shu ulanishga update'larni yubor» degan so'rov: bu bo'lmasa, ba'zan update'lar kelmay turadi
      await client.invoke(new Api.updates.GetState());
      return () => {
        client.removeEventHandler(handler, event);
        client.removeEventHandler(raw);
      };
    },

    // Guruhga a'zo bo'lish (live.js sekin, bittadan chaqiradi). → "joined" | "requested"
    // Guruhda «a'zolikni admin tasdiqlaydi» yoqilgan bo'lsa, Telegram INVITE_REQUEST_SENT qaytaradi — so'rov yuborildi.
    // Boshqa xato (FLOOD_WAIT, CHANNELS_TOO_MUCH — 500 guruh limiti, CHANNEL_PRIVATE) — chaqirgan joyga
    async join(source) {
      const entity = await entityOf(source);
      try {
        await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
      } catch (error) {
        if (error.errorMessage === "USER_ALREADY_PARTICIPANT") return "joined";
        if (error.errorMessage === "INVITE_REQUEST_SENT") return "requested";
        throw error;
      }
      return "joined";
    },

    // Guruh bildirishnomasini butunlay o'chirish (u tanlagan: faqat mute, arxivga solinmaydi, 2026-11-09)
    async mute(source) {
      const entity = await entityOf(source);
      await client.invoke(
        new Api.account.UpdateNotifySettings({
          peer: new Api.InputNotifyPeer({ peer: utils.getInputPeer(entity) }),
          settings: new Api.InputPeerNotifySettings({ muteUntil: 2 ** 31 - 1 }), // «doim» = 2038-yilgacha
        }),
      );
    },

    // Oxirgi so'rovdan beri: nechta update keldi, ulardan nechtasi yangi xabar, nechtasi bizning manbalardan
    liveStats() {
      const out = { ...stats, types: { ...stats.types }, bySource: { ...stats.bySource } };
      Object.assign(stats, freshStats());
      return out;
    },
  };
}

// Chatdagi oxirgi `limit` ta xabarning matnlari (rasm/video izohi ham matn hisoblanadi)
export async function fetchTexts(client, source, { limit }) {
  const entity = await resolveEntity(client, source);
  const texts = [];
  for await (const message of client.iterMessages(entity, { limit })) {
    if (message.message) texts.push(message.message);
  }
  return { title: entity.title ?? entity.username ?? source.value, texts };
}
