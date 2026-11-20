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
// Akkaunt kimniki (2026-11-20, Azimjon: «men QR/kod orqali kimnidir qo'shdim, ammo u bot bilan ishlamagan. Qachondir u
// botni ishga tushirsa, undagi sozlamalarda akkaunt ulashilgan chiqishi kerak. @username ni ham hisobga ol … @username yoki
// raqami ulashilganlarda bo'lsa, ulashilgan bo'lib qolsin»): kim qo'shgan (added_by) YOKI akkauntning o'zi shu odam —
// Telegram ID (user_id), username yoki raqam (phone_hash — tg_phone_hash(drivers.phone), index.js ro'yxatdan o'tkazadi) mos.
// Masalan asosiy akkaunt terminaldan ulangan (added_by yo'q), lekin uning egasi botda — endi u ham «✅ Bog'landi» ko'radi
export const OWNS_ACCOUNT_SQL = `(t.added_by = drivers.chat_id OR t.user_id = CAST(drivers.chat_id AS TEXT)
  OR (drivers.username IS NOT NULL AND t.username IS NOT NULL AND lower(t.username) = lower(drivers.username))
  OR (drivers.phone IS NOT NULL AND t.phone_hash IS NOT NULL AND t.phone_hash = tg_phone_hash(drivers.phone)))`;
export const AUTO_PRO_SQL = `(drivers.phone IS NOT NULL AND EXISTS (SELECT 1 FROM tg_accounts t WHERE ${OWNS_ACCOUNT_SQL}
  AND COALESCE(t.status, 'ok') NOT IN ('logged_out', 'duplicate')))`;

const REFRESH_KEY = "tg_dialogs_request";
const DAY = 24 * 60 * 60 * 1000;
// «🔎 Auto scan»: tekshirilgan guruh qachon qayta ko'riladi (dialog_scans holati bo'yicha; yo'q — hech qachon).
// rejected — yuk guruhi emas edi (keyin e'lon tusha boshlashi mumkin), error — o'qib bo'lmagan edi
export const SCAN_RECHECK = { rejected: 7 * DAY, error: DAY };

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

    // Shu foydalanuvchiniki bo'lgan akkauntlar (OWNS_ACCOUNT_SQL: qo'shgani yoki ID / username / raqam mos)
    tgAccountsOf(chatId) {
      const counts = new Map(db.prepare("SELECT account, COUNT(*) AS n FROM tg_dialogs GROUP BY account").all().map((r) => [r.account, r.n]));
      return db
        // LEFT JOIN: foydalanuvchi yozuvi bo'lmasa ham (qo'shgan odam) — added_by bo'yicha topiladi
        .prepare(`SELECT t.* FROM tg_accounts t LEFT JOIN drivers ON drivers.chat_id = ? WHERE t.added_by = ? OR (drivers.chat_id IS NOT NULL AND ${OWNS_ACCOUNT_SQL}) ORDER BY t.name`)
        .all(Number(chatId), Number(chatId))
        .map((row) => ({ ...accountRow(row), dialogs: counts.get(row.name) ?? 0 }));
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
      // Akkaunt yangi guruhlarga qo'shilgan bo'lishi mumkin — collector avval ro'yxatni yangilaydi (live.js scanNext kutadi)
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(REFRESH_KEY, String(time));
      return time;
    },

    finishAccountScan(name) {
      const time = now();
      db.prepare("UPDATE tg_accounts SET scan_requested_at = NULL, scan_done_at = ?, updated_at = ? WHERE name = ?").run(time, time, name);
    },

    // Tekshirilishi kerak bo'lgan guruhlar (2026-11-20, Azimjon: «yana scan qilsam yana boshidan scan qilayabdi! … bizda
    // tasdiqlangan yoki shunchaki bizda bo'lsa keyingisiga o'tsin, yana tekshirib o'tirmasdan»): faqat YANGI guruhlar.
    // O'tkazib yuboriladi: bizda manba (peer id yoki @username bo'yicha, istalgan holatda — boshqa akkaunt qo'shgan bo'lsa
    // ham), avval tekshirilgan (dialog_scans — peer id bo'yicha, qaysi akkaunt bilan bo'lsa ham: passed / skipped — doim,
    // rejected — SCAN_RECHECK.rejected (7 kun) o'tguncha, error — SCAN_RECHECK.error (1 kun) o'tguncha). Auto scan
    // qo'shib, 24 soatlik sinovdan o'tolmagan manba ham 7 kundan keyingina qayta ko'riladi.
    // exclude — ["@kanal", "-100…"] (o'zimizning kanal/guruhlar — «skipped»). since null — so'rov yo'q → bo'sh ro'yxat
    dialogsToScan(account, { limit = 1, since = null, exclude = [] } = {}) {
      if (since == null) return [];
      const time = now();
      const skip = new Set(exclude.map((x) => String(x).toLowerCase()));
      const known = new Map(db.prepare("SELECT name, auto_scan, check_state, check_at FROM sources").all().map((r) => [r.name.toLowerCase(), r]));
      const scans = new Map(db.prepare("SELECT * FROM dialog_scans").all().map((r) => [r.peer_id, r]));
      const out = [];
      for (const row of db.prepare("SELECT * FROM tg_dialogs WHERE account = ? ORDER BY members DESC, title").all(account)) {
        const d = dialogRow(row);
        const names = [d.peerId, d.username ? `@${d.username}` : null].filter(Boolean).map((n) => n.toLowerCase());
        if (names.some((n) => skip.has(n))) continue;
        const source = names.map((n) => known.get(n)).find(Boolean);
        if (source && !(source.auto_scan && source.check_state === "failed" && time - (source.check_at ?? 0) >= SCAN_RECHECK.rejected)) continue;
        const scan = scans.get(d.peerId);
        if (!source && scan) {
          const wait = SCAN_RECHECK[scan.state];
          if (wait == null || time - scan.at < wait) continue;
        }
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


    // --- O'quvchi akkauntlar (2026-11-20) ---
    // Ochiq guruhga qaysi akkauntlar a'zo: «@nom» (kichik harf) → Set(akkaunt). collector accounts.js accountSources shu
    // bilan a'zo bo'lmagan asosiy o'rniga a'zo akkauntga beradi (manzil so'ralmaydi, yangisi bir necha soniyada keladi)
    openSourceMembers() {
      const out = new Map();
      for (const r of db.prepare("SELECT account, lower(username) AS u FROM tg_dialogs WHERE username IS NOT NULL").all()) {
        const key = `@${r.u}`;
        if (!out.has(key)) out.set(key, new Set());
        out.get(key).add(r.account);
      }
      return out;
    },

    // Shu akkaunt qo'shilishi kerak bo'lgan guruhlar: foydalanuvchi qo'shgan (yoki Auto scan topgan) ochiq guruh sinovdan
    // o'tib tasdiqlangan (check_state ok), yoqilgan, tasdig'i since dan keyin, akkaunt hali a'zo emas va urinilmagan.
    // since — birinchi chaqiruvda settings.reader_joins_since ga yoziladi: eski tasdiqlanganlarga birdaniga qo'shilmaydi
    readerJoinCandidates(account, { limit = 5 } = {}) {
      let since = Number(db.prepare("SELECT value FROM settings WHERE key = 'reader_joins_since'").get()?.value);
      if (!Number.isFinite(since)) {
        since = now();
        db.prepare("INSERT INTO settings (key, value) VALUES ('reader_joins_since', ?) ON CONFLICT (key) DO NOTHING").run(String(since));
      }
      return db
        .prepare(
          `SELECT s.name, s.title FROM sources s
            WHERE s.enabled = 1 AND s.check_state = 'ok' AND s.added_by IS NOT NULL AND s.name LIKE '@%' AND s.check_at >= ?
              AND NOT EXISTS (SELECT 1 FROM reader_joins j WHERE j.name = s.name AND j.account = ?)
              AND NOT EXISTS (SELECT 1 FROM tg_dialogs d WHERE d.account = ? AND '@' || lower(d.username) = lower(s.name))
            ORDER BY s.check_at LIMIT ?`,
        )
        .all(since, account, account, limit)
        .map((r) => ({ name: r.name, title: r.title ?? null }));
    },

    // Hech bir o'quvchi akkaunt a'zo bo'lmagan yoqilgan ochiq guruh (2026-11-20, Azimjon: «3 ta meni accountim bor va ularni
    // qo'shish kerak bo'lgan guruh/kanallarga qo'sh»): shu akkaunt uchun BITTASINI band qiladi (reader_joins 'claimed') —
    // boshqa akkaunt uni olmaydi (bitta SQL — ikki akkaunt bir vaqtda so'rasa ham). Eng faoli (24 soatdagi e'lonlar) birinchi.
    // readers — .env TG_READERS. → { name, title } | null
    claimUncoveredJoin(account, readers) {
      const marks = readers.map(() => "?").join(", ");
      const row = db
        .prepare(
          `INSERT INTO reader_joins (name, account, state, at)
           SELECT s.name, ?, 'claimed', ? FROM sources s
            WHERE s.enabled = 1 AND s.name LIKE '@%'
              AND NOT EXISTS (SELECT 1 FROM reader_joins j WHERE j.name = s.name AND NOT (j.state = 'claimed' AND j.at < ?))
              AND NOT EXISTS (SELECT 1 FROM tg_dialogs d WHERE d.account IN (${marks}) AND '@' || lower(d.username) = lower(s.name))
            ORDER BY (SELECT COUNT(*) FROM posts p WHERE p.source = s.name AND p.created_at > ?) DESC, s.name
            LIMIT 1
           ON CONFLICT (name, account) DO UPDATE SET state = 'claimed', error = NULL, at = excluded.at
           RETURNING name`,
        )
        // band qilingan, lekin 1 soatda tugamagan (jarayon to'xtagan) — qayta olinadi
        .get(account, now(), now() - 60 * 60 * 1000, ...readers, now() - DAY);
      if (!row) return null;
      return { name: row.name, title: db.prepare("SELECT title FROM sources WHERE name = ?").get(row.name)?.title ?? null };
    },

    // Band qilingan, lekin qo'shilmagan (FLOOD_WAIT) — keyin yana olinadi
    releaseReaderJoin(name, account) {
      db.prepare("DELETE FROM reader_joins WHERE name = ? AND account = ? AND state = 'claimed'").run(name, account);
    },

    finishReaderJoin(name, account, { state, error = null }) {
      db.prepare(
        `INSERT INTO reader_joins (name, account, state, error, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (name, account) DO UPDATE SET state = excluded.state, error = excluded.error, at = excluded.at`,
      ).run(name, account, state, error, now());
    },

    // 24 soatda nechta guruhga qo'shildi (spam bo'lib ko'rinmasin — collector cheklaydi)
    readerJoinsSince(account, since) {
      return db.prepare("SELECT COUNT(*) AS n FROM reader_joins WHERE account = ? AND at > ? AND state IN ('joined', 'requested')").get(account, since).n;
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
