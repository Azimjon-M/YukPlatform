// Telegram Mini App bilan aloqa (telegram-web-app.js). Oddiy brauzerda ochilsa, tg bo'sh — forma baribir ishlaydi (sinov uchun).
import { useEffect } from "react";

const tg = window.Telegram?.WebApp ?? null;

export const inTelegram = Boolean(tg?.initData);
// sendData faqat botning pastki menyusidagi tugmadan ochilganda ishlaydi.
// Menyu tugmasi yoki havoladan ochilsa, Telegram query_id beradi — u holda saqlab bo'lmaydi.
export const canSave = inTelegram && !tg.initDataUnsafe?.query_id;
const atLeast = (version) => Boolean(tg?.isVersionAtLeast?.(version));

export function start() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  // Formani pastga surganda ilova yopilib ketmasin
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

// O'zgartirib, saqlamasdan yopmoqchi bo'lsa — Telegram "Yopilsinmi?" deb so'raydi
export function setUnsaved(unsaved) {
  if (!atLeast("6.2")) return;
  if (unsaved) tg.enableClosingConfirmation();
  else tg.disableClosingConfirmation();
}

// Ma'lumot botga "web_app_data" xabari bo'lib boradi, Mini App o'zi yopiladi
export function sendToBot(payload) {
  setUnsaved(false);
  tg.sendData(JSON.stringify(payload));
}

// Telegram'ning pastdagi katta tugmasi (MainButton)
export function useMainButton(text, onClick, visible = true) {
  useEffect(() => {
    if (!inTelegram) return undefined;
    const button = tg.MainButton;
    button.setParams({ text, is_visible: visible, is_active: true });
    button.onClick(onClick);
    return () => button.offClick(onClick);
  }, [text, onClick, visible]);
}
