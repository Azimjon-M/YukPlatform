// Navbatdagi bitta e'lonni oxirigacha olib boradi:
// AI tahlil → har bir yukning kaliti → takror bo'lsa tashlash → bazaga yozish → kanalga joylash → mos haydovchilarga yuborish.
// Telegram va AI tashqaridan beriladi (deps), shuning uchun testda soxtasi qo'yiladi.
import { setTimeout as wait } from "node:timers/promises";
import { DEFAULT_DEDUPE_WINDOW_MS, loadKeys, matchLoad } from "@yuk/shared";

// deps: { parser, store, publish?(load, post) → kanal xabar id | null, deliver(chatId, load, post) → true/false, windowMs }
// AI xatosi (limit, tarmoq) bu yerda ushlanmaydi — uni worker hal qiladi (kutadi yoki keyinroq qayta urinadi).
export async function processPost(post, deps) {
  const { parser, store, windowMs = DEFAULT_DEDUPE_WINDOW_MS } = deps;
  const result = await parser.parse(post.text);
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

const FATAL_PAUSE_MS = 5 * 60 * 1000; // model band (503) yoki boshqa jiddiy xato
const DAILY_LIMIT_PAUSE_MS = 30 * 60 * 1000; // bepul kunlik limit tugadi — e'lonlar navbatda kutadi

// Navbatni doimiy o'qib turadigan ishchi. Yangi e'lon bo'lmasa idleMs kutadi.
export function createWorker(deps, { idleMs = 5000, batch = 5, log = console.log } = {}) {
  const { parser, store } = deps;
  const provider = parser.provider ?? {};
  const controller = new AbortController();
  const sleep = (ms) => wait(ms, undefined, { signal: controller.signal }).catch(() => {});

  // Xato bo'lganda: kutish kerakmi (ms) yoki e'lonni "failed" qilib o'tish kerakmi (null)
  function pauseFor(error) {
    const retry = provider.retryAfterMs?.(error);
    if (retry != null) return retry;
    if (provider.isFatal?.(error)) return error?.status === 429 ? DAILY_LIMIT_PAUSE_MS : FATAL_PAUSE_MS;
    return null;
  }

  async function runOnce() {
    const posts = store.takeNewPosts(batch);
    for (const post of posts) {
      if (controller.signal.aborted) return posts.length;
      try {
        const result = await processPost(post, deps);
        if (result.status === "done") log(`#${post.id} ${post.source}: ${result.fresh}/${result.loads} yangi yuk, ${result.sent} ta haydovchiga`);
      } catch (error) {
        const message = provider.describeError?.(error) ?? error.message;
        const pause = pauseFor(error);
        if (pause != null) {
          // E'lon "new" bo'lib qoladi va kutishdan keyin qayta olinadi
          log(`AI vaqtincha ishlamayapti: ${message} — ${Math.round(pause / 1000)} s kutamiz`);
          await sleep(pause);
          return posts.length;
        }
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
        const count = await runOnce();
        if (count === 0) await sleep(idleMs);
      }
    },
    stop() {
      controller.abort();
    },
  };
}
