// Telegram Mini App bilan aloqa (telegram-web-app.js). Oddiy brauzerda ochilsa, tg bo'sh — ilova sayt bo'lib ishlaydi.
import { useEffect } from "react";

const tg = window.Telegram?.WebApp ?? null;

export const inTelegram = Boolean(tg?.initData);
// Imzolangan ma'lumot: server uni bot tokeni bilan tekshirib, haydovchini taniydi (apps/api telegramAuth.js)
export const initData = tg?.initData ?? "";
// sendData faqat botning pastki menyusidagi tugmadan ochilganda ishlaydi.
// Menyu tugmasi yoki havoladan ochilsa, Telegram query_id beradi — u holda botga yuborib bo'lmaydi
// (server bilan aloqa bo'lsa, sozlamalar server orqali saqlanadi — bu cheklov u yerda yo'q).
export const canSendData = inTelegram && !tg.initDataUnsafe?.query_id;
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

// Telegram'ning pastdagi katta tugmasi (MainButton). visible=false — yashiriladi
export function useMainButton(text, onClick, visible = true) {
  useEffect(() => {
    if (!inTelegram) return undefined;
    const button = tg.MainButton;
    button.setParams({ text, is_visible: visible, is_active: true });
    button.onClick(onClick);
    return () => {
      button.offClick(onClick);
      button.hide();
    };
  }, [text, onClick, visible]);
}
