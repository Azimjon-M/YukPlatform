// Avtomatik pauza (Azimjon, 2026-11-09): botga 24 soat kirmagan foydalanuvchiga — ogohlantirish, 48 soatda — pauza va
// xabar. Qoida (qachon) — @yuk/shared idle.js, bu yerda — har 10 daqiqada tekshirish va Telegram xabarlari.
// «Kirdi» = botga yozdi, tugma bosdi yoki web'ni ochdi (store.touchDriver). Xabardagi tugmani bossa — o'zi faollik:
// «✅ Ha, davom etsin» — yuborish davom etadi, «▶️ Davom ettirish» — pauzadan chiqaradi (bot.js idle: callback'lari).
import { GrammyError, InlineKeyboard } from "grammy";
import { idleState, roleOf } from "@yuk/shared";

const MINUTE = 60 * 1000;
export const IDLE_CHECK_MS = 10 * MINUTE;

// Rolga qarab: nima keladi
const NOUN = { haydovchi: "yuklar", yuk_beruvchi: "bo'sh mashinalar" };
const nounOf = (user) => NOUN[roleOf(user)] ?? NOUN.haydovchi;

export const IDLE_BUTTONS = { ok: "idle:ok", resume: "idle:resume" };

export function idleWarningText(user) {
  return [
    `👋 Botga 24 soatdan beri kirmadingiz. Sizga ${nounOf(user)} kelishda davom etsinmi?`,
    "",
    "Yana 24 soat kirmasangiz, keraksiz xabarlar bilan bezovta qilmaslik uchun yuborish avtomatik to'xtatiladi (pauza). " +
      "Davom etishi uchun pastdagi tugmani bosing.",
  ].join("\n");
}

export function idlePausedText(user) {
  return [
    `⏸ Botga 48 soatdan beri kirmaganingiz uchun ${nounOf(user)} yuborish to'xtatildi (pauza).`,
    "",
    "Sozlamalaringiz joyida. Qayta yoqish uchun pastdagi «▶️ Davom ettirish» tugmasini bosing.",
  ].join("\n");
}

export const idleWarningKeyboard = () => new InlineKeyboard().text("✅ Ha, davom etsin", IDLE_BUTTONS.ok);
export const idlePausedKeyboard = () => new InlineKeyboard().text("▶️ Davom ettirish", IDLE_BUTTONS.resume);

// store — @yuk/store; api — bot.api (sendMessage). Ketma-ket yuboradi (bir paytda ko'p odam bo'lsa ham Telegram cheklovi
// ichida; bot.api da autoRetry bor). → { runOnce, start, stop }
export function createIdleWatcher({ store, api, log = console.log, now = () => Date.now(), everyMs = IDLE_CHECK_MS }) {
  let timer = null;
  let running = false;

  // Kuzatuv qachondan: seen_at 2026-11-09 dan yoziladi, undan oldingilar uchun soat birinchi tekshiruvdan boshlanadi
  function since() {
    const saved = Number(store.getSetting("idle_since"));
    if (saved > 0) return saved;
    const time = now();
    store.setSetting("idle_since", String(time));
    return time;
  }

  // 403 — botni bloklagan: unga boshqa yubormaymiz (deliver dagidek). Boshqa xato — keyingi aylanishda qayta urinadi
  async function send(user, text, keyboard) {
    try {
      await api.sendMessage(user.chatId, text, { reply_markup: keyboard });
      return true;
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 403) store.saveDriver(user.chatId, { active: false, why: "blocked" });
      else log(`Faollik xabari yuborilmadi (${user.chatId}): ${error.description ?? error.message}`);
      return false;
    }
  }

  // → { warned, paused } — shu aylanishda nechta
  async function runOnce() {
    if (running) return { warned: 0, paused: 0 };
    running = true;
    const result = { warned: 0, paused: 0 };
    try {
      const start = since();
      const users = [...store.activeUsers("haydovchi"), ...store.activeUsers("yuk_beruvchi")];
      for (const user of users) {
        const { action } = idleState(user, now(), start);
        if (action === "warn") {
          // Ogohlantirish yetib borsagina belgilanadi — bormasa, pauza ham bo'lmaydi (keyingi aylanishda qayta)
          if (await send(user, idleWarningText(user), idleWarningKeyboard())) {
            store.markIdleWarned(user.chatId);
            result.warned++;
          }
        } else if (action === "pause") {
          // Avval pauza (xabar yetmasa ham yuk bormasin), keyin xabar
          store.saveDriver(user.chatId, { active: false, why: "idle" });
          await send(user, idlePausedText(user), idlePausedKeyboard());
          result.paused++;
        }
      }
      if (result.warned || result.paused) log(`Faollik: ${result.warned} kishi ogohlantirildi, ${result.paused} kishi pauzaga o'tdi (48 soat kirmagan)`);
    } catch (error) {
      log(`Faollik tekshiruvida xato: ${error.message}`);
    } finally {
      running = false;
    }
    return result;
  }

  return {
    runOnce,
    // Birinchi tekshiruv — 1 daqiqadan keyin (bot ishga tushib olsin), keyin har everyMs
    start() {
      if (timer) return;
      timer = setTimeout(function tick() {
        runOnce().finally(() => {
          if (timer) timer = setTimeout(tick, everyMs);
        });
      }, MINUTE);
    },
    stop() {
      clearTimeout(timer);
      timer = null;
    },
  };
}
