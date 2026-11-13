// Collector'ning Telegram akkauntlari (2026-11-13, Azimjon: do'stining yopiq haydovchilar guruhlari).
// Yopiq guruhni faqat unga A'ZO akkaunt o'qiy oladi. Shuning uchun collector bir nechta akkaunt bilan ishlaydi:
//   «asosiy» — avvalgi akkaunt (apps/collector/telegram.session yoki .env TG_SESSION), ochiq guruhlarni o'qiydi;
//   qo'shimchalar — apps/collector/sessions/<nom>.session (egasi serverda o'zi kiradi: npm run tg:login -- --account <nom>).
// Collector har akkauntning kimligini va a'zo bo'lgan guruh/kanallari ro'yxatini shu yerga yozadi, boshqaruv markazi
// («Manbalar» → «Yopiq guruh qo'shish») shu ro'yxatdan tanlaydi. Manba qaysi akkaunt bilan o'qilishi — sources.account
// (NULL — asosiy).
export const MAIN_TG_ACCOUNT = "asosiy";
// Akkaunt nomi = sessiya fayli nomi: kichik lotin harfi, raqam, _ va -, 2–20 belgi
export const TG_ACCOUNT_NAME = /^[a-z][a-z0-9_-]{1,19}$/;
const REFRESH_KEY = "tg_dialogs_request";

const accountRow = (row) => ({
  name: row.name,
  userId: row.user_id ?? null,
  username: row.username ?? null,
  firstName: row.first_name ?? null,
  // ok — ishlayapti | error — ulanib bo'lmadi (error — nima uchun, qayta urinadi) | logged_out — sessiya bekor qilingan
  // yoki fayli o'chirilgan | duplicate — boshqa nom bilan ulangan akkauntning o'zi
  status: row.status ?? null,
  error: row.error ?? null,
  dialogsAt: row.dialogs_at ?? null,
  updatedAt: row.updated_at,
});

const dialogRow = (row) => ({
  account: row.account,
  peerId: row.peer_id,
  title: row.title ?? "",
  username: row.username ?? null,
  type: row.type ?? null, // guruh | kanal
  members: row.members ?? null,
});

export function createTgAccountQueries(db, now) {
  return {
    // Collector yozadi: kim (getMe) va holati. Faqat berilgan maydonlar o'zgaradi
    saveTgAccount(name, { userId, username, firstName, status, error } = {}) {
      const old = db.prepare("SELECT * FROM tg_accounts WHERE name = ?").get(name);
      const pick = (value, column) => (value === undefined ? (old?.[column] ?? null) : value);
      db.prepare(
        `INSERT INTO tg_accounts (name, user_id, username, first_name, status, error, dialogs_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET user_id = excluded.user_id, username = excluded.username,
           first_name = excluded.first_name, status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`,
      ).run(
        name,
        pick(userId == null ? userId : String(userId), "user_id"),
        pick(username, "username"),
        pick(firstName, "first_name"),
        pick(status, "status"),
        pick(error, "error"),
        old?.dialogs_at ?? null,
        now(),
      );
    },

    listTgAccounts() {
      const counts = new Map(db.prepare("SELECT account, COUNT(*) AS n FROM tg_dialogs GROUP BY account").all().map((r) => [r.account, r.n]));
      return db
        .prepare(`SELECT * FROM tg_accounts ORDER BY name = '${MAIN_TG_ACCOUNT}' DESC, name`)
        .all()
        .map((row) => ({ ...accountRow(row), dialogs: counts.get(row.name) ?? 0 }));
    },

    // Akkaunt a'zo bo'lgan guruh/kanallar — butunlay almashtiriladi (chiqib ketgan guruh ro'yxatdan o'chadi).
    // chats — telegram.js listChats: [{ id, title, username, type, members }]
    setTgDialogs(name, chats) {
      const insert = db.prepare("INSERT OR REPLACE INTO tg_dialogs (account, peer_id, title, username, type, members) VALUES (?, ?, ?, ?, ?, ?)");
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM tg_dialogs WHERE account = ?").run(name);
        for (const chat of chats) insert.run(name, String(chat.id), chat.title ?? "", chat.username ?? null, chat.type ?? null, chat.members ?? null);
        db.prepare("UPDATE tg_accounts SET dialogs_at = ?, updated_at = ? WHERE name = ?").run(now(), now(), name);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    // account berilsa — faqat o'shaniki
    tgDialogs({ account = null } = {}) {
      const rows = account
        ? db.prepare("SELECT * FROM tg_dialogs WHERE account = ? ORDER BY title").all(account)
        : db.prepare("SELECT * FROM tg_dialogs ORDER BY account, title").all();
      return rows.map(dialogRow);
    },

    // «-100123…» — qaysi akkauntlar shu guruhda (asosiy birinchi)
    findTgDialog(peerId) {
      return db
        .prepare(`SELECT * FROM tg_dialogs WHERE peer_id = ? ORDER BY account = '${MAIN_TG_ACCOUNT}' DESC, account`)
        .all(String(peerId))
        .map(dialogRow);
    },

    // Boshqaruv markazidagi «Ro'yxatni yangilash»: collector har akkaunt ro'yxatini 1 daqiqa ichida qayta oladi
    requestDialogsRefresh() {
      const time = now();
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(REFRESH_KEY, String(time));
      return time;
    },

    dialogsRefreshRequest() {
      const value = db.prepare("SELECT value FROM settings WHERE key = ?").get(REFRESH_KEY)?.value;
      return value == null ? null : Number(value);
    },
  };
}
