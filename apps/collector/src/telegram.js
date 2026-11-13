// Telegram bilan ishlaydigan HAMMA kod shu faylda.
// Kutubxona: GramJS ("telegram" paketi). U 2026-yilda arxivlangan; davomi — "teleproto" forki.
// Keyinroq o'tish kerak bo'lsa, faqat shu fayl o'zgaradi.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Api, TelegramClient, utils } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
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
  return { userId: String(me.id), username: me.username ?? null, firstName: me.firstName ?? null };
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
async function resolveEntity(client, source) {
  if (source.kind === "username") return client.getEntity(source.value);
  // Raqamli id faqat akkaunt a'zo bo'lgan chatlar ro'yxatidan topiladi
  for await (const dialog of client.iterDialogs({})) {
    if (String(dialog.id) === source.value) return dialog.entity;
  }
  throw new Error(`id ${source.value} topilmadi: akkaunt bu chatga a'zo emas (npm run tg:dialogs)`);
}

// Jonli rejim (live.js) uchun o'quvchi. Guruh manzili bir marta aniqlanadi va eslab qolinadi:
// Telegram manzil bo'yicha qidirishni (resolveUsername) qattiq cheklaydi, har daqiqada so'rash mumkin emas.
export function createReader(client) {
  const entities = new Map(); // source.value → guruh (Api.Channel / Api.Chat)
  const byPeer = new Map(); // "-100123…" → source: jonli xabar qaysi manbaga tegishli
  const freshStats = () => ({ updates: 0, messages: 0, matched: 0, types: {}, bySource: {} });
  const stats = freshStats();
  async function entityOf(source) {
    if (!entities.has(source.value)) {
      const entity = await resolveEntity(client, source);
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
      return messages.map((m) => ({ id: m.id, text: m.message ?? "", date: m.date, sender: m.message ? senderUsername(m.sender) : null })).reverse();
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
      for (let i = 0; i < items.length; i += 50) {
        const chunk = items.slice(i, i + 50);
        const result = await client.invoke(
          new Api.messages.GetPeerDialogs({ peers: chunk.map(([, entity]) => new Api.InputDialogPeer({ peer: utils.getInputPeer(entity) })) }),
        );
        const top = new Map(result.dialogs.filter((d) => d.peer).map((d) => [utils.getPeerId(d.peer), d.topMessage]));
        for (const [source, entity] of chunk) {
          const value = top.get(utils.getPeerId(entity));
          if (value != null) out.set(source.value, value);
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
        if (!message?.message || !message.peerId) return;
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
        onMessage(source, { id: message.id, text: message.message, date: message.date, sender: senderUsername(message.sender) });
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
