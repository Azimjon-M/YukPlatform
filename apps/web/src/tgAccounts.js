// «🛠 Boshqaruv» → «Telegram akkauntlari» (TgAccounts.jsx) uchun sof funksiyalar: matnlar va nom taklifi.
// Server tomoni — apps/api/src/tgLogin.js, holatlar — @yuk/store tgAccounts.js.

export const MAIN_ACCOUNT = "asosiy"; // @yuk/store MAIN_TG_ACCOUNT bilan bir xil
// Kirish davom etyapti (kod yoki parol kutilyapti / tekshirilyapti)
export const ACTIVE_STEPS = new Set(["sending", "code", "qr", "checking", "password"]);

const ORDINALS = ["ikkinchi", "uchinchi", "tortinchi", "beshinchi", "oltinchi", "yettinchi", "sakkizinchi", "toqqizinchi", "oninchi"];

// Yangi akkaunt uchun bo'sh nom: ikkinchi, uchinchi, … (band bo'lsa — keyingisi)
export function suggestAccountName(accounts = []) {
  const used = new Set(accounts.map((a) => a.name));
  return ORDINALS.find((name) => !used.has(name)) ?? `akkaunt${accounts.length + 1}`;
}

export const accountLabel = (name) => (name === MAIN_ACCOUNT ? "asosiy" : name);
export const accountWho = (a) => [a.firstName, a.username ? `@${a.username}` : null].filter(Boolean).join(" ");

// Holat belgisi. relogin — Mini App'dan qayta kirish mumkinmi (asosiy akkaunt — faqat serverda terminaldan)
export function accountStatus(account) {
  const extra = account.name !== MAIN_ACCOUNT;
  switch (account.status) {
    case "ok":
      return { icon: "✅", label: "ishlayapti", problem: false, relogin: false };
    case "error":
      return { icon: "⚠️", label: "ulanib bo'lmadi", problem: true, relogin: false, hint: "Collector o'zi qayta urinadi (1 … 30 daqiqada)." };
    case "logged_out":
      return { icon: "✖", label: "sessiya yo'q", problem: true, relogin: extra, hint: extra ? null : "Asosiy akkauntga serverda terminaldan kiriladi: npm run tg:login" };
    case "duplicate":
      return { icon: "⚠️", label: "takror", problem: true, relogin: false, hint: "Bu boshqa nom bilan ulangan akkauntning o'zi — ishlatilmaydi." };
    default:
      return { icon: "…", label: "noma'lum", problem: false, relogin: false };
  }
}

// Collector xato matnidagi terminal maslahati («Qayta kiring: npm run tg:login …») — Mini App'da o'rniga
// «🔑 Qayta kirish» tugmasi bor, shuning uchun qo'shimcha akkauntda olib tashlanadi
export function accountError(account) {
  const text = String(account.error ?? "");
  if (account.name === MAIN_ACCOUNT) return text;
  return text
    .replace(/\s*\(npm run tg:log(in|out)[^)]*\)/g, "")
    .replace(/[.;]?\s*(Qayta kiring|egasi qayta kirmaguncha ulanmaydi)[^]*$/, "")
    .replace(/\s*—\s*$/, "")
    .trim();
}

const VIA = {
  app: "Telegram ilovasiga — «Telegram» nomli rasmiy chatga (ko'k belgili)",
  sms: "SMS orqali",
  call: "qo'ng'iroq orqali",
  email: "akkauntga bog'langan pochtaga",
  fragment: "Fragment orqali",
};

// "Kod +998 90 ••• •• 67 akkauntining Telegram ilovasiga — … yuborildi."
export function codeWhere(login) {
  if (login.via === "setup_email") return `Telegram bu akkaunt uchun avval pochta bog'lashni so'rayapti — buni Telegram ilovasida qiling, keyin qaytadan boshlang.`;
  const where = VIA[login.via] ?? "Telegram ilovasiga";
  return `Telegram kodni ${login.phone} akkauntiga yubordi: ${where}.`;
}

// «🔎 Auto scan» natijasi — FAQAT topilgan yuk guruhlari sanaladi (2026-11-19, Azimjon: «"3 tasi yuk guruhi emas" bu nimasi?
// bizga yuk guruhlari kerak — faqat yuk guruhlarini sana!»). Yuk guruhi = tekshiruvdan o'tib kuzatuvga olingan (sinovda yoki
// o'tgan). Navbatdagilar soni o'rniga — taxminan qancha vaqt qolgani (har guruh ~30 s)
export const scanFound = (scan) => (scan?.trial ?? 0) + (scan?.ok ?? 0);
export const scanMinutesLeft = (scan) => Math.max(1, Math.ceil(((scan?.pending ?? 0) * 30) / 60));

// Sozlamalardagi o'z akkaunti uchun → { running, lines } | null
export function myScanView(scan) {
  if (!scan) return null;
  const found = scanFound(scan);
  if (scan.running) {
    return {
      running: true,
      lines: [
        `🔎 Guruhlaringiz tekshirilyapti — taxminan ${scanMinutesLeft(scan)} daqiqa qoldi.`,
        found ? `📥 Hozircha ${found} ta yuk guruhi topildi — ulardagi e'lonlar sizga keladi.` : "Hozircha yuk guruhi topilmadi.",
      ],
    };
  }
  if (!scan.checked) return { running: false, lines: [] };
  return {
    running: false,
    lines: [found ? `✅ Tekshiruv tugadi: ${found} ta yuk guruhi topildi — ulardagi e'lonlar sizga keladi.` : "✅ Tekshiruv tugadi: yuk guruhi topilmadi."],
  };
}

// Bir qator (admin ro'yxati) yoki null
export function scanText(scan) {
  if (!scan || (!scan.checked && !scan.pending)) return null;
  const found = `${scanFound(scan)} ta yuk guruhi topildi`;
  return scan.running ? `🔎 Tekshirilyapti (~${scanMinutesLeft(scan)} daq qoldi) · ${found}` : `🔎 ${found}`;
}
