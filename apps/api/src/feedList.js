// Ilova (YukApp) «📋 Yuklar» lentasi: bot haydovchiga asl matn bilan yuboradigan e'lonlarning AYNAN o'zi — so'nggi N daqiqa.
// Azimjon, 2026-11-24: «Ha qil! foydalanuvchilarga bu kerak!» — /pub/loads faqat qoidaviy parser to'liq tushungan
// e'lonlarni beradi (~45%), bot esa hamma e'lonni AI'siz yuboradi. Qoidalar bot pipeline.js fast() bilan bir xil:
//   takror (duplicate) — yo'q; yopiq guruh — bog'lanish yo'li bo'lsa va faqat Pro / guruhni qo'shganga;
//   «📌 Mening guruhlarim» — faqat tanlangan guruhlardan; «quruq gap» (fastLook chatter) — hech kimga;
//   «🚚 Transport» va «📍 Qayerdan» filtrlari. A'zolik tekshiruvi (kanal/guruh) web'dagidek — yo'q.
// fastLook ~2–6 ms; har 3 soniyada har foydalanuvchi so'raydi → natija e'lon id bo'yicha xotirada saqlanadi (matn o'zgarmaydi).
import { extractPhones, fastLook, parseByRules } from "@yuk/parser";
import { feedMode, filtersWanted, isClosedSource, planAllows, rawWanted } from "@yuk/shared";

const CACHE_MAX = 6000;

export function createFeedList({ store, now = Date.now }) {
  const cache = new Map(); // post id → { look, load }

  function lookOf(post) {
    let hit = cache.get(post.id);
    if (hit) return hit;
    let look;
    try {
      look = fastLook(post.text ?? "", { voice: Boolean(post.media) });
    } catch {
      look = { chatter: false, origins: [], originUnknown: false, trucks: [] };
    }
    // Kartaning sarlavhasi (qayerdan → qayerga) — faqat qoidaviy parser yo'nalishni topgan bo'lsa
    let load = {};
    try {
      const first = parseByRules(post.text ?? "").loads?.[0];
      if (first) load = { fromRegion: first.fromRegion ?? null, fromCity: first.fromCity ?? null, fromCountry: first.fromCountry ?? null, toRegion: first.toRegion ?? null, toCity: first.toCity ?? null, toCountry: first.toCountry ?? null };
    } catch {
      // yo'nalishsiz — sarlavha chiqmaydi
    }
    hit = { look, load };
    cache.set(post.id, hit);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return hit;
  }

  // Bot taniydigan ID (pipeline.js knownUser bilan bir xil): yopiq guruhda username'siz yozgan odam bilan bog'lanish yo'li
  const known = (id) => Boolean(store.getDriver?.(Number(id))) || Boolean(store.senderReachable?.(id));
  const closedContact = (post) =>
    extractPhones(post.text ?? "").length > 0 || Boolean(post.senderPhone) || Boolean(post.sender) || Boolean(post.senderId && known(post.senderId));

  // → { minutes, total, items: [{ id, load: {…yo'nalish, phones}, post: {source, link, postedAt, sender, senderId, media, text} }] }
  function list(driver, { minutes = 10, limit = 200 } = {}) {
    const { profile } = driver;
    const guruhlarim = feedMode(profile) === "guruhlarim";
    const owners = new Map();
    const ownerOf = (source) => {
      if (!owners.has(source)) owners.set(source, store.sourceOwner?.(source) ?? null);
      return owners.get(source);
    };
    const items = [];
    for (const post of store.recentPostsSince(now() - minutes * 60_000, 1500)) {
      if (guruhlarim && !rawWanted(profile, post.source)) continue;
      const closed = isClosedSource(post.source);
      if (closed && (!closedContact(post) || !planAllows(driver, { kind: "yuk", source: post.source, owner: ownerOf(post.source) }))) continue;
      const { look, load } = lookOf(post);
      if (look.chatter || !filtersWanted(profile, look)) continue;
      const phones = extractPhones(post.text ?? "");
      if (!phones.length && closed && post.senderPhone) phones.push(post.senderPhone);
      items.push({
        id: post.id,
        load: { ...load, phones },
        post: {
          source: post.source,
          link: post.link ?? null,
          postedAt: post.postedAt,
          sender: post.sender ?? null,
          senderId: post.senderId ?? null,
          media: post.media ?? null,
          fromShipper: false,
          text: post.text ?? "",
        },
      });
    }
    return { minutes, total: items.length, items: items.slice(0, limit) };
  }

  return { list };
}
