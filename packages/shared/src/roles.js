// Foydalanuvchi rollari va obuna (bot, haydovchilar serveri va web uchun bitta qoidalar).
//
// Rol — kim nima oladi:
//   haydovchi     — "yuk bor, mashina kerak" e'lonlari (mashinasi va yo'nalishiga mos)
//   yuk_beruvchi  — "mashina bo'sh, yuk kerak" e'lonlari (yuk egasi yoki dispetcher, o'z yo'nalishida)
// Admin — rol emas, qo'shimcha huquq: .env dagi ADMIN_IDS yoki boshqaruv markazida (localhost) yoqilgan belgi.
// Haydovchi suhbati (docs/haydovchi-suhbati.md §6): haydovchilar ish beruvchi bilan to'g'ridan-to'g'ri bog'lanishni xohlaydi.

export const ROLES = {
  haydovchi: {
    icon: "🚚",
    name: "Haydovchi",
    choice: "🚚 Men haydovchiman — yuk kerak", // 2026-11-19: soddaroq (o'qishi qiyin, yoshi kattalar uchun ham)
    gets: "yuk bor e'lonlari (mashinangiz va yo'nalishingizga mos)",
  },
  yuk_beruvchi: {
    icon: "📦",
    name: "Yuk beruvchi",
    choice: "📦 Menda yuk bor — mashina kerak",
    gets: "bo'sh mashina e'lonlari (yo'nalishingiz bo'yicha)",
  },
};
export const ROLE_IDS = Object.keys(ROLES);
export const DEFAULT_ROLE = "haydovchi";

export const validRole = (role) => (ROLE_IDS.includes(role) ? role : null);

// Rol ustuni bo'lmagan eski yozuv: profili bo'lsa — haydovchi (rollardan oldin hamma haydovchi edi)
export const roleOf = (user) => validRole(user?.role) ?? (user?.profile ? DEFAULT_ROLE : null);

// Ilovaning filtri (YukApp, Azimjon 2026-11-26: «filtr bot bilan bir xil, rol va bot masalalari ilovaga aralashmasin»).
// Ilovada rol yo'q — u doim haydovchining sozlamalari bilan ishlaydi: botda haydovchi bo'lsa — o'sha profil (filtr umumiy),
// botda yuk beruvchi / rol tanlamagan / hisobdan chiqqan bo'lsa — yashirilgan haydovchi profili (profiles.haydovchi).
// Bot rolni almashtirganda (switchRole) shu profil o'sha joyga ko'chadi — ilova ham, bot ham bir filtrni ko'radi
export const appProfileOf = (user) => (roleOf(user) === "haydovchi" ? (user?.profile ?? null) : (user?.profiles?.haydovchi ?? null));

// Qaysi turdagi e'lon shu rolga boradi: haydovchi → yuk (loads.kind = "yuk"), yuk beruvchi → mashina
export const ROLE_KIND = { haydovchi: "yuk", yuk_beruvchi: "mashina" };
export const KIND_ROLE = { yuk: "haydovchi", mashina: "yuk_beruvchi" };

// --- Obuna (2026-11-27, Azimjon: «Free, Pro, Max obunalarni joriy qilishimiz kerak») ---
//   free — ochiq guruhlarning matnli e'lonlari (ovozli e'lon yo'q), 30 tagacha guruh tanlash;
//   pro  — + ovozli e'lonlar (AI matnga o'giradi), + O'Z yopiq guruhlari (o'z Telegram akkaunti a'zo bo'lgan yoki o'zi
//          qo'shgan; boshqalarnikini ko'rmaydi), 100 tagacha guruh;
//   max  — + hamma yopiq guruhlar, 300 tagacha guruh, e'lon birinchi bo'lib unga yuboriladi (planRank).
// Obuna faqat boshqaruv markazidan beriladi. Telegram akkaunt ulash — hammaga bepul (avvalgi «avtomatik Pro» bekor:
// ulagan odamning guruhlaridan «🔎 Auto scan» yangi ochiq manbalar topadi — bu bizga foyda; yopig'ini olish — Pro)
export const PLANS = {
  free: { name: "Free", icon: "", maxSources: 30 },
  pro: { name: "Pro", icon: "⭐", maxSources: 100 },
  max: { name: "Max", icon: "💎", maxSources: 300 },
};
export const DEFAULT_PLAN = "free";
export const PLAN_IDS = Object.keys(PLANS);
export const planOf = (user) => (PLAN_IDS.includes(user?.plan) ? user.plan : DEFAULT_PLAN);
// Yuborish tartibi: max → pro → free (bir e'lon ko'p odamga ketsa, har chatga oraliq bor — Max birinchi oladi)
export const planRank = (user) => PLAN_IDS.indexOf(planOf(user));
export const byPlan = (a, b) => planRank(b) - planRank(a);
// Nechta guruh tanlay oladi («📌 Faqat men tanlaydigan guruhlar»)
export const maxFeedSources = (user) => PLANS[planOf(user)].maxSources;

// «Free obunada ko'pi bilan 30 ta guruh tanlash mumkin (Pro — 100, Max — 300)»
export function sourcesLimitText(plan) {
  const id = PLAN_IDS.includes(plan) ? plan : DEFAULT_PLAN;
  const more = PLAN_IDS.slice(PLAN_IDS.indexOf(id) + 1).map((p) => `${PLANS[p].name} — ${PLANS[p].maxSources}`);
  return `${PLANS[id].name} obunada ko'pi bilan ${PLANS[id].maxSources} ta guruh tanlash mumkin${more.length ? ` (${more.join(", ")})` : ""}`;
}

// Yopiq guruh (qo'shimcha Telegram akkaunt o'qiydi): manba nomi raqam (-100…), ochiq guruh esa @nomi.
// Yuk beruvchining o'zi yuborgan yuk (source null yoki "shipper:…") — ochiq
export const isClosedSource = (source) => typeof source === "string" && /^-\d+$/.test(source);

// Ovozli e'lon (ovozli xabar yoki dumaloq video — AI matnga o'girgan; posts.media)
export const isVoiceMedia = (media) => media === "voice" || media === "round";

// Pulli obuna (Pro yoki Max)
export const isPro = (user) => planOf(user) !== "free";
export const isMax = (user) => planOf(user) === "max";

// Shu e'lon shu foydalanuvchiga ko'rsatilsin / yuborilsinmi.
//   source — manba; yopiq guruh: Max — hammasi, Pro — faqat o'ziniki (owners — store.sourceOwners(source): shu guruh
//            «o'ziniki» bo'lgan chat id'lar), Free — yo'q;
//   media  — posts.media: ovozli e'lon faqat Pro/Max.
// Ochiq guruhlarning matnli e'lonlari — hammaga. kind, now — keyingi rejalar uchun
// eslint-disable-next-line no-unused-vars
export function planAllows(user, { kind, now, source = null, owners = null, media = null } = {}) {
  const plan = planOf(user);
  if (isVoiceMedia(media) && plan === "free") return false;
  if (!isClosedSource(source)) return true;
  if (plan === "max") return true;
  if (plan === "free") return false;
  return user?.chatId != null && (owners ?? []).some((id) => Number(id) === Number(user.chatId));
}

// Ro'yxat uchun (web «📋 Yuklar», xarita, botdagi «📋 Mos yuklar»): (source, media) → ko'rsatilsinmi.
// ownersOf(source) — store.sourceOwners; har yopiq guruh bir marta so'raladi
export function planFilter(user, ownersOf) {
  const cache = new Map();
  return (source, media = null) => {
    if (!isClosedSource(source)) return planAllows(user, { source, media });
    if (!cache.has(source)) cache.set(source, ownersOf?.(source) ?? []);
    return planAllows(user, { source, owners: cache.get(source), media });
  };
}

// Loyiha egasi bilan aloqa (2026-11-27, Azimjon: yordamchi javob bera olmasa yoki limit tugasa — «menga bog'lanishi kerak»).
// Bot, yordamchi akkaunt va sayt shu manzilni ko'rsatadi (.env OWNER_USERNAME / OPS_OWNER_USERNAME bilan almashtiriladi)
export const OWNER_CONTACT = "GT_RUSHSHER";

// --- Blok (boshqaruv markazidan; Azimjon, 2026-11-09) ---
// Bloklangan odam botga nima yozsa ham shu javob (bot.js), web/Mini App esa shu matnli ekran (apps/api public.js 403 "blocked")
export const BLOCKED_TEXT = "Uzr, sizga xizmat ko'rsata olmaymiz!";

// --- Admin ---
// adminIds — .env dagi ADMIN_IDS (raqamlar ro'yxati). user.isAdmin — boshqaruv markazida yoqilgan belgi.
export function isAdmin(user, adminIds = []) {
  if (!user) return false;
  return user.isAdmin === true || adminIds.includes(Number(user.chatId));
}

// "123, 456 789" → [123, 456, 789]
export function parseAdminIds(text) {
  return String(text ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isSafeInteger);
}
