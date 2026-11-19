// Boshqaruv markazidagi matnlar: yuk qanday ko'rinadi, vaqt ("5 daq oldin"), ishlash vaqti, raqamlar.
// Bot'dagi apps/bot/src/format.js ning foydali qismlari (HTML'siz) — admin uni import qilmaydi, alohida dastur.
// Hammasi oddiy funksiyalar: brauzersiz test qilinadi (test/format.test.js).
import {
  BODY_TYPES,
  CATEGORIES,
  FEED_MODES,
  INTL_OPTIONS,
  LOADING_SIDES,
  PAYMENT_TYPES,
  REGIONS,
  ROLES,
  TRUCK_CLASSES,
  bodyId,
  feedOf,
  foldText,
  formatContactPhone,
  idleState,
  intlOption,
  placeKey,
  regionLabel,
  routeChosen,
  routeLabel,
} from "@yuk/shared";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// --- Raqamlar ---
// 3800000 → "3 800 000"; 14.62 → "14,6" (o'zbekcha: kasr vergul bilan, oxiridagi nollar tashlanadi)
export function formatNumber(value, digits = 0) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  const [whole, fraction = ""] = Number(value).toFixed(digits).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${grouped},${trimmed}` : grouped;
}

// --- Joy nomlari (bot bilan bir xil qoida) ---
const regionName = (id) => REGIONS.find((r) => r.id === id)?.name;
// "Farg'ona viloyati" → "Farg'ona", "Toshkent shahri" → "Toshkent"
const regionBase = (id) => regionName(id)?.replace(/ (viloyati|shahri|Respublikasi)$/, "") ?? null;
const sameName = (a, b) => placeKey(a) === placeKey(b);

// "Farg'ona, Beshariq", "Toshkent vil., Chirchiq", "Samarqand", "Rossiya, Moskva", "Surxondaryo viloyati"
export function placeText(load, side) {
  const city = load[`${side}City`];
  const place = load[`${side}Place`];
  const region = regionName(load[`${side}Region`]) ? load[`${side}Region`] : null;
  const country = load[`${side}Country`];
  const parts = [];
  if (region === "xorij" || (country && country !== "O'zbekiston")) {
    if (country) parts.push(country);
    if (city && !sameName(city, country ?? "")) parts.push(city);
  } else if (city && region) {
    const base = regionBase(region);
    const area = region === "toshkent" ? "Toshkent vil." : base;
    if (sameName(city, base)) parts.push(area);
    else parts.push(area, city.replace(/\s*\([^)]*\)$/, ""));
  } else if (city) {
    parts.push(city);
  } else if (region) {
    parts.push(regionName(region));
  }
  if (!parts.length) return place ?? country ?? "?";
  const text = parts.join(", ");
  return place && !sameName(place, city ?? "") ? `${text} (${place})` : text;
}

// 0.7 → "700 kg", 22 → "22 tonna", 1.5 → "1,5 tonna" (Azimjon: «t» emas, «tonna» — hamma joyda)
export function weightText(weightT) {
  if (weightT == null) return null;
  return weightT < 1 ? `${formatNumber(weightT * 1000)} kg` : `${String(weightT).replace(".", ",")} tonna`;
}

const UNIT_TEXT = { reys: "reys", tonna: "tonnasi", kg: "kilosi", kub: "kubi" };

export function moneyText(amount, currency) {
  const value = formatNumber(amount);
  if (currency === "USD") return `$${value}`;
  if (currency === "RUB") return `${value} ₽`;
  if (currency === "KZT") return `${value} ₸`;
  return `${value} so'm`;
}

// "3 800 000 so'm · kelishiladi · naqd", "200 so'm / kilosi", "narx yozilmagan"
export function priceText(load) {
  const parts = [];
  if (load.price != null) {
    const money = moneyText(load.price, load.currency);
    parts.push(load.priceUnit && load.priceUnit !== "reys" ? `${money} / ${UNIT_TEXT[load.priceUnit] ?? load.priceUnit}` : money);
  }
  if (load.negotiable) parts.push("kelishiladi");
  const payment = PAYMENT_TYPES.find((p) => p.id === load.payment)?.name;
  if (payment) parts.push(payment.toLowerCase());
  return parts.length ? parts.join(" · ") : "narx yozilmagan";
}

export const truckClassName = (id) => TRUCK_CLASSES.find((t) => t.id === id)?.name ?? null;
// "Refrijerator / Ref" → "Refrijerator": ro'yxatda birinchi nomi yetadi. Eski kodlar (bort, tral, sementavoz) — yangisi nomi bilan
export const bodyTypeName = (id) => BODY_TYPES.find((b) => b.id === bodyId(id))?.name.split(" / ")[0] ?? null;
export const categoryName = (id) => CATEGORIES.find((c) => c.id === id)?.name ?? null;

// "2 ta · Fura · tent · orqadan · dogruz"
export function vehicleText(load) {
  const parts = [];
  if (load.vehicleCount > 1) parts.push(`${load.vehicleCount} ta`);
  const cls = truckClassName(load.truckClass);
  const body = bodyTypeName(load.bodyType);
  if (cls) parts.push(cls);
  if (body) parts.push(cls ? body.toLowerCase() : body);
  if (load.loadingSides?.length) {
    parts.push(load.loadingSides.map((s) => LOADING_SIDES.find((x) => x.id === s)?.name.toLowerCase() ?? s).join("/"));
  }
  if (load.partial) parts.push("dogruz");
  return parts.join(" · ");
}

// "Sement · 22 t · 80 kub · 33 palet"
export function cargoText(load) {
  return [
    load.cargo,
    weightText(load.weightT),
    load.volumeM3 != null ? `${formatNumber(load.volumeM3, 1)} kub` : null,
    load.pallets ? `${load.pallets} palet` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Telefon: matnda "+998901234567", havolada "tel:+998901234567"
export function phoneLinks(phones) {
  return (phones ?? [])
    .map((phone) => String(phone).replace(/[^\d+]/g, ""))
    .filter((digits) => digits.replace(/\D/g, "").length >= 7)
    .map((digits) => {
      const text = digits.startsWith("+") ? digits : `+${digits}`;
      return { text, href: `tel:${text}` };
    });
}

// Yuk kartochkasi uchun hamma matnlar bir joyda
export function loadView(load = {}) {
  return {
    from: placeText(load, "from"),
    to: placeText(load, "to"),
    cargo: cargoText(load),
    vehicle: vehicleText(load),
    price: priceText(load),
    phones: phoneLinks(load.phones),
    when: load.when ?? null,
    note: load.note ?? null,
    category: categoryName(load.category),
  };
}

// --- Haydovchi profili ---
// "Andijon vil., Rossiya" yoki "Hamma joy" (bo'sh ro'yxat = cheklov yo'q)
export function areasText(areas) {
  return areas?.length ? areas.map(regionLabel).join(", ") : "Hamma joy";
}

export function capacityText(capacityKg) {
  if (capacityKg == null) return null;
  return weightText(Math.round(capacityKg / 100) / 10);
}

// Boshqaruv markazidagi foydalanuvchi qatori. Hisobdan chiqqanda (store.signOut) rol va profil ustunlari bo'shaydi —
// bot uni yangi odamdek ko'radi va yuk yubormaydi, lekin ma'lumot o'chmagan: oxirgi roli (signedOutRole) va o'sha
// rolning sozlamalari (savedProfile) ko'rsatiladi, Holat'da «🚪 Hisobdan chiqqan» turadi
// Hisobini o'chirgan (store.deleteDriver): qator qoladi, o'chirgan paytdagi rol, sozlamalar va raqam — deletedSnapshot da
export function driverShown(driver) {
  const deleted = driver.deletedAt != null;
  const snap = deleted ? (driver.deletedSnapshot ?? {}) : null;
  const signedOut = !deleted && !driver.role && driver.signedOutAt != null;
  const role =
    driver.role ?? (deleted ? (snap.role ?? snap.signedOutRole ?? null) : signedOut ? (driver.signedOutRole ?? null) : null);
  const saved = deleted ? (snap.profile ?? (role ? snap.profiles?.[role] : null) ?? null) : signedOut ? (driver.savedProfile ?? null) : null;
  return {
    signedOut,
    deleted,
    role,
    profile: driver.profile ?? saved,
    phone: driver.phone ?? (deleted ? (snap.phone ?? null) : null),
  };
}

// O'chirish paytidagi sozlamalar (deletedSnapshot yoki tarixdagi «deleted» voqeasi) → [{ role, profile }], asosiysi birinchi.
// Qaytgan foydalanuvchi boshidan boshlaydi, lekin admin oldingi mashinasi va yo'nalishini ko'ra oladi
export function snapshotProfiles(snap) {
  if (!snap) return [];
  const main = snap.role ?? snap.signedOutRole ?? null;
  const list = [];
  const mainProfile = snap.profile ?? (main ? snap.profiles?.[main] : null);
  if (main && mainProfile) list.push({ role: main, profile: mainProfile });
  for (const [role, profile] of Object.entries(snap.profiles ?? {})) if (profile && role !== main) list.push({ role, profile });
  return list;
}

// Botdagi savol-javob qadamlari (apps/bot wizard.js STEPS / SHIPPER_STEPS) — «qaysi qadamda to'xtagan»
const WIZARD_STEPS = {
  class: "Transport turi",
  body: "Kuzov",
  capacity: "Qancha yuk ko'taradi",
  size: "O'lcham",
  sides: "Yuklash tomoni",
  intl: "Qayerda ishlaydi",
  from: "Qayerdan",
  to: "Qayerga",
  classes: "Mashina turlari",
  bodies: "Kuzovlar",
};

// Ro'yxatdan o'tish qayergacha yetgan: «—» o'rniga sababini aytamiz (masalan, rol tanlagan, lekin formani to'ldirmagan)
export function registrationText(driver) {
  const shown = driverShown(driver);
  if (shown.deleted) return "Hisobini o'chirgan — bot unga hech narsa yubormaydi";
  if (shown.signedOut) return "Hisobdan chiqqan — qayta kirib rolni tanlasa, sozlamalari tiklanadi";
  if (!driver.role) return "Faqat /start bosgan — rol tanlamagan";
  if (!driver.profile) {
    const step = WIZARD_STEPS[driver.draftStep];
    return step ? `Ro'yxatdan o'tishni boshlagan — «${step}» qadamida to'xtagan` : "Rol tanlagan, lekin transport formasini to'ldirmagan";
  }
  if (!driver.active) return `Ro'yxatdan o'tgan, pauzada — ${PAUSED_BY[driver.pausedBy]?.note ?? "o'zi to'xtatgan"}`;
  // «⚡ Tezkor» / «📌 Mening guruhlarim»: yo'nalish ham, mashina ham kerak emas — e'lonlar asl matn bilan darhol boradi
  const fm = FEED_MODES[feedOf(driver.profile).mode];
  if (driver.role === "haydovchi" && !fm.sorted) return `Ro'yxatdan o'tgan, ${fm.icon} ${fm.name} — e'lonlar asl matn bilan darhol boradi`;
  if (driver.role === "haydovchi" && !driver.profile.vehicle) return "Ro'yxatdan o'tgan, mashina kiritmagan — faqat tanlagan guruhlaridan oladi";
  if (driver.role === "haydovchi" && !routeChosen(driver.profile)) {
    return fm.groups
      ? "Ro'yxatdan o'tgan, yo'nalish tanlamagan — faqat tanlagan guruhlaridan oladi"
      : "Ro'yxatdan o'tgan, lekin yo'nalish tanlamagan — yuk bormaydi";
  }
  return "Ro'yxatdan o'tgan, yuk oladi";
}

// Kim pauza qilgan (drivers.paused_by). Faol / pauzani faqat foydalanuvchi o'zi o'zgartiradi (Azimjon, 2026-11-09) —
// boshqaruv markazi faqat ko'rsatadi
const PAUSED_BY = {
  user: { icon: "⏸", label: "Pauza", note: "o'zi to'xtatgan" },
  idle: { icon: "💤", label: "Avto-pauza", note: "48 soat botga kirmagan" },
  blocked: { icon: "⛔", label: "Botni bloklagan", note: "Telegram xabarni qabul qilmadi" },
  admin: { icon: "⏸", label: "Pauza", note: "boshqaruv markazidan (eski)" },
};

// Faol / pauza holati. Faol bo'lsa — avtomatik pauza qachon (@yuk/shared idleState: 24 soatda ogohlantirish, 48 da pauza).
// idleSince — bot kuzatuvni boshlagan vaqt (GET /api/drivers); hali yo'q bo'lsa (bot yangi kod bilan ishga tushmagan) —
// muddat ko'rsatilmaydi. → { active, tone, icon, label, note, at, warned, pauseAt }
export function activeView(driver, idleSince = null, now = Date.now()) {
  if (!driver.active) {
    const by = PAUSED_BY[driver.pausedBy] ?? { icon: "⏸", label: "Pauza", note: null };
    return { active: false, tone: driver.pausedBy === "blocked" ? "critical" : "warning", ...by, at: driver.pausedAt ?? null, warned: false, pauseAt: null };
  }
  const idle = idleSince ? idleState(driver, now, idleSince) : null;
  const warned = Boolean(idle?.warned);
  return {
    active: true,
    tone: warned ? "warning" : "good",
    icon: warned ? "⚠" : "●",
    label: "Faol",
    note: warned ? "24 soat kirmagan — ogohlantirildi" : null,
    at: warned ? driver.idleWarnedAt : null,
    warned,
    pauseAt: idle?.pauseAt ?? null,
  };
}

// «pauzagacha 1 kun 3 soat» / «bir necha daqiqada pauza» (bot har 10 daqiqada tekshiradi)
export function pauseInText(pauseAt, now = Date.now()) {
  if (pauseAt == null) return null;
  const left = pauseAt - now;
  return left <= 0 ? "bir necha daqiqada pauza bo'ladi" : `kirmasa, pauzagacha ${durationMin(Math.ceil(left / MINUTE))}`;
}

const VIA_TEXT = { bot: "botda", web: "web'da" };
const roleName = (id) => (id ? (ROLES[id]?.name ?? id) : null);

// Tarixdagi voqea (store user_events, history.js) → { icon, text }
export function eventView({ type, detail }) {
  const d = detail ?? {};
  const via = VIA_TEXT[d.via] ? ` (${VIA_TEXT[d.via]})` : "";
  switch (type) {
    case "joined":
      return { icon: "👋", text: "Botga birinchi marta kirdi" };
    case "role":
      return d.from
        ? { icon: "🔄", text: `Rolni almashtirdi: ${roleName(d.from)} → ${roleName(d.to)}${d.restored ? " (sozlamalari tiklandi)" : ""}` }
        : { icon: "🎭", text: `Rol tanladi: ${roleName(d.to)}${d.restored ? " (oldingi sozlamalari tiklandi)" : ""}` };
    case "registered":
      return { icon: "✅", text: `Ro'yxatdan o'tdi${d.role ? ` (${roleName(d.role)})` : ""}` };
    case "settings":
      return { icon: "⚙️", text: "Sozlamalarini o'zgartirdi" };
    case "route":
      return { icon: "🧭", text: `Yo'nalish tanladi: ${routeLabel({ fromAreas: d.fromAreas, toAreas: d.toAreas })}` };
    case "paused":
      if (d.by === "idle") return { icon: "💤", text: "48 soat botga kirmagani uchun avtomatik pauza (xabar yuborildi)" };
      return { icon: "⏸", text: d.by === "admin" ? "Boshqaruv markazidan to'xtatildi" : "Yuborishni to'xtatdi (pauza)" };
    case "idle_warned":
      return { icon: "⚠️", text: "24 soat kirmagani uchun ogohlantirildi: «yana 24 soat kirmasangiz — pauza»" };
    case "resumed":
      return { icon: "▶️", text: d.by === "admin" ? "Boshqaruv markazidan yoqildi" : "Yuborishni qayta yoqdi" };
    case "blocked":
      return { icon: "⛔", text: "Botni bloklagan — yuborish to'xtatildi" };
    case "phone":
      return { icon: "📱", text: `Raqamini ulashdi${d.phone ? `: ${formatContactPhone(d.phone)}` : ""}` };
    case "phone_removed":
      return { icon: "📵", text: "Raqamini o'chirdi" };
    case "admin":
      return { icon: "🛠", text: d.on ? "Admin qilindi" : "Admin huquqi olindi" };
    case "signout":
      return { icon: "🚪", text: `Hisobdan chiqdi${d.role ? ` (${roleName(d.role)})` : ""}` };
    case "deleted":
      return { icon: "🗑", text: `Hisobini o'chirdi${via}` };
    case "returned":
      return { icon: "↩️", text: `O'chirgandan keyin qaytdi${via} — boshidan boshladi` };
    case "sub_left": {
      const list = (d.missing ?? []).join(", ");
      return d.first
        ? { icon: "🔒", text: `Kanal/guruhga a'zo emas${list ? `: ${list}` : ""} — bot ishlamaydi` }
        : { icon: "🔒", text: `Kanal/guruhdan chiqdi${list ? `: ${list}` : ""} — yuk yuborilmaydi` };
    }
    case "sub_joined":
      return { icon: "🔓", text: "Kanal va guruhga a'zo bo'ldi — bot yana ishlaydi" };
    case "banned": {
      const keys = [d.username ? `@${d.username}` : null, d.phone ? formatContactPhone(d.phone) : null].filter(Boolean);
      return { icon: "🚫", text: `Boshqaruv markazidan bloklandi${keys.length ? ` (${keys.join(", ")} ham)` : ""}` };
    }
    case "unbanned":
      return { icon: "✅", text: "Blokdan chiqarildi" };
    default:
      return { icon: "•", text: type };
  }
}

// Oxirgi faollik: shu vaqt ichida bo'lsa — «● Hozir botda / web'da»
export const ONLINE_MS = 2 * 60 * 1000;
// call — yuk xabaridagi «📞 Telefon qilish» tugmasini bosgan (2026-11-09)
const SEEN_VIA = { bot: "botda", web: "web'da", call: "📞 qo'ng'iroq tugmasida" };

// seenAt — botga yozgan / tugma bosgan yoki web'ni ishlatgan vaqt (2026-11-09 dan yoziladi). Undan oldingilarda —
// updatedAt (bot uni ham har xabarda yangilaydi, lekin boshqaruv markazidagi o'zgarish ham kiradi): taxminiy, «Hozir» yo'q
export function activityView(driver, now = Date.now()) {
  const exact = driver.seenAt != null;
  const at = exact ? driver.seenAt : (driver.updatedAt ?? null);
  return {
    at,
    exact,
    via: exact ? (SEEN_VIA[driver.seenVia] ?? null) : null,
    online: exact && now - driver.seenAt < ONLINE_MS,
  };
}

// Telegram xatosi → tushunarli matn
function deliveryErrorText(error) {
  if (!error) return null;
  if (/blocked/i.test(error)) return "botni bloklagan";
  if (/deactivated/i.test(error)) return "Telegram akkaunti o'chirilgan";
  if (/chat not found/i.test(error)) return "chat topilmadi";
  return error;
}

// «Olgan yuklari» (bazadagi deliveries, 2026-11-09 dan): haydovchiga — yuklar, yuk beruvchiga — bo'sh mashinalar.
// blocked — oxirgi urinish xato bo'lsa (muvaffaqiyatlisidan keyin) — hozir ham yetmayapti
export function deliveriesView(driver) {
  const d = driver.deliveries ?? {};
  const noun = driverShown(driver).role === "yuk_beruvchi" ? "mashina" : "yuk";
  const load = d.lastLoad;
  const to = load ? placeText(load, "to") : null;
  const failing = Boolean(d.lastErrorAt) && d.lastErrorAt >= (d.lastAt ?? 0);
  return {
    noun,
    today: d.today ?? 0,
    total: d.total ?? 0,
    lastAt: d.lastAt ?? null,
    lastRoute: load ? `${placeText(load, "from")} → ${to === "?" && noun === "mashina" ? "istalgan joy" : to}` : null,
    failed: d.failed ?? 0,
    called: d.called ?? 0, // nechta yukda «📞 Telefon qilish» ni bosgan
    // «⚡ Tezkor» / «📌 Mening guruhlarim»: AI'siz, asl matn bilan yuborilgan e'lonlar (store post_deliveries, 2026-11-14)
    raw: { today: 0, total: 0, lastAt: null, called: 0, ...(driver.rawDeliveries ?? {}) },
    error: deliveryErrorText(d.lastError),
    errorAt: d.lastErrorAt ?? null,
    failing,
  };
}

export function profileSummary(profile) {
  if (!profile) return null;
  // Yuk beruvchi: o'z mashinasi yo'q — qanday mashina va kuzov kerak (bo'sh ro'yxat — istalgani)
  if (Array.isArray(profile.truckClasses)) {
    const names = (ids, name) => ids.map((id) => name(id) ?? id).join(", ");
    return {
      vehicle: profile.truckClasses.length ? `Kerak: ${names(profile.truckClasses, truckClassName)}` : "Istalgan mashina",
      size: profile.bodyTypes?.length ? `Kuzov: ${names(profile.bodyTypes, bodyTypeName).toLowerCase()}` : null,
      from: areasText(profile.fromAreas),
      to: areasText(profile.toAreas),
      intl: INTL_OPTIONS[intlOption(profile)]?.label ?? null,
      mode: null,
    };
  }
  // Yetkazish rejimi (@yuk/shared feed.js, 2026-11-14): saralangandan boshqasi belgi bilan, guruhlari ro'yxat bilan
  const feed = feedOf(profile);
  const fm = FEED_MODES[feed.mode];
  const mode = feed.mode === "saralangan" ? null : `${fm.icon} ${fm.name}${fm.groups ? ` (${feed.sources.length} ta guruh)` : ""}`;
  const groups = fm.groups ? feedGroupsText(feed.sources) : null;
  const v = profile.vehicle ?? {};
  const body = bodyTypeName(v.bodyType);
  const classes = (Array.isArray(v.truckClasses) && v.truckClasses.length ? v.truckClasses : [v.truckClass]).map((id) => truckClassName(id) ?? id);
  const vehicle = [classes.filter(Boolean).join(", "), body ? body.toLowerCase() : null, capacityText(v.capacityKg)].filter(Boolean).join(" · ");
  const size = v.body ? `${formatNumber(v.body.lengthM, 2)} × ${formatNumber(v.body.widthM, 2)} × ${formatNumber(v.body.heightM, 2)} m` : null;
  const sizeShown = size && v.bodyGuess ? `${size} (odatdagi)` : size;
  const intl = INTL_OPTIONS[intlOption(profile)]?.label ?? null;
  // «⚡ Tezkor» / «📌 Mening guruhlarim»: mashina va yo'nalish ishlatilmaydi — e'lon asl matni bilan darhol
  if (!fm.sorted) {
    return {
      vehicle: profile.vehicle ? `${vehicle || "—"} (ishlatilmaydi)` : "shart emas",
      size: profile.vehicle ? sizeShown : null,
      from: fm.groups ? "faqat tanlagan guruhlaridan" : "hamma guruhlardan",
      to: "saralanmaydi — darhol, asl matn bilan",
      intl: fm.groups ? null : "uzoq xorij yuklarisiz", // tezkor — doiradan tashqari (Rossiya va h.k.) e'lonlar AI'siz ham tashlanadi
      mode,
      groups,
    };
  }
  // Yo'nalishni haydovchi botdagi «📋 Mos yuklar» da tanlaydi; tanlamaguncha unga yuk yuborilmaydi
  const chosen = routeChosen(profile);
  // «Guruhlarim + saralangan», lekin mashina kiritilmagan — faqat guruhlari keladi
  if (!profile.vehicle) {
    return { vehicle: "kiritilmagan — faqat guruhlaridan keladi", size: null, from: chosen ? areasText(profile.fromAreas) : "—", to: chosen ? areasText(profile.toAreas) : "—", intl, mode, groups };
  }
  return {
    vehicle: vehicle || "—",
    size: sizeShown,
    from: chosen ? areasText(profile.fromAreas) : "tanlanmagan — yuk bormaydi",
    to: chosen ? areasText(profile.toAreas) : "—",
    intl,
    mode,
    groups,
  };
}

// «📌 Mening guruhlarim» ro'yxati: birinchi 3 tasi va «va yana N ta»
export function feedGroupsText(sources = []) {
  if (!sources.length) return "tanlanmagan";
  return sources.length > 3 ? `${sources.slice(0, 3).join(", ")} va yana ${sources.length - 3} ta` : sources.join(", ");
}

// --- Foydalanuvchi qo'shgan manba (bot «➕ Guruh qo'shish», 2026-11-10) ---
// Tekshiruv holati belgisi: probe — collector oxirgi xabarlarini ko'ryapti; trial — 24 soatlik sinov (kamida 5 ta yuk
// e'loni); ok — o'tdi; failed — rad etildi / o'tmadi (checkNote — nima uchun). Admin qo'shgan manbada — null
export const TRIAL_MIN_LOADS = 5; // apps/bot userSources.js SOURCE_RULES.minLoads bilan bir xil
export function sourceCheckView(source, { timeZone } = {}) {
  const note = source.checkNote ?? undefined;
  switch (source.checkState) {
    case "probe":
      return { tone: "info", icon: "🔎", label: "Tekshirilyapti", title: "Collector guruhning oxirgi 50 ta xabarini ko'rib chiqyapti (yuk e'loni bormi)" };
    case "trial": {
      const loads = source.trial?.loads ?? 0;
      return {
        tone: "warning",
        icon: "🧪",
        label: `Sinovda: ${loads}/${TRIAL_MIN_LOADS} yuk e'loni · ${formatDateTime(source.checkUntil, { timeZone })} gacha`,
        title: `Shu vaqtgacha kamida ${TRIAL_MIN_LOADS} ta yuk e'loni chiqsa — doimiy qo'shiladi, chiqmasa — o'chiriladi.${note ? ` Tekshiruv: ${note}` : ""}`,
      };
    }
    case "ok":
      return { tone: "good", icon: "✅", label: "Sinovdan o'tgan", title: note };
    case "failed":
      return { tone: "critical", icon: "❌", label: source.checkStats?.trial ? "Sinovdan o'tmadi" : "Rad etildi", title: note };
    default:
      return null;
  }
}

// --- Collector'ning Telegram akkauntlari (2026-11-13, yopiq guruhlar uchun) ---
export const MAIN_TG_ACCOUNT = "asosiy"; // @yuk/store tgAccounts.js bilan bir xil
// Holat belgisi: ok — ishlayapti; error — ulanib bo'lmadi (collector o'zi qayta urinadi); logged_out — sessiya bekor
// qilingan yoki fayli yo'q (egasi qayta kirishi kerak); duplicate — boshqa nom bilan ulangan akkauntning o'zi
export function tgAccountView(account) {
  const error = account.error ?? undefined;
  switch (account.status) {
    case "ok":
      return { tone: "good", icon: "✓", label: "Ishlayapti" };
    case "error":
      return { tone: "critical", icon: "!", label: "Ulanib bo'lmadi", title: error, hint: "Collector o'zi qayta urinadi (1 … 30 daqiqada)" };
    case "logged_out":
      return { tone: "critical", icon: "✖", label: "Sessiya yo'q", title: error, hint: reloginHint(account.name) };
    case "duplicate":
      return { tone: "warning", icon: "⚠", label: "Takror", title: error, hint: "Bu boshqa nom bilan ulangan akkauntning o'zi — ishlatilmaydi" };
    default:
      return { tone: "neutral", icon: "…", label: "Noma'lum" };
  }
}

export const loginCommand = (name) => (name === MAIN_TG_ACCOUNT ? "npm run tg:login" : `npm run tg:login -- --account ${name}`);

// Qo'shimcha akkauntga Mini App'dan kiriladi (2026-11-13, apps/web TgAccounts.jsx), asosiysiga — faqat serverda terminaldan
export const MINIAPP_LOGIN = "Mini App → «🛠 Boshqaruv» → «Telegram akkauntlari»";
export function reloginHint(name) {
  if (name === MAIN_TG_ACCOUNT) return `Akkaunt egasi serverda qayta kirsin: ${loginCommand(name)}`;
  return `Akkaunt egasi qayta kirsin: ${MINIAPP_LOGIN} → «🔑 Qayta kirish» (yoki serverda: ${loginCommand(name)})`;
}

// «Yopiq guruh qo'shish» ro'yxati: hali manba bo'lmagan guruh/kanallar, bir guruh bir marta (a'zo akkauntlari bilan),
// yopiqlari birinchi, keyin nomi bo'yicha. query — nomi, @username yoki id bo'yicha qidirish.
// Faqat ishlayotgan (ok) akkauntlarning ro'yxati — sessiyasi yo'q akkaunt guruhni o'qiy olmaydi
export function pickableDialogs(dialogs, accounts, query = "") {
  const working = new Set(accounts.filter((a) => a.status === "ok").map((a) => a.name));
  const words = foldText(query.trim()); // kirill/lotin farqisiz
  const byPeer = new Map();
  for (const d of dialogs) {
    if (d.added || !working.has(d.account)) continue;
    const entry = byPeer.get(d.peerId);
    if (entry) {
      entry.accounts.push(d.account);
      continue;
    }
    byPeer.set(d.peerId, { ...d, accounts: [d.account] });
  }
  const list = [...byPeer.values()].filter((d) => !words || [d.title, d.username ? `@${d.username}` : "", d.peerId].some((v) => foldText(v).includes(words)));
  return list.sort((a, b) => Number(Boolean(a.username)) - Number(Boolean(b.username)) || a.title.localeCompare(b.title));
}

// Tanlangan guruh qanday qo'shiladi: ochig'i — @username (asosiy akkaunt a'zo bo'lmasdan o'qiydi), yopig'i — id va uni
// o'qiydigan akkaunt (asosiy a'zo bo'lsa — asosiy, aks holda birinchi a'zo akkaunt)
export function dialogSource(dialog) {
  if (dialog.username) return { name: `@${dialog.username}`, account: null };
  const account = dialog.accounts.includes(MAIN_TG_ACCOUNT) ? MAIN_TG_ACCOUNT : dialog.accounts[0];
  return { name: dialog.peerId, account };
}

// --- Vaqt ---
// Brauzer o'z vaqt mintaqasini ishlatadi (Toshkent). Testlarda timeZone beriladi.
export function formatTime(ts, { seconds = false, timeZone } = {}) {
  if (ts == null) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined }).format(new Date(ts));
}

// "05.11 14:30"
export function formatDateTime(ts, { timeZone } = {}) {
  if (ts == null) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(ts))
    .replace(",", "");
}

// "hozirgina", "5 daq oldin", "3 soat oldin", "2 kun oldin", bir haftadan eski — sana
export function timeAgo(ts, now = Date.now(), options = {}) {
  if (ts == null) return "—";
  const diff = Math.max(0, now - ts);
  if (diff < MINUTE) return "hozirgina";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} daq oldin`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} soat oldin`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} kun oldin`;
  return formatDateTime(ts, options);
}

// Daqiqalar: 45 → "45 daq", 65 → "1 soat 5 daq", 120 → "2 soat", 1500 → "1 kun 1 soat"
export function durationMin(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} daq`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} soat ${rest} daq` : `${h} soat`;
  }
  const d = Math.floor(m / (24 * 60));
  const h = Math.floor((m % (24 * 60)) / 60);
  return h ? `${d} kun ${h} soat` : `${d} kun`;
}

// Jarayon qancha vaqtdan beri ishlayapti: "12 s", "5 daq", "2 soat 5 daq", "3 kun 4 soat"
export function uptimeText(startedAt, now = Date.now()) {
  if (startedAt == null) return "—";
  const ms = Math.max(0, now - startedAt);
  if (ms < MINUTE) return `${Math.floor(ms / 1000)} s`;
  return durationMin(Math.floor(ms / MINUTE));
}

// «🔎 Auto scan» holati (server: store dialogScanSummary) → { running, text } — akkaunt qatori va «Batafsil» uchun.
// FAQAT topilgan yuk guruhlari sanaladi (2026-11-19, Azimjon: «faqat yuk guruhlarini sana!»): sinovda + o'tgan
export function scanView(scan) {
  if (!scan) return null;
  if (!scan.running && !scan.checked) return { running: false, text: null };
  const found = `${scan.trial + scan.ok} ta yuk guruhi topildi${scan.trial ? ` (${scan.trial} tasi sinovda)` : ""}`;
  const left = Math.max(1, Math.ceil((scan.pending * 30) / 60));
  return { running: scan.running, text: scan.running ? `🔎 Tekshirilyapti (~${left} daq qoldi) · ${found}` : `🔎 ${found}` };
}

// --- Foydalanuvchilar ro'yxati (ixcham qator, 2026-11-16) ---
// Yopiq qatordagi bitta holat belgisi: eng muhimi — o'chirgan > bloklangan > chiqqan > ro'yxatsiz > faol / pauza
export function driverPill(driver, idleSince = null, now = Date.now()) {
  const shown = driverShown(driver);
  if (shown.deleted) return { tone: "critical", icon: "🗑", label: "O'chirgan" };
  if (driver.banned) return { tone: "critical", icon: "🚫", label: "Bloklangan" };
  if (shown.signedOut) return { tone: "warning", icon: "🚪", label: "Chiqqan" };
  if (!driver.profile) return driver.registering ? { tone: "warning", icon: "◷", label: "Ro'yxatda" } : { tone: "neutral", icon: "–", label: "Profilsiz" };
  if (driver.subOk === false) return { tone: "critical", icon: "🔒", label: "A'zo emas" };
  const v = activeView(driver, idleSince, now);
  return { tone: v.tone, icon: v.icon, label: v.label };
}

export const isProDriver = (driver) => driver.plan === "pro" || driver.autoPro === true;

// Filtr tugmalari: id → shart
export const DRIVER_FILTERS = [
  { id: "all", label: "Hammasi", test: () => true },
  { id: "active", label: "Faol", test: (d) => Boolean(d.profile) && d.active && !driverShown(d).deleted },
  { id: "online", label: "Onlayn", test: (d, now) => activityView(d, now).online },
  { id: "pro", label: "Pro", test: (d) => isProDriver(d) },
  { id: "paused", label: "Pauzada", test: (d) => Boolean(d.profile) && !d.active },
  { id: "noprofile", label: "Ro'yxatsiz", test: (d) => !d.profile && !driverShown(d).deleted && !driverShown(d).signedOut },
  { id: "gone", label: "Chiqqan / o'chirgan", test: (d) => driverShown(d).deleted || driverShown(d).signedOut },
];

// Qidiruv: ism, @username, telefon raqami (raqamlari), Telegram ID
export function driverMatches(driver, query) {
  const q = foldText(String(query ?? "").trim().replace(/^@/, "")); // «давронбек» = «Davronbek»
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  const phone = String(driverShown(driver).phone ?? "").replace(/\D/g, "");
  return (
    foldText(driver.name).includes(q) ||
    foldText(driver.username).includes(q) ||
    (digits.length >= 3 && (phone.includes(digits) || String(driver.chatId).includes(digits)))
  );
}

// Yopiq qatordagi ikkinchi satr: «🚚 Haydovchi · Isuzu · 7 tonna» yoki ro'yxatdan qayergacha o'tgani
export function driverLine(driver) {
  const shown = driverShown(driver);
  const role = shown.role ? ROLES[shown.role] : null;
  const p = profileSummary(shown.profile);
  const what = p ? p.vehicle : registrationText(driver);
  return [role ? `${role.icon} ${role.name}` : null, what].filter(Boolean).join(" · ");
}

// Avatar uchun bosh harflar: «GT RUSHSHER» → «GR», ismsiz → username yoki «?»
export function initials(driver) {
  const words = String(driver.name || driver.username || "?").trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
