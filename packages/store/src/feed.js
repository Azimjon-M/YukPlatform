// Haydovchining yetkazish rejimi uchun bazadagi qism (2026-11-14; qoidalari — @yuk/shared feed.js):
//   • post_deliveries — «⚡ Tezkor» / «📌 Mening guruhlarim» da e'lon AI'siz, asl matn bilan kimga ketgani
//     (deliveries jadvali yuklar uchun: u yerda load_id bor, bu yerda — e'lonning o'zi, yuk hali tushunilmagan).
//     Keyin AI shu e'londan yuk topsa, bot o'sha haydovchiga uni ikkinchi marta yubormaydi (postDeliveredTo).
//   • feedSources — haydovchi «Mening guruhlarim» ro'yxatida qaysi guruhlarni ko'radi va tanlay oladi.

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
// Yopiq guruh e'lonlari faqat Pro'ga boradi (@yuk/shared planAllows) — shuning uchun yopig'ini Pro yoki uni o'zi qo'shgan
// tanlaydi; boshqalarga u «locked» bo'lib ko'rinadi (tanlab bo'lmaydi, bot/ilova Pro haqida aytadi)
const LISTED = `enabled = 1 AND (check_state IS NULL OR check_state IN ('trial', 'ok'))`;
const isClosedName = (name) => !String(name).startsWith("@");
// Shu odam tanlay oladimi: ochig'i — hamma, yopig'i — Pro yoki o'zi qo'shgan
const canPick = (row, chatId, pro) => !isClosedName(row.name) || pro || (row.added_by != null && row.added_by === chatId);

export function createFeedQueries(db, now) {
  return {
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
      const row = db.prepare("SELECT id, source, link, text, posted_at, sender, shipper, media, sender_id FROM posts WHERE id = ?").get(id);
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
      };
    },

    // «📌 Mening guruhlarim» ro'yxati: ochiq va yopiq guruh/kanallar, eng faoli birinchi. pro — @yuk/shared isPro(driver).
    // → [{ name, title, members, chatType, perDay, mine, closed, locked }]: perDay — oxirgi 24 soatda nechta e'lon
    // (takrorlarsiz), mine — o'zi «➕ Guruh qo'shish» bilan qo'shgan, closed — yopiq, locked — yopiq va tanlab bo'lmaydi (Pro emas)
    feedSources(chatId, { pro = false } = {}) {
      const rows = db.prepare(`SELECT name, title, members, chat_type, added_by FROM sources WHERE ${LISTED}`).all();
      const counts = new Map(
        db
          .prepare("SELECT lower(source) AS source, COUNT(*) AS n FROM posts WHERE created_at > ? AND status != 'duplicate' GROUP BY lower(source)")
          .all(now() - 24 * HOUR)
          .map((r) => [r.source, r.n]),
      );
      // Oddiy (Pro emas) foydalanuvchiga yopiq guruhlar umuman ko'rinmaydi (2026-11-19, Azimjon: «oddiy foydalanuvchilarda
      // yopiq guruhlar ko'rinmasin! ammo public guruhlarni tanlay olsin») — faqat o'zi qo'shgani qoladi
      return rows
        .filter((r) => canPick(r, chatId, pro))
        .map((r) => ({
          name: r.name,
          title: r.title ?? null,
          members: r.members ?? null,
          chatType: r.chat_type ?? null,
          perDay: counts.get(r.name.toLowerCase()) ?? 0,
          mine: r.added_by != null && r.added_by === chatId,
          closed: isClosedName(r.name),
          locked: !canPick(r, chatId, pro),
        }))
        .sort((a, b) => Number(b.mine) - Number(a.mine) || b.perDay - a.perDay || a.name.localeCompare(b.name));
    },

    // Tashqaridan kelgan tanlovni qisqartirish: faqat shu odam tanlay oladigan guruhlar (yopig'i — Pro yoki o'zi qo'shgan),
    // ro'yxatdagi yozilishi bilan. → ["@TutGruz", "-100…", ...] (tartib — kelgan tartibda)
    allowedFeedSources(chatId, names, { pro = false } = {}) {
      const visible = new Map(
        db
          .prepare(`SELECT name, added_by FROM sources WHERE ${LISTED}`)
          .all()
          .filter((r) => canPick(r, chatId, pro))
          .map((r) => [r.name.toLowerCase(), r.name]),
      );
      const out = [];
      for (const name of Array.isArray(names) ? names : []) {
        const hit = visible.get(String(name).trim().toLowerCase());
        if (hit && !out.includes(hit)) out.push(hit);
      }
      return out;
    },

    // Yopiq guruhni o'z akkaunti bilan qo'shgan foydalanuvchi (roles.js planAllows owner) → chat id | null
    sourceOwner(name) {
      return db.prepare("SELECT added_by FROM sources WHERE name = ?").get(String(name))?.added_by ?? null;
    },

    // Guruh nomi (@nomi o'rniga sarlavha): bot va boshqaruv markazidagi profil matni uchun → { "@nomi": "Sarlavha" }
    sourceTitles() {
      return Object.fromEntries(db.prepare("SELECT name, title FROM sources WHERE title IS NOT NULL").all().map((r) => [r.name.toLowerCase(), r.title]));
    },
  };
}
