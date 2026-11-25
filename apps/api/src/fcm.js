// Firebase Cloud Messaging (FCM HTTP v1) — ilovaga bildirishnoma yuborish. Kutubxonasiz: Google xizmat akkaunti kaliti
// (Firebase → Project settings → Service accounts → «Generate new private key») bilan JWT imzolanadi → OAuth token
// (~1 soat, xotirada) → messages:send. Kalit fayli: YUK_FCM_KEY yoki /data/ops/firebase-yuk.json (git'ga kirmaydi).
// Fayl yo'q — createFcm null qaytaradi (bildirishnoma o'chiq, server baribir ishlaydi).
import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const FCM_KEY_FILE = process.env.YUK_FCM_KEY?.trim() || "/data/ops/firebase-yuk.json";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

export function loadFcmKey(file = FCM_KEY_FILE) {
  if (!existsSync(file)) return null;
  const key = JSON.parse(readFileSync(file, "utf8"));
  if (!key.project_id || !key.client_email || !key.private_key) throw new Error(`${file}: Firebase xizmat akkaunti kaliti emas`);
  return key;
}

// send(token, data) → "ok" | "gone" (token o'lik — o'chirish kerak) | "error"
export function createFcm(key, { fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!key) return null;
  const tokenUri = key.token_uri || "https://oauth2.googleapis.com/token";
  let access = null; // { token, until }

  async function accessToken() {
    if (access && access.until > now() + 60_000) return access.token;
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: key.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`FCM token olinmadi: ${res.status} ${data.error ?? ""}`);
    access = { token: data.access_token, until: now() + (Number(data.expires_in) || 3600) * 1000 };
    return access.token;
  }

  return async function send(token, data) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${key.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
      // data-only: ilova (expo-notifications) o'zi ko'rsatadi — kanal, «📞» tugmasi. HIGH — telefon uxlab yotsa ham (Doze) uyg'otadi
      body: JSON.stringify({ message: { token, data, android: { priority: "HIGH", ttl: "900s" } } }),
    });
    if (res.ok) return "ok";
    const body = await res.json().catch(() => ({}));
    const reason = JSON.stringify(body.error ?? {});
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(reason)) return "gone";
    if (res.status === 400 && /INVALID_ARGUMENT/.test(reason) && /token/i.test(reason)) return "gone";
    if (res.status === 401) access = null;
    return "error";
  };
}
