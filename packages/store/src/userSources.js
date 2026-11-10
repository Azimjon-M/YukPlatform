// Foydalanuvchi qo'shgan guruh/kanallar (2026-11-10, Azimjon: «o'zingiz belgilagan guruhlardan»).
// Raqamini ulashgan foydalanuvchi botga ochiq guruh/kanal havolasini yuboradi → shu yerda «sources» ga yoziladi.
// Uch bosqich (sources.check_state):
//   probe  — collector guruhning oxirgi xabarlarini ko'rib chiqishi kutilmoqda (manba hali o'chiq, e'lon olinmaydi);
//   trial  — sinov: manba yoqilgan, check_until gacha (24 soat) kamida 5 ta yuk e'loni chiqishi kerak;
//   ok     — sinovdan o'tdi, doimiy manba;  failed — rad etildi yoki sinovdan o'tmadi (manba o'chiriladi).
// Bot (apps/bot userSources.js) sinov muddatini kuzatadi va natijani qo'shgan odamga yozadi (check_notified — oxirgi
// aytilgan holat, ikki marta yozmaslik uchun). Boshqaruv markazidan qo'shilgan manbalarda bular hammasi NULL.
const HOUR = 60 * 60 * 1000;
const parse = (text) => (text == null ? null : JSON.parse(text));

// Yuk e'loni deb sanaladigan natija: AI yoki qoidaviy parser tushundi va yuk/bo'sh mashina topdi.
// «Boshqa yo'nalish: …» — haqiqiy yuk e'loni, faqat bizning yo'nalishlardan tashqari (pipeline.js handleParsed)
const IS_LOAD = "(status = 'done' AND (error IS NULL OR error LIKE 'Boshqa yo%'))";

export function userSourceRow(row) {
  if (!row) return null;
  return {
    name: row.name,
    enabled: row.enabled === 1,
    addedBy: row.added_by ?? null,
    title: row.title ?? null,
    members: row.members ?? null,
    chatType: row.chat_type ?? null, // channel | group
    checkState: row.check_state ?? null,
    checkAt: row.check_at ?? null,
    checkUntil: row.check_until ?? null,
    checkNote: row.check_note ?? null,
    checkStats: parse(row.check_stats),
    createdAt: row.created_at,
  };
}

export function createUserSourceQueries(db, now) {
  const byName = db.prepare("SELECT * FROM sources WHERE lower(name) = lower(?)");
  return {
    // "@Guruh" yoki "guruh" — katta-kichik harf farqi yo'q (Telegram manzillarida ham yo'q)
    findSource(name) {
      const clean = String(name ?? "").replace(/^@/, "");
      return userSourceRow(byName.get(`@${clean}`));
    },

    // Bir odam: hozir tekshirilayotgan (probe/trial) va oxirgi 24 soatda yuborgan manbalari soni; all — hamma odamlar 24 soatda
    userSourceCounts(chatId) {
      const since = now() - 24 * HOUR;
      const one = (sql, ...params) => db.prepare(sql).get(...params).n;
      return {
        checking: one("SELECT COUNT(*) AS n FROM sources WHERE added_by = ? AND check_state IN ('probe', 'trial')", chatId),
        today: one("SELECT COUNT(*) AS n FROM sources WHERE added_by = ? AND created_at > ?", chatId, since),
        all: one("SELECT COUNT(*) AS n FROM sources WHERE added_by IS NOT NULL AND created_at > ?", since),
      };
    },

    // Shu odam qo'shgan manbalar (eng yangisi birinchi) — «➕ Guruh qo'shish» xabarida ro'yxat
    userSourcesOf(chatId, { limit = 10 } = {}) {
      return db.prepare("SELECT * FROM sources WHERE added_by = ? ORDER BY created_at DESC LIMIT ?").all(chatId, limit).map(userSourceRow);
    },

    // Yangi manba (yoki bir hafta oldin rad etilgani qayta yuborildi): «probe» holatida, o'chiq — collector oxirgi
    // xabarlarini ko'rib chiqadi (sourcesToProbe). Boshqa holatdagi mavjud manbaga tegilmaydi → false
    addUserSource({ name, chatId, title = null, members = null, chatType = null }) {
      const existing = byName.get(name);
      const time = now();
      if (existing && existing.check_state !== "failed") return false;
      if (existing) {
        db.prepare(
          `UPDATE sources SET enabled = 0, added_by = ?, title = ?, members = ?, chat_type = ?, check_state = 'probe', check_at = ?,
             check_until = NULL, check_note = NULL, check_stats = NULL, check_notified = NULL, created_at = ? WHERE name = ?`,
        ).run(chatId, title, members, chatType, time, time, existing.name);
        return true;
      }
      db.prepare(
        `INSERT INTO sources (name, enabled, note, created_at, added_by, title, members, chat_type, check_state, check_at)
         VALUES (?, 0, ?, ?, ?, ?, ?, ?, 'probe', ?)`,
      ).run(name, "foydalanuvchi qo'shdi", time, chatId, title, members, chatType, time);
      return true;
    },

    // Collector: ko'rib chiqilishi kerak bo'lgan manbalar (eskisi birinchi)
    sourcesToProbe({ limit = 5 } = {}) {
      return db.prepare("SELECT * FROM sources WHERE check_state = 'probe' ORDER BY check_at LIMIT ?").all(limit).map(userSourceRow);
    },

    // Oxirgi xabarlarni ko'rib chiqish natijasi (collector, yoki u ishlamasa — bot): ok → sinov boshlanadi (manba yoqiladi,
    // trialMs gacha), aks holda — rad etildi. stats — nechta xabar, nechtasi yuk e'loniga o'xshaydi va h.k. (JSON)
    finishProbe(name, { ok, note = null, stats = null, trialMs = 24 * HOUR }) {
      const time = now();
      const sql = ok
        ? "UPDATE sources SET enabled = 1, check_state = 'trial', check_at = ?, check_until = ?, check_note = ?, check_stats = ? WHERE name = ? AND check_state = 'probe'"
        : "UPDATE sources SET enabled = 0, check_state = 'failed', check_at = ?, check_until = ?, check_note = ?, check_stats = ? WHERE name = ? AND check_state = 'probe'";
      const stored = JSON.stringify({ probe: stats });
      return db.prepare(sql).run(time, ok ? time + trialMs : null, note, stored, name).changes > 0;
    },

    trialSources() {
      return db.prepare("SELECT * FROM sources WHERE check_state = 'trial' ORDER BY check_until").all().map(userSourceRow);
    },

    // Sinov boshlangandan beri shu manbadan: loads — yuk e'loni bo'lib chiqqanlar (AI yoki qoidaviy parser), processed —
    // tahlil qilinganlari (eskirib, AI'ga bormaganlari hisobga olinmaydi), repeats — boshqa guruhda allaqachon bo'lgan
    // yuk e'lonining aynan nusxasi (matni bir xil — bizga yangi narsa bermaydi), noContact — telefon ham, lichka ham
    // yo'q bo'lgani uchun AI'siz yopilganlar (apps/bot pipeline.js «Aloqasiz: …»; processed ichida), posts — hammasi
    trialStats(name, since) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS posts,
                  SUM(${IS_LOAD}) AS loads,
                  SUM(status IN ('done', 'failed') AND (error IS NULL OR error NOT LIKE 'Eskirgan%')) AS processed,
                  SUM(status = 'new') AS waiting,
                  SUM(status = 'done' AND error LIKE 'Aloqasiz%') AS noContact
           FROM posts WHERE source = ? AND created_at >= ?`,
        )
        .get(name, since);
      const repeats = db
        .prepare(
          `SELECT COUNT(*) AS n FROM posts d WHERE d.source = ? AND d.created_at >= ? AND d.status = 'duplicate'
             AND EXISTS (SELECT 1 FROM posts o WHERE o.text_key = d.text_key AND o.id <> d.id
                           AND o.status = 'done' AND (o.error IS NULL OR o.error LIKE 'Boshqa yo%'))`,
        )
        .get(name, since).n;
      return { posts: row.posts, loads: row.loads ?? 0, processed: row.processed ?? 0, waiting: row.waiting ?? 0, repeats, noContact: row.noContact ?? 0 };
    },

    // Sinov tugadi: ok → doimiy (yoqilganligi o'zgarmaydi — admin o'chirib qo'ygan bo'lsa, o'chiq qoladi), aks holda o'chiriladi
    finishTrial(name, { ok, note = null, stats = null }) {
      const row = byName.get(name);
      if (!row || row.check_state !== "trial") return false;
      const stored = JSON.stringify({ ...(parse(row.check_stats) ?? {}), trial: stats });
      db.prepare(`UPDATE sources SET ${ok ? "" : "enabled = 0, "}check_state = ?, check_at = ?, check_note = ?, check_stats = ? WHERE name = ?`).run(
        ok ? "ok" : "failed",
        now(),
        note,
        stored,
        row.name,
      );
      return true;
    },

    // Qo'shgan odamga hali aytilmagan natijalar (sinov boshlandi / rad etildi / o'tdi)
    sourceNotices() {
      return db
        .prepare(
          `SELECT * FROM sources WHERE added_by IS NOT NULL AND check_state IN ('trial', 'ok', 'failed')
             AND (check_notified IS NULL OR check_notified <> check_state) ORDER BY check_at`,
        )
        .all()
        .map(userSourceRow);
    },

    markSourceNotified(name, state) {
      return db.prepare("UPDATE sources SET check_notified = ? WHERE name = ?").run(state, name).changes > 0;
    },
  };
}
