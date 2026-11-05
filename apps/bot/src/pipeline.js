// Navbatdagi e'lonlarni oxirigacha olib boradi:
// AI tahlil → har bir yukning kaliti → takror bo'lsa tashlash → bazaga yozish → kanalga joylash → mos haydovchilarga yuborish.
// AI'ga e'lonlar guruh-guruh (batch) beriladi: 10 ta e'lon — bitta so'rov (bepul Gemini'da so'rovlar soni cheklangan).
// Telegram va AI tashqaridan beriladi (deps), shuning uchun testda soxtasi qo'yiladi.
import { setTimeout as wait } from "node:timers/promises";
import { DEFAULT_DEDUPE_WINDOW_MS, loadKeys, matchLoad } from "@yuk/shared";

// AI natijasi tayyor bo'lgan bitta e'lon: takrorni tashlash → bazaga yozish → kanal → haydovchilar.
// deps: { store, publish?(load, post) → kanal xabar id | null, deliver(chatId, load, post) → true/false, windowMs }
export async function handleParsed(post, result, deps) {
  const { store, windowMs = DEFAULT_DEDUPE_WINDOW_MS } = deps;
  if (!result.ok) {
    store.finishPost(post.id, "failed", result.error);
    return { status: "failed", error: result.error };
  }
  // Hozircha faqat "yuk bor, mashina kerak" e'lonlari yuboriladi. "Mashina bo'sh" — keyin yuk beruvchilarga.
  if (result.postType !== "yuk_bor" || result.loads.length === 0) {
    store.finishPost(post.id, "done", result.postType);
    return { status: "skipped", postType: result.postType };
  }

  // Avval hamma yangi yuklarni bazaga yozamiz, keyin yuboramiz:
  // yuborish o'rtasida dastur to'xtasa ham, o'sha yuk ikkinchi marta yuborilmaydi
  const keys = loadKeys(result.loads);
  const fresh = [];
  result.loads.forEach((load, i) => {
    if (store.hasRecentLoad(keys[i], windowMs)) return;
    fresh.push({ id: store.addLoad({ postId: post.id, key: keys[i], load }), load });
  });

  const drivers = store.activeDrivers();
  let sent = 0;
  for (const { id, load } of fresh) {
    const channelMessageId = (await deps.publish?.(load, post)) ?? null;
    let count = 0;
    for (const driver of drivers) {
      if (!matchLoad(load, driver.profile).ok) continue;
      if (await deps.deliver(driver.chatId, load, post)) count++;
    }
    store.setLoadDelivery(id, { sentTo: count, channelMessageId });
    sent += count;
  }
  store.finishPost(post.id, "done");
  return { status: "done", loads: result.loads.length, fresh: fresh.length, sent };
}

// Bitta e'lon: AI (alohida so'rov) + handleParsed.
// AI xatosi (limit, tarmoq) bu yerda ushlanmaydi — uni worker hal qiladi (kutadi yoki keyinroq qayta urinadi).
export async function processPost(post, deps) {
  return handleParsed(post, await deps.parser.parse(post.text), deps);
}

const FATAL_PAUSE_MS = 5 * 60 * 1000; // model band (503) yoki boshqa jiddiy xato
const DAILY_LIMIT_PAUSE_MS = 30 * 60 * 1000; // bepul kunlik limit tugadi — e'lonlar navbatda kutadi

// Navbatni doimiy o'qib turadigan ishchi. Yangi e'lon bo'lmasa idleMs kutadi.
// batch — bitta AI so'rovidagi e'lonlar soni (standart: parser.batchSize — .env dagi PARSER_BATCH).
// fillWaitMs — navbatda batch'dan kam e'lon bo'lsa, eng eski e'lon joylanganidan shuncha vaqt o'tguncha yana
// yig'ilishini kutamiz (standart: parser.batchWaitMs — PARSER_BATCH_WAIT). Aks holda navbat bo'sh paytda
// har 5 soniyada 1–2 ta e'lon uchun so'rov ketadi va batch limitni tejamaydi.
export function createWorker(deps, { idleMs = 5000, batch, fillWaitMs, log = console.log, now = Date.now } = {}) {
  const { parser, store } = deps;
  const provider = parser.provider ?? {};
  const size = batch ?? parser.batchSize ?? 10;
  const fillWait = fillWaitMs ?? parser.batchWaitMs ?? 60_000;
  const controller = new AbortController();
  const sleep = (ms) => wait(ms, undefined, { signal: controller.signal }).catch(() => {});
  const describe = (error) => provider.describeError?.(error) ?? error.message;

  // Xato bo'lganda: kutish kerakmi (ms) yoki e'lonni "failed" qilib o'tish kerakmi (null)
  function pauseFor(error) {
    const retry = provider.retryAfterMs?.(error);
    if (retry != null) return retry;
    if (provider.isFatal?.(error)) return error?.status === 429 ? DAILY_LIMIT_PAUSE_MS : FATAL_PAUSE_MS;
    return null;
  }

  // Limit yoki model band bo'lsa — kutadi va true qaytaradi. E'lonlar "new" bo'lib qoladi va keyin qayta olinadi.
  async function pauseOn(error) {
    const pause = pauseFor(error);
    if (pause == null) return false;
    log(`AI vaqtincha ishlamayapti: ${describe(error)} — ${Math.round(pause / 1000)} s kutamiz`);
    await sleep(pause);
    return true;
  }

  // Navbatdan bir guruh e'lonni olib, oxirigacha olib boradi. → olingan e'lonlar soni (0 — ish yo'q).
  // options.fillWaitMs — start() beradi; testlar va --dry-run guruh to'lishini kutmaydi.
  async function runOnce({ fillWaitMs: fill = 0 } = {}) {
    // Eng yangi e'lonlar birinchi: navbat to'lib qolganda ham yangi yuk darhol chiqadi, eskilari bo'sh paytda
    const posts = store.takeNewPosts(size, { newest: true });
    if (posts.length === 0) return 0;
    if (posts.length < size && fill > 0 && now() - Math.min(...posts.map((p) => p.postedAt)) < fill) return 0;

    // 1) AI: hamma e'lon bitta so'rovda. Javob yaroqsiz bo'lsa parser o'zi ularni bittadan qayta tahlil qiladi.
    let results = null;
    if (posts.length > 1 && parser.parseBatch) {
      try {
        results = await parser.parseBatch(posts.map((p) => p.text));
        const fallback = results.filter((r) => r.fallback);
        if (fallback.length) log(`AI javobi yaroqsiz (${fallback[0].fallback}) — ${fallback.length} ta e'lon bo'linib qayta yuborildi`);
        else log(`AI: ${posts.length} ta e'lon bitta so'rovda`);
      } catch (error) {
        if (await pauseOn(error)) return posts.length;
        // Kutilmagan xato — pastda har bir e'lon alohida so'rov bilan, xatosi o'ziga yoziladi
        log(`AI guruh xatosi: ${describe(error)} — e'lonlar bittadan tahlil qilinadi`);
      }
    }

    // 2) Har bir e'lon: takror → baza → kanal → haydovchilar
    for (const [i, post] of posts.entries()) {
      if (controller.signal.aborted) return posts.length;
      try {
        const result = results ? results[i] : await parser.parse(post.text);
        const outcome = await handleParsed(post, result, deps);
        if (outcome.status === "done") log(`#${post.id} ${post.source}: ${outcome.fresh}/${outcome.loads} yangi yuk, ${outcome.sent} ta haydovchiga`);
      } catch (error) {
        if (await pauseOn(error)) return posts.length;
        const message = describe(error);
        log(`#${post.id}: xato — ${message}`);
        store.finishPost(post.id, "failed", message);
      }
    }
    return posts.length;
  }

  return {
    runOnce,
    async start() {
      while (!controller.signal.aborted) {
        const count = await runOnce({ fillWaitMs: fillWait });
        if (count === 0) await sleep(idleMs);
      }
    },
    stop() {
      controller.abort();
    },
  };
}
