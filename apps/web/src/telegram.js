// Telegram Mini App bilan aloqa (telegram-web-app.js). Oddiy brauzerda ochilsa, ilova sayt bo'lib ishlaydi.
import { useEffect, useSyncExternalStore } from "react";

// Kutubxona oddiy brauzerda ham Telegram.WebApp ni yaratadi (platform "unknown", initData bo'sh)
const tg = window.Telegram?.WebApp ?? null;

// Imzolangan ma'lumot: server uni bot tokeni bilan tekshirib, foydalanuvchini taniydi (apps/api telegramAuth.js).
// Inline tugma, chap pastdagi menyu tugmasi yoki t.me havolasidan ochilganda keladi.
export const initData = tg?.initData ?? "";
// Telegram ichidami. Botning PASTKI MENYU (reply keyboard) tugmasidan ochilganda Telegram initData'ni BO'SH beradi
// (core.telegram.org/bots/webapps: "empty if the Mini App was launched from a keyboard button") — lekin platformani
// (android / ios / tdesktop / weba ...) baribir aytadi. Shuning uchun faqat initData'ga qarab bo'lmaydi.
export const inTelegram = Boolean(tg) && (Boolean(initData) || (tg.platform ?? "unknown") !== "unknown");
// Pastki menyu tugmasidan ochilgan: kimligini bot tugma manziliga qo'ygan token (?t=) aytadi (api.js),
// sozlamalar esa serverga ham, sendData bilan botga ham ketadi (bot chatda «✅ Saqlandi» deb, menyuni yangilaydi).
// sendData faqat shu holatda ishlaydi — inline tugma / havoladan ochilsa, Telegram uni rad etadi.
export const fromKeyboard = inTelegram && !initData;
export const canSendData = fromKeyboard;
const atLeast = (version) => Boolean(tg?.isVersionAtLeast?.(version));

// Yorug' / qorong'i: Telegram mavzusidan, brauzerda — tizim sozlamasidan (xarita rasmlari shunga qarab)
function applyScheme() {
  const dark = inTelegram ? tg.colorScheme === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.scheme = dark ? "dark" : "light";
}

export function start() {
  applyScheme();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", applyScheme);
  if (!tg) return;
  tg.onEvent?.("themeChanged", applyScheme);
  tg.ready();
  tg.expand();
  // Ro'yxatni pastga surganda ilova yopilib ketmasin
  if (atLeast("7.7")) tg.disableVerticalSwipes();
}

export const haptic = {
  select: () => atLeast("6.1") && tg.HapticFeedback.selectionChanged(),
  error: () => atLeast("6.1") && tg.HapticFeedback.notificationOccurred("error"),
  success: () => atLeast("6.1") && tg.HapticFeedback.notificationOccurred("success"),
};

export function showAlert(message) {
  if (atLeast("6.2")) tg.showAlert(message);
  else window.alert(message);
}

// "Ha / Yo'q" savoli → Promise<boolean>. Telegram ichida — Telegram oynasi, brauzerda — oddiy confirm
export function confirmAction(message) {
  if (atLeast("6.2")) return new Promise((resolve) => tg.showConfirm(message, (ok) => resolve(Boolean(ok))));
  return Promise.resolve(window.confirm(message));
}

// O'zgartirib, saqlamasdan yopmoqchi bo'lsa — Telegram "Yopilsinmi?" deb so'raydi
export function setUnsaved(unsaved) {
  if (!atLeast("6.2")) return;
  if (unsaved) tg.enableClosingConfirmation();
  else tg.disableClosingConfirmation();
}

// Telefon raqami (ixtiyoriy): Telegram «Raqamingizni ulashasizmi?» deb so'raydi. Rozi bo'lsa, raqam BOTGA kontakt
// xabari bo'lib boradi va bot uni saqlaydi (faqat o'z kontakti) — ilova uni serverdan (/pub/me) ko'radi.
// → Promise<boolean>: ulashdimi. Telegram 6.9 dan eski bo'lsa — tugma ko'rsatilmaydi (botda /raqam).
export const canRequestContact = inTelegram && atLeast("6.9");
export function requestContact() {
  return new Promise((resolve) => tg.requestContact((shared) => resolve(Boolean(shared))));
}

// Ma'lumot botga "web_app_data" xabari bo'lib boradi, Mini App o'zi yopiladi
export function sendToBot(payload) {
  setUnsaved(false);
  tg.sendData(JSON.stringify(payload));
}

// t.me havolasi Telegram ichida chatning o'zida ochilsin (brauzerga chiqib ketmasin)
export function openLink(url, event) {
  if (!inTelegram) return;
  event?.preventDefault();
  if (/^https:\/\/t\.me\//.test(url) && atLeast("6.1")) tg.openTelegramLink(url);
  else tg.openLink(url);
}

// Telegram'ning tepadagi «← Orqaga» tugmasi (ro'yxatdan o'tishning oldingi qadamiga). visible=false — yashiriladi
export function useBackButton(onBack, visible = true) {
  useEffect(() => {
    if (!inTelegram || !atLeast("6.1") || !visible) return undefined;
    const button = tg.BackButton;
    button.onClick(onBack);
    button.show();
    return () => {
      button.offClick(onBack);
      button.hide();
    };
  }, [onBack, visible]);
}

// Telegram'ning pastdagi katta tugmasi (MainButton). visible=false — yashiriladi
// Qulf (2026-11-19 hodisa: akkaunt ulashda 2FA parolini yozib, klaviatura ustidagi «✅ Saqlash» bosildi — sozlamalar saqlanib,
// Mini App yopildi, parol esa yuborilmadi). Sahifada boshqa forma (akkaunt ulash) ochiq turganda useMainButtonLock(true) —
// pastdagi Telegram tugmasi yashiriladi, foydalanuvchi forma ichidagi tugmani bosadi
let mainButtonLocks = 0;
const lockListeners = new Set();
const lockChanged = () => lockListeners.forEach((listener) => listener());
const subscribeLock = (listener) => (lockListeners.add(listener), () => lockListeners.delete(listener));
const lockedNow = () => mainButtonLocks > 0;
export function useMainButtonLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    mainButtonLocks++;
    lockChanged();
    return () => {
      mainButtonLocks--;
      lockChanged();
    };
  }, [active]);
}

export function useMainButton(text, onClick, visible = true) {
  const locked = useSyncExternalStore(subscribeLock, lockedNow, lockedNow);
  useEffect(() => {
    if (!inTelegram) return undefined;
    const button = tg.MainButton;
    button.setParams({ text, is_visible: visible && !locked, is_active: true });
    button.onClick(onClick);
    return () => {
      button.offClick(onClick);
      button.hide();
    };
  }, [text, onClick, visible, locked]);
}

// Mini App'ni yopish (Telegram ichida). Saytda hech narsa qilmaydi → false
export function closeApp() {
  if (!inTelegram) return false;
  tg.close();
  return true;
}
