// Haydovchilar serveri (apps/api public.js) bilan aloqa: kirish, token, so'rovlar.
// Server manzili: odatda shu sayt bilan bir joyda (/pub/...). Sayt boshqa joyda (Cloudflare Pages) bo'lsa —
// yig'ishda VITE_API_URL=https://... beriladi (apps/web/README.md).
import { initData } from "./telegram.js";

export const API_URL = (import.meta.env?.VITE_API_URL ?? "").replace(/\/+$/, "");
const TOKEN_KEY = "yuk-token";

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, field = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field; // forma xatosi: qaysi maydon (masalan «📦 Yuk berish» da "phones") — sahifa o'sha joyni ko'rsatadi
    this.code = code; // "auth" — qayta kirish, "no_profile" — sozlamalar kerak, "offline" — server bilan aloqa yo'q,
    // "blocked" — boshqaruv markazidan bloklangan (App «Uzr, sizga xizmat ko'rsata olmaymiz!» ekranini ko'rsatadi)
  }
}

// Bloklangan javobi (403 "blocked") qaysi so'rovdan kelsa ham — App butun ilova o'rniga «Uzr...» ekranini qo'yadi
let blockedHandler = null;
export function onBlocked(handler) {
  blockedHandler = handler;
  return () => {
    if (blockedHandler === handler) blockedHandler = null;
  };
}

// Brauzer xotirasi: yopiq rejimda yoki taqiqlangan bo'lsa xato beradi — unda token faqat shu ochilishda yashaydi
let memoryToken = null;
export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set(token) {
    memoryToken = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* xotira yo'q — memoryToken yetadi */
    }
  },
};

// Manzildagi kirish tokeni — olib, manzildan o'chiramiz (ekranda, nusxa olinganda ko'rinmasin):
//   ?t=...      — botning pastki menyu tugmasi (Telegram u yerda initData bermaydi, bot shu odamning tokenini qo'yadi);
//                 boshqa parametrlar (?v=&r=&p=&s=) va Telegram'ning #tgWebApp... qismi qoladi
//   #token=...  — boshqaruv markazidagi «Web'da ochish» havolasi (http://localhost:3001/#token=...)
const TOKEN_RE = /^[\w.-]{20,512}$/;
export function takeTokenFromUrl(location = window.location, history = window.history) {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("t");
  if (fromQuery !== null) {
    params.delete("t");
    const search = params.toString();
    history.replaceState(history.state ?? null, "", `${location.pathname}${search ? `?${search}` : ""}${location.hash}`);
    return TOKEN_RE.test(fromQuery) ? fromQuery : null;
  }
  const match = /(?:^#|&)token=([\w.-]+)/.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return match[1];
}

export async function request(method, path, { body, token = tokenStore.get() } = {}) {
  const headers = { accept: "application/json", "ngrok-skip-browser-warning": "1" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Server bilan aloqa yo'q. Internetni tekshiring va qayta urinib ko'ring.", { code: "offline" });
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (response.ok && json) return json;
  // Ilova (nginx'dagi apps/web/dist) yangilangan, server esa hali eski kodda: yangi yo'l unda yo'q va u umumiy «Topilmadi»
  // deydi (2026-11-07 da «Chiqish» shunday bo'lgan). Ilova faqat o'zi biladigan yo'llarni so'raydi — demak, server eski
  if (response.status === 404 && json?.error === "Topilmadi" && !json.code) {
    throw new ApiError(
      "Server hali eski versiyada ishlayapti — bu amal server qayta ishga tushirilgach ishlaydi. Hech narsa o'zgarmadi.",
      { status: 404, code: "outdated" },
    );
  }
  if (json?.code === "blocked") blockedHandler?.(json.error);
  if (json?.error) throw new ApiError(json.error, { status: response.status, code: json.code ?? null, field: json.field ?? null });
  // JSON emas (server yo'q, tunnel o'chiq, statik hosting 404 qaytardi)
  throw new ApiError("Server hozir ishlamayapti. Birozdan keyin qayta urinib ko'ring.", { status: response.status, code: "offline" });
}

export const getConfig = () => request("GET", "/pub/config", { token: null });

// Kirish: Telegram ichida — initData bilan; saytda — vidjet ma'lumoti bilan. → me (token saqlanadi)
export async function login({ widget } = {}) {
  const body = widget ? { widget } : { initData };
  const { token, me } = await request("POST", "/pub/auth", { body, token: null });
  tokenStore.set(token);
  return me;
}

// Ilova ochilganda, tartib bilan:
//   1) initData bor (inline / menyu tugmasi, havola) — har safar yangidan kiradi (initData 24 soat amal qiladi);
//   2) manzilda token (botning pastki menyu tugmasi ?t=, boshqaruv markazi #token=) — o'sha bilan;
//   3) avval saqlangan token bilan.
// → { me } | { me: null } (kirish kerak: saytda — kirish sahifasi, Telegram ichida — sozlamalar botga sendData bilan)
export async function resume() {
  const fromUrl = takeTokenFromUrl();
  if (initData) {
    try {
      return { me: await login() };
    } catch (error) {
      if (error.code !== "auth") throw error; // imzo o'tmadi — pastda token bilan urinib ko'ramiz
    }
  }
  if (fromUrl) tokenStore.set(fromUrl);
  if (!tokenStore.get()) return { me: null };
  try {
    return { me: await request("GET", "/pub/me") };
  } catch (error) {
    if (error.code === "auth") {
      tokenStore.set(null);
      return { me: null };
    }
    throw error;
  }
}

export const logout = () => tokenStore.set(null);
// Foydalanuvchining hozirgi holati (masalan, bot raqamni saqladimi)
export const getMe = () => request("GET", "/pub/me");
// role — "haydovchi" | "yuk_beruvchi": profil shu rol qoidalari bilan tekshiriladi
// «📌 Mening guruhlarim» uchun tanlasa bo'ladigan guruhlar → { sources: [{ name, title, members, perDay, mine }], chosen, max }
export const getFeedSources = () => request("GET", "/pub/me/feed-sources");

export const saveProfile = (profile, role) => request("PUT", "/pub/me/profile", { body: role ? { role, profile } : { profile } });
// Boshqa rolga o'tilsa, server eski rolning sozlamalarini saqlab qo'yadi; yangi rolda avval to'ldirilgani bo'lsa — me.profile da
export const setRole = (role) => request("PUT", "/pub/me/role", { body: { role } });
export const setActive = (active) => request("PATCH", "/pub/me", { body: { active } });
// Hisobdan chiqish — serverda (faqat tokenni o'chirish yetmaydi: Telegram'da bot odamni baribir taniydi):
// rol va sozlamalar yashiriladi, bot yubormaydi; qayta kirib rolni tanlasa — tiklanadi → me (role: null)
export const signOut = () => request("POST", "/pub/me/logout");
// Hisobni butunlay o'chirish (botdagi /ochirish → «Hammasini o'chirish» bilan bir xil) → { deleted: true }
export const deleteMe = () => request("DELETE", "/pub/me");
// Faqat o'z telefon raqamini o'chirish (sozlamalardagi «🗑 Raqamni o'chirish») → me (phone: null)
export const deletePhone = () => request("DELETE", "/pub/me/phone");

const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// view: mine | all; hours, from, to, limit, offset
export const getLoads = (params = {}) => request("GET", `/pub/loads?${query(params)}`);
// Bo'sh mashinalar (yuk beruvchiga) — parametrlar xuddi shunday
export const getTrucks = (params = {}) => request("GET", `/pub/trucks?${query(params)}`);

// Haydovchining yo'nalishi (botdagi «📋 Mos yuklar» bilan bir xil): { from, hours } → { areas: [{ id, label, count }], any }.
// from yo'q — «Qayerdan?» tugmalari, bor — «Qayerga?» ("*" = hamma joydan)
export const getRoute = (params = {}) => request("GET", `/pub/me/route?${query(params)}`);
// "*" = istalgan joy → yangilangan me (bot ham yangi yuklarni shu yo'nalish bo'yicha yuboradi).
// notify — botdagi «🗺 Xaritadan tanlash» dan ochilgan: bot chatda «✅ Yo'nalish» va mos yuklar bilan javob beradi
export const saveRoute = (from, to, { notify = false } = {}) =>
  request("PUT", "/pub/me/route", { body: notify ? { from, to, notify: true } : { from, to } });

// «📦 Yuk berish» (yuk beruvchi): forma uchun — oxirgi raqamlar, 24 soatda nechta yuborgani, botdagi qoralama →
// { draft, phones, used, limit }
export const getLoadForm = () => request("GET", "/pub/me/load-form");
// Yukni yuborish → { ok, id, load }. Xato maydon — ApiError.field. fromDraft — botdagi qoralama tuzatib yuborildi
export const postLoad = (load, { fromDraft = false } = {}) => request("POST", "/pub/loads", { body: fromDraft ? { load, fromDraft: true } : { load } });

// --- Admin («🛠 Boshqaruv»): server har safar admin ekanini tekshiradi, boshqalarga 403 ---
export const getAdminOverview = () => request("GET", "/pub/admin/overview");
// q — ism / @username / id; role — haydovchi | yuk_beruvchi | none
export const getAdminUsers = (params = {}) => request("GET", `/pub/admin/users?${query(params)}`);
// { active } yoki { role } (boshqa rolga o'tsa, uning sozlamalari saqlanib qoladi, yangi roldagisi bo'lsa — tiklanadi)
export const updateAdminUser = (chatId, body) => request("PATCH", `/pub/admin/users/${chatId}`, { body });

// Collector'ning Telegram akkauntlari va yangi akkaunt qo'shish (raqam → kod → 2FA parol; apps/api tgLogin.js)
// base: "/pub/admin/tg-accounts" (admin — hammasi) yoki "/pub/me/tg-accounts" (Sozlamalar — faqat o'zinikilar)
export function tgAccountsApi(base) {
  const login = (id) => `${base}/login/${encodeURIComponent(id)}`;
  return {
    get: () => request("GET", base),
    start: (name, phone) => request("POST", `${base}/login`, { body: { name, phone } }),
    startQr: (name) => request("POST", `${base}/login`, { body: { name, qr: true } }),
    code: (id, code) => request("POST", `${login(id)}/code`, { body: { code } }),
    resend: (id) => request("POST", `${login(id)}/resend`),
    password: (id, password) => request("POST", `${login(id)}/password`, { body: { password } }),
    cancel: (id) => request("DELETE", login(id)),
  };
}
export const ADMIN_TG = tgAccountsApi("/pub/admin/tg-accounts");
export const MY_TG = tgAccountsApi("/pub/me/tg-accounts");
