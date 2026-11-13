// Tunnel dasturlari chiqargan qatorlarni tushunish va qaysi tunnelni ishlatishni tanlash (tunnel.js uchun; .exe
// ishga tushirilmaydi — testlanadi).
// cloudflared ko'p gapiradi (INF). Bizga kerakli: berilgan manzil, ulanish tayyorligi, ogohlantirish va xatolar.
import { existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";

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

// Cloudflare'da bir martalik qo'llaniladigan sozlamalar (`cloudflared tunnel login` → cert.pem),
// keyin xizmat ularni takrorlamaydi. nom — tunnel nomi, hostname — domen (yuk.gtpro.uz kabi).
// cert.pem (yoki CF_TUNNEL_CRED) va CF_TUNNEL_HOSTNAME bo'lsa — doimiy manzilli tunnel ishlatiladi.
export function namedCloudflare(env = process.env) {
  const cert = env.CF_TUNNEL_CERT || `${env.HOME ?? ""}/.cloudflared/cert.pem`;
  const certReady = cert && existsSync(cert);
  const credFile = env.CF_TUNNEL_CRED || (certReady && existsSync(cert) ? findCredential(cert) : null);
  const hostname = String(env.CF_TUNNEL_HOSTNAME ?? "").trim().toLowerCase();
  const name = String(env.CF_TUNNEL_NAME ?? "yuk").trim().toLowerCase();
  return { certReady, credFile, hostname, name, usable: Boolean(certReady && credFile && hostname) };
}

// cert.pem yonidagi tunnel kaliti: ~/.cloudflared/<tunnel-id>.json
function findCredential(certPath) {
  const dir = dirname(certPath);
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir);
  const id = String(process.env.CF_TUNNEL_ID ?? "").trim();
  const pick = (id && files.includes(`${id}.json`) ? `${id}.json` : null) ?? files.find((f) => /^[0-9a-f-]{36}\.json$/.test(f)) ?? null;
  return pick ? `${dir}/${pick}` : null;
}

// Qaysi tunnel: .env dagi TUNNEL = auto (standart) | tailscale | cloudflare | cloudflare-named (doimiy domen).
//   auto — Tailscale o'rnatilgan va ulangan bo'lsa Funnel (doimiy manzil), bo'lmasa Cloudflare (manzil har safar yangi)
//   cloudflare-named — sertifikat bilan nomlangan tunnel: manzil DOIMIY (masalan https://yuk.gtpro.uz)
// → { use: "tailscale" | "cloudflare" | "named", note? } yoki { use: null, error }
export function chooseTunnel({ mode, tailscale = null, cloudflared = null, status = null, named = null } = {}) {
  const wanted = String(mode ?? "").trim().toLowerCase();
  const kind =
    wanted === "tailscale" ? "tailscale" : wanted === "cloudflare" || wanted === "cloudflared" ? "cloudflare" : wanted === "cloudflare-named" || wanted === "named" ? "named" : "auto";
  const ready = status?.state === "Running" && Boolean(status.url);
  const why = !tailscale
    ? "Tailscale o'rnatilmagan"
    : status?.state === "Running"
      ? "Tailscale'da MagicDNS o'chiq (login.tailscale.com → DNS → MagicDNS)"
      : stateText(status?.state);
  const noCloudflared = "cloudflared topilmadi. O'rnatish (bir marta): winget install --id Cloudflare.cloudflared";

  if (kind === "tailscale") return ready ? { use: "tailscale" } : { use: null, error: `TUNNEL=tailscale, lekin ${why}` };
  if (kind === "cloudflare") return cloudflared ? { use: "cloudflare" } : { use: null, error: noCloudflared };
  if (kind === "named")
    return !cloudflared
      ? { use: null, error: noCloudflared }
      : named?.usable
        ? { use: "named", note: `Doimiy manzil: https://${named.hostname}` }
        : {
            use: null,
            error:
              "TUNNEL=cloudflare-named, lekin tayyor emas: " +
              (!named?.certReady
                ? "`cloudflared tunnel login` bilan sertifikat oling (~/.cloudflared/cert.pem)"
                : !named?.credFile
                  ? "tunnel kaliti (~/.cloudflared/<id>.json) topilmadi — `cloudflared tunnel create` qiling"
                  : ".env ga CF_TUNNEL_HOSTNAME domenini yozing"),
          };
  if (ready) return { use: "tailscale" };
  // auto rejimda ham doimiy domenni afzal ko'ramiz
  if (named?.usable) return { use: "named", note: `Doimiy manzil: https://${named.hostname}` };
  if (cloudflared) return { use: "cloudflare", note: tailscale ? `Doimiy manzil yo'q: ${why}` : null };
  return { use: null, error: tailscale ? `${why}; ${noCloudflared}` : noCloudflared };
}
