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

// Haydovchi ro'yxatda ko'radigan guruhlar (SQL sharti): yoqilgan, tekshiruvdan o'tayotgan yoki o'tgan
// (probe / failed — yo'q) va ochiq (@nomi) yoki shu odamning o'zi qo'shgan yopiq guruhi. Yopiq guruhni boshqa
// foydalanuvchi o'z akkaunti bilan qo'shgan bo'lsa — uning nomi boshqalarga ko'rsatilmaydi
const VISIBLE = `enabled = 1 AND (check_state IS NULL OR check_state IN ('trial', 'ok')) AND (name LIKE '@%' OR added_by = ?)`;

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
      const row = db.prepare("SELECT id, source, link, text, posted_at, sender, shipper FROM posts WHERE id = ?").get(id);
      if (!row) return null;
      return { id: row.id, source: row.source, link: row.link, text: row.text, postedAt: row.posted_at, sender: row.sender ?? null, fromShipper: row.shipper != null };
    },

    // «📌 Mening guruhlarim» ro'yxati: shu odam tanlay oladigan guruh/kanallar, eng faoli birinchi.
    // → [{ name, title, members, chatType, perDay, mine }]: perDay — oxirgi 24 soatda nechta e'lon (takrorlarsiz),
    // mine — o'zi «➕ Guruh qo'shish» bilan qo'shgan
    feedSources(chatId) {
      const rows = db.prepare(`SELECT name, title, members, chat_type, added_by FROM sources WHERE ${VISIBLE}`).all(chatId);
      const counts = new Map(
        db
          .prepare("SELECT lower(source) AS source, COUNT(*) AS n FROM posts WHERE created_at > ? AND status != 'duplicate' GROUP BY lower(source)")
          .all(now() - 24 * HOUR)
          .map((r) => [r.source, r.n]),
      );
      return rows
        .map((r) => ({
          name: r.name,
          title: r.title ?? null,
          members: r.members ?? null,
          chatType: r.chat_type ?? null,
          perDay: counts.get(r.name.toLowerCase()) ?? 0,
          mine: r.added_by != null && r.added_by === chatId,
        }))
        .sort((a, b) => Number(b.mine) - Number(a.mine) || b.perDay - a.perDay || a.name.localeCompare(b.name));
    },

    // Tashqaridan kelgan tanlovni qisqartirish: faqat shu odamga ko'rinadigan guruhlar, ro'yxatdagi yozilishi bilan.
    // → ["@TutGruz", ...] (tartib — kelgan tartibda)
    allowedFeedSources(chatId, names) {
      const visible = new Map(db.prepare(`SELECT name FROM sources WHERE ${VISIBLE}`).all(chatId).map((r) => [r.name.toLowerCase(), r.name]));
      const out = [];
      for (const name of Array.isArray(names) ? names : []) {
        const hit = visible.get(String(name).trim().toLowerCase());
        if (hit && !out.includes(hit)) out.push(hit);
      }
      return out;
    },

    // Guruh nomi (@nomi o'rniga sarlavha): bot va boshqaruv markazidagi profil matni uchun → { "@nomi": "Sarlavha" }
    sourceTitles() {
      return Object.fromEntries(db.prepare("SELECT name, title FROM sources WHERE title IS NOT NULL").all().map((r) => [r.name.toLowerCase(), r.title]));
    },
  };
}
