// Haydovchilar ilovasining internetdagi manzili, tunnel bergan (https://....trycloudflare.com).
// Tunnel (apps/api src/edge/tunnel.js) ishga tushib manzil olganda bazaga yozadi, to'xtaganda o'chiradi.
// Bot (Mini App tugmasi) va boshqaruv markazi shu yerdan o'qiydi. Tekin tunnel manzili har qayta yoqilganda o'zgaradi.
import { readRunLock } from "./lock.js";

export const TUNNEL_URL_KEY = "public_url";

// Tunnel jarayoni tirik bo'lsagina manzil qaytadi: majburan o'chirilgan tunneldan qolgan eski manzil ishlatilmaydi
export function tunnelUrl(store, { readLock = readRunLock } = {}) {
  if (!readLock("tunnel")?.alive) return null;
  return store.getSetting(TUNNEL_URL_KEY);
}
