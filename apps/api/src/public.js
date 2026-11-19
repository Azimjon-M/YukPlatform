// Haydovchilar uchun ochiq server: web sayt va Telegram Mini App shu yerdan ochiladi va ma'lumot oladi.
// Boshqaruv markazidan (app.js) ALOHIDA: boshqa port (PUBLIC_PORT, standart 3001), faqat haydovchiga kerakli narsalar,
// har bir so'rov Telegram orqali kirgan haydovchi nomidan. Internetga tunnel orqali chiqariladi (README),
// boshqaruv markazi esa hech qachon chiqarilmaydi.
//
//   GET  /pub/config           bot username (saytdagi «Telegram bilan kirish» uchun), yo'nalish doirasi
//   POST /pub/auth             { initData } (Mini App) yoki { widget } (sayt) → { token, me }
//   GET  /pub/call?c=<token>   «📞 Telefon qilish» tugmasi (bot yuk xabari yoki tezkor e'lon ostida): HTML sahifa → tel:+998… (kirishsiz)
//   GET  /pub/me               foydalanuvchi: ism, rol, obuna, admin, profil, faolmi, o'z raqami (ulashgan bo'lsa)
//   PUT  /pub/me/role          { role } — haydovchi | yuk_beruvchi (har rolning sozlamalari saqlanadi, qaytganda tiklanadi)
//   PUT  /pub/me/profile       { profile, role? } — sozlamalarni saqlash (bot ham shu qoidalar bilan tekshiradi);
//                              profile.feed — yetkazish rejimi (kelmasa — eskisi qoladi), guruhlar faqat ro'yxatdagilar
//   GET  /pub/me/feed-sources  «📌 Mening guruhlarim» uchun tanlasa bo'ladigan guruh/kanallar (eng faoli birinchi)
//   PATCH /pub/me              { active } — pauza / davom
//   POST /pub/me/logout        hisobdan chiqish: rol va sozlamalar yashiriladi, bot yubormaydi (qayta kirsa — tiklanadi)
//   DELETE /pub/me             hisobni o'chirish (botdagi /ochirish → «Hammasini o'chirish» bilan bir xil)
//   DELETE /pub/me/phone       faqat o'z raqamini o'chirish (botdagi «📱 Faqat raqamni o'chirish» bilan bir xil); qayta
//                              ulashish — Mini App'dagi «📱 Raqam ulashish» (kontakt botga boradi)
//   GET  /pub/me/route         ?from&hours — haydovchining yo'nalish tanlovi: joylar va har biridagi mos yuklar soni
//                              (from yo'q — «Qayerdan?» qadami, bor — «Qayerga?», "*" = hamma joydan)
//   PUT  /pub/me/route         { from, to, notify? } — yo'nalishni saqlash ("*" = istalgan); botdagi «📋 Mos yuklar» bilan bir xil;
//                              notify: true (botdagi «🗺 Xaritadan tanlash») — bot chatda javob beradi va mos yuklarni yuboradi
//   GET  /pub/loads            ?view=mine|all&from&to&hours&limit&offset — yuklar (haydovchiga), eng yangisi birinchi
//   GET  /pub/trucks           xuddi shunday — bo'sh mashinalar (yuk beruvchiga)
//   --- «📦 Yuk berish» (faqat yuk beruvchi; bot shipperLoads.js bilan bir qoida) ---
//   GET  /pub/me/load-form     forma uchun: botda tushunilgan qoralama (d=1 — «✏️ Formada tuzatish»), oxirgi raqamlari,
//                              24 soatda nechta yubordi va chegara
//   POST /pub/loads            { load, fromDraft? } — yukni yuborish: tekshiriladi (sanitizeShipperLoad), navbatga tushadi,
//                              bot uni darhol mos haydovchilarga yuboradi va natijani chatga yozadi
//   --- faqat adminlar (Mini App'dagi «🛠 Boshqaruv»), boshqalarga 403 ---
//   GET  /pub/admin/overview   ko'rsatkichlar (navbat, yuklar, foydalanuvchilar) va AI ulanishlari holati
//   GET  /pub/admin/users      ?q&role — foydalanuvchilar ro'yxati
//   PATCH /pub/admin/users/:id { role } — rolni almashtirish (faol / pauza — faqat foydalanuvchining o'zi)
//   GET  /pub/admin/tg-accounts            collector'ning Telegram akkauntlari + davom etayotgan kirish (tgLogin.js)
//   POST /pub/admin/tg-accounts/login      { name, phone } — yangi akkaunt: Telegram kod yuboradi;
//                                          { name, qr: true } — kodsiz: QR / tg://login havolasi (login.qrUrl)
//   POST /pub/admin/tg-accounts/login/:id/code      { code }
//   POST /pub/admin/tg-accounts/login/:id/resend    «Kod kelmadi» — SMS / qo'ng'iroq bilan qayta
//   POST /pub/admin/tg-accounts/login/:id/password  { password } — 2FA bo'lsa
//   DELETE /pub/admin/tg-accounts/login/:id         bekor qilish / yopish
//   GET/POST/DELETE /pub/me/tg-accounts…   xuddi shular, lekin istalgan foydalanuvchi — faqat o'z akkauntlari (Sozlamalar)
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { extractPhones, pacificDay } from "@yuk/parser";
import {
  BLOCKED_TEXT,
  FEED_MODES,
  FEED_SOURCES_MAX,
  KIND_MATCHERS,
  KIND_ROLE,
  SHIPPER_LOAD_LIMIT,
  applyRoute,
  distanceKm,
  formatContactPhone,
  isAdmin,
  isPro,
  parseAdminIds,
  phoneText,
  placePoint,
  placeText,
  planFilter,
  roleOf,
  routeCounts,
  routeInScope,
  sameArea,
  sanitizeProfileFor,
  sanitizeShipperLoad,
  shipperLoadForm,
  shipperLoadText,
  sortedReady,
  telegramUsername,
  truckPlaceText,
  validRole,
  validRouteArea,
  withPrevFeed,
  withRoute,
} from "@yuk/shared";
import { MAIN_TG_ACCOUNT } from "@yuk/store";
import { verifyLoginWidget, verifyWebAppData } from "./telegramAuth.js";

const HOUR = 60 * 60 * 1000;
export const MAX_HOURS = 72;
const MAX_LIMIT = 500;

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Oddiy cheklov: bitta manzildan oynada (standart 1 daqiqa) ko'pi bilan `limit` ta so'rov
export function createRateLimiter({ limit, windowMs = 60_000, now = () => Date.now() }) {
  const hits = new Map();
  return (key) => {
    const time = now();
    const entry = hits.get(key);
    if (!entry || time - entry.start >= windowMs) {
      if (hits.size > 10_000) for (const [k, e] of hits) if (time - e.start >= windowMs) hits.delete(k);
      hits.set(key, { start: time, count: 1 });
      return true;
    }
    entry.count++;
    return entry.count <= limit;
  };
}

// Tunnel orqali kelgan so'rovda haqiqiy manzil sarlavhada (Cloudflare — cf-connecting-ip, ngrok — x-forwarded-for).
// Server faqat 127.0.0.1 da tinglaydi, shuning uchun bu sarlavhalarni faqat tunnel qo'yadi.
const clientIp = (req) =>
  req.get("cf-connecting-ip") || req.get("x-forwarded-for")?.split(",")[0].trim() || req.socket.remoteAddress || "?";

// Sozlamalar to'ldirilmagan bo'lsa nima deymiz (rolga qarab)
const NEED_PROFILE = {
  haydovchi: "Avval sozlamalarda transportingizni kiriting",
  yuk_beruvchi: "Avval sozlamalarda yo'nalishingizni kiriting",
};
const NEED_ROLE = "Avval kim ekaningizni tanlang: haydovchi yoki yuk beruvchi";
// «⚡ Tezkor» / «📌 Mening guruhlarim» — yuklar saralanmaydi (mashina va yo'nalish ishlatilmaydi)
const NO_SORTED = "Bu rejimda yuklar saralanmaydi — e'lonlar botga darhol keladi. «Hammasi» ni oching yoki rejimni «🎯 Saralangan» ga o'zgartiring";

// Joy filtri: area — viloyat kodi (Toshkent shahri = viloyati) yoki davlat nomi
function atArea(load, side, area) {
  if (!area) return true;
  return sameArea(area, load[`${side}Region`]) || load[`${side}Country`] === area;
}

const text = (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : null);

// near=lat,lng — xaritadan tanlangan nuqta. noto'g'ri bo'lsa null (filtr yo'q, oddiy ro'yxat qaytadi)
function parseNear(value) {
  const parts = String(value ?? "").split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Web'dan hisobdan chiqilganda bot chatiga yoziladigan xabar (pastki menyu ham olib tashlanadi — eski tugmalar eskirdi)
export const SIGNED_OUT_TEXT =
  "🚪 Hisobdan chiqdingiz. Endi bot sizga yuk yubormaydi.\n" +
  "Qaytib kirish — /start: rolingizni tanlasangiz, sozlamalaringiz va yo'nalishingiz tiklanadi.";

// Hisob web'dan o'chirilganda bot chatiga yoziladigan xabar (pastki menyu ham olib tashlanadi).
// «Ma'lumotlaringiz o'chirildi» demaymiz — ular boshqaruv markazida qoladi (Azimjon, 2026-11-09: «Hammasi saqlansin»)
export const DELETED_TEXT = "✅ Hisobingiz o'chirildi. Endi sizga hech narsa yuborilmaydi.\nQaytadan boshlash — /start (boshidan ro'yxatdan o'tasiz)";

const escapeHtml = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Sahifa skripti. Bot tugmasi — Mini App (web_app): sahifa Telegram ichida ochiladi. Darhol tel: ga o'tadi va qo'ng'iroq
// oynasi oldinga chiqishi bilan (sahifa ko'rinmay qoladi / fokusni yo'qotadi) Mini App'ni yopadi — haydovchi qo'ng'iroqdan
// keyin to'g'ri chatga qaytadi. Telegram bilan gaplashish telegram-web-app.js siz (tashqi fayl yuklanmasin): Android/iOS'da
// window.TelegramWebviewProxy.postEvent, web.telegram.org da — ota oynaga postMessage (core.telegram.org/api/web-events).
// Eski xabarlardagi oddiy havola tugmasidan (brauzerda) ochilsa — faqat tel: ga o'tadi, yopish yo'q.
//
// iPhone (2026-11-09, Azimjon sinadi: Mini App ochildi, yashil tugma ishlamadi): Telegram-iOS Mini App ichida tel: ga
// o'tishni umuman qayta ishlamaydi (WebAppController: navigatsiya shunchaki .allow, WKWebView esa tel: ni ochmaydi).
// Shuning uchun iPhone'da yashil tugma Telegram'ga «havolani och» (web_app_open_link) deydi — bosilgandan keyin 10 s
// ichida qabul qilinadi (Telegram sahifadagi har teginishni eslaydi), avtomatik emas:
//   1) tel: — Telegram ruxsat bergan protokollar ro'yxatida bo'lsa, iPhone «Qo'ng'iroq qilinsinmi?» deb so'raydi;
//   2) ruxsat bo'lmasa, shu sahifa Safari'da ochiladi — u yerda tel: ishlaydi. Telegram ruxsatsiz protokolni teginishni
//      «ishlatmasdan» rad etadi, qabul qilganini esa «ishlatilgan» deb belgilaydi — shuning uchun ikkalasini ketma-ket
//      yuborish xavfsiz: faqat bittasi ochiladi.
const CALL_SCRIPT = `(function () {
  var tel = __TEL__;
  var proxy = window.TelegramWebviewProxy;
  var inTelegram = Boolean(proxy) || location.hash.indexOf("tgWebApp") >= 0;
  var platform = (location.hash.match(/tgWebAppPlatform=([a-z]+)/) || [])[1] || "";
  function post(type, data) {
    var body = JSON.stringify(data || {});
    try {
      if (proxy) proxy.postEvent(type, body);
      else if (window.parent !== window) window.parent.postMessage(JSON.stringify({ eventType: type, eventData: data || {} }), "*");
    } catch (e) {}
  }
  if (inTelegram && platform === "ios") {
    // Maslahat (Azimjon, 2026-11-09: «Ha, qo'sh»): xabardagi ko'k raqam Telegram'ning o'z menyusini ochadi — brauzersiz, tezroq
    document.getElementById("hint").textContent = "iPhone'da yashil tugma qo'ng'iroqni Safari orqali ochadi.";
    document.getElementById("ios").hidden = false;
    document.getElementById("call").addEventListener("click", function (event) {
      event.preventDefault();
      post("web_app_open_link", { url: tel });
      post("web_app_open_link", { url: location.href.split("#")[0] });
    });
  }
  var closed = false;
  function close() {
    if (closed || !inTelegram) return;
    closed = true;
    post("web_app_close");
  }
  post("web_app_ready");
  if (inTelegram) {
    document.addEventListener("visibilitychange", function () { if (document.hidden) close(); });
    window.addEventListener("pagehide", close);
    window.addEventListener("blur", close);
    var back = document.getElementById("back");
    back.hidden = false;
    back.addEventListener("click", function (event) { event.preventDefault(); closed = false; close(); });
  }
  location.href = tel;
})();`;

// «📞 Telefon qilish» sahifasi. Telegram tugmasi tel: ni ocholmaydi, shuning uchun tugma shu sahifani ochadi, sahifa esa
// darhol tel:+998… ga o'tadi — telefonning qo'ng'iroq oynasi raqam yozilgan holda ochiladi, haydovchi yashil tugmani bosadi.
// O'zi o'tmasa (ba'zi brauzerlar ruxsat so'raydi yoki to'sadi) — sahifadagi katta yashil tugma. call null — havola yaroqsiz.
// Tashqi fayl yo'q (CSS va JS shu yerda) — sahifa tez ochiladi
export function callPage(call) {
  const head = (title) =>
    `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>` +
    "body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f2f4f7;color:#17212b;" +
    "min-height:100vh;display:flex;align-items:center;justify-content:center}" +
    "main{width:100%;max-width:420px;padding:24px 16px;box-sizing:border-box;text-align:center}" +
    ".route{margin:0 0 8px;font-size:16px;color:#5b6773}.phone{margin:0 0 28px;font-size:30px;font-weight:700;letter-spacing:.5px}" +
    "a.call{display:block;padding:18px;border-radius:16px;background:#1fa855;color:#fff;font-size:21px;font-weight:600;text-decoration:none}" +
    "a.call:active{background:#178a45}.hint{margin:20px 0 0;font-size:14px;line-height:1.45;color:#5b6773}" +
    "a.back{display:inline-block;margin-top:18px;padding:10px 18px;color:#2481cc;font-size:16px;text-decoration:none}[hidden]{display:none!important}" +
    ".tip{margin:16px 0 0;padding:12px 14px;border-radius:12px;background:#e6f0fa;font-size:15px;line-height:1.45;text-align:left}" +
    "@media (prefers-color-scheme:dark){body{background:#17212b;color:#eef2f5}.route,.hint{color:#8e9aa6}.tip{background:#22303f}}" +
    "</style></head><body><main>";
  if (!call) {
    return (
      head("Havola yaroqsiz") +
      "<p class=\"phone\" style=\"font-size:22px\">Havola yaroqsiz</p>" +
      "<p class=\"hint\">Telefon raqami yuk xabarining o'zida yozilgan — Telegram'ga qayting va raqamni bosing.</p></main></body></html>"
    );
  }
  const tel = `tel:${call.phone.replace(/[^\d+]/g, "")}`; // faqat raqamlar va + (HTML va JS ichiga xavfsiz)
  const shown = formatContactPhone(call.phone);
  return (
    head(`Qo'ng'iroq: ${shown}`) +
    (call.route ? `<p class="route">${escapeHtml(call.route)}</p>` : "") +
    `<p class="phone">${escapeHtml(shown)}</p>` +
    `<a class="call" id="call" href="${tel}">📞 Qo'ng'iroq qilish</a>` +
    "<p class=\"hint\" id=\"hint\">Qo'ng'iroq oynasi o'zi ochilmasa — yashil tugmani bosing.</p>" +
    // Faqat iPhone'dagi Telegram'da ko'rinadi (skript ochadi)
    "<p class=\"tip\" id=\"ios\" hidden>💡 <b>iPhone'da tezroq:</b> Telegram'ga qayting, yuk xabaridagi ko'k raqamni bosing va " +
    "«Aloqa operatori orqali chaqiruv» ni tanlang — brauzer ochilmaydi.</p>" +
    `<a class="back" id="back" href="#" hidden>← Telegram'ga qaytish</a>` +
    `</main><script>${CALL_SCRIPT.replace("__TEL__", JSON.stringify(tel))}</script></body></html>`
  );
}

// scope — yo'nalish doirasi (.env dagi ROUTE_SCOPE): undan tashqaridagi eski yuklar ko'rsatilmaydi.
// notify(chatId, text, extra) — bot nomidan xabar (botMessage.js); null — yuborilmaydi (testlarda soxtasi beriladi)
// calls — «📞 Telefon qilish» havolalari (@yuk/store createCallLinks, bot bilan bir kalit); null — /pub/call 404
// errors — boshqaruv markazining xatolar jurnali (errorLog.js); server xatolari u yerda ham ko'rinadi
// tgLogin — collector uchun Telegram akkaunt qo'shish (tgLogin.js); null — «server qayta ishga tushirilgach»
export function createPublicApp({ store, env = process.env, sessions, calls = null, scope, webDist = null, notify = null, errors = null, tgLogin = null, now = () => Date.now() }) {
  const app = express();
  app.disable("x-powered-by");
  const botToken = env.BOT_TOKEN?.trim() || null;
  const limitAll = createRateLimiter({ limit: 240, now });
  const limitAuth = createRateLimiter({ limit: 20, now });
  const adminIds = parseAdminIds(env.ADMIN_IDS);

  // Web'ga ketadigan foydalanuvchi ma'lumoti. role — rollardan oldingi yozuvda ham (profil bor → haydovchi).
  // phone — o'zining raqami (Sozlamalarda «📱 Raqamingiz»). withPhone: false — admin boshqa odamni o'zgartirganda:
  // birovning raqami tunnel orqali chiqmaydi (raqamlar faqat boshqaruv markazida, localhost)
  const meOf = (driver, { withPhone = true } = {}) => ({
    chatId: driver.chatId,
    name: driver.name,
    username: driver.username,
    role: roleOf(driver),
    plan: isPro(driver) ? "pro" : (driver.plan ?? "free"), // avtomatik Pro ham (raqam + bog'langan akkaunt)
    isAdmin: isAdmin(driver, adminIds),
    profile: driver.profile,
    active: driver.active,
    // phoneAt — qachon ulashgan: «Raqamni almashtirish» da o'sha raqamni qayta ulashsa ham ilova saqlanganini ko'radi
    // loadPhones — yuk beruvchining oxirgi yukidagi raqamlar («📦 Yuk berish» formasi shular bilan ochiladi)
    ...(withPhone ? { phone: driver.phone ?? null, phoneAt: driver.phoneAt ?? null, loadPhones: driver.loadPhones ?? [] } : {}),
  });

  const pub = express.Router();
  pub.use((req, res, next) => {
    // CORS: kirish Bearer token bilan (cookie yo'q), shuning uchun boshqa saytdan so'rovga ruxsat berish xavfsiz —
    // tokenni bilmagan sayt hech narsa ololmaydi. Mini App Cloudflare Pages'da, API esa tunnelda bo'lishi mumkin.
    res.set({
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, ngrok-skip-browser-warning",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-max-age": "600",
      "cache-control": "no-store",
    });
    if (req.method === "OPTIONS") return res.status(204).end();
    if (!limitAll(clientIp(req))) return next(httpError(429, "Juda ko'p so'rov — bir daqiqadan keyin qayta urinib ko'ring"));
    next();
  });
  pub.use(express.json({ limit: "20kb" }));

  pub.get("/health", (req, res) => res.json({ ok: true }));

  // Bot o'z username'ini bazaga yozadi (bot.js init) — sayt «Telegram bilan kirish» tugmasini shu bilan chizadi
  pub.get("/config", (req, res) => {
    res.json({ botUsername: store.getSetting("bot_username") ?? env.BOT_USERNAME ?? null, scope, login: Boolean(botToken) });
  });

  pub.post("/auth", (req, res) => {
    if (!limitAuth(clientIp(req))) throw httpError(429, "Juda ko'p urinish — bir daqiqadan keyin qayta urinib ko'ring");
    if (!botToken) throw httpError(503, "Server sozlanmagan: .env da BOT_TOKEN yo'q");
    const body = req.body ?? {};
    const options = { now: now() };
    const result = body.initData
      ? verifyWebAppData(body.initData, botToken, options)
      : body.widget
        ? verifyLoginWidget(body.widget, botToken, options)
        : { error: "Telegram ma'lumoti kelmadi" };
    if (result.error) throw httpError(401, result.error, "auth");
    const { id, name, username } = result.user;
    // Boshqaruv markazidan bloklangan (id, username yoki raqam) — kiritmaymiz, ilova «Uzr...» ekranini ko'rsatadi
    if (!adminIds.includes(id) && store.banOf({ chatId: id, username, phone: store.getDriver(id)?.phone })) {
      throw httpError(403, BLOCKED_TEXT, "blocked");
    }
    store.comeBack(id, "web"); // hisobini o'chirgan bo'lsa — qaytdi (boshidan boshlaydi, tarixga yoziladi)
    const driver = store.saveDriver(id, { name, username });
    res.json({ token: sessions.issue(id), me: meOf(driver) });
  });

  // «📞 Telefon qilish» (bot.js loadButtons). Kirish kerak emas: havola faqat shu odamning chatida, imzosiz token yaroqsiz.
  // Raqam manzilda yo'q — token «qaysi yuk, nechanchi raqam, kimga» ni aytadi, raqamni bazadagi yukdan olamiz.
  // Bosilgani yoziladi: deliveries.called_at (boshqaruv markazida «📞 raqamni ochgan») va oxirgi faollik — 48 soatlik
  // avto-pauza faqat qo'ng'iroq qiladigan haydovchini ham «faol» deb biladi (oldin raqam bosilgani botga ko'rinmasdi)
  pub.get("/call", (req, res) => {
    const link = calls?.read(typeof req.query.c === "string" ? req.query.c : "");
    res.set({
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "referrer-policy": "no-referrer",
    });
    // Tezkor e'lon (2026-11-14): yuk hali tushunilmagan — raqam e'lon matnidan, bot qanday olgan bo'lsa shunday
    // (@yuk/parser extractPhones, tartib bir xil). Yo'nalish yozilmaydi: uni AI hali aytmagan
    if (link?.postId != null) {
      const post = store.getPost?.(link.postId);
      const phone = post ? extractPhones(post.text)[link.phone] : null;
      if (!phone) return res.status(404).type("html").send(callPage(null));
      store.markPostCalled?.({ postId: link.postId, chatId: link.chatId });
      store.touchDriver(link.chatId, "call");
      return res.type("html").send(callPage({ phone: phoneText(phone), route: null }));
    }
    const row = link ? store.getLoad(link.loadId) : null;
    const phone = row?.load.phones?.[link.phone];
    if (!phone) return res.status(404).type("html").send(callPage(null));
    store.markCalled({ loadId: link.loadId, chatId: link.chatId });
    store.touchDriver(link.chatId, "call");
    const place = row.kind === "mashina" ? truckPlaceText : placeText;
    const route = `${row.kind === "mashina" ? "🚚" : "🚛"} ${place(row.load, "from")} → ${place(row.load, "to")}`;
    res.type("html").send(callPage({ phone: phoneText(phone), route }));
  });

  // Bundan keyingi hamma yo'l — faqat kirgan haydovchi uchun: "Authorization: Bearer <token>"
  pub.use((req, res, next) => {
    const uid = sessions.verify((req.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    const driver = uid ? store.getDriver(uid) : null;
    // Hisobini o'chirgan — eski tokenlari ishlamaydi (qator qoladi, lekin u qayta kirmaguncha — yo'q hisob)
    if (!driver || driver.deletedAt != null) return next(httpError(401, "Kirish kerak", "auth"));
    // Kirgandan keyin bloklangan — eski token ham ishlamaydi
    if (!adminIds.includes(driver.chatId) && store.banOf(driver)) return next(httpError(403, BLOCKED_TEXT, "blocked"));
    req.driver = driver;
    store.touchDriver(uid, "web"); // oxirgi faollik — boshqaruv markazida «🟢 Hozir web'da»
    next();
  });

  pub.get("/me", (req, res) => res.json(meOf(req.driver)));

  // Rol: botdagi /rol bilan bir xil. Har rolning sozlamalari alohida saqlanadi (store.switchRole): bu rolda avval
  // to'ldirgan bo'lsa — tiklanadi (javobda profile bor), bo'lmasa profile = null (haydovchi profili yuk beruvchiga to'g'ri kelmaydi)
  pub.put("/me/role", (req, res) => {
    const role = validRole(req.body?.role);
    if (!role) throw httpError(400, "role: haydovchi yoki yuk_beruvchi bo'lishi kerak");
    if (roleOf(req.driver) === role) return res.json(meOf(req.driver));
    res.json(meOf(store.switchRole(req.driver.chatId, role)));
  });

  // Botdagi «Saqlash» bilan bir xil: profil rolga qarab tekshiriladi, saqlanadi va yuborish yoqiladi.
  // role kelmasa — bazadagi rol; boshqa rol kelsa — avval eski rolning sozlamalari saqlab qo'yiladi
  pub.put("/me/profile", (req, res) => {
    const role = validRole(req.body?.role) ?? roleOf(req.driver);
    if (!role) throw httpError(409, NEED_ROLE, "no_role");
    // Rejimni yubormagan (eski) forma — rejim eskisicha qoladi (withPrevFeed). Rol almashsa — o'sha rolning eski profili
    const prev = roleOf(req.driver) === role ? req.driver.profile : null;
    const input = role === "haydovchi" ? withPrevFeed(req.body?.profile, prev) : req.body?.profile;
    const result = sanitizeProfileFor(role, input, { scope });
    if (result.error) return res.status(400).json({ error: result.error, field: result.field ?? null });
    // «📌 Mening guruhlarim»: faqat shu odamga ko'rinadigan guruhlar (yozilishi — ro'yxatdagidek); hech biri qolmasa — xato
    if (result.profile?.feed && FEED_MODES[result.profile.feed.mode].groups) {
      const sources = store.allowedFeedSources(req.driver.chatId, result.profile.feed.sources, { pro: isPro(req.driver) });
      if (!sources.length) return res.status(400).json({ error: "Tanlangan guruhlar ro'yxatda topilmadi — qaytadan tanlang", field: "groups" });
      result.profile = { ...result.profile, feed: { ...result.profile.feed, sources } };
    }
    if (roleOf(req.driver) !== role) store.switchRole(req.driver.chatId, role);
    // Haydovchi formasida yo'nalish yo'q (u botdagi «📋 Mos yuklar» da tanlanadi) — eskisi qoladi
    const before = store.getDriver(req.driver.chatId)?.profile;
    const profile = role === "haydovchi" ? withRoute(result.profile, before) : result.profile;
    res.json(meOf(store.saveDriver(req.driver.chatId, { role, profile, draft: null, active: true })));
  });

  // «📌 Mening guruhlarim» ro'yxati (store feed.js feedSources): ochiq va yopiq guruhlar (yopig'ini Pro tanlaydi — boshqalarga
  // locked); perDay — oxirgi 24 soatdagi e'lonlar, mine — o'zi «➕ Guruh qo'shish» bilan qo'shgan. chosen — hozirgi tanlovi,
  // pro — shu odam yopiq guruhlarni tanlay oladimi
  pub.get("/me/feed-sources", (req, res) => {
    const feed = req.driver.profile?.feed;
    const pro = isPro(req.driver);
    res.json({ sources: store.feedSources(req.driver.chatId, { pro }), chosen: feed?.sources ?? [], max: FEED_SOURCES_MAX, pro });
  });

  pub.patch("/me", (req, res) => {
    const active = req.body?.active;
    if (typeof active !== "boolean") throw httpError(400, "active: true yoki false bo'lishi kerak");
    const role = roleOf(req.driver);
    if (active && !role) throw httpError(409, NEED_ROLE, "no_role");
    // Yuk beruvchiga sozlamalar shart emas (Azimjon, 2026-11-12: «Ro'yxatdan o'tish kerak emas») — bo'sh profil
    // bilan ham yuborish yoqiladi; haydovchiga mos yuklar profil bo'lmasa hisoblanmaydi
    if (active && !req.driver.profile && role === "haydovchi") throw httpError(409, NEED_PROFILE[role], "no_profile");
    res.json(meOf(store.saveDriver(req.driver.chatId, { active })));
  });

  // Hisobdan chiqish. Faqat tokenni o'chirish yetmaydi: Telegram'da bot odamni baribir taniydi va Mini App o'zi kiradi
  // (2026-11-07 da shunday bo'lgan — «chiqmadi»). Shuning uchun serverda: store.signOut — rol va sozlamalar yashiriladi,
  // yuborish to'xtaydi, bot uni yangi foydalanuvchidek ko'radi. Qayta kirib rolni tanlasa — sozlamalari tiklanadi.
  pub.post("/me/logout", (req, res) => {
    const { chatId } = req.driver;
    const user = store.signOut(chatId);
    void notify?.(chatId, SIGNED_OUT_TEXT, { reply_markup: { remove_keyboard: true } }); // xatoni o'zi yutadi
    res.json(meOf(user));
  });

  // Sozlamalardagi «🗑 Raqamni o'chirish» (Azimjon, 2026-11-10). Botdagi /ochirish → «Faqat raqamni o'chirish» bilan
  // bir xil: raqam o'chadi, phoneAskedAt qoladi (bot o'zi boshqa so'ramaydi), tarixda «raqamini o'chirdi».
  // Chatdagi pastki menyuni bot yangilaydi (server bot kabi to'liq menyu yasay olmaydi) — topshiriq "phone_deleted"
  pub.delete("/me/phone", (req, res) => {
    const { chatId } = req.driver;
    if (!req.driver.phone) return res.json(meOf(req.driver));
    const user = store.saveDriver(chatId, { phone: null });
    store.addBotNotice?.(chatId, "phone_deleted");
    res.json(meOf(user));
  });

  // Hisobni o'chirish (store.deleteDriver): foydalanuvchi uchun hisob yopiladi — rol, sozlamalar, raqam tozalanadi,
  // yuborish to'xtaydi, tokenlar ishlamaydi (deletedAt → 401). Ma'lumot boshqaruv markazida «🗑 Hisobini o'chirgan» bilan qoladi.
  // Keyin botga yozsa yoki ilovaga qayta kirsa — qaytdi (comeBack), rol tanlashdan boshlaydi.
  pub.delete("/me", (req, res) => {
    const { chatId } = req.driver;
    store.deleteDriver(chatId, { via: "web" });
    // Javobni kutmaymiz: chatdagi pastki menyu eskirdi — bot nomidan «o'chirildi» deb yozib, menyuni olib tashlaymiz
    void notify?.(chatId, DELETED_TEXT, { reply_markup: { remove_keyboard: true } }); // xatoni o'zi yutadi
    res.json({ deleted: true });
  });

  // Yo'nalish — faqat sozlamalarini to'ldirgan haydovchiga (yuk beruvchining yo'nalishi sozlamalarida)
  const driverProfile = (driver) => {
    const role = roleOf(driver);
    if (!role) throw httpError(409, NEED_ROLE, "no_role");
    if (role !== "haydovchi") throw httpError(409, "Yo'nalish tanlash — haydovchilar uchun", "role");
    if (!driver.profile) throw httpError(409, NEED_PROFILE.haydovchi, "no_profile");
    // «⚡ Tezkor» / «📌 Mening guruhlarim» (yoki «+ saralangan», lekin mashinasi yo'q) — yo'nalish ishlatilmaydi
    if (!sortedReady(driver.profile)) throw httpError(409, NO_SORTED, "feed");
    return driver.profile;
  };

  // Tugmalardagi son — tanlangan muddatda (6/24/72 soat) mashinasiga sig'adigan yuklar, doiradan tashqaridagilarsiz
  pub.get("/me/route", (req, res) => {
    const profile = driverProfile(req.driver);
    const hours = clamp(Number(req.query.hours) || 24, 1, MAX_HOURS);
    const from = text(req.query.from);
    if (from && !validRouteArea(profile, scope, from)) throw httpError(400, "Bunday joy tanlab bo'lmaydi");
    const allowed = planFilter(req.driver, store.sourceOwner);
    const rows = store
      .recentLoads({ sinceMs: hours * HOUR, limit: 5000, kind: "yuk" })
      .filter(({ load, post }) => allowed(post.source) && routeInScope(load, scope));
    res.json({ hours, from, ...routeCounts({ profile, scope, rows, from }) });
  });

  // notify: true — yo'nalish botdagi «🗺 Xaritadan tanlash» orqali tanlandi (web xaritasi Telegram ichida):
  // bot chatdagi «Qayerdan?» xabarini «✅ Yo'nalish: …» ga almashtirib, mos yuklarni yuborsin. Bu server botning
  // o'zi emas (u alohida jarayon) — shuning uchun bazaga topshiriq yoziladi, bot 2 soniyada oladi (store bot_notices)
  pub.put("/me/route", (req, res) => {
    const profile = driverProfile(req.driver);
    const { from, to, notify } = req.body ?? {};
    if (!validRouteArea(profile, scope, from) || !validRouteArea(profile, scope, to)) throw httpError(400, "Bunday joy tanlab bo'lmaydi");
    const saved = store.saveDriver(req.driver.chatId, { profile: applyRoute(profile, from, to, now()) });
    if (notify === true) store.addBotNotice?.(req.driver.chatId, "route");
    res.json(meOf(saved));
  });

  // kind "yuk" — yuklar (haydovchiga), "mashina" — bo'sh mashinalar (yuk beruvchiga).
  // view=mine — shu foydalanuvchiga mos (bot yuboradiganlari), view=all — hammasi
  const listing = (kind) => (req, res) => {
    const view = req.query.view === "all" ? "all" : "mine";
    const hours = clamp(Number(req.query.hours) || 24, 1, MAX_HOURS);
    const limit = clamp(Number(req.query.limit) || 30, 1, MAX_LIMIT);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const from = text(req.query.from);
    const to = text(req.query.to);
    const { profile } = req.driver;
    const role = roleOf(req.driver);
    // «Menga mos» — yuk beruvchi uchun sozlamalar shart EMAS (Azimjon, 2026-11-12: «yuk beruvchi uchun Ro'yxatdan
    // o'tish kerak emas»). Bo'sh profil = cheklov yo'q (matchTruck), «Mashinalar» endi xaritadagi nuqta bo'yicha
    if (view === "mine" && role !== KIND_ROLE[kind]) {
      if (!role) throw httpError(409, NEED_ROLE, "no_role");
      throw httpError(409, kind === "yuk" ? "«Menga mos» yuklar — haydovchilar uchun" : "«Menga mos» mashinalar — yuk beruvchilar uchun", "role");
    }
    // Haydovchiga mos yuklar profil (transport) bo'lmasa hisoblanmaydi; yuk beruvchiga esa sozlamalar shart emas
    if (view === "mine" && kind === "yuk" && role === "haydovchi" && !profile) throw httpError(409, NEED_PROFILE.haydovchi, "no_profile");
    // Saralanmaydigan rejim (mashina yo'q) — «Menga mos» hisoblanmaydi, ilova «Hammasi» ni ko'rsatadi
    if (view === "mine" && kind === "yuk" && role === "haydovchi" && !sortedReady(profile)) throw httpError(409, NO_SORTED, "feed");
    // near=lat,lng — shu nuqtaga yaqin e'lonlar (km, default 50, <5000 km). Yuk beruvchi «🚚 Mashinalar» da
    // xaritadan tanlagan nuqta; masofa @yuk/shared geo.js distanceKm bilan hisoblanadi
    const nearPoint = parseNear(req.query.near);
    const radius = clamp(Number(req.query.r) || 50, 1, 5000);
    const matches = KIND_MATCHERS[kind];

    // Yopiq guruh e'loni — faqat Pro obunadagilarga (va guruhni qo'shganga): «Hammasi» da ham
    const allowed = planFilter(req.driver, store.sourceOwner);
    let rows = store
      .recentLoads({ sinceMs: hours * HOUR, limit: 5000, kind })
      .filter(({ post }) => allowed(post.source))
      .filter(({ load }) => routeInScope(load, scope) && atArea(load, "from", from) && atArea(load, "to", to))
      // profile = null (ro'yxatdan o'tmagan) — matchTruck bo'sh profil bilan ishlaydi (cheklovlar yo'q)
      .filter(({ load }) => view === "all" || matches(load, profile ?? {}).ok);
    if (nearPoint) {
      // Yaqinligi noma'lum (joyi yozilmagan / bilmaymiz) e'lonlar ro'yxatga kirmaydi
      rows = rows
        .map((row) => {
          const point = placePoint(row.load, "from");
          return point ? { ...row, distanceKm: distanceKm(nearPoint, point) } : null;
        })
        .filter((row) => row && row.distanceKm <= radius)
        // Eng yaqini tepada; bir xil masofada — eng yangisi
        .sort((a, b) => a.distanceKm - b.distanceKm || b.post.postedAt - a.post.postedAt || b.id - a.id);
    } else {
      // E'lon guruhda chiqqan vaqt bo'yicha: bot navbatdagi eng yangi e'lonni birinchi oladi,
      // shuning uchun bazadagi tartib (id) e'lon vaqti bilan har doim ham bir xil emas
      rows.sort((a, b) => b.post.postedAt - a.post.postedAt || b.id - a.id);
    }
    res.json({
      view,
      hours,
      ...(nearPoint ? { near: nearPoint, r: radius } : {}),
      total: rows.length,
      // distanceKm — faqat near=... bilan so'ralganda (xaritadagi nuqtadan masofa, kartochkada ko'rsatiladi)
      items: rows.slice(offset, offset + limit).map(({ id, load, post, createdAt, distanceKm: d }) => ({
        id,
        load,
        post,
        createdAt,
        ...(d != null ? { distanceKm: Math.round(d) } : {}),
      })),
    });
  };
  pub.get("/loads", listing("yuk"));
  pub.get("/trucks", listing("mashina"));

  // --- «📦 Yuk berish» ---
  // Yuk beruvchi sozlamalarini to'ldirmagan bo'lsa ham yuk bera oladi (Azimjon, 2026-11-10: «Shart emas» — sozlamalar
  // faqat bo'sh mashina e'lonlari uchun). Rol esa kerak: haydovchi yuk bersa — boshqa narsa
  const shipperOnly = (driver) => {
    const role = roleOf(driver);
    if (!role) throw httpError(409, NEED_ROLE, "no_role");
    if (role !== "yuk_beruvchi") throw httpError(409, "Yuk berish — yuk beruvchilar uchun", "role");
  };

  // Formani ochganda: draft — botga yozgan, tasdiqlanmagan yuk (bot uni «✏️ Formada tuzatish» bilan shu yerga yuboradi);
  // phones — oxirgi yukdagi raqamlar, bo'lmasa o'zi ulashgan raqam; used — 24 soatda nechta yubordi
  pub.get("/me/load-form", (req, res) => {
    shipperOnly(req.driver);
    const { chatId } = req.driver;
    const draft = store.loadDraft(chatId);
    const fresh = draft?.loads?.length && now() - (draft.at ?? 0) < HOUR ? draft : null;
    const phones = req.driver.loadPhones?.length ? req.driver.loadPhones : req.driver.phone ? [req.driver.phone] : [];
    res.json({
      draft: fresh ? shipperLoadForm(fresh.loads[0], scope) : null,
      phones,
      used: store.shipperPostCount(chatId),
      limit: SHIPPER_LOAD_LIMIT,
    });
  });

  // Yukni yuborish. Navbatga yoziladi (posts jadvali, guruh e'loni kabi) — haydovchilarga bot ishchisi yuboradi (u boshqa
  // jarayon: bu server uni chaqira olmaydi, ishchi navbatni har 5 soniyada ko'radi). Natijani bot chatga yozadi
  pub.post("/loads", (req, res) => {
    shipperOnly(req.driver);
    const { chatId } = req.driver;
    if (store.shipperPostCount(chatId) >= SHIPPER_LOAD_LIMIT) {
      throw httpError(429, `24 soatda ${SHIPPER_LOAD_LIMIT} ta yuk yubordingiz — bu chegara. Keyingisini birozdan keyin yuboring`, "limit");
    }
    const { load, error, field } = sanitizeShipperLoad(req.body?.load, { scope });
    if (error) return res.status(400).json({ error, field: field ?? null });
    const { id } = store.addDirectPost({ chatId, text: shipperLoadText(load), loads: [load], via: "web", sender: telegramUsername(req.driver.username) });
    store.setLoadPhones(chatId, load.phones);
    if (req.body?.fromDraft === true) store.setLoadDraft(chatId, null); // botdagi qoralama formada tuzatib yuborildi
    res.status(201).json({ ok: true, id, load });
  });

  // --- Admin ---
  // Admin — .env dagi ADMIN_IDS yoki boshqaruv markazida (localhost) yoqilgan belgi. Bu server internetga chiqadi,
  // shuning uchun har bir so'rovda shu yerda tekshiriladi (web'dagi tugmani yashirish — himoya emas).
  // Bu yerdan boshqa odamni admin qilib ham, obunasini o'zgartirib ham BO'LMAYDI — faqat boshqaruv markazidan.
  const admin = express.Router();
  admin.use((req, res, next) => next(isAdmin(req.driver, adminIds) ? undefined : httpError(403, "Bu bo'lim faqat adminlar uchun", "forbidden")));

  admin.get("/overview", (req, res) => {
    const m = store.metrics({ maxAgeMs: 15_000 }); // og'ir hisob — 15 s kesh (store admin.js metrics)
    const today = pacificDay(now()); // Gemini kunlik limiti Tinch okeani vaqti bilan yangilanadi
    // AI ulanishlari: kalitning o'zi ham, "…a1B2" ko'rsatkichi ham yuborilmaydi
    const ai = store.listAiKeys().flatMap((key) =>
      key.models.map(({ model, state }) => {
        const fresh = state?.day === today;
        return {
          label: key.label ?? key.provider,
          model,
          enabled: key.enabled,
          requests: fresh ? state.requests : 0,
          posts: fresh ? state.posts : 0,
          errors: fresh ? state.errors : 0,
          restingUntil: state?.cooldownUntil > now() ? state.cooldownUntil : null,
          reason: state?.cooldownUntil > now() ? (state.reason ?? null) : null,
          problem: Boolean(state?.problem), // tez-tez xato beryapti — bot uni oxirgi navbatda ishlatadi
        };
      }),
    );
    res.json({
      now: m.now,
      queue: m.queue,
      lastHour: m.lastHour,
      loads: m.loads,
      trucks: m.trucks,
      drivers: m.drivers,
      shippers: m.shippers,
      hourly: m.hourly,
      ai,
    });
  });

  // Ro'yxatda telefon yo'q (foydalanuvchi ulashgan raqam faqat boshqaruv markazida): ism, username, rol, holat
  admin.get("/users", (req, res) => {
    const q = text(req.query.q)?.toLowerCase().replace(/^@/, "") ?? null;
    const role = req.query.role === "none" ? "none" : validRole(req.query.role);
    const items = store
      .listDrivers()
      .filter((u) => !role || (role === "none" ? !u.role : u.role === role))
      .filter((u) => !q || [u.name, u.username, String(u.chatId)].some((v) => v?.toLowerCase().includes(q)))
      .map((u) => ({
        chatId: u.chatId,
        name: u.name,
        username: u.username,
        role: u.role,
        plan: u.plan,
        isAdmin: isAdmin(u, adminIds),
        hasProfile: Boolean(u.profile),
        registering: u.registering,
        active: u.active,
        // Kim pauza qilgan: user (o'zi) | idle (48 soat kirmagan) | blocked (botni bloklagan)
        pausedBy: u.active ? null : u.pausedBy,
        // Hisobdan chiqqan: role null (bot yubormaydi), lekin qaysi roldan chiqqani ko'rsatiladi
        signedOut: !u.role && u.signedOutAt != null,
        signedOutRole: u.role ? null : u.signedOutRole,
        // Hisobini o'chirgan (qator qoladi) va necha marta o'chirgani
        deleted: u.deletedAt != null,
        deletedCount: u.deletedCount ?? 0,
        updatedAt: u.updatedAt,
      }));
    res.json({ total: items.length, items: items.slice(0, 200) });
  });

  admin.patch("/users/:id", (req, res) => {
    const chatId = Number(req.params.id);
    const user = Number.isSafeInteger(chatId) ? store.getDriver(chatId) : null;
    if (!user) throw httpError(404, "Foydalanuvchi topilmadi");
    const body = req.body ?? {};
    // Avval hammasini tekshiramiz, keyin o'zgartiramiz (xato so'rov yarim-yorti saqlanib qolmasin)
    const role = "role" in body ? validRole(body.role) : null;
    if ("role" in body && !role) throw httpError(400, "role: haydovchi yoki yuk_beruvchi bo'lishi kerak");
    // Faol / pauza — faqat foydalanuvchining o'zi (Azimjon, 2026-11-09); 48 soat kirmasa bot o'zi pauza qiladi
    if ("active" in body) throw httpError(400, "Faol / pauzani faqat foydalanuvchining o'zi o'zgartiradi");
    // Bot va web'dagidek: har rolning sozlamalari saqlanadi, yangi rolda avval to'ldirgani bo'lsa — tiklanadi
    if (role && role !== roleOf(user)) return res.json(meOf(store.switchRole(chatId, role), { withPhone: false }));
    res.json(meOf(user, { withPhone: false }));
  });

  // --- Collector'ning Telegram akkauntlari va yangi akkaunt qo'shish (tgLogin.js, 2026-11-13) ---
  // Akkauntlar ro'yxatida raqam yo'q (sessiya — serverda faylda). login — davom etayotgan kirish (bittadan), Mini App
  // yopilib qayta ochilsa shu bilan davom etadi; unavailable — bu serverda kirib bo'lmasa, nega
  admin.get("/tg-accounts", (req, res) => {
    const perAccount = {};
    for (const s of store.listSources()) perAccount[s.account ?? MAIN_TG_ACCOUNT] = (perAccount[s.account ?? MAIN_TG_ACCOUNT] ?? 0) + 1;
    res.json({
      accounts: (store.listTgAccounts?.() ?? []).map((a) => ({
        name: a.name,
        firstName: a.firstName,
        username: a.username,
        status: a.status,
        error: a.status === "ok" ? null : a.error,
        dialogs: a.dialogs ?? 0,
        sources: perAccount[a.name] ?? 0,
        scan: store.dialogScanSummary?.(a.name) ?? null,
        updatedAt: a.updatedAt,
      })),
      login: tgLogin?.current() ?? null,
      unavailable: tgLogin ? tgLogin.unavailable() : "Server qayta ishga tushirilgach ishlaydi",
    });
  });

  const needLogin = () => {
    if (!tgLogin) throw httpError(409, "Server qayta ishga tushirilgach ishlaydi");
    return tgLogin;
  };
  // Nom + raqam → Telegram kod yuboradi. Javob — kirish holati (step: code | failed …)
  admin.post("/tg-accounts/login", async (req, res) => {
    res.status(201).json({ login: await needLogin().start({ name: req.body?.name, phone: req.body?.phone, by: req.driver.chatId, qr: req.body?.qr === true }) });
  });
  // Kod va 2FA parol: tekshiruv natijasi shu javobda (noto'g'ri bo'lsa — login.error, bosqich o'zgarmaydi)
  admin.post("/tg-accounts/login/:id/code", async (req, res) => {
    res.json({ login: await needLogin().code(req.params.id, req.body?.code) });
  });
  admin.post("/tg-accounts/login/:id/resend", async (req, res) => {
    res.json({ login: await needLogin().resend(req.params.id) });
  });
  admin.post("/tg-accounts/login/:id/password", async (req, res) => {
    res.json({ login: await needLogin().password(req.params.id, req.body?.password) });
  });
  admin.delete("/tg-accounts/login/:id", (req, res) => {
    res.json({ ok: needLogin().cancel(req.params.id) });
  });

  // --- Har foydalanuvchining o'z Telegram akkauntlari (Sozlamalar, 2026-11-13, Azimjon: «adminlik bermasdan shunchaki
  // sozlamalar ichiga qo'shib ber» → «Hamma foydalanuvchiga»). Admin yo'lidan farqi: har kim faqat O'ZI qo'shgan
  // akkauntlarni va O'Z kirishini ko'radi/boshqaradi (boshqaning kirish id'si — 404), nomni server beradi
  // (tgLogin userAccountName), soatlik chegaralar alohida — admin limitiga tegmaydi.
  // Ulangan akkaunt collector'ga qo'shiladi; uning yopiq guruhlarini manbaga admin qo'shadi (boshqaruv markazi).
  const mine = (req) => req.driver.chatId;
  pub.get("/me/tg-accounts", (req, res) => {
    const perAccount = {};
    for (const s of store.listSources()) if (s.account) perAccount[s.account] = (perAccount[s.account] ?? 0) + 1;
    res.json({
      accounts: (store.listTgAccounts?.() ?? [])
        .filter((a) => a.addedBy === mine(req))
        .map((a) => ({
          name: a.name,
          firstName: a.firstName,
          username: a.username,
          status: a.status,
          error: a.status === "ok" ? null : a.error,
          dialogs: a.dialogs ?? 0,
          sources: perAccount[a.name] ?? 0,
          // Guruhlarini avtomatik tekshirish natijasi (collector live.js scanNext): checked, pending, trial, ok, rejected …
          scan: store.dialogScanSummary?.(a.name) ?? null,
          updatedAt: a.updatedAt,
        })),
      login: tgLogin?.current(mine(req)) ?? null,
      unavailable: tgLogin ? tgLogin.unavailable() : "Server qayta ishga tushirilgach ishlaydi",
    });
  });
  // { phone, name? } — name faqat o'z akkauntiga qayta kirish uchun («🔑 Qayta kirish»); yangisiga nomni server beradi
  pub.post("/me/tg-accounts/login", async (req, res) => {
    const login = await needLogin().start({ name: req.body?.name || null, phone: req.body?.phone, by: mine(req), mine: true, qr: req.body?.qr === true });
    res.status(201).json({ login });
  });
  pub.post("/me/tg-accounts/login/:id/code", async (req, res) => {
    res.json({ login: await needLogin().code(req.params.id, req.body?.code, mine(req)) });
  });
  pub.post("/me/tg-accounts/login/:id/resend", async (req, res) => {
    res.json({ login: await needLogin().resend(req.params.id, mine(req)) });
  });
  pub.post("/me/tg-accounts/login/:id/password", async (req, res) => {
    res.json({ login: await needLogin().password(req.params.id, req.body?.password, mine(req)) });
  });
  pub.delete("/me/tg-accounts/login/:id", (req, res) => {
    res.json({ ok: needLogin().cancel(req.params.id, mine(req)) });
  });
  // «🔎 Auto scan» o'z akkaunti uchun (2026-11-19, Azimjon: «boshqaruv markazidagi Auto scan bilan bir xil ishlasin»):
  // boshqaruv markazidagi POST /api/tg-accounts/:name/scan bilan bir xil, faqat O'Z qo'shgan akkaunti (boshqaniki — 404)
  pub.post("/me/tg-accounts/:name/scan", (req, res) => {
    const account = (store.listTgAccounts?.() ?? []).find((a) => a.name === req.params.name && a.addedBy === mine(req));
    if (!account) throw httpError(404, "Bunday akkaunt yo'q");
    if (account.status !== "ok") throw httpError(409, "Akkaunt hozir ishlamayapti — u ulangach tekshiriladi");
    if (!account.scanRequestedAt) store.requestAccountScan(account.name);
    res.json({ scan: store.dialogScanSummary(account.name) });
  });
  // «🔗 Havola orqali» (2026-11-19, Azimjon): telefon bitta — QR'ni o'zi skanerlay olmaydi. Shu sahifani kompyuterda ochadigan
  // 1 soatlik kirish tokeni; manzilni ilova o'zi yasaydi (location.origin + ?v=akkaunt&t=…). Telegram'ning tg://login havolasi
  // emas — uni Telegram havoladan qabul qilmaydi (2026-11-14 sinalgan), shuning uchun QR o'sha kompyuterda chiqadi
  pub.post("/me/tg-accounts/desktop-link", (req, res) => {
    const ttl = 60 * 60;
    res.json({ token: sessions.issue(mine(req), { ttl }), ttl });
  });

  pub.use("/admin", admin);

  pub.use((req, res, next) => next(httpError(404, "Topilmadi")));
  app.use("/pub", pub);

  // Web ilovaning o'zi (npm run web:build → apps/web/dist): shu server orqali http://localhost:3001
  const index = webDist ? path.join(webDist, "index.html") : null;
  if (index && existsSync(index)) {
    app.use(
      express.static(webDist, {
        index: false,
        // assets/ dagi fayl nomida xesh bor — uzoq saqlanadi; index.html har safar yangidan
        setHeaders: (res, file) => res.set("cache-control", file.endsWith(".html") ? "no-cache" : "public, max-age=604800, immutable"),
      }),
    );
    app.get(/^\/(?!pub(\/|$)).*/, (req, res) => res.set("cache-control", "no-cache").sendFile(index));
  } else {
    app.get("/", (req, res) => res.status(503).type("text").send("Web hali yig'ilmagan. YukPlatform papkasida: npm start (yoki npm run web:build)"));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    // express.json buzilgan JSON uchun 400 beradi; boshqa kutilmagan xato — 500
    const status = error.status ?? error.statusCode ?? 500;
    if (status >= 500) {
      console.error(error);
      // Boshqaruv markazining «Xatolar» bo'limiga (haydovchiga faqat «Server xatosi» ko'rinadi)
      errors?.add({ source: "web", level: "error", kind: "server", text: `${req.method} ${req.originalUrl.split("?")[0]}: ${error.message}`, details: error.stack });
    }
    // code — web nima qilishini biladi: auth → qayta kirish, no_profile → sozlamalarga, no_role → rol tanlash
    const code = ["auth", "no_profile", "no_role", "role", "forbidden", "blocked", "limit", "feed"].includes(error.code) ? { code: error.code } : {};
    res.status(status).json({ error: status >= 500 ? "Server xatosi" : error.message, ...code });
  });

  return app;
}
