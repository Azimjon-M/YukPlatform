// Navbatdagi e'lonlarni oxirigacha olib boradi:
// AI tahlil → har bir yukning kaliti → takror bo'lsa tashlash → bazaga yozish → kanalga joylash → mos haydovchilarga yuborish.
// AI'ga e'lonlar guruh-guruh (batch) beriladi: 10 ta e'lon — bitta so'rov (bepul Gemini'da so'rovlar soni cheklangan).
// Bir nechta AI ulanishi (kalit + model) bo'lsa, guruhlar parallel tahlil qilinadi.
// Telegram va AI tashqaridan beriladi (deps), shuning uchun testda soxtasi qo'yiladi.
import { setTimeout as wait } from "node:timers/promises";
import { extractPhones, fastLook, hasContact, parseByRules, poolFromParser, quickLook } from "@yuk/parser";
import {
  DEFAULT_DEDUPE_WINDOW_MS,
  DEFAULT_ROUTE_SCOPE,
  KIND_MATCHERS,
  KIND_ROLE,
  feedMode,
  filtersWanted,
  regionWanted,
  truckWanted,
  loadKeys,
  isClosedSource,
  planAllows,
  rawWanted,
  routeChosen,
  routeInScope,
  routeText,
  sortedWanted,
  usesRawFeed,
} from "@yuk/shared";

// Tezkor yo'l filtri (@yuk/parser fastLook): «quruq gap»mi, «qayerdan» viloyatlari, transport turlari. Xato — filtrsiz o'tadi
export function lookOf(text) {
  try {
    return fastLook(text);
  } catch {
    return { chatter: false, origins: [], trucks: [] };
  }
}

// E'lon turi → bazadagi kind va kimga boradi (rollar: @yuk/shared roles.js)
//   yuk_bor     → kind "yuk"     → haydovchilarga (matchLoad: mashinasi va yo'nalishi)
//   mashina_bor → kind "mashina" → yuk beruvchilarga (matchTruck: yo'nalishi, kerakli mashina turi)
const POST_KIND = { yuk_bor: "yuk", mashina_bor: "mashina" };

// Aloqasiz e'lon (@yuk/parser hasContact): matnda telefon raqami ham, yozgan odamning username'i («💬 Lichkasi») ham yo'q.
// Haydovchi bunday yuk bilan bog'lana olmaydi (Azimjon, 2026-11-10: «Aloqasiz yuklarni to'xtat»). 2026-11-10 o'lchovi
// (24 soat): AI'ga borgan 11 423 ta e'lonning 5 833 tasi (51%) aloqasiz edi — asosan @XALQARO_YUKLARI va
// @VODIY_BOYLAB_YUKLAR dagi GLogistics / Targo.uz e'lonlari (aloqa — ularning sayti yoki boti orqali).
// Boshqaruv markazi izohni «Aloqasiz» deb taniydi (posts.error shu so'z bilan boshlanadi)
export const NO_CONTACT = "Aloqasiz: telefon raqami ham, lichkasi ham yo'q";

// Ochiq guruhdagi ovozli xabar / dumaloq video (collector media.js): gapirgan odamning username'i ko'pincha yo'q va raqamini
// aytmaydi — aloqa «📄 Asl e'lon» orqali: haydovchi guruhda o'sha xabarni ochib eshitadi va o'sha yerdan yozadi
// (Azimjon, 2026-11-16: «Buni qil»). Yopiq guruhda havola yo'q — haydovchi u yerga a'zo emas, shuning uchun bu istisno yo'q
// Gapirgan odamning Telegram ID'si ham aloqa: bot «💬 Lichkasi» tugmasini tg://user?id= bilan beradi (Azimjon: «raqam
// berilmasa u yuk e'loni emas degani emas! … lichkasi yoki id sidan foydalanib uni chatiga link qo'yish kerak»)
// ID faqat bot taniydigan odam uchun ishlaydi (botga yozgan — drivers jadvalida): begonasini Telegram tugmada
// BUTTON_USER_INVALID bilan rad etadi (2026-11-16 jonli loglarida 89 marta). known(id) — store.getDriver bo'yicha
export const knownUser = (store) => (id) => Boolean(store?.getDriver?.(Number(id)));
export const linkContact = (post, known = () => false) => Boolean(post?.media && (post?.link || (post?.senderId && known(post.senderId))));
const NO_CONTACT_SKIPPED = `${NO_CONTACT} — AI'ga yuborilmadi`;

// Tahlil natijasi tayyor bo'lgan bitta e'lon: yo'nalish doirasi → takrorni tashlash → bazaga yozish → kanal → foydalanuvchilar.
// result — AI natijasi yoki qoidaviy parserniki (result.by === "rules"); bazaga kim tushungani yoziladi (posts.parsed_by).
// deps: { store, publish?(load, post) → kanal xabar id | null, deliver(chatId, load, post, kind, loadId) → { ok, error? } | true/false, windowMs,
//         routeScope — @yuk/shared ROUTE_SCOPES kodi (.env dagi ROUTE_SCOPE; standart "qoshni"),
//         canReceive?(user) → Promise<boolean> — kanal va guruhga a'zomi (bot.js; yo'q bo'lsa — hammaga),
//         requireContact — aloqasiz e'lonning yuklari saqlanmaydi va yuborilmaydi (.env REQUIRE_CONTACT, standart yoqiq),
//         rawSentTo?(postId) → Set<chatId> — kimga bu e'lon asl matn bilan (tezkor yo'l) ketgan yoki ketyapti (createWorker beradi) }
// Haydovchining rejimi (@yuk/shared feed.js): «🎯 Saralangan» — yo'nalish + mashina bo'yicha (avvalgidek). «⚡ Tezkor» /
// «📌 Mening guruhlarim» — o'sha guruhdagi e'lon unga AI'siz, asl matn bilan ketgan (createWorker fast), bu yerda qayta
// yuborilmaydi. AI'siz tekshiruv «yuk emas» degan (looksLikeLoad ~4% ini o'tkazib yuboradi), lekin AI yuk topgan e'lon —
// unga shu yerda, saralangan ko'rinishda, mashina va yo'nalishsiz yetkaziladi: rejimi «shu guruhdagi hamma yuk» degani
// Yuk beruvchining o'z yuki (post.shipper, result.by === "shipper") ham shu yo'ldan o'tadi: takror bo'lsa — yuborilmaydi,
// mos haydovchilarga — darhol. Natijani yuk beruvchiga createWorker yozdiradi (deps.onDirect)
// Saralash o'chiq paytida kimga qaysi guruhdan asl matn ketadi: «📌 Mening guruhlarim» — faqat tanlaganlaridan,
// qolgan hamma (saralangan, tezkor, guruhlarim + saralangan) — hamma guruhdan
export const fastWanted = (profile, source) => (feedMode(profile) === "guruhlarim" ? rawWanted(profile, source) : true);

export async function handleParsed(post, result, deps) {
  const { store, windowMs = DEFAULT_DEDUPE_WINDOW_MS, routeScope = DEFAULT_ROUTE_SCOPE } = deps;
  if (!result.ok) {
    store.finishPost(post.id, "failed", result.error);
    return { status: "failed", error: result.error };
  }
  const by = result.by ?? "ai";
  // "Yuk bor" — haydovchilarga, "mashina bo'sh" — yuk beruvchilarga. Reklama va boshqasi — hech kimga.
  const kind = POST_KIND[result.postType];
  if (!kind || result.loads.length === 0) {
    store.finishPost(post.id, "done", result.postType, by);
    return { status: "skipped", postType: result.postType };
  }

  // Telefon ham, lichka ham yo'q — bog'lanib bo'lmaydi: yuk saqlanmaydi va hech kimga yuborilmaydi.
  // Odatda bunday e'lon AI'gacha yopiladi (createWorker), bu — oxirgi to'siq (masalan, processPost yo'li)
  if (deps.requireContact && post.shipper == null && !post.sender && !linkContact(post, knownUser(store)) && result.loads.every((load) => !load.phones?.length)) {
    store.finishPost(post.id, "done", NO_CONTACT, by);
    return { status: "skipped", reason: "contact", kind };
  }

  // Faqat doiradagi yo'nalishlar (boshlanishiga: O'zbekiston ichi va chegaradosh davlatlar bilan).
  // E'londagi hamma yuk doiradan tashqarida bo'lsa — e'lon izoh bilan yopiladi (boshqaruv markazida ko'rinadi)
  const loads = result.loads.filter((load) => routeInScope(load, routeScope));
  if (loads.length === 0) {
    const routes = [...new Set(result.loads.map(routeText))];
    store.finishPost(post.id, "done", `Boshqa yo'nalish: ${routes.slice(0, 3).join(", ")}${routes.length > 3 ? "…" : ""}`, by);
    return { status: "skipped", reason: "route", kind, outOfScope: result.loads.length };
  }

  // Avval hamma yangi yuklarni bazaga yozamiz, keyin yuboramiz:
  // yuborish o'rtasida dastur to'xtasa ham, o'sha yuk ikkinchi marta yuborilmaydi
  const keys = loadKeys(loads);
  const fresh = [];
  loads.forEach((load, i) => {
    if (store.hasRecentLoad(keys[i], windowMs, kind)) return;
    fresh.push({ id: store.addLoad({ postId: post.id, key: keys[i], load, kind }), load });
  });

  const users = store.activeUsers(KIND_ROLE[kind]);
  const matches = KIND_MATCHERS[kind];
  // Tezkor yo'lda bu e'lonni asl matn bilan olganlar (yoki navbatida turganlar) — ularga yuk qayta yuborilmaydi
  const rawSent = kind === "yuk" && fresh.length ? (deps.rawSentTo?.(post.id) ?? new Set(store.postDeliveredTo?.(post.id) ?? [])) : new Set();
  // Yopiq guruh e'loni — faqat Pro obunadagilarga va guruhni qo'shgan odamga (roles.js planAllows);
  // ochiq kanal va guruh bo'limlariga umuman chiqmaydi
  const closed = post.shipper == null && isClosedSource(post.source);
  const plan = { kind, source: closed ? post.source : null, owner: closed ? (store.sourceOwner?.(post.source) ?? null) : null };
  let sent = 0;
  // Saralash o'chiq (deps.sortingOff, 2026-11-19): guruh e'loni haydovchilarga faqat tezkor yo'l bilan (asl matn) boradi —
  // AI/qoidalar natijasi hech kimga yuborilmaydi (kech keladi). Yuk beruvchining o'z yuki — hammaga, saralanmasdan
  const rawFor = deps.sortingOff ? fastWanted : rawWanted;
  for (const { id, load } of fresh) {
    // Kanal faqat yuklar uchun (va faqat CHANNEL_LOADS=1 bo'lsa — bot.js publish)
    const channelMessageId = kind === "yuk" && !closed ? ((await deps.publish?.(load, post)) ?? null) : null;
    let count = 0;
    for (const user of users) {
      if (kind === "yuk" && deps.sortingOff && post.shipper == null) break;
      // «📍 Qayerdan» va «🚚 Transport» filtrlari — yuk beruvchining o'z yukida ham
      if (kind === "yuk" && !regionWanted(user.profile, load.fromRegion ? [load.fromRegion] : [])) continue;
      if (kind === "yuk" && !truckWanted(user.profile, load.truckClass ? [load.truckClass] : [])) continue;
      if (kind === "yuk" && rawFor(user.profile, post.source)) {
        // Shu guruhdagi hamma yuk unga kerak (tezkor / guruhlarim): asl matn bilan olgan bo'lsa — bo'ldi,
        // olmagan bo'lsa (AI'siz tekshiruv o'tkazib yuborgan, yuk beruvchining o'z yuki) — mashina va yo'nalishsiz, shu yerda
        if (rawSent.has(user.chatId)) continue;
      } else {
        // «Mening guruhlarim» (faqat) — boshqa guruhlardan hech narsa; «+ saralangan» va «Saralangan» — mos bo'lsa
        if (kind === "yuk" && !sortedWanted(user.profile, post.source)) continue;
        // Mashinasi kiritilmagan (tezkordan «Saralangan» ga o'tgan, hali yozmagan) — saralab bo'lmaydi
        if (kind === "yuk" && !user.profile?.vehicle) continue;
        // Haydovchi yo'nalishni («📋 Mos yuklar» da) tanlamaguncha yuk yuborilmaydi — aks holda butun O'zbekistondagi yuklar
        if (kind === "yuk" && !routeChosen(user.profile)) continue;
        if (!matches(load, user.profile).ok) continue;
      }
      // Obuna: yopiq guruh e'loni — faqat Pro (roles.js planAllows)
      if (!planAllows(user, plan)) continue;
      // Kanal va guruhimizga a'zo emas — yuborilmaydi (bot.js canReceive o'zi kuniga bir marta «a'zo bo'ling» deb eslatadi)
      if (deps.canReceive && !(await deps.canReceive(user))) continue;
      // deliver → { ok, error } (bot.js) yoki true/false. Har biri yoziladi: boshqaruv markazida kim qancha yuk olgani ko'rinadi
      const outcome = await deps.deliver(user.chatId, load, post, kind, id); // id — «📞 Telefon qilish» tugmasi uchun
      const ok = outcome === true || outcome?.ok === true;
      store.addDelivery?.({ loadId: id, chatId: user.chatId, ok, error: ok ? null : (outcome?.error ?? null) });
      if (ok) count++;
    }
    store.setLoadDelivery(id, { sentTo: count, channelMessageId });
    sent += count;
  }
  store.finishPost(post.id, "done", null, by);
  return { status: "done", kind, loads: loads.length, outOfScope: result.loads.length - loads.length, fresh: fresh.length, sent };
}

// AI'siz qoidaviy parser (@yuk/parser src/rules): e'lonni to'liq tushunsa — handleParsed uchun natija, aks holda null.
// 2026-11-09 sinovi (6 813 e'lon): 35% e'lon shu yo'l bilan hal bo'ladi, yo'nalish AI bilan 98% bir xil
export function ruleParse(text) {
  const r = parseByRules(text);
  return r.confident ? { ok: true, postType: r.postType, loads: r.loads } : null;
}

// Bitta e'lon: AI (alohida so'rov) + handleParsed.
// AI xatosi (limit, tarmoq) bu yerda ushlanmaydi — uni worker hal qiladi (kutadi yoki keyinroq qayta urinadi).
export async function processPost(post, deps) {
  return handleParsed(post, await deps.parser.parse(post.text), deps);
}

// Pauza matni: "45 s", "12 daq", "13:00 gacha"
function pauseText(ms, now) {
  if (ms < 2 * 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} daq`;
  const until = new Date(now + ms).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
  return `${until} gacha`;
}

// Vaqt matni: 3 soat → "3 soat", 1,5 soat → "1,5 soat", yarim soat → "30 daqiqa"
function formatHours(ms) {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)} daqiqa`;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace(".", ",")} soat`;
}

// Navbatni doimiy o'qib turadigan ishchi.
//
// AI bosqichi PARALLEL: har bir bo'sh AI ulanishi (kalit + model) navbatdan o'z guruhini oladi.
// Biri limitga tushsa, o'sha dam oladi, qolganlari ishlayveradi (deps.pool — @yuk/parser createParserPool).
// Yuborish bosqichi KETMA-KET: kanal va haydovchilarga xabarlar bittalab ketadi (Telegram limitlari, kanal tartibi).
//
// deps.pool yoki deps.parser (bitta parser — eski usul, testlar va --dry-run).
// batch — bitta AI so'rovidagi e'lonlar soni (standart: .env dagi PARSER_BATCH).
// fillWaitMs — navbatda batch'dan kam e'lon bo'lsa, eng eski e'lon NAVBATGA TUSHGANIDAN shuncha vaqt o'tguncha yana
// yig'ilishini kutamiz (standart: PARSER_BATCH_WAIT). Aks holda navbat bo'sh paytda har 5 soniyada 1–2 ta e'lon
// uchun so'rov ketadi va batch limitni tejamaydi.
// Nega joylangan vaqt (postedAt) emas: e'lon navbatga o'rtacha 40 s kechikib tushadi, 60 s lik kutish amalda ~20 s
// bo'lib qolardi va so'rovga o'rtacha 4–5 ta e'lon ketardi (kunlik bepul limit 21:20 da tugagan).
// liveWaitMs — jonli kelgan e'lon (via = "live", collector akkaunti a'zo bo'lgan guruhdan ~1 s da) uchun qisqa kutish
// (standart: PARSER_LIVE_WAIT, 30 s): guruh to'lishini 90 s kutsak, jonli rejimning foydasi yo'qoladi.
// Guruhdagi har e'lonning o'z muddati bor; birortasiniki o'tsa — guruh ketadi (qolganlari unga qo'shilib ketadi).
// maxParallel — bir vaqtda nechta AI so'rovi (standart: .env dagi PARSER_PARALLEL yoki 8).
// Yuk beruvchining o'z yuki (post.direct — tayyor yuklar, «📦 Yuk berish»: web forma yoki botga yozilgan matn) AI'ga
// bormaydi va eskirmaydi: quick() uni birinchi bo'lib yuborish navbatiga qo'yadi. Yuborib bo'lgach —
// deps.onDirect(post, outcome) (bot.js: yuk beruvchiga «✅ N ta haydovchiga yuborildi»). poke() — kutmasdan darhol ko'rish.
// deps.rules(text) → natija | null — AI'siz qoidaviy parser (main.js: @yuk/parser parseByRules). Har yangi e'lon avval
// shundan o'tadi: ishonchli bo'lsa — AI'ni kutmasdan darhol yuborishga ketadi (AI limiti ham tejaladi), null bo'lsa —
// e'lon navbatda qoladi va AI oladi. deps.rules yo'q bo'lsa (RULE_PARSER=0, testlar) — hammasi AI'da, avvalgidek.
// deps.requireContact — aloqasiz e'lon (telefon ham, lichka ham yo'q) qoidaviy parserga ham, AI'ga ham bormaydi:
// navbatga tushishi bilan «Aloqasiz» deb yopiladi (yuqorida NO_CONTACT). Yo'q bo'lsa (REQUIRE_CONTACT=0, testlar) — avvalgidek.
// maxAgeMs — joylanganiga shundan ko'p vaqt o'tgan e'lon AI'ga bormaydi, "Eskirgan" deb yopiladi (0 — cheklovsiz;
// bot .env dagi POST_MAX_AGE_HOURS ni beradi, standart 3 soat). Yukni odatda bir soat ichida olib bo'lishadi:
// kechagi e'lonni "yangi yuk" deb kanalga chiqarish haydovchini chalg'itadi va bepul AI limitini behuda yeydi.
//
// Tezkor yo'l (haydovchi rejimi «⚡ Tezkor» / «📌 Mening guruhlarim», @yuk/shared feed.js; Azimjon, 2026-11-14: «yukni kim
// birinchi olsa, yuk o'shaniki»): navbatga tushgan har e'lon quick() da AI'siz tekshiriladi (@yuk/parser quickLook, ~2 ms)
// va «yuk e'loni» bo'lsa — shu guruhni kutayotgan haydovchilarga asl matn bilan darhol ketadi (deps.deliverRaw).
// Saralangan yo'l bunga tegmaydi: e'lon keyin odatdagidek (qoidalar yoki AI) tahlil qilinadi va saralangan rejimdagilarga boradi.
// deps.deliverRaw(chatId, post, { phones }) → { ok, error? } | true/false — yo'q bo'lsa (testlar, eski main.js) tezkor yo'l o'chiq.
// fastMs — quick() necha ms da bir ishlaydi (standart 1 s; avval asosiy aylanish bilan 5 s gacha kutardi).
// rawMaxAgeMs — joylanganiga shundan ko'p vaqt o'tgan e'lon tezkor yo'lga kirmaydi (bot qayta yoqilganda navbatdagi
// eski e'lonlar bir to'da bo'lib «yangi» deb kelmasin; standart 30 daqiqa).
export function createWorker(
  deps,
  { idleMs = 5000, fastMs = 1000, rawMaxAgeMs = 30 * 60_000, batch, fillWaitMs, liveWaitMs, log = console.log, now = Date.now, maxParallel, maxAgeMs = 0 } = {},
) {
  const { store } = deps;
  const contactOf = (post) => hasContact(post) || linkContact(post, knownUser(store));
  const pool = deps.pool ?? poolFromParser(deps.parser);
  const size = batch ?? pool.batchSize ?? 10;
  const fillWait = fillWaitMs ?? pool.batchWaitMs ?? 90_000;
  const liveWait = liveWaitMs ?? pool.liveWaitMs ?? 30_000;
  const parallel = maxParallel ?? (Math.floor(Number(process.env.PARSER_PARALLEL)) || 8);
  const controller = new AbortController();
  const sleep = (ms) => wait(ms, undefined, { signal: controller.signal }).catch(() => {});

  const claimed = new Set(); // AI'da yoki yuborish navbatida turgan e'lonlar — ikkinchi marta olinmaydi
  const bounces = new Map(); // e'lon id → necha marta noma'lum AI xatosi bilan navbatga qaytgan (settle)
  const MAX_BOUNCES = 3;
  let delivery = Promise.resolve(); // yuborish zanjiri (ketma-ket)
  let waiting = 0; // AI'dan o'tib, yuborilishini kutayotgan e'lonlar
  const tag = (lease) => (pool.size() > 1 ? ` [${lease.label}]` : "");

  // Uyg'onadigan uyqu: bitta AI ishini tugatsa, rejalovchi kutmasdan keyingisini boshlaydi
  let wake = () => {};
  function nap(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", done);
        wake = () => {};
        resolve();
      }
      wake = done;
      controller.signal.addEventListener("abort", done);
    });
  }

  // Eskirgan e'lonlarni yopish. Daqiqada bir martadan ko'p emas: har 5 soniyada bazaga yozish shart emas,
  // bir daqiqalik farq esa 3 soatlik chegarada sezilmaydi.
  const ageText = `${formatHours(maxAgeMs)}dan oshgan`;
  let expiredAt = -Infinity;
  function expire() {
    if (!(maxAgeMs > 0) || now() - expiredAt < 60_000) return;
    expiredAt = now();
    const error = `Eskirgan: joylanganiga ${ageText}, AI'ga yuborilmadi`;
    const count = store.expireOldPosts({ before: now() - maxAgeMs, error, exclude: [...claimed] });
    if (count) log(`${count} ta e'lon eskirgan (joylanganiga ${ageText}) — AI'ga yuborilmadi`);
  }

  // Aloqasiz e'lon — darhol yopiladi (AI so'rovi ham, qoidaviy parser ham kerak emas). true — yopildi
  let noContactCount = 0;
  function contactless(post) {
    if (!deps.requireContact || contactOf(post)) return false;
    store.finishPost(post.id, "done", NO_CONTACT_SKIPPED);
    noContactCount++;
    return true;
  }

  // --- Tezkor yo'l: asl matn, AI'siz ---
  // rawPending — yuborish navbatidagi tezkor xabarlar (e'lon id → chat id'lar). handleParsed ularni «olgan» deb biladi:
  // aks holda qoidaviy parser 3 ms da tushungan e'lon tezkor xabar yetib bormasdan saralangan ko'rinishda ham ketardi
  const rawPending = new Map();
  // Har haydovchining O'Z navbati (2026-11-19): avval bitta umumiy zanjir edi — bot.js bir chatga 1,1 s oraliq qo'ygani uchun
  // bir haydovchining navbati hammanikini ushlab, 2 daqiqalik tirbandlik bo'lgan (pauzadan keyin ham 111 ta e'lon ketgan)
  const rawQueues = new Map(); // chatId → oxirgi yuborish va'dasi
  const rawAll = new Set(); // hali tugamagan yuborishlar (runOnce / stop kutadi)
  const RAW_STALE_MS = 5 * 60_000; // navbatda shundan ko'p turib qolgan e'lon endi yuborilmaydi
  let rawCount = 0;
  const rawSentTo = (postId) => new Set([...(store.postDeliveredTo?.(postId) ?? []), ...(rawPending.get(postId) ?? [])]);
  const handleDeps = { ...deps, rawSentTo };
  const scope = deps.routeScope ?? DEFAULT_ROUTE_SCOPE;

  // Tezkor yo'ldan nimadir oladigan faol haydovchilar (quick() da yangi e'lon bo'lsagina so'raladi)
  // Saralash o'chiq (deps.sortingOff; Azimjon 2026-11-19: «algoritmni noaktiv qil. Bizga tezlik kerak sifat emas!
  // … bot chati yonib ketsa ham e'lonlarni uchirib tashlaydigan qil») — hamma faol haydovchi tezkor yo'lda, filtrsiz:
  // «yuk e'lonimi» (quickLook), chet el yo'nalishi va aloqa tekshiruvi yo'q. Qoladi: 30 daqiqadan eski emas, takror emas
  // (collector dedupe), yopiq guruh — faqat Pro, kanal/guruhga a'zolik (canReceive)
  const fastAll = Boolean(deps.sortingOff);
  const wantedFn = fastAll ? fastWanted : rawWanted;
  const rawUsers = () => (deps.deliverRaw ? store.activeUsers("haydovchi").filter((u) => fastAll || usesRawFeed(u.profile)) : []);

  // Bitta e'lon: kimga kerak (rejim + guruh) → yuk e'lonimi (AI'siz) → tezkor rejimda chet el emasmi → yuborish navbatiga
  function fast(post, users) {
    if (!users.length || post.shipper != null || !(post.postedAt >= now() - rawMaxAgeMs) || (!fastAll && !contactOf(post))) return;
    // Filtr (2026-11-19, Azimjon): «quruq gap» — hech kimga (shart); «🚚 Transport» va «📍 Qayerdan» — haydovchi tanlagan
    // bo'lsa. Bitta qoidaviy tahlil (~3 ms, AI'siz); e'londa transport yoki joy topilmasa — o'sha filtrdan o'tadi
    const look = lookOf(post.text);
    if (look.chatter) return;
    const wanted = users.filter((u) => wantedFn(u.profile, post.source) && filtersWanted(u.profile, look));
    if (!wanted.length) return;
    let quick = { load: true, outOfScope: false };
    if (!fastAll) {
      try {
        quick = quickLook(post.text, { scope });
      } catch (error) {
        log(`#${post.id}: tezkor tekshiruv xatosi — ${error.message}`);
        return;
      }
      if (!quick.load) return;
    }
    // «⚡ Tezkor» (hamma guruh) — chet el (Rossiya, Yevropa…) yo'nalishi tashlanadi; o'zi tanlagan guruhdan esa hammasi.
    // Bot qayta yoqilgan bo'lsa — bazada «yuborilgan» deb turganlarga ikkinchi marta emas
    const already = new Set(store.postDeliveredTo?.(post.id) ?? []);
    const targets = wanted.filter((u) => !already.has(u.chatId) && !(quick.outOfScope && feedMode(u.profile) === "tezkor"));
    if (!targets.length) return;
    rawPending.set(post.id, new Set(targets.map((u) => u.chatId)));
    const phones = extractPhones(post.text);
    const closed = isClosedSource(post.source);
    const plan = { kind: "yuk", source: closed ? post.source : null, owner: closed ? (store.sourceOwner?.(post.source) ?? null) : null };
    let count = 0;
    let left = targets.length;
    const queuedAt = now();
    const sendTo = async (user) => {
      if (controller.signal.aborted) return;
      try {
        if (!planAllows(user, plan)) return; // yopiq guruh — faqat Pro
        if (deps.held?.(user.chatId)) return; // sozlash oynasi ochiq (bot.js isBusy) — shu e'lon unga yuborilmaydi
        if (now() - queuedAt > RAW_STALE_MS) return; // navbatda eskirdi
        // Navbatda turgan paytda holati o'zgargan bo'lishi mumkin (2026-11-19 tiket: pauzadan keyin ham kelaverdi) —
        // yuborishdan oldin bazadan yangisini o'qiymiz: pauza, hisob o'chirilgan, rol yoki rejim/guruh/viloyat o'zgargan
        const fresh = store.getDriver?.(user.chatId) ?? user;
        if (!fresh || fresh.active === false || fresh.deletedAt != null || fresh.role !== "haydovchi") return;
        if (!wantedFn(fresh.profile, post.source)) return;
        if (!filtersWanted(fresh.profile, look)) return;
        if (deps.canReceive && !(await deps.canReceive(fresh))) return;
        const outcome = await deps.deliverRaw(user.chatId, post, { phones });
        const ok = outcome === true || outcome?.ok === true;
        store.addPostDelivery?.({ postId: post.id, chatId: user.chatId, ok, error: ok ? null : (outcome?.error ?? null) });
        if (ok) count++;
      } catch (error) {
        log(`#${post.id}: tezkor xabar yuborilmadi (${user.chatId}) — ${error.description ?? error.message}`);
      } finally {
        rawPending.get(post.id)?.delete(user.chatId);
        if (--left === 0) {
          rawPending.delete(post.id);
          rawCount += count;
          if (count) log(`#${post.id} ${post.source}: ⚡ ${count} ta haydovchiga asl matn bilan (AI'siz, ${Math.round((now() - (post.queuedAt ?? post.postedAt)) / 1000)} s)`);
        }
      }
    };
    for (const user of targets) {
      const job = (rawQueues.get(user.chatId) ?? Promise.resolve()).then(() => sendTo(user));
      rawQueues.set(user.chatId, job);
      rawAll.add(job);
      job.finally(() => {
        rawAll.delete(job);
        if (rawQueues.get(user.chatId) === job) rawQueues.delete(user.chatId);
      });
    }
  }

  // Tez yo'l: navbatga yangi tushgan e'lonlar qoidaviy parserdan o'tadi (~2 ms). Ishonchlisi — darhol yuborishga,
  // qolgani navbatda AI'ni kutadi. ruleCursor — qaysi e'longacha ko'rib bo'lindi (har e'lon bir marta tekshiriladi).
  // AI hammasi dam olayotganda ham ishlaydi: kunlik limit tugasa ham oddiy yuklar haydovchilarga ketaveradi.
  let ruleCursor = 0;
  let ruleCount = 0;
  // Aloqasiz e'lonlar ham shu yerda (qoidaviy parserdan oldin) yopiladi.
  function quick() {
    let handled = 0;
    let users = null; // tezkor yo'l oluvchilari — faqat yangi e'lon bo'lsa so'raladi
    for (;;) {
      const posts = store.takeNewPostsAfter(ruleCursor, 50);
      const ready = [];
      const results = [];
      if (posts.length && users == null) users = rawUsers();
      for (const post of posts) {
        ruleCursor = Math.max(ruleCursor, post.id);
        if (claimed.has(post.id)) continue; // AI allaqachon olgan
        // Yuk beruvchining o'zi yuborgan yuk — tayyor, tekshirilgan: AI ham, qoidaviy parser ham kerak emas
        if (post.direct) {
          claimed.add(post.id);
          ready.push(post);
          results.push({ ok: true, postType: "yuk_bor", loads: post.direct, by: "shipper" });
          continue;
        }
        if (maxAgeMs > 0 && post.postedAt < now() - maxAgeMs) continue; // eskirgan — expire() yopadi
        // Saralash o'chiq — aloqasiz e'lon ham haydovchiga ketadi (keyin AI'ga bormasdan yopiladi)
        if (fastAll) fast(post, users);
        if (contactless(post)) continue;
        // Tezkor rejimdagilarga asl matn — AI'ni ham, qoidaviy parserni ham kutmasdan (e'lon o'zi navbatda qoladi)
        if (!fastAll) fast(post, users);
        if (!deps.rules) continue; // aloqasi bor — AI kutadi
        let result = null;
        try {
          result = deps.rules(post.text);
        } catch (error) {
          log(`#${post.id}: qoidaviy parser xatosi — ${error.message} (AI tahlil qiladi)`);
        }
        if (!result) continue;
        claimed.add(post.id);
        ready.push(post);
        results.push({ ...result, by: "rules" });
      }
      if (ready.length) deliver(ready, results);
      handled += ready.length;
      if (posts.length < 50) break;
    }
    ruleCount += handled;
    return handled;
  }

  // Navbatdan bir guruh (eng yangilari, boshqa AI olganlaridan tashqari). Guruh to'lmagan va yangi bo'lsa — [] (kutamiz)
  // lease.batchSize — ulanishning o'z chegarasi (1pro: 6 ta), umumiy o'lchamdan katta bo'lmaydi
  function take(fill, lease, live = Math.min(liveWait, fill)) {
    const n = Math.min(size, lease?.batchSize || size);
    // quick() aloqasizlarni odatda oldinroq yopadi; bu — o'rtada kelib qolgani uchun (collector boshqa jarayon)
    // Yuk beruvchining yuki (direct) — AI'ga emas, quick() ga (u keyingi aylanishda oladi)
    const posts = store.takeNewPosts(n, { newest: true, exclude: [...claimed] }).filter((post) => !post.direct && !contactless(post));
    if (posts.length === 0) return [];
    if (posts.length < n && fill > 0) {
      // Eng erta tugaydigan muddat: jonli e'lon — navbatga tushganidan live ms, qolganlari — fill ms
      const due = Math.min(...posts.map((p) => (p.queuedAt ?? p.postedAt) + (p.via === "live" || p.via === "tops" ? Math.min(live, fill) : fill)));
      if (now() < due) return [];
    }
    for (const post of posts) claimed.add(post.id);
    return posts;
  }

  // AI: guruh bitta so'rovda. → { results, pause?, error? }.
  // pause — ulanish limitga tushdi / band: results'dan keyingi e'lonlar navbatga qaytadi (boshqa AI yoki keyinroq oladi).
  async function analyse(lease, posts) {
    const { parser } = lease;
    if (posts.length > 1 && parser.parseBatch) {
      try {
        const results = await parser.parseBatch(posts.map((p) => p.text));
        const fallback = results.filter((r) => r.fallback);
        if (fallback.length) log(`AI${tag(lease)}: javob yaroqsiz (${fallback[0].fallback}) — ${fallback.length} ta e'lon bo'linib qayta yuborildi`);
        else log(`AI${tag(lease)}: ${posts.length} ta e'lon bitta so'rovda`);
        return { results };
      } catch (error) {
        const pause = lease.fail(error);
        if (pause) return { results: [], pause, error };
        // Kutilmagan xato — har bir e'lon alohida so'rov bilan, xatosi o'ziga yoziladi
        log(`AI${tag(lease)} guruh xatosi: ${lease.describe(error)} — e'lonlar bittadan tahlil qilinadi`);
      }
    }
    const results = [];
    for (const post of posts) {
      if (controller.signal.aborted) break;
      try {
        results.push(await parser.parse(post.text));
      } catch (error) {
        const pause = lease.fail(error);
        if (pause) return { results, pause, error };
        results.push({ ok: false, error: lease.describe(error) });
      }
    }
    return { results };
  }

  // AI xato qaytarsa, natijasi yo'q e'lonlar navbatga qaytadi va boshqa ulanish ularni darhol oladi.
  // Lekin noma'lum xato (500, 400...) e'lonning o'zidan bo'lishi ham mumkin: bitta e'lon 3 marta shunday qaytsa —
  // cheksiz aylanmasin, "failed" bo'ladi (boshqaruv markazining «Navbat» bo'limida qayta yuborish mumkin).
  // Limit, band, internet — ulanishning muammosi, ular sanalmaydi.
  function settle(lease, posts, outcome) {
    const results = [...outcome.results];
    if (outcome.pause?.reason !== "error") return results;
    posts.forEach((post, i) => {
      if (i < outcome.results.length) return;
      const count = (bounces.get(post.id) ?? 0) + 1;
      bounces.set(post.id, count);
      if (count >= MAX_BOUNCES) results[i] = { ok: false, error: `${count} ta AI ulanishida xato: ${lease.describe(outcome.error)}` };
    });
    return results;
  }

  // Yuborish: takror → baza → kanal → haydovchilar, bittalab. Natijasi yo'q e'lonlar darhol navbatga qaytadi.
  // results[i] — posts[i] ning natijasi; bo'sh joy — e'lon navbatga qaytadi
  function deliver(posts, results) {
    const ready = [];
    posts.forEach((post, i) => (results[i] ? ready.push([post, results[i]]) : claimed.delete(post.id)));
    waiting += ready.length;
    delivery = delivery.then(async () => {
      for (const [post, result] of ready) {
        bounces.delete(post.id);
        let outcome = null;
        try {
          // To'xtatilsa — qolganlari "new" bo'lib qoladi va keyingi safar qayta tahlil qilinadi
          if (controller.signal.aborted) continue;
          outcome = await handleParsed(post, result, handleDeps);
          if (outcome.status === "done") {
            const other = outcome.outOfScope ? ` (+${outcome.outOfScope} tasi boshqa yo'nalish)` : "";
            const [what, whom] = outcome.kind === "mashina" ? ["bo'sh mashina", "yuk beruvchiga"] : ["yuk", "haydovchiga"];
            const fast = result.by === "rules" ? " ⚡ AI'siz" : result.by === "shipper" ? " 📦 yuk beruvchidan" : "";
            log(`#${post.id} ${post.source}: ${outcome.fresh}/${outcome.loads} yangi ${what}${other}, ${outcome.sent} ta ${whom}${fast}`);
          }
          else if (outcome.status === "failed") log(`#${post.id}: xato — ${outcome.error}`);
        } catch (error) {
          const message = error.description ?? error.message;
          log(`#${post.id}: yuborishda xato — ${message}`);
          store.finishPost(post.id, "failed", message);
          outcome = { status: "failed", error: message };
        } finally {
          claimed.delete(post.id);
          waiting--;
        }
        // Yuk beruvchiga natija (nechta haydovchiga ketdi). Uning xatosi yuborish navbatini to'xtatmasin
        if (post.shipper != null && outcome) {
          try {
            await deps.onDirect?.(post, outcome);
          } catch (error) {
            log(`#${post.id}: yuk beruvchiga natija yozilmadi — ${error.description ?? error.message}`);
          }
        }
      }
    });
    return delivery;
  }

  // Bitta guruh, ketma-ket (testlar va --dry-run): AI → yuborish. Ulanish limitga tushsa — shu yerda kutadi.
  // → olingan e'lonlar soni (0 — ish yo'q yoki bo'sh ulanish yo'q).
  async function runOnce({ fillWaitMs: fill = 0, liveWaitMs: live = fill } = {}) {
    expire();
    const quickCount = quick();
    while (rawAll.size) await Promise.allSettled([...rawAll]);
    if (quickCount) await delivery;
    const lease = pool.acquire();
    if (!lease) return quickCount;
    const posts = take(fill, lease, live);
    if (posts.length === 0) {
      lease.release();
      return quickCount;
    }
    let outcome = { results: [] };
    try {
      outcome = await analyse(lease, posts);
    } finally {
      lease.release({ posts: outcome.results.length });
    }
    await deliver(posts, settle(lease, posts, outcome));
    if (outcome.pause) {
      log(`AI vaqtincha ishlamayapti${tag(lease)}: ${lease.describe(outcome.error)} — ${Math.round(outcome.pause.ms / 1000)} s kutamiz`);
      await sleep(outcome.pause.ms);
    }
    return quickCount + posts.length;
  }

  // Bitta AI ulanishining ishi (parallel): tahlil → natijani yuborish navbatiga.
  // Xato bo'lsa — ulanish dam oladi, e'lonlari darhol navbatga qaytadi va rejalovchi ularni boshqa ulanishga beradi
  async function lane(lease, posts) {
    let outcome = { results: [] };
    try {
      outcome = await analyse(lease, posts);
    } finally {
      lease.release({ posts: outcome.results.length });
      deliver(posts, settle(lease, posts, outcome));
    }
    if (outcome.pause) {
      const back = posts.length - outcome.results.length;
      const moved = back && pool.size() > 1 ? `${back} ta e'lon boshqa AI'ga o'tdi, ` : "";
      log(`AI${tag(lease)}: ${lease.describe(outcome.error)} — ${moved}o'zi ${pauseText(outcome.pause.ms, now())} dam oladi`);
      if (outcome.pause.flagged) log(`⚠ AI${tag(lease)} «muammoli» deb belgilandi (tez-tez xato) — endi oxirgi navbatda ishlatiladi`);
    }
  }

  return {
    runOnce,
    // Yuk beruvchi yuk yubordi — ishchi uyqudan darhol uyg'onadi (aks holda 5 s gacha kutardi)
    poke() {
      wake();
    },
    async start() {
      const lanes = new Set();
      let notice = null; // bir xil ogohlantirish qayta-qayta yozilmasin
      const say = (key, message) => {
        if (notice !== key) log(message);
        notice = key;
      };
      const count = pool.size();
      log(count ? `AI: ${count} ta ulanish, bir vaqtda ${Math.min(count, parallel)} tagacha so'rov` : "AI: ulanish yo'q");
      if (deps.rules) log("Qoidaviy parser yoqiq: oddiy e'lonlar AI'siz, darhol yuboriladi (.env: RULE_PARSER=0 — o'chirish)");
      if (deps.requireContact) log("Aloqasiz e'lonlar (telefon ham, lichka ham yo'q) AI'ga ham, foydalanuvchilarga ham yuborilmaydi (.env: REQUIRE_CONTACT=0 — o'chirish)");
      // quick() — o'z taymerida, har fastMs da (asosiy aylanish AI'ni kutib uxlab yotganda ham): tezkor yo'l va
      // qoidaviy parser yangi e'lonni ~1 s ichida ko'radi
      if (deps.deliverRaw) log(`Tezkor yo'l yoqiq: yangi e'lonlar har ${fastMs / 1000} s da ko'riladi, «⚡ Tezkor» / «📌 Guruhlarim» rejimidagilarga AI'siz ketadi`);
      const fastTimer = setInterval(() => {
        try {
          quick();
        } catch (error) {
          log(`Tezkor tekshiruv xatosi: ${error.message}`);
        }
      }, fastMs);
      controller.signal.addEventListener("abort", () => clearInterval(fastTimer));
      // Har 10 daqiqada: nechta e'lon AI'siz tushunildi, nechtasi aloqasiz deb tashlandi, nechta tezkor xabar ketdi
      let reportedAt = now();
      let reported = 0;
      let reportedNoContact = 0;
      let reportedRaw = 0;
      while (!controller.signal.aborted) {
        // Hamma AI dam olayotgan bo'lsa ham: kechasi to'plangan e'lonlar navbatda "kutib" turmasin
        expire();
        quick();
        if ((deps.rules || deps.requireContact || deps.deliverRaw) && now() - reportedAt >= 10 * 60_000) {
          if (ruleCount > reported) log(`Qoidaviy parser: oxirgi 10 daqiqada ${ruleCount - reported} ta e'lon AI'siz tushunildi`);
          if (rawCount > reportedRaw) log(`Tezkor: oxirgi 10 daqiqada ${rawCount - reportedRaw} ta asl matnli xabar yuborildi`);
          reportedRaw = rawCount;
          if (noContactCount > reportedNoContact) {
            log(`Aloqasiz: oxirgi 10 daqiqada ${noContactCount - reportedNoContact} ta e'lon (telefon ham, lichka ham yo'q) AI'ga yuborilmadi`);
          }
          reported = ruleCount;
          reportedNoContact = noContactCount;
          reportedAt = now();
        }
        // Yuborish ortda qolsa yoki hamma yo'lak band — kutamiz (Telegram'dan tezroq tahlil qilishning foydasi yo'q)
        if (lanes.size >= parallel || waiting >= size * 3) {
          await nap(idleMs);
          continue;
        }
        const lease = pool.acquire();
        if (!lease) {
          const ready = pool.nextReadyIn();
          if (pool.size() === 0) say("none", "AI ulanishi yo'q: boshqaruv markazining «AI» bo'limida kalit qo'shing (yoki .env ga GEMINI_API_KEY)");
          else if (ready > 0 && lanes.size === 0) say("rest", `Hamma AI ulanishlari dam olyapti — eng yaqini ${pauseText(ready, now())}. E'lonlar navbatda kutadi`);
          // Dam olish uzoq bo'lsa ham 15 s da bir tekshiramiz: yangi kalit qo'shilgan bo'lishi mumkin.
          // Qoidaviy parser yoqiq bo'lsa — idleMs da bir (yangi e'lonlar AI'siz ham ketishi uchun)
          const most = deps.rules ? idleMs : 15_000;
          await nap(ready == null ? idleMs : Math.min(Math.max(ready, 1000), most));
          continue;
        }
        const posts = take(fillWait, lease);
        if (posts.length === 0) {
          lease.release();
          await nap(idleMs);
          continue;
        }
        notice = null;
        const job = lane(lease, posts)
          .catch((error) => log(`Ishchi xatosi: ${error.message}`))
          .finally(() => {
            lanes.delete(job);
            wake();
          });
        lanes.add(job);
      }
    },
    stop() {
      controller.abort();
    },
  };
}
