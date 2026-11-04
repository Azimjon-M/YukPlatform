// Telegram bilan ishlaydigan HAMMA kod shu faylda.
// Kutubxona: GramJS ("telegram" paketi). U 2026-yilda arxivlangan; davomi — "teleproto" forki.
// Keyinroq o'tish kerak bo'lsa, faqat shu fayl o'zgaradi.
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Api, TelegramClient } from "telegram";
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

// Chatdagi oxirgi `limit` ta xabarning matnlari (rasm/video izohi ham matn hisoblanadi)
export async function fetchTexts(client, source, { limit }) {
  const entity = await resolveEntity(client, source);
  const texts = [];
  for await (const message of client.iterMessages(entity, { limit })) {
    if (message.message) texts.push(message.message);
  }
  return { title: entity.title ?? entity.username ?? source.value, texts };
}
