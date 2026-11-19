// Haydovchiga yuklar qanday yetkaziladi — «rejim» (Azimjon, 2026-11-14: «yukni kim birinchi olsa, yuk o'shaniki»).
// Profilda: profile.feed = { mode, sources }. Eski profilda feed yo'q — u «saralangan» (avvalgi ish tartibi).
//
//   saralangan      — AI / qoidaviy parser e'lonni tushunadi → yo'nalish va mashina bo'yicha moslaydi (match.js).
//                     Aniq, lekin AI navbati tufayli 1–5 daqiqa (cho'qqi soatlarda undan ham ko'p) kechikadi.
//   tezkor          — AI kutilmaydi: e'lon navbatga tushishi bilan AI'siz tekshiruv («yuk e'loniga o'xshaydimi»,
//                     @yuk/parser looksLikeLoad + aloqa bor) «ha» desa — asl matn darhol ketadi. Hamma guruhlardan.
//                     Faqat chet el (Rossiya, Yevropa…) tilga olingan e'lonlar tashlanadi (yo'nalish doirasi — scope.js).
//   guruhlarim      — tezkor, lekin FAQAT haydovchi tanlagan guruh/kanallardan (sources) — hammasi, filtrsiz.
//                     Maqsad: haydovchi o'sha guruhlarni o'zi kuzatib yurmasin, faqat botni kuzatsin.
//   guruhlarim_plus — tanlaganlaridan hammasi darhol (guruhlarim kabi) + qolgan guruhlardan saralangani (saralangan kabi).
//
// Mashina (vehicle) faqat saralash bor rejimlarda kerak: tezkor va guruhlarimda forma so'ralmaydi (Azimjon tanlovi).
// 2026-11-10/11 o'lchovi (24 soat): tezkor hajmi kuniga ~6 900 e'lon, kunduzi daqiqasiga ~10 ta — shuning uchun
// asosiy tavsiya «guruhlarim» (haydovchi o'zi biladigan 3–5 guruh).

import { REGIONS, REGION_IDS } from "./regions.js";
import { truckFamily } from "./vehicles.js";

export const FEED_MODE_IDS = ["saralangan", "tezkor", "hududim", "guruhlarim", "guruhlarim_plus"];
// Tanlab bo'ladigan rejimlar (2026-11-19, Azimjon: «hamma tezkor rejimda! saralashni olib tashlamoqdamiz!») — bot va ilova
// faqat shularni ko'rsatadi; yangi haydovchi darhol tezkorda. Saralangan / «+ saralangan» — faqat eski profillar uchun ichkarida
// 2026-11-19 (keyinroq, Azimjon: «Rejimda Hamma e'lonlar, Men turgan joydan ketadigan e'lonlar, faqat mening guruhlarimdan
// e'lonlar kelsin»): tezkor — ekranda «🌐 Hamma e'lonlar» (ichki nomi o'zgarmadi), yangi «📍 Mening hududimdan»
// 2026-11-19 (yana keyinroq, Azimjon: «* asosiy yuk yoki quruq gap — shart; ^ transport turi; ^ yuk qayerdan ketishi —
// foydalanuvchi tanlay olsin, tanlamasa filtrsiz; transporti yoki joyi yo'q e'lon hammasiga tushadi»): rejim endi faqat
// MANBA (hamma guruhlar / faqat mening guruhlarim). «Qayerdan» (regions) va «transport» (trucks) — har ikki rejimda ishlaydigan
// ixtiyoriy filtr. Eski «hududim» profil — tezkor + o'sha viloyatlar (feedOf shunday o'qiydi)
export const FEED_MODE_CHOICES = ["tezkor", "guruhlarim"];
export const NEW_DRIVER_FEED_MODE = "tezkor";
// Eski rejim (saralangan / + saralangan) tanlov ro'yxatida yo'q — ekranda tezkor deb ko'rsatiladi
export const choiceMode = (mode) => (FEED_MODE_CHOICES.includes(mode) ? mode : NEW_DRIVER_FEED_MODE);
export const DEFAULT_FEED_MODE = "saralangan";

// icon + name — tugma va ro'yxatlar uchun; about — tanlashda ostidagi bir jumla
export const FEED_MODES = {
  saralangan: {
    icon: "🎯",
    name: "Saralangan",
    about: "Mashinangiz va yo'nalishingizga mos yuklar — AI saralaydi (1–5 daqiqa kechikishi mumkin)",
    vehicle: true,
    groups: false,
    sorted: true,
  },
  tezkor: {
    icon: "🌐",
    name: "Hamma guruhlar",
    about: "Hamma guruhlardagi yuk e'lonlari — darhol",
    vehicle: false,
    groups: false,
    sorted: false,
  },
  // Eski (2026-11-19 kunduzi) rejim — endi tezkor + «📍 Qayerdan» filtri; tanlovda yo'q, feedOf tezkorga aylantiradi
  hududim: {
    icon: "📍",
    name: "Mening hududimdan",
    about: "Siz tanlagan viloyat(lar)dan ketadigan e'lonlar — darhol (joyi aniqlanmagan e'lonlar ham keladi)",
    vehicle: false,
    groups: false,
    regions: true,
    sorted: false,
  },
  guruhlarim: {
    icon: "📌",
    name: "Faqat mening guruhlarim",
    about: "Faqat siz tanlagan guruh va kanallardagi e'lonlar — darhol",
    vehicle: false,
    groups: true,
    sorted: false,
  },
  guruhlarim_plus: {
    icon: "📌",
    name: "Guruhlarim + saralangan",
    about: "Tanlagan guruhlaringizdan hammasi darhol, qolgan guruhlardan — mashinangiz va yo'nalishingizga moslari",
    vehicle: true,
    groups: true,
    sorted: true,
  },
};

// Bir haydovchi nechta guruh tanlay oladi (bot va web ro'yxati shundan katta bo'lmaydi)
// 2026-11-19: 50 → 500 («hammasini tanlash» tugmasi: oddiy foydalanuvchiga ~70, Pro'ga ~85 guruh ko'rinadi)
export const FEED_SOURCES_MAX = 500;

export const validFeedMode = (mode) => (FEED_MODE_IDS.includes(mode) ? mode : null);

// Manba nomi: "@guruh" (ochiq) yoki "-100123…" (yopiq, Telegram id). Solishtirish — kichik harfda
// (posts.source bot o'zi admin bo'lgan guruhda chat.username dan, collector'da sources jadvalidan keladi — harfi farq qilishi mumkin)
const SOURCE_RE = /^(@[A-Za-z][A-Za-z0-9_]{3,31}|-\d{5,20})$/;
export const sourceKey = (name) => String(name ?? "").trim().toLowerCase();
export const validSourceName = (name) => typeof name === "string" && SOURCE_RE.test(name.trim());

// Profildagi rejim → { mode, sources, regions, trucks }. feed yo'q yoki buzilgan — saralangan (eski profillar shunday ishlaydi).
// regions / trucks — filtr (bo'sh = hammasi); eski «hududim» — tezkor + o'sha viloyatlar
export function feedOf(profile) {
  const feed = profile?.feed;
  let mode = validFeedMode(feed?.mode) ?? DEFAULT_FEED_MODE;
  if (mode === "hududim") mode = "tezkor";
  const sources = FEED_MODES[mode].groups && Array.isArray(feed?.sources) ? feed.sources.filter(validSourceName) : [];
  return { mode, sources, regions: validRegions(feed?.regions), trucks: validTrucks(feed?.trucks) };
}

// Viloyat kodlari (regions.js) — takrorsiz, ro'yxat tartibida
const validRegions = (list) => (Array.isArray(list) ? REGION_IDS.filter((id) => list.includes(id)) : []);
export const regionTitle = (id) => REGIONS.find((r) => r.id === id)?.name ?? id;

// «🚚 Transport» filtri — Azimjon aytgan to'rt tur (kuzovsiz: tent/ref farqi yo'q). families — vehicles.js TRUCK_CLASSES oilalari:
// e'londa shu oiladagi mashina tilga olingan bo'lsa (yoki 15 t dan og'ir — fura), e'lon shu turga tegishli
export const TRUCK_FILTERS = [
  { id: "fura", icon: "🚛", name: "Fura", families: ["fura", "mini_fura", "kamaz"] },
  { id: "isuzu", icon: "🚚", name: "Isuzu", families: ["isuzu"] },
  { id: "bongo", icon: "🛻", name: "Bongo / Porter", families: ["kichik"] },
  { id: "labo", icon: "🚐", name: "Labo / Damas", families: ["labo", "yengil_avto"] },
];
export const TRUCK_FILTER_IDS = TRUCK_FILTERS.map((t) => t.id);
const validTrucks = (list) => (Array.isArray(list) ? TRUCK_FILTER_IDS.filter((id) => list.includes(id)) : []);
export const truckFilterTitle = (id) => TRUCK_FILTERS.find((t) => t.id === id)?.name ?? id;
// Transport sinfi (katta_fura, isuzu…) → filtr kodi (fura, isuzu, bongo, labo) yoki null
export function truckFilterOf(truckClass) {
  if (!truckClass) return null;
  const family = truckFamily(truckClass);
  return TRUCK_FILTERS.find((t) => t.families.includes(family))?.id ?? null;
}

// «📍 Qayerdan» filtri: e'lon shu haydovchiga mosmi. origins — e'londan topilgan «qayerdan» viloyatlari.
// Viloyat tanlamagan yoki e'londa joy topilmagan — har doim true (yuk yo'qolmasin)
export function regionWanted(profile, origins) {
  const { regions } = feedOf(profile);
  if (!origins?.length || !regions.length) return true;
  return origins.some((id) => regions.includes(id));
}

// «🚚 Transport» filtri. truckClasses — e'londan topilgan transport sinflari (vehicles.js). Tur tanlamagan yoki e'londa
// mashina aytilmagan (yoki to'rt turdan biriga tushmaydi) — har doim true
export function truckWanted(profile, truckClasses) {
  const { trucks } = feedOf(profile);
  if (!trucks.length) return true;
  const kinds = (truckClasses ?? []).map(truckFilterOf).filter(Boolean);
  if (!kinds.length) return true;
  return kinds.some((id) => trucks.includes(id));
}

// Ikkala filtr birga (tezkor yo'l: fastLook natijasi { origins, trucks })
export const filtersWanted = (profile, look) => regionWanted(profile, look?.origins) && truckWanted(profile, look?.trucks);

export const feedMode = (profile) => feedOf(profile).mode;
// Rejim uchun mashina formasi kerakmi (tezkor va guruhlarimda — yo'q)
export const feedNeedsVehicle = (modeOrProfile) => FEED_MODES[typeof modeOrProfile === "string" ? (validFeedMode(modeOrProfile) ?? DEFAULT_FEED_MODE) : feedMode(modeOrProfile)].vehicle;
export const feedUsesGroups = (modeOrProfile) => FEED_MODES[typeof modeOrProfile === "string" ? (validFeedMode(modeOrProfile) ?? DEFAULT_FEED_MODE) : feedMode(modeOrProfile)].groups;

// Tashqaridan (Mini App, bot tugmalari) kelgan rejim. → { feed } yoki { error, field: "feed" | "groups" }.
// Manbalar faqat ko'rinishi bo'yicha tekshiriladi; ro'yxatda bormi va bu odamga ko'rinadimi — bot va server o'zi qisqartiradi
// (store feedSourceNames). Guruh rejimida kamida bitta guruh kerak — aks holda haydovchiga hech narsa kelmaydi
export function sanitizeFeed(input) {
  if (input == null) return { feed: { mode: DEFAULT_FEED_MODE, sources: [] } };
  if (typeof input !== "object") return { error: "Rejim noto'g'ri", field: "feed" };
  let mode = validFeedMode(input.mode);
  if (!mode) return { error: "Rejimni tanlang", field: "feed" };
  if (mode === "hududim") mode = "tezkor"; // eski ilova / tugma
  // Filtrlar ixtiyoriy: bo'sh — hammasi keladi
  // (bo'sh filtr profilga yozilmaydi — feedOf baribir [] qaytaradi)
  const regions = validRegions(input.regions);
  const trucks = validTrucks(input.trucks);
  const filters = { ...(regions.length ? { regions } : {}), ...(trucks.length ? { trucks } : {}) };
  if (!FEED_MODES[mode].groups) return { feed: { mode, sources: [], ...filters } };
  const seen = new Set();
  const sources = [];
  for (const name of Array.isArray(input.sources) ? input.sources : []) {
    if (!validSourceName(name) || seen.has(sourceKey(name))) continue;
    seen.add(sourceKey(name));
    sources.push(name.trim());
  }
  if (sources.length === 0) return { error: "Kamida bitta guruh yoki kanalni tanlang", field: "groups" };
  if (sources.length > FEED_SOURCES_MAX) return { error: `Ko'pi bilan ${FEED_SOURCES_MAX} ta guruh tanlash mumkin`, field: "groups" };
  return { feed: { mode, sources, ...filters } };
}

// Shu manbadagi e'lon haydovchiga AI'siz, asl matn bilan (darhol) ketadimi: tezkor — har qanday guruhdan,
// guruhlarim / guruhlarim_plus — faqat tanlaganlaridan
export function rawWanted(profile, source) {
  const { mode, sources } = feedOf(profile);
  if (mode === "tezkor") return true; // filtrlar (qayerdan, transport) — filtersWanted
  if (!FEED_MODES[mode].groups) return false;
  const key = sourceKey(source);
  return sources.some((name) => sourceKey(name) === key);
}

// Shu manbadagi e'lonning saralangan (AI / qoidalar → matchLoad) yuki haydovchiga boradimi.
// Tanlagan guruhidagi e'lon u yerga kirmaydi — u allaqachon asl matn bilan ketgan (rawWanted)
export function sortedWanted(profile, source) {
  const { mode } = feedOf(profile);
  return FEED_MODES[mode].sorted && !rawWanted(profile, source);
}

// Haydovchi profili tezkor yo'l bilan biror narsa oladimi (pipeline: qaysi foydalanuvchilarni tezkor yo'lda ko'rish)
export const usesRawFeed = (profile) => feedMode(profile) !== "saralangan";

// Saralangan yuklar (mashina + yo'nalish bo'yicha) shu haydovchiga borishi mumkinmi: rejimida saralash bor VA mashinasi
// kiritilgan. Tezkordan «Saralangan» ga o'tgan yoki «Guruhlarim + saralangan» ni tanlab mashinasini hali yozmagan
// haydovchida vehicle yo'q — unga saralangan yuk bormaydi (matchLoad mashinasiz hammasini «mos» derdi)
export const sortedReady = (profile) => FEED_MODES[feedMode(profile)].sorted && Boolean(profile?.vehicle);

// Ro'yxatdan o'tish tugaganmi: profil bor va rejimga mashina kerak bo'lsa — u ham kiritilgan.
// Bot menyusi shunga qarab «🚚 Ro'yxatdan o'tish» yoki «⚙️ Sozlamalar» ni ko'rsatadi
export const profileReady = (profile) => Boolean(profile) && (!FEED_MODES[feedMode(profile)].vehicle || Boolean(profile.vehicle));

// Mashinasiz rejimdagi (tezkor / guruhlarim) haydovchining profili: mashina, hudud va yo'nalish ishlatilmaydi.
// Oldingi mashinasi bo'lsa — saqlanadi (saralanganga qaytsa, qayta kiritmaydi)
export function rawProfile(feed, prev = null) {
  return {
    vehicle: prev?.vehicle ?? null,
    domestic: prev?.domestic ?? true,
    international: prev?.international ?? false,
    fromAreas: prev?.fromAreas ?? [],
    toAreas: prev?.toAreas ?? [],
    routeAt: prev?.routeAt ?? null,
    mode: "own",
    feed,
  };
}

// Filtrlar matni: «Hammasi» / «Fura, Isuzu»; «Hamma joy» / «Toshkent shahri, Farg'ona viloyati»
export const trucksText = (trucks) => (trucks?.length ? trucks.map(truckFilterTitle).join(", ") : "Hammasi");
export const regionsText = (regions) => (regions?.length ? regions.map(regionTitle).join(", ") : "Hamma joy");

// "🌐 Hamma guruhlar" / "📌 Faqat mening guruhlarim (3 ta guruh) · 🚚 Fura · 📍 Toshkent shahri"
export function feedLabel(profile) {
  const { mode, sources, regions, trucks } = feedOf(profile);
  const m = FEED_MODES[mode];
  const parts = [`${m.icon} ${m.name}${m.groups ? ` (${sources.length} ta guruh)` : ""}`];
  if (trucks.length) parts.push(`🚚 ${trucksText(trucks)}`);
  if (regions.length) parts.push(`📍 ${regionsText(regions)}`);
  return parts.join(" · ");
}

// Forma (eski Mini App yoki bot savol-javobi) rejimni yubormasa — oldingi profildagi rejim qoladi
// (aks holda tezkor haydovchi mashinasini o'zgartirsa, saralanganga tushib qolardi)
export const withPrevFeed = (input, prev) => (input && typeof input === "object" && input.feed === undefined && prev?.feed ? { ...input, feed: prev.feed } : input);
