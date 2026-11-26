// Ilovaga bildirishnoma (Azimjon, 2026-11-25: «ilovadan chiqib ketsam e'lon kelmayabdi … backgroundda ham ishlashi kerak»).
// Har 5 soniyada: telefon tokeni bor haydovchilarga ilova lentasining AYNAN o'zi (feedList.js, so'nggi 3 daqiqa) — undagi
// shu tokenga hali yuborilmagan e'lonlar FCM bilan ketadi: sarlavha «📍 Qayerdan → Qayerga», matn — e'lon boshi,
// «📞 Qo'ng'iroq qilish» — e'londagi birinchi raqam. Bir aylanishda bitta telefonga ko'pi bilan 3 ta (qolgani — lentada).
// Pauzada / filtrsiz / hisobdan chiqqan — yuborilmaydi. Yuk beruvchiga (bo'sh mashinalar) — hali yo'q.
import { appProfileOf, placeText } from "@yuk/shared";

export const PUSH_EVERY_MS = 5_000;
export const PUSH_MINUTES = 3;
export const PUSH_PER_TICK = 3;

const hasPlace = (load, side) => Boolean(load[`${side}City`] || load[`${side}Region`] || load[`${side}Country`]);

// FCM data (hamma qiymat — matn): expo-notifications NotificationData — title, message, channelId, categoryId, body (JSON)
export function pushMessage(item) {
  const { load = {}, post = {} } = item;
  const route = hasPlace(load, "from") || hasPlace(load, "to") ? `📍 ${placeText(load, "from")} → ${placeText(load, "to")}` : "🚚 Yangi yuk";
  const text = String(post.text ?? "").replace(/\s+/g, " ").trim();
  const phone = load.phones?.[0] ?? "";
  return {
    title: route,
    message: text.length > 180 ? `${text.slice(0, 179)}…` : text,
    channelId: "yuklar",
    categoryId: phone ? "yuk" : "",
    body: itemBody(item, phone),
  };
}

// FCM xabari ko'pi bilan 4 KB. body ichida e'lonning o'zi (lenta kartasi) — bosilganda ilova serverni kutmasdan ko'rsatadi
// (Azimjon, 2026-11-25: «~3 s dan so'ng scroll … umuman qotmaydigan qil»). Uzun matn baytlar bo'yicha qisqartiriladi
// (kirill — 2 bayt), to'liq matn ilovaning keyingi so'rovida keladi
export const BODY_MAX_BYTES = 2800;
function itemBody(item, phone) {
  const post = item.post ?? {};
  let text = String(post.text ?? "");
  const make = () =>
    JSON.stringify({
      postId: item.id,
      phone,
      item: { id: item.id, load: item.load ?? {}, post: { ...post, text } },
    });
  let body = make();
  while (Buffer.byteLength(body) > BODY_MAX_BYTES && text.length > 0) {
    const over = Buffer.byteLength(body) - BODY_MAX_BYTES;
    text = `${text.slice(0, Math.max(0, text.length - Math.max(over, 20) - 1))}…`;
    body = make();
  }
  return Buffer.byteLength(body) > BODY_MAX_BYTES ? JSON.stringify({ postId: item.id, phone }) : body;
}

export function createPusher({ store, feedList, send, log = () => {}, everyMs = PUSH_EVERY_MS }) {
  let busy = false;
  let timer = null;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const byChat = new Map();
      for (const row of store.pushTokens()) {
        if (!byChat.has(row.chatId)) byChat.set(row.chatId, []);
        byChat.get(row.chatId).push(row);
      }
      for (const [chatId, rows] of byChat) {
        const driver = store.getDriver(chatId);
        // ilova botning rolidan mustaqil: haydovchi filtri (appProfileOf) bo'lsa bas; ilova pauzasi — appActive
        const appProfile = driver && appProfileOf(driver);
        if (!driver || driver.deletedAt || !appProfile || driver.appActive === false) continue;
        const items = feedList.list(driver, { minutes: PUSH_MINUTES, limit: 50 }).items; // eng yangisi birinchi
        const top = items.reduce((max, item) => Math.max(max, Number(item.id)), 0);
        for (const row of rows) {
          // Birinchi marta — eskilari yuborilmaydi, faqat bundan keyingilari
          if (row.lastPostId == null) {
            store.setPushCursor(row.token, top);
            continue;
          }
          const fresh = items.filter((item) => Number(item.id) > row.lastPostId).slice(0, PUSH_PER_TICK).reverse();
          if (!fresh.length) continue;
          store.setPushCursor(row.token, top);
          for (const item of fresh) {
            const result = await send(row.token, pushMessage(item)).catch((error) => {
              log(`Bildirishnoma yuborilmadi: ${error.message}`);
              return "error";
            });
            if (result === "gone") {
              store.dropPushToken(row.token); // ilova o'chirilgan / token eskirgan
              break;
            }
          }
        }
      }
    } catch (error) {
      log(`Bildirishnoma aylanishida xato: ${error.message}`);
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    start() {
      timer ??= setInterval(tick, everyMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

// Yangi ilova versiyasi joylandi (data/apk/latest.json, @yuk/store appRelease.js) — hamma telefonga bir marta
// «📲 yangilang» (Azimjon, 2026-11-25: «bildirishnomaham bo'lsin yangila degan»). Qaysi versiya haqida aytilgani
// settings.app_release_pushed da: server qayta yoqilsa ham takrorlanmaydi; birinchi ishga tushishda faqat eslab qoladi.
// Bosilganda ilova ochiladi va (versiya eski bo'lsa) «Yangilash» oynasini ko'rsatadi; 0.11.x lar — botdagi /ilovalar.
export const RELEASE_KEY = "app_release_pushed";
export const RELEASE_EVERY_MS = 60_000;

export function releaseMessage(apk) {
  return {
    title: "📲 Yuk Ekspert yangilandi",
    message: `Yangi versiya ${apk.version} — ilovani oching va «Yangilash» ni bosing (yoki botda /ilovalar)`,
    channelId: "yuklar",
    categoryId: "",
    body: JSON.stringify({ type: "update", version: apk.version }),
  };
}

export function createReleaseNotifier({ store, readRelease, send, log = () => {}, everyMs = RELEASE_EVERY_MS }) {
  let busy = false;
  let timer = null;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const apk = readRelease();
      if (!apk?.versionCode) return;
      const told = Number(store.getSetting(RELEASE_KEY));
      store.setSetting(RELEASE_KEY, String(apk.versionCode)); // oldin — xato bo'lsa ham takror-takror yubormaslik uchun
      if (!told || apk.versionCode <= told) return;
      let sent = 0;
      for (const row of store.pushTokens()) {
        const result = await send(row.token, releaseMessage(apk)).catch(() => "error");
        if (result === "gone") store.dropPushToken(row.token);
        if (result === "ok") sent++;
      }
      log(`Ilova ${apk.version}: ${sent} ta telefonga «yangilang» bildirishnomasi`);
    } catch (error) {
      log(`Yangi versiya bildirishnomasida xato: ${error.message}`);
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    start() {
      timer ??= setInterval(tick, everyMs);
      timer.unref?.();
      tick();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
