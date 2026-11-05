// API bilan ishlash: get / post / patch / del. Xato bo'lsa — Error(serverning o'zbekcha xabari).
// O'zgartiruvchi so'rovlarga "x-yuk-admin: 1" sarlavhasi qo'shiladi: API usiz 403 qaytaradi
// (boshqa sayt brauzeringiz orqali so'rov yubora olmasin — bunday sarlavhani CORS'siz qo'yib bo'lmaydi).
import { buildQuery } from "./query.js";

export const OFFLINE_MESSAGE = "Server bilan aloqa yo'q — npm start ishlayaptimi?";

export class ApiError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.offline = offline;
  }
}

// Javob matni → ma'lumot yoki ApiError. API xatolari doim { error: "..." } JSON bo'ladi;
// JSON bo'lmagan xato (Vite proxy 500, server yig'ilmagan) — server ishlamayapti deb hisoblaymiz.
export function readResponse(status, text) {
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (status >= 200 && status < 300) {
    if (text && json === null) throw new ApiError("Server tushunarsiz javob qaytardi", { status });
    return json;
  }
  if (json && typeof json.error === "string") throw new ApiError(json.error, { status });
  throw new ApiError(OFFLINE_MESSAGE, { status, offline: true });
}

async function request(method, path, { params, body } = {}) {
  const headers = { accept: "application/json" };
  if (method !== "GET") headers["x-yuk-admin"] = "1";
  if (body !== undefined) headers["content-type"] = "application/json";
  let status;
  let text;
  try {
    const response = await fetch(`${path}${buildQuery(params)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = response.status;
    text = await response.text();
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, { offline: true });
  }
  return readResponse(status, text);
}

export const get = (path, params) => request("GET", path, { params });
export const post = (path, body = {}) => request("POST", path, { body });
export const patch = (path, body = {}) => request("PATCH", path, { body });
export const del = (path) => request("DELETE", path);
