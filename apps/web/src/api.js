// Haydovchilar serveri (apps/api public.js) bilan aloqa: kirish, token, so'rovlar.
// Server manzili: odatda shu sayt bilan bir joyda (/pub/...). Sayt boshqa joyda (Cloudflare Pages) bo'lsa —
// yig'ishda VITE_API_URL=https://... beriladi (apps/web/README.md).
import { inTelegram, initData } from "./telegram.js";

export const API_URL = (import.meta.env?.VITE_API_URL ?? "").replace(/\/+$/, "");
const TOKEN_KEY = "yuk-token";

export class ApiError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code; // "auth" — qayta kirish, "no_profile" — sozlamalar kerak, "offline" — server bilan aloqa yo'q
  }
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

// Boshqaruv markazidagi «Web'da ochish» havolasi: http://localhost:3001/#token=... — tokenni olib, manzildan o'chiramiz
export function takeTokenFromUrl(location = window.location, history = window.history) {
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
  if (json?.error) throw new ApiError(json.error, { status: response.status, code: json.code ?? null });
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

// Ilova ochilganda: Telegram ichida har safar yangidan kiradi (initData 24 soat amal qiladi);
// saytda — saqlangan token bilan. → { me } | { me: null } (kirish kerak)
export async function resume() {
  if (inTelegram) return { me: await login() };
  const fromUrl = takeTokenFromUrl();
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
// role — "haydovchi" | "yuk_beruvchi": profil shu rol qoidalari bilan tekshiriladi
export const saveProfile = (profile, role) => request("PUT", "/pub/me/profile", { body: role ? { role, profile } : { profile } });
// Boshqa rolga o'tilsa, server eski sozlamalarni o'chiradi
export const setRole = (role) => request("PUT", "/pub/me/role", { body: { role } });
export const setActive = (active) => request("PATCH", "/pub/me", { body: { active } });

const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// view: mine | all; hours, from, to, limit, offset
export const getLoads = (params = {}) => request("GET", `/pub/loads?${query(params)}`);
// Bo'sh mashinalar (yuk beruvchiga) — parametrlar xuddi shunday
export const getTrucks = (params = {}) => request("GET", `/pub/trucks?${query(params)}`);

// --- Admin («🛠 Boshqaruv»): server har safar admin ekanini tekshiradi, boshqalarga 403 ---
export const getAdminOverview = () => request("GET", "/pub/admin/overview");
// q — ism / @username / id; role — haydovchi | yuk_beruvchi | none
export const getAdminUsers = (params = {}) => request("GET", `/pub/admin/users?${query(params)}`);
// { active } yoki { role } (boshqa rolga o'tsa, uning sozlamalari o'chadi)
export const updateAdminUser = (chatId, body) => request("PATCH", `/pub/admin/users/${chatId}`, { body });
