// Haydovchining yetkazish rejimi uchun bazadagi qism (2026-11-14; qoidalari — @yuk/shared feed.js):
//   • post_deliveries — «⚡ Tezkor» / «📌 Mening guruhlarim» da e'lon AI'siz, asl matn bilan kimga ketgani
//     (deliveries jadvali yuklar uchun: u yerda load_id bor, bu yerda — e'lonning o'zi, yuk hali tushunilmagan).
//     Keyin AI shu e'londan yuk topsa, bot o'sha haydovchiga uni ikkinchi marta yubormaydi (postDeliveredTo).
//   • feedSources — haydovchi «Mening guruhlarim» ro'yxatida qaysi guruhlarni ko'radi va tanlay oladi.
import { OWNS_ACCOUNT_SQL } from "./tgAccounts.js";

const HOUR = 60 * 60 * 1000;

// SCHEMA (index.js) dan keyin chaqiriladi: yangi jadval eski bazaga ham qo'shiladi
export function migrateFeed(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS post_deliveries (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  sent_at INTEGER NOT NULL,
  called_at INTEGER                  -- «📞 Telefon qilish» ni birinchi bosgan vaqt
);
CREATE INDEX IF NOT EXISTS post_deliveries_post ON post_deliveries (post_id);
CREATE INDEX IF NOT EXISTS post_deliveries_chat ON post_deliveries (chat_id, sent_at);
`);
}

// «📌 Mening guruhlarim» ro'yxatidagi guruhlar (SQL sharti): yoqilgan, tekshiruvdan o'tayotgan yoki o'tgan (probe / failed — yo'q).
// Ochiq (@nomi) va yopiq (raqamli id) — ikkalasi ham (Azimjon, 2026-11-16: «publik va private guruhlardan tanlaydigan qil»).
// Yopiq guruh (2026-11-27, obunalar — @yuk/shared planAllows): Max — hammasini tanlaydi; Pro — faqat o'zinikini (o'z
// akkaunti a'zo yoki o'zi qo'shgan), boshqalarniki unga ko'rinmaydi; Free — o'ziniki «locked» bo'lib ko'rinadi (Pro kerak)
const LISTED = `enabled = 1 AND (check_state IS NULL OR check_state IN ('trial', 'ok'))`;
const isClosedName = (name) => !String(name).startsWith("@");
// Ko'rinadimi: ochig'i — hammaga; yopig'i — Max'ga hammasi, qolganlarga faqat o'ziniki
const canSee = (name, plan, own) => !isClosedName(name) || plan === "max" || own;
// Tanlay oladimi: ochig'i — hamma; yopig'i — Max (hammasini) yoki Pro (o'zinikini)
const canPick = (name, plan, own) => !isClosedName(name) || plan === "max" || (plan === "pro" && own);

export function createFeedQueries(db, now) {
  // Guruh a'zolari soni akkauntlarimiz guruhlar ro'yxatidan (tg_dialogs): Map("@nom" | "-100…" (kichik harf) → eng kattasi).
  // sources.members bo'lmasa shu olinadi («🎛 Filtr», boshqaruv markazi «Manbalar»)
  function dialogMembers() {
    const out = new Map();
    for (const d of db.prepare("SELECT peer_id, username, members FROM tg_dialogs WHERE members IS NOT NULL").all()) {
      for (const key of [d.peer_id && String(d.peer_id).toLowerCase(), d.username && `@${d.username}`.toLowerCase()]) {
        if (key && !(out.get(key) >= d.members)) out.set(key, d.members);
      }
    }
    return out;
  }
  // Shu odamning «o'z» guruhlari: o'z Telegram akkaunti(lari) a'zo (tg_dialogs — id yoki @username) yoki o'zi qo'shgan
  // (sources.added_by). → Set(kichik harfda)
  function ownNames(store, chatId) {
    const own = new Set();
    const accounts = (store.tgAccountsOf?.(chatId) ?? []).map((a) => a.name);
    if (accounts.length) {
      const marks = accounts.map(() => "?").join(",");
      for (const d of db.prepare(`SELECT peer_id, username FROM tg_dialogs WHERE account IN (${marks})`).all(...accounts)) {
        if (d.peer_id) own.add(String(d.peer_id).toLowerCase());
        if (d.username) own.add(`@${d.username}`.toLowerCase());
      }
    }
    for (const r of db.prepare("SELECT name FROM sources WHERE added_by = ?").all(chatId)) own.add(r.name.toLowerCase());
    return own;
  }
  return {
    dialogMembers,

    // Tezkor xabar yuborildi (yoki Telegram qabul qilmadi — ok: false, error)
    addPostDelivery({ postId, chatId, ok, error = null }) {
      db.prepare("INSERT INTO post_deliveries (post_id, chat_id, ok, error, sent_at) VALUES (?, ?, ?, ?, ?)").run(
        postId,
        chatId,
        ok ? 1 : 0,
        ok ? null : String(error ?? "xato").slice(0, 200),
        now(),
      );
    },

    // Shu e'lon asl matn bilan kimlarga yetib borgan → [chatId]
    postDeliveredTo(postId) {
      return db.prepare("SELECT DISTINCT chat_id FROM post_deliveries WHERE post_id = ? AND ok = 1").all(postId).map((r) => r.chat_id);
    },

    // «📞 Telefon qilish» (tezkor xabar ostida) bosildi — birinchi bosilgan vaqt
    markPostCalled({ postId, chatId }) {
      return (
        db
          .prepare(
            `UPDATE post_deliveries SET called_at = ? WHERE id = (
               SELECT id FROM post_deliveries WHERE post_id = ? AND chat_id = ? AND ok = 1 AND called_at IS NULL ORDER BY id DESC LIMIT 1)`,
          )
          .run(now(), postId, chatId).changes > 0
      );
    },

    // Bitta e'lon id bo'yicha (tezkor xabardagi «📞 Telefon qilish» raqamni shu matndan oladi) → { id, source, link, text, postedAt, sender } | null
    getPost(id) {
      const row = db.prepare("SELECT id, source, link, text, posted_at, sender, shipper, media, sender_id, sender_phone FROM posts WHERE id = ?").get(id);
      if (!row) return null;
      return {
        id: row.id,
        source: row.source,
        link: row.link,
        text: row.text,
        postedAt: row.posted_at,
        sender: row.sender ?? null,
        fromShipper: row.shipper != null,
        media: row.media ?? null,
        senderId: row.sender_id ?? null,
        senderPhone: row.sender_phone ?? null,
      };
    },

    // «📌 Faqat men tanlaydigan guruhlar» ro'yxati: ochiq va yopiq guruh/kanallar, eng faoli birinchi. plan — free | pro | max.
    // → [{ name, title, members, chatType, perDay, mine, own, closed, locked }]: perDay — oxirgi 24 soatda nechta e'lon
    // (takrorlarsiz), mine — o'zi «➕ Guruh qo'shish» bilan qo'shgan, own — o'z akkaunti a'zo yoki o'zi qo'shgan (Azimjon,
    // 2026-11-26: «global va o'z accountimdagi»), closed — yopiq, locked — ko'rinadi, lekin tanlab bo'lmaydi (Free'da o'z
    // yopiq guruhi — Pro kerak). Boshqalarning yopiq guruhlari faqat Max'ga ko'rinadi
    feedSources(chatId, { plan = "free" } = {}) {
      const rows = db.prepare(`SELECT name, title, members, chat_type, added_by FROM sources WHERE ${LISTED}`).all();
      const counts = new Map(
        db
          .prepare("SELECT lower(source) AS source, COUNT(*) AS n FROM posts WHERE created_at > ? AND status != 'duplicate' GROUP BY lower(source)")
          .all(now() - 24 * HOUR)
          .map((r) => [r.source, r.n]),
      );
      const own = ownNames(this, chatId);
      // A'zolar soni sources da bo'lmasa (TG_SOURCES / qo'lda qo'shilgan) — akkauntlarimiz guruhlar ro'yxatidagi soni
      // (tg_dialogs; «🎛 Filtr» da «👥 1.3K», 2026-11-27)
      const members = dialogMembers();
      return rows
        .filter((r) => canSee(r.name, plan, own.has(r.name.toLowerCase())))
        .map((r) => ({
          own: own.has(r.name.toLowerCase()),
          name: r.name,
          title: r.title ?? null,
          members: r.members ?? members.get(r.name.toLowerCase()) ?? null,
          chatType: r.chat_type ?? null,
          perDay: counts.get(r.name.toLowerCase()) ?? 0,
          mine: r.added_by != null && r.added_by === chatId,
          closed: isClosedName(r.name),
          locked: !canPick(r.name, plan, own.has(r.name.toLowerCase())),
        }))
        .sort((a, b) => Number(b.mine) - Number(a.mine) || b.perDay - a.perDay || a.name.localeCompare(b.name));
    },

    // Shu odamga ko'rinmaydigan (boshqalarning) yopiq guruhlari soni — «💎 Max'da yana N ta yopiq guruh» yozuvi uchun
    hiddenClosedCount(chatId, { plan = "free" } = {}) {
      if (plan === "max") return 0;
      const own = ownNames(this, chatId);
      return db.prepare(`SELECT name FROM sources WHERE ${LISTED}`).all().filter((r) => isClosedName(r.name) && !own.has(r.name.toLowerCase())).length;
    },

    // Tashqaridan kelgan tanlovni qisqartirish: faqat shu odam tanlay oladigan guruhlar (yopig'i — Max yoki Pro'ning o'ziniki),
    // ro'yxatdagi yozilishi bilan. → ["@TutGruz", "-100…", ...] (tartib — kelgan tartibda)
    allowedFeedSources(chatId, names, { plan = "free" } = {}) {
      const own = ownNames(this, chatId);
      const visible = new Map(
        db
          .prepare(`SELECT name FROM sources WHERE ${LISTED}`)
          .all()
          .filter((r) => canPick(r.name, plan, own.has(r.name.toLowerCase())))
          .map((r) => [r.name.toLowerCase(), r.name]),
      );
      const out = [];
      for (const name of Array.isArray(names) ? names : []) {
        const hit = visible.get(String(name).trim().toLowerCase());
        if (hit && !out.includes(hit)) out.push(hit);
      }
      return out;
    },

    // Yopiq guruh kimlarniki (roles.js planAllows owners — Pro faqat o'z yopiq guruhini oladi): qo'shgan odam (added_by) va
    // shu guruhga a'zo ulangan akkauntlarning egalari (tg_dialogs → tg_accounts → OWNS_ACCOUNT_SQL). → [chat id, ...]
    sourceOwners(name) {
      const key = String(name);
      const out = new Set();
      const added = db.prepare("SELECT added_by FROM sources WHERE name = ?").get(key)?.added_by;
      if (added != null) out.add(added);
      const rows = db
        .prepare(
          `SELECT DISTINCT drivers.chat_id AS id FROM tg_dialogs d JOIN tg_accounts t ON t.name = d.account
             JOIN drivers ON ${OWNS_ACCOUNT_SQL}
           WHERE d.peer_id = ? AND COALESCE(t.status, 'ok') NOT IN ('logged_out', 'duplicate')`,
        )
        .all(key);
      for (const r of rows) out.add(r.id);
      return [...out];
    },

    // Guruh nomi (@nomi o'rniga sarlavha): bot va boshqaruv markazidagi profil matni uchun → { "@nomi": "Sarlavha" }
    sourceTitles() {
      return Object.fromEntries(db.prepare("SELECT name, title FROM sources WHERE title IS NOT NULL").all().map((r) => [r.name.toLowerCase(), r.title]));
    },

    // Kuzatiladigan (yoqilgan) manbami — Mini App guruh rasmini faqat shular uchun beradi (public.js /pub/avatar/source)
    hasSource(name) {
      return Boolean(db.prepare("SELECT 1 FROM sources WHERE lower(name) = lower(?) AND enabled = 1").get(String(name)));
    },
  };
}
