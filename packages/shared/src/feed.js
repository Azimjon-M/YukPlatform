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

export const FEED_MODE_IDS = ["saralangan", "tezkor", "hududim", "guruhlarim", "guruhlarim_plus"];
// Tanlab bo'ladigan rejimlar (2026-11-19, Azimjon: «hamma tezkor rejimda! saralashni olib tashlamoqdamiz!») — bot va ilova
// faqat shularni ko'rsatadi; yangi haydovchi darhol tezkorda. Saralangan / «+ saralangan» — faqat eski profillar uchun ichkarida
// 2026-11-19 (keyinroq, Azimjon: «Rejimda Hamma e'lonlar, Men turgan joydan ketadigan e'lonlar, faqat mening guruhlarimdan
// e'lonlar kelsin»): tezkor — ekranda «🌐 Hamma e'lonlar» (ichki nomi o'zgarmadi), yangi «📍 Mening hududimdan»
export const FEED_MODE_CHOICES = ["tezkor", "hududim", "guruhlarim"];
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
    name: "Hamma e'lonlar",
    about: "Hamma guruhlardagi e'lonlar — darhol (kuniga minglab xabar)",
    vehicle: false,
    groups: false,
    sorted: false,
  },
  // Siz tanlagan viloyat(lar)dan ketadigan e'lonlar: «qayerdan» AI'siz (qoidaviy parser, ~1 ms) topiladi; topilmasa — baribir
  // yuboriladi (Azimjon tanlovi: yuk yo'qolmasin; 2026-11-19 o'lchovi: e'lonlarning ~72% ida joy topiladi)
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
export const FEED_SOURCES_MAX = 50;

export const validFeedMode = (mode) => (FEED_MODE_IDS.includes(mode) ? mode : null);

// Manba nomi: "@guruh" (ochiq) yoki "-100123…" (yopiq, Telegram id). Solishtirish — kichik harfda
// (posts.source bot o'zi admin bo'lgan guruhda chat.username dan, collector'da sources jadvalidan keladi — harfi farq qilishi mumkin)
const SOURCE_RE = /^(@[A-Za-z][A-Za-z0-9_]{3,31}|-\d{5,20})$/;
export const sourceKey = (name) => String(name ?? "").trim().toLowerCase();
export const validSourceName = (name) => typeof name === "string" && SOURCE_RE.test(name.trim());

// Profildagi rejim → { mode, sources }. feed yo'q yoki buzilgan — saralangan (eski profillar shunday ishlaydi)
export function feedOf(profile) {
  const feed = profile?.feed;
  const mode = validFeedMode(feed?.mode) ?? DEFAULT_FEED_MODE;
  const sources = FEED_MODES[mode].groups && Array.isArray(feed?.sources) ? feed.sources.filter(validSourceName) : [];
  if (!FEED_MODES[mode].regions) return { mode, sources };
  return { mode, sources, regions: validRegions(feed?.regions) };
}

// Viloyat kodlari (regions.js) — takrorsiz, ro'yxat tartibida
const validRegions = (list) => (Array.isArray(list) ? REGION_IDS.filter((id) => list.includes(id)) : []);
export const regionTitle = (id) => REGIONS.find((r) => r.id === id)?.name ?? id;

// «📍 Mening hududimdan»: e'lon shu haydovchiga mosmi. origins — e'londan topilgan «qayerdan» viloyatlari (bo'sh — topilmadi:
// baribir yuboriladi). Boshqa rejimlarda — har doim true
export function regionWanted(profile, origins) {
  const feed = feedOf(profile);
  if (!FEED_MODES[feed.mode].regions) return true;
  if (!origins?.length || !feed.regions.length) return true;
  return origins.some((id) => feed.regions.includes(id));
}

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
  const mode = validFeedMode(input.mode);
  if (!mode) return { error: "Rejimni tanlang", field: "feed" };
  if (FEED_MODES[mode].regions) {
    const regions = validRegions(input.regions);
    if (regions.length === 0) return { error: "Kamida bitta viloyatni tanlang", field: "regions" };
    return { feed: { mode, sources: [], regions } };
  }
  if (!FEED_MODES[mode].groups) return { feed: { mode, sources: [] } };
  const seen = new Set();
  const sources = [];
  for (const name of Array.isArray(input.sources) ? input.sources : []) {
    if (!validSourceName(name) || seen.has(sourceKey(name))) continue;
    seen.add(sourceKey(name));
    sources.push(name.trim());
  }
  if (sources.length === 0) return { error: "Kamida bitta guruh yoki kanalni tanlang", field: "groups" };
  if (sources.length > FEED_SOURCES_MAX) return { error: `Ko'pi bilan ${FEED_SOURCES_MAX} ta guruh tanlash mumkin`, field: "groups" };
  return { feed: { mode, sources } };
}

// Shu manbadagi e'lon haydovchiga AI'siz, asl matn bilan (darhol) ketadimi: tezkor — har qanday guruhdan,
// guruhlarim / guruhlarim_plus — faqat tanlaganlaridan
export function rawWanted(profile, source) {
  const { mode, sources } = feedOf(profile);
  if (mode === "tezkor" || FEED_MODES[mode].regions) return true; // hududim — manba bo'yicha hammasi, viloyat — regionWanted
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

// "⚡ Tezkor" / "📌 Mening guruhlarim (3 ta)"
export function feedLabel(profile) {
  const { mode, sources, regions = [] } = feedOf(profile);
  const m = FEED_MODES[mode];
  if (m.regions) return `${m.icon} ${m.name}${regions.length ? ` (${regions.map(regionTitle).join(", ")})` : ""}`;
  return `${m.icon} ${m.name}${m.groups ? ` (${sources.length} ta guruh)` : ""}`;
}

// Forma (eski Mini App yoki bot savol-javobi) rejimni yubormasa — oldingi profildagi rejim qoladi
// (aks holda tezkor haydovchi mashinasini o'zgartirsa, saralanganga tushib qolardi)
export const withPrevFeed = (input, prev) => (input && typeof input === "object" && input.feed === undefined && prev?.feed ? { ...input, feed: prev.feed } : input);
