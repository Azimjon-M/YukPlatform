import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeView,
  activityView,
  areasText,
  cargoText,
  deliveriesView,
  driverShown,
  durationMin,
  eventView,
  formatDateTime,
  sourceCheckView,
  dialogSource,
  pickableDialogs,
  tgAccountView,
  formatNumber,
  formatTime,
  loadView,
  pauseInText,
  phoneLinks,
  placeText,
  priceText,
  profileSummary,
  registrationText,
  snapshotProfiles,
  timeAgo,
  uptimeText,
  vehicleText,
  weightText,
} from "../src/format.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const TZ = { timeZone: "Asia/Tashkent" };

// Soxta yuk (haqiqiy e'lon emas)
const LOAD = {
  category: "fura",
  fromCity: "Beshariq",
  fromRegion: "fargona",
  fromCountry: "O'zbekiston",
  toCity: "Samarqand",
  toRegion: "samarqand",
  cargo: "Sement",
  weightT: 22,
  volumeM3: null,
  pallets: 33,
  truckClass: "fura",
  bodyType: "tent",
  vehicleCount: 2,
  loadingSides: ["orqa"],
  partial: false,
  price: 3800000,
  priceUnit: "reys",
  currency: "UZS",
  payment: "naqd",
  negotiable: true,
  when: "ertaga",
  note: null,
  phones: ["998901112233"],
};

test("raqamlar bo'sh joy bilan guruhlanadi, kasr vergul bilan", () => {
  assert.equal(formatNumber(3800000), "3 800 000");
  assert.equal(formatNumber(14.62, 1), "14,6");
  assert.equal(formatNumber(14, 1), "14");
  assert.equal(formatNumber(2.45, 2), "2,45");
  assert.equal(formatNumber(null), "—");
});

test("joy: avval viloyat, keyin shahar; markaz va xorij", () => {
  assert.equal(placeText(LOAD, "from"), "Farg'ona, Beshariq");
  assert.equal(placeText(LOAD, "to"), "Samarqand");
  assert.equal(placeText({ fromCity: "Chirchiq", fromRegion: "toshkent" }, "from"), "Toshkent vil., Chirchiq");
  assert.equal(placeText({ toCity: "Moskva", toRegion: "xorij", toCountry: "Rossiya" }, "to"), "Rossiya, Moskva");
  assert.equal(placeText({ toRegion: "surxondaryo" }, "to"), "Surxondaryo viloyati");
  assert.equal(placeText({}, "to"), "?");
});

test("og'irlik, narx, mashina, yuk matni", () => {
  assert.equal(weightText(0.7), "700 kg");
  assert.equal(weightText(1.5), "1,5 tonna");
  assert.equal(weightText(null), null);
  assert.equal(priceText(LOAD), "3 800 000 so'm · kelishiladi · naqd");
  assert.equal(priceText({ price: 200, priceUnit: "kg" }), "200 so'm / kilosi");
  assert.equal(priceText({ price: 1500, currency: "USD" }), "$1 500");
  assert.equal(priceText({}), "narx yozilmagan");
  assert.equal(vehicleText(LOAD), "2 ta · Fura · tent · orqadan");
  assert.equal(vehicleText({ bodyType: "ref" }), "Refrijerator");
  assert.equal(vehicleText({ bodyType: "bort" }), "Plashatka", "eski kod — yangi nom");
  assert.equal(cargoText(LOAD), "Sement · 22 tonna · 33 palet");
});

test("telefon tel: havolasiga aylanadi, qisqa raqam tashlanadi", () => {
  assert.deepEqual(phoneLinks(["998901112233", "+998 90 111-22-44", "12"]), [
    { text: "+998901112233", href: "tel:+998901112233" },
    { text: "+998901112244", href: "tel:+998901112244" },
  ]);
  assert.deepEqual(phoneLinks(undefined), []);
});

test("loadView kartochka uchun hamma matnni beradi", () => {
  const view = loadView(LOAD);
  assert.equal(view.from, "Farg'ona, Beshariq");
  assert.equal(view.to, "Samarqand");
  assert.equal(view.category, "Fura");
  assert.equal(view.when, "ertaga");
  assert.equal(view.phones.length, 1);
});

test("yuk beruvchi profili: kerakli mashina va kuzov", () => {
  const summary = profileSummary({ fromAreas: ["samarqand"], toAreas: [], domestic: true, international: false, truckClasses: ["fura", "isuzu"], bodyTypes: ["tent", "ploshatka"] });
  assert.equal(summary.vehicle, "Kerak: Fura, Isuzu");
  assert.equal(summary.size, "Kuzov: tent, plashatka");
  assert.equal(summary.from, "Samarqand vil.");
  assert.equal(summary.to, "Hamma joy");
  assert.equal(profileSummary({ fromAreas: [], toAreas: [], truckClasses: [], bodyTypes: [] }).vehicle, "Istalgan mashina");
});

test("haydovchi profili qisqa ko'rinishda", () => {
  const summary = profileSummary({
    vehicle: { truckClass: "fura", bodyType: "ref", capacityKg: 22000, body: { lengthM: 13.6, widthM: 2.45, heightM: 2.7 }, loadingSides: [] },
    fromAreas: ["andijon", "Rossiya"],
    toAreas: [],
    domestic: true,
    international: true,
    mode: "own",
  });
  assert.equal(summary.vehicle, "Fura · refrijerator · 22 tonna");
  assert.equal(summary.size, "13,6 × 2,45 × 2,7 m");
  assert.equal(summary.from, "Andijon vil., Rossiya");
  assert.equal(summary.to, "Hamma joy");
  assert.equal(summary.intl, "O'zbekiston va xalqaro");
  assert.equal(summary.mode, null, "«Qaysi yuklar» savoli olib tashlandi");
  // Yo'nalish tanlanmagan (yangi haydovchi) — ko'rinib tursin
  const fresh = profileSummary({ vehicle: { truckClass: "isuzu" }, fromAreas: [], toAreas: [], routeAt: null });
  assert.deepEqual([fresh.from, fresh.to], ["tanlanmagan — yuk bormaydi", "—"]);
  assert.equal(profileSummary({ vehicle: {}, fromAreas: [], toAreas: [], routeAt: 1 }).from, "Hamma joy");
  assert.equal(profileSummary(null), null);
  assert.equal(areasText(["toshkent_sh"]), "Toshkent shahri");
});

test("haydovchi rejimi (2026-11-14): tezkor — mashina shart emas; guruhlarim — ro'yxat; «+ saralangan» mashinasiz", () => {
  const fast = profileSummary({ vehicle: null, domestic: true, feed: { mode: "tezkor", sources: [] } });
  assert.equal(fast.mode, "🌐 Hamma e'lonlar");
  assert.equal(fast.vehicle, "shart emas");
  assert.equal(fast.from, "hamma guruhlardan");
  assert.match(fast.to, /saralanmaydi/);
  assert.equal(fast.groups, null);
  assert.equal(fast.intl, "uzoq xorij yuklarisiz");
  assert.equal(registrationText({ role: "haydovchi", active: true, profile: { vehicle: null, feed: { mode: "tezkor" } } }), "Ro'yxatdan o'tgan, 🌐 Hamma e'lonlar — e'lonlar asl matn bilan darhol boradi");
  assert.equal(
    registrationText({ role: "haydovchi", active: true, profile: { vehicle: null, feed: { mode: "guruhlarim_plus", sources: ["@a_guruh"] } } }),
    "Ro'yxatdan o'tgan, mashina kiritmagan — faqat tanlagan guruhlaridan oladi",
  );
  const groups = profileSummary({ vehicle: null, feed: { mode: "guruhlarim", sources: ["@a_guruh", "@b_guruh", "@c_guruh", "@d_guruh"] } });
  assert.equal(groups.mode, "📌 Faqat mening guruhlarim (4 ta guruh)");
  assert.equal(groups.groups, "@a_guruh, @b_guruh, @c_guruh va yana 1 ta");
  assert.equal(groups.from, "faqat tanlagan guruhlaridan");
  const plus = profileSummary({ vehicle: null, routeAt: null, feed: { mode: "guruhlarim_plus", sources: ["@a_guruh"] } });
  assert.equal(plus.vehicle, "kiritilmagan — faqat guruhlaridan keladi");
  assert.equal(plus.groups, "@a_guruh");
  // Tezkor, lekin eski mashinasi saqlangan
  assert.equal(profileSummary({ vehicle: { truckClass: "isuzu" }, feed: { mode: "tezkor" } }).vehicle, "Isuzu (ishlatilmaydi)");
  // Asl matnli xabarlar soni
  assert.deepEqual(deliveriesView({ rawDeliveries: { today: 2, total: 9, lastAt: 5, called: 1 } }).raw, { today: 2, total: 9, lastAt: 5, called: 1 });
  assert.equal(deliveriesView({}).raw.total, 0);
});

test("nisbiy vaqt: hozirgina, daq, soat, kun, keyin sana", () => {
  const now = Date.UTC(2026, 10, 5, 10, 0);
  assert.equal(timeAgo(now - 20 * 1000, now), "hozirgina");
  assert.equal(timeAgo(now + 5000, now), "hozirgina");
  assert.equal(timeAgo(now - 5 * MIN, now), "5 daq oldin");
  assert.equal(timeAgo(now - 3 * HOUR - 10 * MIN, now), "3 soat oldin");
  assert.equal(timeAgo(now - 50 * HOUR, now), "2 kun oldin");
  assert.equal(timeAgo(now - 10 * 24 * HOUR, now, TZ), "26.10 15:00");
  assert.equal(timeAgo(null, now), "—");
});

test("soat va sana Toshkent vaqtida", () => {
  const ts = Date.UTC(2026, 10, 5, 9, 7, 3);
  assert.equal(formatTime(ts, TZ), "14:07");
  assert.equal(formatTime(ts, { ...TZ, seconds: true }), "14:07:03");
  assert.equal(formatDateTime(ts, TZ), "05.11 14:07");
});

test("davomiylik va ishlash vaqti", () => {
  assert.equal(durationMin(45), "45 daq");
  assert.equal(durationMin(65), "1 soat 5 daq");
  assert.equal(durationMin(120), "2 soat");
  assert.equal(durationMin(1500), "1 kun 1 soat");
  assert.equal(durationMin(null), "—");
  const now = 1_000_000_000;
  assert.equal(uptimeText(now - 12_000, now), "12 s");
  assert.equal(uptimeText(now - 5 * MIN, now), "5 daq");
  assert.equal(uptimeText(now - (2 * HOUR + 5 * MIN), now), "2 soat 5 daq");
  assert.equal(uptimeText(null, now), "—");
});

test("hisobdan chiqqan foydalanuvchi: oxirgi roli va sozlamalari ko'rinadi", () => {
  const truck = { vehicle: { truckClass: "fura" }, fromAreas: ["samarqand"] };
  const shown = (fields) => driverShown({ deletedAt: null, phone: null, ...fields });
  assert.deepEqual(shown({ role: null, profile: null, signedOutAt: 5, signedOutRole: "haydovchi", savedProfile: truck }), {
    signedOut: true,
    deleted: false,
    role: "haydovchi",
    profile: truck,
    phone: null,
  });
  assert.deepEqual(shown({ role: "haydovchi", profile: truck, signedOutAt: null, phone: "+998901234567" }), {
    signedOut: false,
    deleted: false,
    role: "haydovchi",
    profile: truck,
    phone: "+998901234567",
  });
  // Hali rol tanlamagan yangi odam — chiqqan emas
  assert.deepEqual(shown({ role: null, profile: null, signedOutAt: null, signedOutRole: null }), {
    signedOut: false,
    deleted: false,
    role: null,
    profile: null,
    phone: null,
  });
  // Ikkala rol saqlangan, qaysi biridan chiqqani noma'lum (eski yozuv)
  assert.equal(shown({ role: null, profile: null, signedOutAt: 5, signedOutRole: null, savedProfile: null }).signedOut, true);
});

test("hisobini o'chirgan: qator qoladi — o'chirgan paytdagi rol, sozlamalar va raqam", () => {
  const truck = { vehicle: { truckClass: "fura" }, fromAreas: ["samarqand"], routeAt: 1 };
  const cargo = { fromAreas: [], truckClasses: [] };
  const deleted = {
    role: null,
    profile: null,
    phone: null,
    signedOutAt: null,
    deletedAt: 9,
    deletedSnapshot: { role: "haydovchi", profile: truck, profiles: { yuk_beruvchi: cargo }, phone: "+998901234567" },
  };
  assert.deepEqual(driverShown(deleted), { signedOut: false, deleted: true, role: "haydovchi", profile: truck, phone: "+998901234567" });
  // Hisobdan chiqib, keyin o'chirgan: profil — saqlanganlardan
  const afterSignOut = { ...deleted, deletedSnapshot: { role: null, signedOutRole: "yuk_beruvchi", profile: null, profiles: { yuk_beruvchi: cargo } } };
  assert.deepEqual(driverShown(afterSignOut), { signedOut: false, deleted: true, role: "yuk_beruvchi", profile: cargo, phone: null });
  assert.match(registrationText(deleted), /Hisobini o'chirgan/);
});

test("o'chirish paytidagi sozlamalar: asosiy rol birinchi, keyin saqlanganlari", () => {
  const truck = { vehicle: { truckClass: "fura" } };
  const cargo = { truckClasses: [] };
  assert.deepEqual(snapshotProfiles({ role: "haydovchi", profile: truck, profiles: { yuk_beruvchi: cargo, haydovchi: null } }), [
    { role: "haydovchi", profile: truck },
    { role: "yuk_beruvchi", profile: cargo },
  ]);
  assert.deepEqual(snapshotProfiles({ role: null, signedOutRole: "yuk_beruvchi", profile: null, profiles: { yuk_beruvchi: cargo } }), [
    { role: "yuk_beruvchi", profile: cargo },
  ]);
  assert.deepEqual(snapshotProfiles({ role: "haydovchi", profile: null, profiles: null }), []);
  assert.deepEqual(snapshotProfiles(null), []);
});

test("ro'yxatdan o'tish qayergacha yetgan («—» o'rniga)", () => {
  const base = { deletedAt: null, signedOutAt: null, role: null, profile: null, active: false, draftStep: null };
  assert.equal(registrationText(base), "Faqat /start bosgan — rol tanlamagan");
  assert.equal(registrationText({ ...base, role: "haydovchi" }), "Rol tanlagan, lekin transport formasini to'ldirmagan");
  assert.equal(registrationText({ ...base, role: "haydovchi", draftStep: "capacity" }), "Ro'yxatdan o'tishni boshlagan — «Qancha yuk ko'taradi» qadamida to'xtagan");
  const truck = { vehicle: { truckClass: "fura" }, fromAreas: [], toAreas: [] };
  assert.match(registrationText({ ...base, role: "haydovchi", profile: truck, active: true }), /yo'nalish tanlamagan/);
  assert.equal(registrationText({ ...base, role: "haydovchi", profile: { ...truck, routeAt: 1 }, active: true }), "Ro'yxatdan o'tgan, yuk oladi");
  assert.equal(registrationText({ ...base, role: "yuk_beruvchi", profile: { truckClasses: [] }, active: false }), "Ro'yxatdan o'tgan, pauzada — o'zi to'xtatgan");
  assert.equal(registrationText({ ...base, role: "haydovchi", profile: truck, active: false, pausedBy: "idle" }), "Ro'yxatdan o'tgan, pauzada — 48 soat botga kirmagan");
  assert.match(registrationText({ ...base, signedOutAt: 5 }), /Hisobdan chiqqan/);
});

test("faol / pauza holati (faqat ko'rsatish): kim pauza qilgan, avtomatik pauzagacha qancha", () => {
  const since = 100 * HOUR;
  const base = { active: true, profile: { vehicle: {} }, deletedAt: null, createdAt: 1, seenAt: since + HOUR, idleWarnedAt: null };
  const fresh = activeView(base, since, since + 2 * HOUR);
  assert.deepEqual([fresh.label, fresh.tone, fresh.warned, fresh.pauseAt], ["Faol", "good", false, since + 49 * HOUR]);
  assert.equal(pauseInText(fresh.pauseAt, since + 2 * HOUR), "kirmasa, pauzagacha 1 kun 23 soat");
  // Bot hali kuzatmagan (idleSince yo'q) — muddat ko'rsatilmaydi
  assert.equal(activeView(base, null, since).pauseAt, null);
  const warned = activeView({ ...base, idleWarnedAt: since + 25 * HOUR }, since, since + 26 * HOUR);
  assert.deepEqual([warned.tone, warned.icon, warned.warned, warned.at], ["warning", "⚠", true, since + 25 * HOUR]);
  assert.equal(pauseInText(since + 49 * HOUR, since + 50 * HOUR), "bir necha daqiqada pauza bo'ladi");
  assert.equal(pauseInText(null), null);

  const idle = activeView({ ...base, active: false, pausedBy: "idle", pausedAt: 5 }, since);
  assert.deepEqual([idle.label, idle.icon, idle.note, idle.at, idle.tone], ["Avto-pauza", "💤", "48 soat botga kirmagan", 5, "warning"]);
  assert.equal(activeView({ ...base, active: false, pausedBy: "blocked" }).tone, "critical");
  assert.equal(activeView({ ...base, active: false, pausedBy: "user" }).note, "o'zi to'xtatgan");
  assert.equal(activeView({ ...base, active: false, pausedBy: null }).label, "Pauza", "eski yozuv — sababi noma'lum");
});

test("tarix voqealari matni", () => {
  assert.deepEqual(eventView({ type: "deleted", detail: { via: "web" } }), { icon: "🗑", text: "Hisobini o'chirdi (web'da)" });
  assert.deepEqual(eventView({ type: "returned", detail: { via: "bot" } }), { icon: "↩️", text: "O'chirgandan keyin qaytdi (botda) — boshidan boshladi" });
  assert.equal(eventView({ type: "role", detail: { from: null, to: "haydovchi", restored: false } }).text, "Rol tanladi: Haydovchi");
  assert.equal(eventView({ type: "role", detail: { from: "haydovchi", to: "yuk_beruvchi", restored: true } }).text, "Rolni almashtirdi: Haydovchi → Yuk beruvchi (sozlamalari tiklandi)");
  assert.equal(eventView({ type: "resumed", detail: { by: "admin" } }).text, "Boshqaruv markazidan yoqildi");
  assert.equal(eventView({ type: "paused", detail: { by: "idle" } }).icon, "💤");
  assert.match(eventView({ type: "idle_warned", detail: null }).text, /24 soat kirmagani uchun ogohlantirildi/);
  assert.equal(eventView({ type: "phone", detail: { phone: "+998901234567" } }).icon, "📱");
  assert.match(eventView({ type: "route", detail: { fromAreas: ["samarqand"], toAreas: [] } }).text, /^Yo'nalish tanladi: Samarqand/);
  assert.deepEqual(eventView({ type: "nimadir", detail: null }), { icon: "•", text: "nimadir" });
});

test("oxirgi faollik: 2 daqiqa ichida — «Hozir», eski yozuvlarda taxminiy vaqt", () => {
  const now = 10 * HOUR;
  assert.deepEqual(activityView({ seenAt: now - MIN, seenVia: "web", updatedAt: 1 }, now), { at: now - MIN, exact: true, via: "web'da", online: true });
  assert.equal(activityView({ seenAt: now - 3 * MIN, seenVia: "bot" }, now).online, false);
  // seen_at yozilmagan (2026-11-09 dan oldin) — updatedAt, «Hozir» emas (boshqaruv markazidagi o'zgarish ham uni yangilaydi)
  assert.deepEqual(activityView({ seenAt: null, updatedAt: now - 1000 }, now), { at: now - 1000, exact: false, via: null, online: false });
});

test("olgan yuklari: yo'nalish, xato sababi, hozir ham yetmayaptimi", () => {
  const load = { fromCity: "Samarqand", fromRegion: "samarqand", toCity: "Toshkent", toRegion: "toshkent_sh" };
  const base = { role: "haydovchi", profile: {}, deliveries: { today: 2, total: 9, lastAt: 500, lastLoad: load, failed: 0, lastError: null, lastErrorAt: null } };
  const ok = deliveriesView(base);
  assert.deepEqual([ok.noun, ok.today, ok.total, ok.failing], ["yuk", 2, 9, false]);
  assert.match(ok.lastRoute, /^Samarqand → .*Toshkent/);
  const blocked = deliveriesView({ ...base, deliveries: { ...base.deliveries, failed: 1, lastError: "Forbidden: bot was blocked by the user", lastErrorAt: 600 } });
  assert.deepEqual([blocked.error, blocked.failing], ["botni bloklagan", true]);
  // Xatodan keyin yana yetib borgan — hozir muammo yo'q
  assert.equal(deliveriesView({ ...base, deliveries: { ...base.deliveries, failed: 1, lastError: "x", lastErrorAt: 400 } }).failing, false);
  // Yuk beruvchi — bo'sh mashinalar, manzili yo'q mashina — «istalgan joy»
  const shipper = deliveriesView({ role: "yuk_beruvchi", deliveries: { total: 1, lastAt: 1, lastLoad: { fromCity: "Andijon", fromRegion: "andijon" } } });
  assert.deepEqual([shipper.noun, shipper.lastRoute], ["mashina", "Andijon → istalgan joy"]);
  assert.deepEqual([deliveriesView({ role: "haydovchi" }).total, deliveriesView({ role: "haydovchi" }).lastRoute], [0, null]);
});

test("foydalanuvchi qo'shgan manba: tekshiruv belgisi", () => {
  assert.equal(sourceCheckView({ checkState: null }), null, "admin qo'shgan");
  assert.equal(sourceCheckView({ checkState: "probe" }).label, "Tekshirilyapti");
  const trial = sourceCheckView({ checkState: "trial", trial: { loads: 3 }, checkUntil: Date.UTC(2026, 10, 11, 9, 30), checkNote: "50 tadan 20 tasi" }, { timeZone: "Asia/Tashkent" });
  assert.equal(trial.label, "Sinovda: 3/5 yuk e'loni · 11.11 14:30 gacha");
  assert.match(trial.title, /Tekshiruv: 50 tadan 20 tasi/);
  assert.equal(sourceCheckView({ checkState: "failed", checkStats: { probe: {} } }).label, "Rad etildi");
  assert.equal(sourceCheckView({ checkState: "failed", checkStats: { probe: {}, trial: {} } }).label, "Sinovdan o'tmadi");
  assert.equal(sourceCheckView({ checkState: "ok" }).tone, "good");
});

test("Telegram akkaunti holati: ishlayapti / ulanib bo'lmadi / sessiya yo'q (qanday kirish) / takror", () => {
  assert.equal(tgAccountView({ name: "ikkinchi", status: "ok" }).label, "Ishlayapti");
  assert.equal(tgAccountView({ name: "ikkinchi", status: "error", error: "Not connected" }).title, "Not connected");
  assert.match(tgAccountView({ name: "ikkinchi", status: "logged_out" }).hint, /Boshqaruv.*Qayta kirish.*npm run tg:login -- --account ikkinchi/);
  assert.match(tgAccountView({ name: "asosiy", status: "logged_out" }).hint, /npm run tg:login$/);
  assert.equal(tgAccountView({ name: "x", status: "duplicate" }).tone, "warning");
});

test("yopiq guruh tanlash: qo'shilmaganlari, bir guruh bir marta, yopiqlari birinchi, faqat ishlayotgan akkauntlar; qidiruv", () => {
  const accounts = [
    { name: "asosiy", status: "ok" },
    { name: "ikkinchi", status: "ok" },
    { name: "eski", status: "logged_out" },
  ];
  const dialogs = [
    { account: "asosiy", peerId: "-1001", title: "Yuk Andijon", username: "yuk_andijon", added: null },
    { account: "asosiy", peerId: "-1002", title: "Qo'shilgan", username: null, added: "-1002" },
    { account: "ikkinchi", peerId: "-1003", title: "Haydovchilar", username: null, added: null },
    { account: "asosiy", peerId: "-1003", title: "Haydovchilar", username: null, added: null },
    { account: "eski", peerId: "-1004", title: "Eski akkaunt guruhi", username: null, added: null },
  ];
  const list = pickableDialogs(dialogs, accounts);
  assert.deepEqual(
    list.map((d) => [d.peerId, d.accounts]),
    [["-1003", ["ikkinchi", "asosiy"]], ["-1001", ["asosiy"]]],
  );
  assert.deepEqual(dialogSource(list[0]), { name: "-1003", account: "asosiy" }, "asosiy a'zo bo'lsa — asosiy o'qiydi");
  assert.deepEqual(dialogSource({ ...list[0], accounts: ["ikkinchi"] }), { name: "-1003", account: "ikkinchi" });
  assert.deepEqual(dialogSource(list[1]), { name: "@yuk_andijon", account: null }, "ochig'i — manzili bilan");
  assert.deepEqual(pickableDialogs(dialogs, accounts, "ANDIJON").map((d) => d.peerId), ["-1001"]);
  assert.deepEqual(pickableDialogs(dialogs, accounts, "@yuk_").map((d) => d.peerId), ["-1001"]);
  assert.deepEqual(pickableDialogs(dialogs, accounts, "-1003").map((d) => d.peerId), ["-1003"]);
});

test("scanView: Auto scan holati bir qatorda", async () => {
  const { scanView } = await import("../src/format.js");
  assert.equal(scanView(null), null);
  assert.deepEqual(scanView({ running: false, checked: 0, pending: 0, trial: 0, ok: 0, failed: 0, rejected: 0, errors: 0 }), { running: false, text: null });
  assert.deepEqual(scanView({ running: true, checked: 4, pending: 30, trial: 2, ok: 0, failed: 0, rejected: 2, errors: 0 }), {
    running: true,
    text: "🔎 Tekshirilyapti: 4 ta tekshirildi, yana 30 tasi navbatda (30 soniyada bittadan) · 2 tasi manbaga olindi (2 tasi sinovda) · 2 tasi yuk guruhi emas",
  });
  assert.equal(
    scanView({ running: false, checked: 10, pending: 0, trial: 1, ok: 3, failed: 1, rejected: 5, errors: 1 }).text,
    "🔎 10 ta guruh tekshirilgan · 5 tasi manbaga olindi (1 tasi sinovda), 3 tasi sinovdan o'tdi · 5 tasi yuk guruhi emas · 1 tasini o'qib bo'lmadi",
  );
});

test("foydalanuvchilar ro'yxati: holat belgisi, filtr, qidiruv, bosh harflar", async () => {
  const { DRIVER_FILTERS, driverMatches, driverPill, initials, isProDriver } = await import("../src/format.js");
  const now = Date.UTC(2026, 10, 16, 10);
  const base = { chatId: 700000001, name: "Sanjar Test", username: "sanjar_test", phone: "+998900000001", role: "haydovchi", active: true, profile: { vehicle: { truckClass: "isuzu" } } };
  assert.equal(driverPill({ ...base, deletedAt: now }, null, now).label, "O'chirgan");
  assert.equal(driverPill({ ...base, banned: { at: now } }, null, now).label, "Bloklangan");
  assert.equal(driverPill({ ...base, profile: null, registering: true }, null, now).label, "Ro'yxatda");
  assert.equal(driverPill({ ...base, profile: null }, null, now).label, "Profilsiz");
  assert.equal(driverPill(base, null, now).label, "Faol");
  assert.equal(isProDriver({ plan: "free", autoPro: true }), true);
  assert.equal(isProDriver({ plan: "free" }), false);
  const pro = DRIVER_FILTERS.find((f) => f.id === "pro");
  assert.equal(pro.test({ ...base, plan: "pro" }, now), true);
  assert.equal(driverMatches(base, "sanjar"), true);
  assert.equal(driverMatches(base, "@sanjar_test"), true);
  assert.equal(driverMatches(base, "90 000 00"), true, "raqam bo'shliq bilan ham");
  assert.equal(driverMatches(base, "700000"), true, "Telegram ID");
  assert.equal(driverMatches(base, "aziz"), false);
  assert.equal(driverMatches(base, ""), true);
  assert.equal(initials(base), "ST");
  assert.equal(initials({ name: "Ali Valiyev" }), "AV");
  assert.equal(initials({ name: "", username: "ali" }), "AL");
});

test("qidiruv kirill/lotin farqisiz: haydovchi va yopiq guruh", async () => {
  const { driverMatches, pickableDialogs } = await import("../src/format.js");
  const d = { chatId: 1, name: "Давронбек", username: null };
  assert.equal(driverMatches(d, "davronbek"), true);
  assert.equal(driverMatches(d, "ДАВРОН"), true);
  assert.equal(driverMatches({ chatId: 2, name: "Sanjar Test" }, "санжар"), true);
  const dialogs = [{ peerId: "-1001", title: "Кукон ISUZU ва KIA юк ташиш", username: null, account: "a", added: false }];
  assert.equal(pickableDialogs(dialogs, [{ name: "a", status: "ok" }], "kukon").length, 1);
  assert.equal(pickableDialogs(dialogs, [{ name: "a", status: "ok" }], "юк ташиш").length, 1);
});
