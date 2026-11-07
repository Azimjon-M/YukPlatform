// Tunnel dasturlari chiqargan qatorlarni tushunish va qaysi tunnelni ishlatishni tanlash (tunnel.js uchun; .exe
// ishga tushirilmaydi — testlanadi).
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

// --- Tailscale Funnel: doimiy manzil https://<kompyuter>.<tarmoq>.ts.net (bepul, shaxsiy foydalanish uchun) ---

// `tailscale status --json` → { state, url }. state: Running | NeedsLogin | Stopped | NeedsMachineAuth | Starting | null.
// url — shu kompyuterning MagicDNS nomidan (Self.DNSName "yuk.tail1234.ts.net."), MagicDNS o'chiq bo'lsa — null
export function tailscaleStatus(json) {
  let data = json;
  if (typeof json === "string") {
    try {
      data = JSON.parse(json);
    } catch {
      return { state: null, url: null };
    }
  }
  const dns = String(data?.Self?.DNSName ?? "")
    .replace(/\.$/, "")
    .toLowerCase();
  return { state: data?.BackendState ?? null, url: /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(dns) ? `https://${dns}` : null };
}

// `tailscale funnel <manzil>` qatorlari → { kind, link? }:
//   ready   — «Available on the internet» yoki chiqqan https://….ts.net manzil (internetda ochiq)
//   enable  — Funnel yoki HTTPS tarmoqda hali yoqilmagan: CLI login.tailscale.com havolasini berib, kutib turadi
//   problem — xato (logga chiqaramiz)
export function funnelLine(line) {
  if (/available on the internet/i.test(line) || /https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net/i.test(line)) return { kind: "ready" };
  const link = line.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
  if (link) return { kind: "enable", link };
  if (/\b(error|failed|denied|not enabled|not allowed)\b/i.test(line)) return { kind: "problem" };
  return { kind: null };
}

const TAILSCALE_STATES = {
  NeedsLogin: "Tailscale'ga kirilmagan — Tailscale ilovasida «Log in»",
  Stopped: "Tailscale o'chiq — Tailscale ilovasida «Connect»",
  NeedsMachineAuth: "kompyuter Tailscale tarmog'ida hali tasdiqlanmagan (login.tailscale.com → Machines)",
  Starting: "Tailscale hali ishga tushyapti",
};
const stateText = (state) => TAILSCALE_STATES[state] ?? (state ? `Tailscale holati: ${state}` : "Tailscale xizmati javob bermadi");

// Qaysi tunnel: .env dagi TUNNEL = auto (standart) | tailscale | cloudflare.
//   auto — Tailscale o'rnatilgan va ulangan bo'lsa Funnel (doimiy manzil), bo'lmasa Cloudflare (manzil har safar yangi)
// → { use: "tailscale" | "cloudflare", note? } yoki { use: null, error }
export function chooseTunnel({ mode, tailscale = null, cloudflared = null, status = null } = {}) {
  const wanted = String(mode ?? "").trim().toLowerCase();
  const kind = wanted === "tailscale" ? "tailscale" : wanted === "cloudflare" || wanted === "cloudflared" ? "cloudflare" : "auto";
  const ready = status?.state === "Running" && Boolean(status.url);
  const why = !tailscale
    ? "Tailscale o'rnatilmagan"
    : status?.state === "Running"
      ? "Tailscale'da MagicDNS o'chiq (login.tailscale.com → DNS → MagicDNS)"
      : stateText(status?.state);
  const noCloudflared = "cloudflared topilmadi. O'rnatish (bir marta): winget install --id Cloudflare.cloudflared";

  if (kind === "tailscale") return ready ? { use: "tailscale" } : { use: null, error: `TUNNEL=tailscale, lekin ${why}` };
  if (kind === "cloudflare") return cloudflared ? { use: "cloudflare" } : { use: null, error: noCloudflared };
  if (ready) return { use: "tailscale" };
  if (cloudflared) return { use: "cloudflare", note: tailscale ? `Doimiy manzil yo'q: ${why}` : null };
  return { use: null, error: tailscale ? `${why}; ${noCloudflared}` : noCloudflared };
}
