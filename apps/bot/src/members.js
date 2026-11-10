// Kanal va guruhga a'zolik (Azimjon, 2026-11-09): bot faqat @Yuk_Ekspert kanali va @Yuk_Ekspert_chat guruhi
// a'zolariga ishlaydi. A'zo bo'lmagan odam botga yozsa — «a'zo bo'ling» xabari va tugmalar chiqadi, yuk ham yuborilmaydi.
//
// Node/Telegram qismi: Telegram'dan getChatMember(chat, user) bilan so'raymiz — javobda odamning shu chatdagi holati
// (creator | administrator | member | restricted | left | kicked). Boshqa odam haqida Telegram faqat bot o'sha
// kanal/guruhda ADMIN bo'lsa aytadi — bot ikkalasida ham admin (2026-11-09 da tekshirildi).
// Har xabar va har yukda Telegram'ga so'rov yubormaslik uchun natija xotirada (Map) 10 daqiqa saqlanadi.
import { InlineKeyboard } from "grammy";

export const SUB_CHECK = "sub:check"; // «✅ A'zo bo'ldim» tugmasi
export const CHECK_BUTTON = "✅ A'zo bo'ldim";
export const CACHE_MS = 10 * 60_000;
// Telegram xato bersa (bot adminlikdan olingan, tarmoq) — «bilmaymiz»: botni hamma uchun yopib qo'ymaslik uchun
// o'tkazib yuboramiz, lekin natijani qisqa saqlaymiz — tez orada qayta so'raladi
export const UNKNOWN_CACHE_MS = 60_000;
export const REMIND_EVERY_MS = 24 * 60 * 60_000; // «yuk yuborilmadi, a'zo bo'ling» — kuniga ko'pi bilan bir marta

const MEMBER = new Set(["creator", "administrator", "member"]);

// .env: REQUIRED_CHATS=@Yuk_Ekspert,@Yuk_Ekspert_chat (vergul yoki bo'sh joy bilan; -100... raqami ham bo'ladi).
// Bo'sh, 0 yoki off — tekshiruv o'chiq (bot hammaga ishlaydi)
export function readRequiredChats(value) {
  const raw = value?.trim() ?? "";
  if (!raw || /^(0|yo'q|yoq|no|false|off)$/i.test(raw)) return [];
  const chats = raw.split(/[,\s]+/).filter(Boolean);
  for (const chat of chats) {
    if (!/^(@[A-Za-z]\w{3,}|-100\d+)$/.test(chat)) {
      throw new Error(`REQUIRED_CHATS: «${chat}» — @kanal_nomi yoki -100... raqami bo'lishi kerak.`);
    }
  }
  return [...new Set(chats)];
}

// Telegram javobi → a'zomi? «restricted» — cheklangan (masalan yozish taqiqlangan), lekin is_member bo'lsa a'zo
export function isMember(member) {
  return MEMBER.has(member?.status) || (member?.status === "restricted" && member.is_member === true);
}

// «user not found» — odam bu chatda umuman bo'lmagan: a'zo emas. Boshqa xatolar — tekshirib bo'lmadi
export function notMemberError(error) {
  return error?.error_code === 400 && /user not found|participant_id_invalid|member not found/i.test(error.description ?? "");
}

// Chat haqida: tugmadagi havola va nomi. getChat ishlamasa ham (testda, tarmoq) — @nom dan havola
export function chatInfo(ref, chat = null) {
  const username = chat?.username ?? (ref.startsWith("@") ? ref.slice(1) : null);
  return {
    ref,
    id: chat?.id ?? null,
    title: chat?.title ?? (username ? `@${username}` : ref),
    type: chat?.type ?? (/chat|group|guruh/i.test(ref) ? "supergroup" : "channel"),
    url: username ? `https://t.me/${username}` : (chat?.invite_link ?? null),
  };
}

const isChannel = (chat) => chat.type === "channel";
const kindText = (chat) => (isChannel(chat) ? "kanal" : "guruh");
const joinLabel = (chat) => (isChannel(chat) ? "📢 Kanalga a'zo bo'lish" : "💬 Guruhga a'zo bo'lish");
const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Hammasi ro'yxati: a'zo bo'lganlari ✅, qolganlari 👉
function chatLines(chats, missing) {
  const left = new Set(missing.map((c) => c.ref));
  return chats.map((c) => `${left.has(c.ref) ? "👉" : "✅"} <b>${escape(c.title)}</b> — ${kindText(c)}`);
}

// A'zo bo'lmaganlarga tugmalar (havola) va oxirida «✅ A'zo bo'ldim»
export function joinKeyboard(missing) {
  const keyboard = new InlineKeyboard();
  for (const chat of missing) if (chat.url) keyboard.url(joinLabel(chat), chat.url).row();
  return keyboard.text(CHECK_BUTTON, SUB_CHECK);
}

// Botga yozganda (a'zo emas): «a'zo bo'ling» xabari. → { text, keyboard }
export function joinPrompt(chats, missing) {
  const both = missing.length > 1 ? "kanal va guruhimizga" : `${kindText(missing[0])}imizga`;
  return {
    text: [
      `🔒 <b>Botdan foydalanish uchun ${both} a'zo bo'ling</b>`,
      "",
      ...chatLines(chats, missing),
      "",
      `A'zo bo'lgach, «${CHECK_BUTTON}» tugmasini bosing.`,
    ].join("\n"),
    keyboard: joinKeyboard(missing),
  };
}

// Yuk kelganda yoki kanaldan chiqqanda: eslatma. reason "load" — mos yuk chiqdi, lekin yuborilmadi; "left" — chiqib ketdi.
// one / many — rolga qarab: «yuk» / «yuklar» yoki «bo'sh mashina» / «bo'sh mashinalar»
export function remindText(chats, missing, { reason = "load", one = "yuk", many = "yuklar" } = {}) {
  const head =
    reason === "left"
      ? `🔔 <b>Siz ${missing.map((c) => escape(c.title)).join(" va ")}dan chiqdingiz — ${many} endi yuborilmaydi</b>`
      : `🔔 <b>Sizga mos yangi ${one} chiqdi, lekin yuborilmadi</b>`;
  return {
    text: [
      head,
      `Yuk Ekspert faqat kanal va guruhimiz a'zolariga ishlaydi. A'zo bo'ling — ${many} yana shu yerga keladi:`,
      "",
      ...chatLines(chats, missing),
    ].join("\n"),
    keyboard: joinKeyboard(missing),
  };
}

// api — grammY bot.api (getChat, getChatMember); refs — readRequiredChats natijasi;
// onChecked(userId, { ok, missing: ["@..."] }) — Telegram'dan haqiqiy javob kelganda (bazaga yozish uchun)
export function createMembership({ api, refs, log = () => {}, onChecked = () => {}, now = Date.now }) {
  let chats = refs.map((ref) => chatInfo(ref));
  const cache = new Map(); // userId → { ok, missing, unknown, at }
  const warned = new Map(); // chat ref → oxirgi ogohlantirish vaqti (log toshib ketmasin)

  // Ishga tushganda: nomlar va havolalar Telegram'dan; bot admin bo'lmasa — ogohlantirish (u holda tekshira olmaydi)
  async function init(botId) {
    chats = await Promise.all(
      refs.map(async (ref) => {
        const chat = await api.getChat(ref).catch((error) => {
          log(`⚠️  A'zolik: ${ref} topilmadi (${error.description ?? error.message}) — bu chat tekshirilmaydi`);
          return null;
        });
        if (chat && botId != null) {
          const me = await api.getChatMember(chat.id, botId).catch(() => null);
          if (me?.status !== "administrator" && me?.status !== "creator") {
            log(`⚠️  A'zolik: bot ${ref} da admin emas — Telegram boshqa odamlarning a'zoligini aytmaydi. Botni admin qiling.`);
          }
        }
        return chatInfo(ref, chat);
      }),
    );
    return chats;
  }

  // → { ok, missing: [chat], unknown: [chat] }. fresh — «a'zo emas» natijasini eslab qolmasdan qayta so'rash
  // (odam hozirgina a'zo bo'lgan bo'lishi mumkin); «a'zo» natijasi baribir 10 daqiqa ishlatiladi
  async function check(userId, { fresh = false } = {}) {
    const hit = cache.get(userId);
    const age = hit ? now() - hit.at : Infinity;
    if (hit && age < (hit.unknown.length ? UNKNOWN_CACHE_MS : CACHE_MS) && (hit.ok || !fresh)) return hit;
    const missing = [];
    const unknown = [];
    for (const chat of chats) {
      try {
        if (!isMember(await api.getChatMember(chat.id ?? chat.ref, userId))) missing.push(chat);
      } catch (error) {
        if (notMemberError(error)) {
          missing.push(chat);
          continue;
        }
        unknown.push(chat);
        if (now() - (warned.get(chat.ref) ?? -Infinity) > 10 * 60_000) {
          warned.set(chat.ref, now());
          log(`⚠️  A'zolikni tekshirib bo'lmadi (${chat.ref}): ${error.description ?? error.message} — hozircha o'tkazib yuborildi`);
        }
      }
    }
    const result = { ok: missing.length === 0, missing, unknown, at: now() };
    if (cache.size > 5000) for (const [id, r] of cache) if (now() - r.at > CACHE_MS) cache.delete(id);
    cache.set(userId, result);
    // Bilmagan chat bo'lsa va boshqasida a'zo — bazaga yozmaymiz (a'zo ekanini bilmaymiz)
    if (!unknown.length || missing.length) onChecked(userId, { ok: result.ok, missing: missing.map((c) => c.ref) });
    return result;
  }

  // Shu chatlardan birimi (chat_member yangilanishi kelganda)
  const watches = (chat) =>
    chats.some((c) => (c.id != null && c.id === chat.id) || (chat.username && c.ref.toLowerCase() === `@${chat.username}`.toLowerCase()));

  return {
    init,
    check,
    watches,
    forget: (userId) => cache.delete(userId),
    chats: () => chats,
  };
}
