// Telegram bilan ishlaydigan HAMMA kod shu faylda.
// Kutubxona: GramJS ("telegram" paketi). U 2026-yilda arxivlangan; davomi — "teleproto" forki.
// Keyinroq o'tish kerak bo'lsa, faqat shu fayl o'zgaradi.
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Api, TelegramClient, utils } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { authErrorAction } from "./authErrors.js";

// Sessiya fayli = akkauntga kirish kaliti. U gitga tushmaydi (.gitignore: *.session).
export const SESSION_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../telegram.session");

export function readConfig() {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) {
    throw new Error(
      "TG_API_ID va TG_API_HASH topilmadi.\n" +
        "my.telegram.org → API development tools → ilova yarating, keyin ikkalasini .env ga yozing.",
    );
  }
  return { apiId, apiHash };
}

export async function loadSession() {
  if (process.env.TG_SESSION) return process.env.TG_SESSION;
  return existsSync(SESSION_FILE) ? (await readFile(SESSION_FILE, "utf8")).trim() : "";
}

export async function saveSession(client) {
  await writeFile(SESSION_FILE, client.session.save(), "utf8");
}

export async function deleteSession() {
  if (existsSync(SESSION_FILE)) await unlink(SESSION_FILE);
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

// Saqlangan sessiya bilan ulanadi; sessiya bo'lmasa yoki eskirgan bo'lsa — xato
export async function connectSaved() {
  const session = await loadSession();
  if (!session) throw new Error("Avval Telegram'ga kiring: npm run tg:login");
  const client = await createClient(session);
  if (!(await client.checkAuthorization())) {
    await client.disconnect();
    throw new Error("Sessiya eskirgan yoki bekor qilingan. Qayta kiring: npm run tg:login");
  }
  return client;
}

// ask(savol, { hidden }) — terminaldan javob o'qiydigan funksiya (cli.js beradi)
export async function login(ask) {
  const client = await createClient(await loadSession());
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
  await saveSession(client);
  return client;
}

export async function logout(client) {
  await client.invoke(new Api.auth.LogOut());
  await deleteSession();
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
    async since(source, minId, limit = 200) {
      const messages = await client.getMessages(await entityOf(source), { minId, limit });
      return messages
        .filter((m) => m.message)
        .map((m) => ({ id: m.id, text: m.message, date: m.date }))
        .reverse();
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
    // onMessage(source, { id, text, date }) — faqat manbalarimizdan (byPeer) kelgan matnli xabarlar.
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
        onMessage(source, { id: message.id, text: message.message, date: message.date });
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
