// Navbatdagi e'lonlarni oxirigacha olib boradi:
// AI tahlil → har bir yukning kaliti → takror bo'lsa tashlash → bazaga yozish → kanalga joylash → mos haydovchilarga yuborish.
// AI'ga e'lonlar guruh-guruh (batch) beriladi: 10 ta e'lon — bitta so'rov (bepul Gemini'da so'rovlar soni cheklangan).
// Bir nechta AI ulanishi (kalit + model) bo'lsa, guruhlar parallel tahlil qilinadi.
// Telegram va AI tashqaridan beriladi (deps), shuning uchun testda soxtasi qo'yiladi.
import { setTimeout as wait } from "node:timers/promises";
import { poolFromParser } from "@yuk/parser";
import {
  DEFAULT_DEDUPE_WINDOW_MS,
  DEFAULT_ROUTE_SCOPE,
  KIND_MATCHERS,
  KIND_ROLE,
  loadKeys,
  planAllows,
  routeInScope,
  routeText,
} from "@yuk/shared";

// E'lon turi → bazadagi kind va kimga boradi (rollar: @yuk/shared roles.js)
//   yuk_bor     → kind "yuk"     → haydovchilarga (matchLoad: mashinasi va yo'nalishi)
//   mashina_bor → kind "mashina" → yuk beruvchilarga (matchTruck: yo'nalishi, kerakli mashina turi)
const POST_KIND = { yuk_bor: "yuk", mashina_bor: "mashina" };

// AI natijasi tayyor bo'lgan bitta e'lon: yo'nalish doirasi → takrorni tashlash → bazaga yozish → kanal → foydalanuvchilar.
// deps: { store, publish?(load, post) → kanal xabar id | null, deliver(chatId, load, post, kind) → true/false, windowMs,
//         routeScope — @yuk/shared ROUTE_SCOPES kodi (.env dagi ROUTE_SCOPE; standart "qoshni") }
export async function handleParsed(post, result, deps) {
  const { store, windowMs = DEFAULT_DEDUPE_WINDOW_MS, routeScope = DEFAULT_ROUTE_SCOPE } = deps;
  if (!result.ok) {
    store.finishPost(post.id, "failed", result.error);
    return { status: "failed", error: result.error };
  }
  // "Yuk bor" — haydovchilarga, "mashina bo'sh" — yuk beruvchilarga. Reklama va boshqasi — hech kimga.
  const kind = POST_KIND[result.postType];
  if (!kind || result.loads.length === 0) {
    store.finishPost(post.id, "done", result.postType);
    return { status: "skipped", postType: result.postType };
  }

  // Faqat doiradagi yo'nalishlar (boshlanishiga: O'zbekiston ichi va chegaradosh davlatlar bilan).
  // E'londagi hamma yuk doiradan tashqarida bo'lsa — e'lon izoh bilan yopiladi (boshqaruv markazida ko'rinadi)
  const loads = result.loads.filter((load) => routeInScope(load, routeScope));
  if (loads.length === 0) {
    const routes = [...new Set(result.loads.map(routeText))];
    store.finishPost(post.id, "done", `Boshqa yo'nalish: ${routes.slice(0, 3).join(", ")}${routes.length > 3 ? "…" : ""}`);
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
  let sent = 0;
  for (const { id, load } of fresh) {
    // Kanal faqat yuklar uchun (va faqat CHANNEL_LOADS=1 bo'lsa — bot.js publish)
    const channelMessageId = kind === "yuk" ? ((await deps.publish?.(load, post)) ?? null) : null;
    let count = 0;
    for (const user of users) {
      if (!matches(load, user.profile).ok) continue;
      // Obuna (hozircha hamma bepul va hammaga yuboriladi — roles.js planAllows)
      if (!planAllows(user, { kind })) continue;
      if (await deps.deliver(user.chatId, load, post, kind)) count++;
    }
    store.setLoadDelivery(id, { sentTo: count, channelMessageId });
    sent += count;
  }
  store.finishPost(post.id, "done");
  return { status: "done", kind, loads: loads.length, outOfScope: result.loads.length - loads.length, fresh: fresh.length, sent };
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
// maxParallel — bir vaqtda nechta AI so'rovi (standart: .env dagi PARSER_PARALLEL yoki 8).
// maxAgeMs — joylanganiga shundan ko'p vaqt o'tgan e'lon AI'ga bormaydi, "Eskirgan" deb yopiladi (0 — cheklovsiz;
// bot .env dagi POST_MAX_AGE_HOURS ni beradi, standart 3 soat). Yukni odatda bir soat ichida olib bo'lishadi:
// kechagi e'lonni "yangi yuk" deb kanalga chiqarish haydovchini chalg'itadi va bepul AI limitini behuda yeydi.
export function createWorker(deps, { idleMs = 5000, batch, fillWaitMs, log = console.log, now = Date.now, maxParallel, maxAgeMs = 0 } = {}) {
  const { store } = deps;
  const pool = deps.pool ?? poolFromParser(deps.parser);
  const size = batch ?? pool.batchSize ?? 10;
  const fillWait = fillWaitMs ?? pool.batchWaitMs ?? 90_000;
  const parallel = maxParallel ?? (Math.floor(Number(process.env.PARSER_PARALLEL)) || 8);
  const controller = new AbortController();
  const sleep = (ms) => wait(ms, undefined, { signal: controller.signal }).catch(() => {});

  const claimed = new Set(); // AI'da yoki yuborish navbatida turgan e'lonlar — ikkinchi marta olinmaydi
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

  // Navbatdan bir guruh (eng yangilari, boshqa AI olganlaridan tashqari). Guruh to'lmagan va yangi bo'lsa — [] (kutamiz)
  function take(fill) {
    const posts = store.takeNewPosts(size, { newest: true, exclude: [...claimed] });
    if (posts.length === 0) return [];
    const oldest = Math.min(...posts.map((p) => p.queuedAt ?? p.postedAt));
    if (posts.length < size && fill > 0 && now() - oldest < fill) return [];
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

  // Yuborish: takror → baza → kanal → haydovchilar, bittalab. Natijasi yo'q e'lonlar darhol navbatga qaytadi.
  function deliver(posts, results) {
    const ready = posts.slice(0, results.length);
    for (const post of posts.slice(results.length)) claimed.delete(post.id);
    waiting += ready.length;
    delivery = delivery.then(async () => {
      for (const [i, post] of ready.entries()) {
        try {
          // To'xtatilsa — qolganlari "new" bo'lib qoladi va keyingi safar qayta tahlil qilinadi
          if (controller.signal.aborted) continue;
          const outcome = await handleParsed(post, results[i], deps);
          if (outcome.status === "done") {
            const other = outcome.outOfScope ? ` (+${outcome.outOfScope} tasi boshqa yo'nalish)` : "";
            const [what, whom] = outcome.kind === "mashina" ? ["bo'sh mashina", "yuk beruvchiga"] : ["yuk", "haydovchiga"];
            log(`#${post.id} ${post.source}: ${outcome.fresh}/${outcome.loads} yangi ${what}${other}, ${outcome.sent} ta ${whom}`);
          }
          else if (outcome.status === "failed") log(`#${post.id}: xato — ${outcome.error}`);
        } catch (error) {
          const message = error.description ?? error.message;
          log(`#${post.id}: yuborishda xato — ${message}`);
          store.finishPost(post.id, "failed", message);
        } finally {
          claimed.delete(post.id);
          waiting--;
        }
      }
    });
    return delivery;
  }

  // Bitta guruh, ketma-ket (testlar va --dry-run): AI → yuborish. Ulanish limitga tushsa — shu yerda kutadi.
  // → olingan e'lonlar soni (0 — ish yo'q yoki bo'sh ulanish yo'q).
  async function runOnce({ fillWaitMs: fill = 0 } = {}) {
    expire();
    const lease = pool.acquire();
    if (!lease) return 0;
    const posts = take(fill);
    if (posts.length === 0) {
      lease.release();
      return 0;
    }
    let outcome = { results: [] };
    try {
      outcome = await analyse(lease, posts);
    } finally {
      lease.release({ posts: outcome.results.length });
    }
    await deliver(posts, outcome.results);
    if (outcome.pause) {
      log(`AI vaqtincha ishlamayapti${tag(lease)}: ${lease.describe(outcome.error)} — ${Math.round(outcome.pause.ms / 1000)} s kutamiz`);
      await sleep(outcome.pause.ms);
    }
    return posts.length;
  }

  // Bitta AI ulanishining ishi (parallel): tahlil → natijani yuborish navbatiga
  async function lane(lease, posts) {
    let outcome = { results: [] };
    try {
      outcome = await analyse(lease, posts);
    } finally {
      lease.release({ posts: outcome.results.length });
      deliver(posts, outcome.results);
    }
    if (outcome.pause) {
      const others = pool.size() > 1 ? ", qolganlari ishlayveradi" : "";
      log(`AI${tag(lease)}: ${lease.describe(outcome.error)} — ${pauseText(outcome.pause.ms, now())} dam oladi${others}`);
    }
  }

  return {
    runOnce,
    async start() {
      const lanes = new Set();
      let notice = null; // bir xil ogohlantirish qayta-qayta yozilmasin
      const say = (key, message) => {
        if (notice !== key) log(message);
        notice = key;
      };
      const count = pool.size();
      log(count ? `AI: ${count} ta ulanish, bir vaqtda ${Math.min(count, parallel)} tagacha so'rov` : "AI: ulanish yo'q");
      while (!controller.signal.aborted) {
        // Hamma AI dam olayotgan bo'lsa ham: kechasi to'plangan e'lonlar navbatda "kutib" turmasin
        expire();
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
          // Dam olish uzoq bo'lsa ham 15 s da bir tekshiramiz: yangi kalit qo'shilgan bo'lishi mumkin
          await nap(ready == null ? idleMs : Math.min(Math.max(ready, 1000), 15_000));
          continue;
        }
        const posts = take(fillWait);
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
