// Boshqaruv markazida kirish holati (server: apps/api/src/adminAuth.js).
//
// Sessiya cookie'si httpOnly — JS uni o'qiy olmaydi, shuning uchun holat serverdan so'raladi:
//   GET /api/session → { signedIn, configured, expiresAt, source, login, user }
//
// 2026-11-11 (Azimjon: «login sahifa faqat parol so'raydigan bo'libdi… username va parolli bo'lsin»):
// kirish endi LOGIN + PAROL. Login serverda saqlanadi (settings.admin_user), parol kabi hisoblangan holida.
// Kirish / chiqish shu modul orqali (login.js emas — React holati bilan bog'langan).
//
// Har qanday API javobi 401 bo'lsa (sessiya tugagan yoki server qayta yoqilgan) — barcha sahifalar shu
// modulga xabar beradi va App.jsx qaytadan kirish sahifasini ko'rsatadi.
import { get, onUnauthorized, post } from "./api.js";

let state = { status: "checking", signedIn: false, configured: true, source: null, login: null, loginSource: null, user: null, envLogin: null, expiresAt: null, error: null };
const subscribers = new Set();

function set(next) {
  state = { ...state, ...next };
  for (const fn of subscribers) fn(state);
}

export const sessionState = () => state;

export function subscribeSession(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Sahifa ochilganda va kirishdan keyin: serverga «men kirmishmanmi?» deb so'raymiz (bu so'rov parolsiz ham ishlaydi)
export async function checkSession() {
  try {
    const info = await get("/api/session", null, { timeoutMs: 10_000 });
    set({
      status: "ready",
      signedIn: Boolean(info.signedIn),
      configured: Boolean(info.configured),
      source: info.source ?? null,
      // login — faqat KIRGAN holatda keladi (tashqaridagi odam uni bilib qo'ymasligi uchun)
      login: info.login ?? null,
      loginSource: info.loginSource ?? null,
      user: info.user ?? null,
      expiresAt: info.expiresAt ?? null,
      error: null,
    });
    return state;
  } catch (error) {
    // Server ishlamayapti / tunnel uzilgan — «serverga ulanib bo'lmadi» holatini ko'rsatamiz (parol xatosi emas)
    set({ status: "offline", error });
    return state;
  }
}

// Login + parol bilan kirish. Muvaffaqiyatli bo'lsa — cookie qo'yiladi, sahifa o'zi ochiladi.
export async function signIn({ username, password, remember = false }) {
  const answer = await post("/api/login", { username, password, remember });
  set({ status: "ready", signedIn: true, configured: true, login: answer.login ?? null, user: answer.login ?? username ?? null, expiresAt: answer.expiresAt ?? null, remember: Boolean(answer.remember), error: null });
  return answer;
}

// Hali login/parol qo'yilmagan (birinchi ishga tushirish): birinchi login va parolni o'zimiz qo'yamiz
export async function setupPassword({ username, password, repeat }) {
  const answer = await post("/api/setup", { username, password, repeat });
  set({ status: "ready", signedIn: true, configured: true, login: answer.login ?? null, user: answer.login ?? username ?? null, source: "manual", loginSource: "manual", expiresAt: answer.expiresAt ?? null, error: null });
  return answer;
}

export async function signOut() {
  try {
    await post("/api/logout", {});
  } finally {
    set({ status: "ready", signedIn: false, expiresAt: null });
  }
}

// Parolni almashtirish (kirgan holatda, eski parolni bilgan holda)
export async function changePassword({ oldPassword, password, repeat }) {
  await post("/api/password", { oldPassword, password, repeat });
}

// Login va/yoki parolni almashtirish (kirgan holatda; eski parol shart). Javobda yangi login qaytadi —
// uni holatga yozamiz, shunda yon paneldagi «Hisob» yangi login'ni ko'rsatadi.
export async function updateAccount({ username, oldPassword, password, repeat }) {
  const answer = await post("/api/account", { username, oldPassword, password, repeat });
  if (answer?.login) set({ login: answer.login, user: answer.login, loginSource: "manual" });
  return answer;
}

// 401 — sessiya tugagan: sahifani kirishga qaytaramiz (har bir so'rov uchun bir marta, takrorlanmaydi)
let notified = false;
onUnauthorized(() => {
  if (notified) return;
  notified = true;
  set({ status: "ready", signedIn: false, expiresAt: null });
  setTimeout(() => (notified = false), 2000);
});
