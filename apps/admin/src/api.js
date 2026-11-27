// API bilan ishlash: get / post / patch / del. Xato bo'lsa — ApiError (serverning o'zbekcha xabari + turi).
// O'zgartiruvchi so'rovlarga "x-yuk-admin: 1" sarlavhasi qo'shiladi: API usiz 403 qaytaradi
// (boshqa sayt brauzeringiz orqali so'rov yubora olmasin — bunday sarlavhani CORS'siz qo'yib bo'lmaydi).
//
// Vaqt chegarasi: server osilib qolsa sahifa abadiy «Yuklanmoqda…» da turmasin — GET 20 s, o'zgartiruvchi so'rovlar
// 150 s (AI kalitini sinash bitta haqiqiy AI so'rovi: 1pro 120 s gacha javob berishi mumkin). Shundan keyin — "timeout".
// Har bir xato «Xatolar» bo'limiga yoziladi (errors.js).
import { recordError } from "./errors.js";
import { buildQuery } from "./query.js";

export const OFFLINE_MESSAGE = "Server bilan aloqa yo'q — npm start ishlayaptimi?";
export const GET_TIMEOUT_MS = 20_000;
export const CHANGE_TIMEOUT_MS = 150_000;

// kind: "timeout" — javob kutib turilmadi; "offline" — serverga ulanib bo'lmadi (yoki server ishlamayapti);
// "server" — 5xx; "client" — 4xx (masalan, «Bot terminalda ishlayapti»); "invalid" — tushunarsiz javob
export class ApiError extends Error {
  constructor(message, { status = 0, offline = false, kind = null, method = null, path = null, durationMs = null, timeoutMs = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.offline = offline;
    this.kind = kind ?? (offline ? "offline" : status >= 500 ? "server" : status >= 400 ? "client" : "invalid");
    this.method = method;
    this.path = path;
    this.durationMs = durationMs;
    this.timeoutMs = timeoutMs;
    this.at = Date.now();
  }
}

// Sessiya muddati tugaganda (401) barcha sahifalar bir marta xabar oladi — App.jsx kirish sahifasini qayta ochadi
const unauthorizedListeners = new Set();
export function onUnauthorized(fn) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}
function noteUnauthorized(status) {
  if (status === 401) for (const fn of unauthorizedListeners) fn();
}

// Javob matni → ma'lumot yoki ApiError. API xatolari doim { error: "..." } JSON bo'ladi;
// JSON bo'lmagan xato (Vite proxy 500, server yig'ilmagan) — server ishlamayapti deb hisoblaymiz.
// meta — xato qaysi so'rovda chiqqani (method, path, durationMs): «Xatolar» bo'limida ko'rinadi
export function readResponse(status, text, meta = {}) {
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (status >= 200 && status < 300) {
    if (text && json === null) throw new ApiError("Server tushunarsiz javob qaytardi", { status, kind: "invalid", ...meta });
    return json;
  }
  if (json && typeof json.error === "string") throw new ApiError(json.error, { status, ...meta });
  throw new ApiError(OFFLINE_MESSAGE, { status, offline: true, ...meta });
}

// Vaqt chegarasi xatosi (alohida — test qilish oson)
export function timeoutError(meta, timeoutMs) {
  return new ApiError(`Server ${Math.round(timeoutMs / 1000)} soniya ichida javob bermadi`, { kind: "timeout", timeoutMs, ...meta });
}

async function request(method, path, { params, body, timeoutMs = method === "GET" ? GET_TIMEOUT_MS : CHANGE_TIMEOUT_MS } = {}) {
  const headers = { accept: "application/json" };
  if (method !== "GET") headers["x-yuk-admin"] = "1";
  if (body !== undefined) headers["content-type"] = "application/json";
  const url = `${path}${buildQuery(params)}`;
  const started = Date.now();
  const meta = () => ({ method, path: url, durationMs: Date.now() - started });
  // AbortController — so'rovni o'rtada to'xtatish: timeoutMs o'tsa, fetch "AbortError" bilan tugaydi
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let status;
    let text;
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      status = response.status;
      text = await response.text();
    } catch {
      throw controller.signal.aborted ? timeoutError(meta(), timeoutMs) : new ApiError(OFFLINE_MESSAGE, { offline: true, ...meta() });
    }
    return readResponse(status, text, meta());
  } catch (error) {
    if (error instanceof ApiError) {
      noteUnauthorized(error.status);
      // 401 — parol/sessiya masalasi, «Xatolar» jurnaliga yozilmaydi (sahifani chalg'itmasligi uchun)
      if (error.status !== 401) recordError(error);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const get = (path, params, options) => request("GET", path, { params, ...options });
export const post = (path, body = {}, options) => request("POST", path, { body, ...options });
export const patch = (path, body = {}, options) => request("PATCH", path, { body, ...options });
export const put = (path, body = {}, options) => request("PUT", path, { body, ...options });
export const del = (path, options) => request("DELETE", path, options);
