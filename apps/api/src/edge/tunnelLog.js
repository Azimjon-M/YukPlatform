// cloudflared chiqargan qatorlarni tushunish (tunnel.js uchun; React'siz, testlanadi).
// cloudflared ko'p gapiradi (INF). Bizga kerakli: berilgan manzil, ulanish tayyorligi, ogohlantirish va xatolar.

// Tekin (quick) tunnel manzili: https://so'z-so'z-so'z-so'z.trycloudflare.com (kamida bitta chiziqcha —
// xato xabarlaridagi https://api.trycloudflare.com tunnel manzili emas)
export function parseTunnelUrl(line) {
  return line.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/i)?.[0].toLowerCase() ?? null;
}

// → "ready" (Cloudflare bilan ulandi), "problem" (WRN / ERR — logga chiqaramiz), null (ma'lumot uchun — yashiramiz)
export function tunnelLineKind(line) {
  if (/Registered tunnel connection/i.test(line)) return "ready";
  if (/\s(WRN|ERR|FTL)\s/.test(line)) return "problem";
  return null;
}
