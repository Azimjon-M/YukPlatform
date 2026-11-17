// Collector'ning Telegram akkauntlari (2026-11-13, Azimjon: do'stining yopiq haydovchilar guruhlari).
// Yopiq guruhni faqat unga A'ZO akkaunt o'qiy oladi. Shuning uchun collector bir nechta akkaunt bilan ishlaydi:
//   «asosiy» — avvalgi akkaunt (apps/collector/telegram.session yoki .env TG_SESSION), ochiq guruhlarni o'qiydi;
//   qo'shimchalar — apps/collector/sessions/<nom>.session (egasi serverda o'zi kiradi: npm run tg:login -- --account <nom>).
// Collector har akkauntning kimligini va a'zo bo'lgan guruh/kanallari ro'yxatini shu yerga yozadi, boshqaruv markazi
// («Manbalar» → «Yopiq guruh qo'shish») shu ro'yxatdan tanlaydi. Manba qaysi akkaunt bilan o'qilishi — sources.account
// (NULL — asosiy).
import { createHash } from "node:crypto";

export const MAIN_TG_ACCOUNT = "asosiy";
// Akkaunt nomi = sessiya fayli nomi: kichik lotin harfi, raqam, _ va -, 2–20 belgi
export const TG_ACCOUNT_NAME = /^[a-z][a-z0-9_-]{1,19}$/;

// Telefon raqamining xeshi — bazada raqamning o'zini saqlamay, «shu raqam allaqachon ulanganmi?» ni tekshirish uchun.
// Faqat raqamlar olinadi (+, bo'shliq, format farqlari e'tiborga olinmaydi), shuning uchun "+998 90…" va "998 90…" bir xil chiqadi.
// Bir yo'nalishli: xeshdan raqamni tiklab bo'lmaydi; bo'sh/raqamsiz kiritma uchun null (hech narsaga mos kelmaydi).
export function hashPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits ? createHash("sha256").update(`yuk-tg-phone:${digits}`).digest("hex") : null;
}
// Avtomatik Pro (Azimjon, 2026-11-16: «kontakt ulashib va accountlarni bog'lash qilgan bo'lsa unga automatic pro ber»):
// raqamini ulashgan VA Mini App'dan kamida bitta Telegram akkauntini bog'lagan (sessiyasi bekor qilinmagan / dublikat emas).
// Bazaga yozilmaydi — har safar hisoblanadi: raqamni o'chirsa yoki akkaunt chiqib ketsa, o'zi tushadi.
// plan ustuni — boshqaruv markazidan qo'lda berilgani
export const AUTO_PRO_SQL = `(drivers.phone IS NOT NULL AND EXISTS (SELECT 1 FROM tg_accounts t WHERE t.added_by = drivers.chat_id
  AND COALESCE(t.status, 'ok') NOT IN ('logged_out', 'duplicate')))`;

const REFRESH_KEY = "tg_dialogs_request";
const DAY = 24 * 60 * 60 * 1000;

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
  addedBy: row.added_by ?? null, // Mini App'dan qo'shgan foydalanuvchi (chat id)
  phoneHash: row.phone_hash ?? null, // telefon raqamining xeshi (dublikatni erta aniqlash uchun; raqamning o'zi emas)
  scanRequestedAt: row.scan_requested_at ?? null, // «🔎 Auto scan» bosilgan, navbat hali tugamagan
  scanDoneAt: row.scan_done_at ?? null,
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
  const listDialogsToScan = (account, options) => queries.dialogsToScan(account, options);
  const queries = {
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

    // Mini App'dan kirish tugadi: akkaunt shu foydalanuvchiniki. Collector qatorni hali yozmagan bo'lsa — yaratiladi
    // (saveTgAccount added_by ga tegmaydi, shuning uchun egasi saqlanib qoladi).
    // phoneHash — kirgan raqamning xeshi: keyinchalik shu raqamni boshqa nom bilan qo'shishga urinishni erta to'xtatadi.
    // Berilmasa (undefined/null) eski xesh saqlanib qoladi (COALESCE).
    setTgAccountOwner(name, chatId, phoneHash) {
      db.prepare(
        `INSERT INTO tg_accounts (name, added_by, phone_hash, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET added_by = excluded.added_by,
           phone_hash = COALESCE(excluded.phone_hash, tg_accounts.phone_hash), updated_at = excluded.updated_at`,
      ).run(name, chatId == null ? null : Number(chatId), phoneHash ?? null, now());
    },

    // Faqat telefon xeshini saqlash (admin «🛠 Boshqaruv» qo'shgan, egasi yo'q akkauntlar uchun — setTgAccountOwner chaqirilmaydi).
    // phoneHash null bo'lsa eski xesh saqlanadi (COALESCE)
    setTgAccountPhoneHash(name, phoneHash) {
      if (phoneHash == null) return;
      db.prepare(
        `INSERT INTO tg_accounts (name, phone_hash, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET phone_hash = COALESCE(excluded.phone_hash, tg_accounts.phone_hash), updated_at = excluded.updated_at`,
      ).run(name, phoneHash, now());
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

    // --- Akkaunt guruhlarini tekshirish «🔎 Auto scan» (2026-11-13, Azimjon: «"+ Guruh qo'shish" dagi tekshirish
    // algoritmidek» → «dashboarddan foydalanuvchini tanlab auto scanni bossam … bildirishnoma borishi shart emas»).
    // Faqat boshqaruv markazida bosilganda (requestAccountScan): collector (live.js scanNext) shu akkauntning hali manba
    // bo'lmagan guruhlarini o'sha akkaunt bilan probe.js judgeProbe dan o'tkazadi; o'tgani — 24 soatlik sinovga (bot
    // userSources.js reviewTrial — «➕ Guruh qo'shish» bilan bir xil). Navbat tugagach so'rov o'chadi (finishAccountScan).

    requestAccountScan(name) {
      const row = db.prepare("SELECT name FROM tg_accounts WHERE name = ?").get(name);
      if (!row) return null;
      const time = now();
      db.prepare("UPDATE tg_accounts SET scan_requested_at = ?, updated_at = ? WHERE name = ?").run(time, time, name);
      return time;
    },

    finishAccountScan(name) {
      const time = now();
      db.prepare("UPDATE tg_accounts SET scan_requested_at = NULL, scan_done_at = ?, updated_at = ? WHERE name = ?").run(time, time, name);
    },

    // Tekshirilishi kerak bo'lgan guruhlar: hali manba emas (peer id yoki @username bo'yicha) va since (so'rov vaqti)dan
    // keyin tekshirilmagan; tekshiruvdan o'tib, sinovda yiqilgan (o'chirilgan) manba — qayta. exclude — ["@kanal", "-100…"]
    // (o'zimizning kanal/guruhlar — ular «skipped» bo'lib qoladi). since null — so'rov yo'q → bo'sh ro'yxat
    dialogsToScan(account, { limit = 1, since = null, exclude = [] } = {}) {
      if (since == null) return [];
      const skip = new Set(exclude.map((x) => String(x).toLowerCase()));
      const known = new Map(db.prepare("SELECT name, auto_scan, check_state, check_at FROM sources").all().map((r) => [r.name.toLowerCase(), r]));
      const scans = new Map(db.prepare("SELECT * FROM dialog_scans").all().map((r) => [r.peer_id, r]));
      const out = [];
      for (const row of db.prepare("SELECT * FROM tg_dialogs WHERE account = ? ORDER BY members DESC, title").all(account)) {
        const d = dialogRow(row);
        const names = [d.peerId, d.username ? `@${d.username}` : null].filter(Boolean).map((n) => n.toLowerCase());
        if (names.some((n) => skip.has(n))) continue;
        const scan = scans.get(d.peerId);
        if (scan?.state === "skipped" || (scan && scan.at >= since)) continue;
        const source = names.map((n) => known.get(n)).find(Boolean);
        if (source && !(source.auto_scan && source.check_state === "failed")) continue;
        out.push(d);
        if (out.length >= limit) break;
      }
      return out;
    },

    finishDialogScan(peerId, { account, state, note = null, stats = null }) {
      db.prepare(
        `INSERT INTO dialog_scans (peer_id, account, state, note, stats, at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (peer_id) DO UPDATE SET account = excluded.account, state = excluded.state, note = excluded.note,
           stats = excluded.stats, at = excluded.at`,
      ).run(String(peerId), account, state, note, stats == null ? null : JSON.stringify(stats), now());
    },

    // Tekshiruvdan o'tgan guruh → manba, darhol 24 soatlik sinovda (check_state trial, yoqilgan). account — uni o'qiydigan
    // akkaunt (NULL — asosiy). addedBy — akkaunt egasi (boshqaruv markazida «👤 Foydalanuvchi qo'shgan»; asosiyda NULL).
    // Mavjud manbaga tegmaydi, faqat shu yo'l bilan qo'shilib sinovdan o'tmaganini qayta qo'yadi → true/false
    addScannedSource({ name, account = null, title = null, chatType = null, members = null, addedBy = null, note = null, stats = null, trialMs = DAY }) {
      const time = now();
      const existing = db.prepare("SELECT * FROM sources WHERE lower(name) = lower(?)").get(name);
      if (existing && !(existing.auto_scan && existing.check_state === "failed")) return false;
      // Yopiq guruh (raqamli id) — sinovsiz, darhol doimiy (judgeClosed o'tkazgan; Azimjon, 2026-11-16)
      const closed = /^-\d+$/.test(String(name));
      const state = closed ? "ok" : "trial";
      const values = [addedBy, title, members, chatType, time, closed ? null : time + trialMs, note, JSON.stringify({ probe: stats }), account];
      if (existing) {
        db.prepare(
          `UPDATE sources SET enabled = 1, added_by = ?, title = ?, members = ?, chat_type = ?, check_state = '${state}', check_at = ?,
             check_until = ?, check_note = ?, check_stats = ?, check_notified = NULL, account = ?, auto_scan = 1 WHERE name = ?`,
        ).run(...values, existing.name);
        return true;
      }
      db.prepare(
        `INSERT INTO sources (added_by, title, members, chat_type, check_at, check_until, check_note, check_stats, account,
           name, enabled, note, created_at, check_state, auto_scan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, '${state}', 1)`,
      ).run(...values, name, "akkaunt guruhlaridan (Auto scan)", time);
      return true;
    },

    // --- Yopiq guruhning taklif havolasi (invite_checks) ---
    // Bot: foydalanuvchi yubordi. accounts — uning ishlab turgan akkauntlari (navbat bilan tekshiriladi)
    addInviteCheck({ chatId, hash, accounts }) {
      return Number(
        db
          .prepare("INSERT INTO invite_checks (chat_id, hash, accounts, state, created_at) VALUES (?, ?, ?, 'new', ?)")
          .run(chatId, hash, JSON.stringify(accounts), now()).lastInsertRowid,
      );
    },

    // Collector: shu akkaunt navbati kelgan so'rovlar (eskisi birinchi)
    inviteChecksFor(account, { limit = 1 } = {}) {
      return db
        .prepare("SELECT * FROM invite_checks WHERE state = 'new' ORDER BY id")
        .all()
        .filter((r) => JSON.parse(r.accounts)[r.tried] === account)
        .slice(0, limit)
        .map((r) => ({ id: r.id, chatId: r.chat_id, hash: r.hash }));
    },

    // Collector natijasi: found { peerId, title, chatType, members } | not_member (keyingi akkauntga o'tadi) | invalid | error
    finishInviteCheck(id, { state, account = null, peerId = null, title = null, chatType = null, members = null, error = null }) {
      const row = db.prepare("SELECT * FROM invite_checks WHERE id = ?").get(id);
      if (!row) return;
      if (state === "not_member" && row.tried + 1 < JSON.parse(row.accounts).length) {
        db.prepare("UPDATE invite_checks SET tried = tried + 1 WHERE id = ?").run(id);
        return;
      }
      db.prepare(
        "UPDATE invite_checks SET state = ?, account = ?, peer_id = ?, title = ?, chat_type = ?, members = ?, error = ? WHERE id = ?",
      ).run(state, account, peerId, title, chatType, members, error, id);
    },

    // Bot: tugagan, hali javob yozilmagan so'rovlar; bir soatdan eskisi — collector ishlamayapti → «error»
    inviteResults({ staleMs = 60 * 60 * 1000 } = {}) {
      db.prepare("UPDATE invite_checks SET state = 'error', error = 'timeout' WHERE state = 'new' AND created_at < ?").run(now() - staleMs);
      return db
        .prepare("SELECT * FROM invite_checks WHERE state <> 'new' AND reported = 0 ORDER BY id")
        .all()
        .map((r) => ({
          id: r.id,
          chatId: r.chat_id,
          state: r.state,
          peerId: r.peer_id,
          account: r.account,
          title: r.title,
          chatType: r.chat_type,
          members: r.members,
          error: r.error,
        }));
    },

    markInviteReported(id) {
      db.prepare("UPDATE invite_checks SET reported = 1 WHERE id = ?").run(id);
    },

    // Tekshiruv natijasi (boshqaruv markazi, Mini App): checked — tekshirilgan, pending — navbatda (so'rov bo'lsa),
    // trial / ok / failed — manbaga olinganlar holati, rejected — yuk guruhi emas, running/requestedAt/doneAt
    dialogScanSummary(account) {
      const row = db.prepare("SELECT scan_requested_at, scan_done_at FROM tg_accounts WHERE name = ?").get(account);
      const by = Object.fromEntries(
        db.prepare("SELECT state, COUNT(*) AS n FROM dialog_scans WHERE account = ? GROUP BY state").all(account).map((r) => [r.state, r.n]),
      );
      // Manbalar holati — dialog_scans orqali (ochiq guruh @username bilan, asosiy akkaunt o'qiydi — account NULL)
      const st = Object.fromEntries(
        db
          .prepare(
            `SELECT s.check_state AS state, COUNT(*) AS n FROM dialog_scans d
               JOIN tg_dialogs t ON t.account = d.account AND t.peer_id = d.peer_id
               JOIN sources s ON s.auto_scan = 1 AND (s.name = d.peer_id OR lower(s.name) = '@' || lower(t.username))
              WHERE d.account = ? AND d.state = 'passed' GROUP BY s.check_state`,
          )
          .all(account)
          .map((r) => [r.state, r.n]),
      );
      const requestedAt = row?.scan_requested_at ?? null;
      return {
        running: requestedAt != null,
        requestedAt,
        doneAt: row?.scan_done_at ?? null,
        total: db.prepare("SELECT COUNT(*) AS n FROM tg_dialogs WHERE account = ?").get(account).n,
        checked: (by.passed ?? 0) + (by.rejected ?? 0) + (by.error ?? 0),
        pending: requestedAt == null ? 0 : listDialogsToScan(account, { limit: 100_000, since: requestedAt }).length,
        rejected: by.rejected ?? 0,
        errors: by.error ?? 0,
        trial: st.trial ?? 0,
        ok: st.ok ?? 0,
        failed: st.failed ?? 0,
      };
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
  return queries;
}
