// Boshqaruv markazi (apps/api) uchun so'rovlar: yuklar ro'yxati va filtrlar, navbat, haydovchilar, manbalar, ko'rsatkichlar.
// Bot va collector bularni ishlatmaydi — ular index.js dagi asosiy funksiyalar bilan ishlaydi.

const HOUR = 60 * 60 * 1000;
const parse = (text) => (text == null ? null : JSON.parse(text));
const clampLimit = (limit, max = 200) => Math.min(Math.max(Number(limit) || 50, 1), max);
const clampOffset = (offset) => Math.max(Number(offset) || 0, 0);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function postRow(row) {
  return {
    id: row.id,
    source: row.source,
    messageId: row.message_id,
    link: row.link,
    text: row.text,
    postedAt: row.posted_at,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    doneAt: row.done_at ?? null,
  };
}

// SQL shartlari va qiymatlari: [["json_extract(...) = ?", value], ...] → { where, params }.
// Qiymati bo'sh shart tashlanadi; shartdagi har bir "?" uchun o'sha qiymat qo'yiladi.
function buildWhere(conditions) {
  const used = conditions.filter(([, value]) => value !== undefined && value !== null && value !== "");
  return {
    where: used.length ? `WHERE ${used.map(([sql]) => sql).join(" AND ")}` : "",
    params: used.flatMap(([sql, value]) => new Array(sql.split("?").length - 1).fill(value)),
  };
}

export function createAdminQueries(db, now) {
  return {
    // --- Yuklar ---
    // filters: from, to (viloyat kodi), truckClass, bodyType, q (matn), hours (oxirgi N soat)
    // → { total, items: [{ id, load, post, createdAt, sentTo, channelMessageId }] } — eng yangisi birinchi
    // kind: "yuk" (standart) yoki "mashina" (bo'sh mashina e'lonlari)
    listLoads({ from, to, truckClass, bodyType, q, hours, limit, offset, kind = "yuk" } = {}) {
      const { where, params } = buildWhere([
        ["l.kind = ?", kind],
        ["json_extract(l.data, '$.fromRegion') = ?", from],
        ["json_extract(l.data, '$.toRegion') = ?", to],
        ["json_extract(l.data, '$.truckClass') = ?", truckClass],
        ["json_extract(l.data, '$.bodyType') = ?", bodyType],
        ["(l.data LIKE ? OR p.text LIKE ?)", q ? `%${q}%` : null],
        ["l.created_at > ?", hours ? now() - Number(hours) * HOUR : null],
      ]);
      const values = params;
      const from_ = "FROM loads l JOIN posts p ON p.id = l.post_id";
      const total = db.prepare(`SELECT COUNT(*) AS n ${from_} ${where}`).get(...values).n;
      const rows = db
        .prepare(
          `SELECT l.id, l.data, l.created_at, l.sent_to, l.channel_message_id, p.source, p.link, p.posted_at
           ${from_} ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...values, clampLimit(limit), clampOffset(offset));
      return {
        total,
        items: rows.map((row) => ({
          id: row.id,
          load: parse(row.data),
          post: { source: row.source, link: row.link, postedAt: row.posted_at },
          createdAt: row.created_at,
          sentTo: row.sent_to,
          channelMessageId: row.channel_message_id,
        })),
      };
    },

    // --- E'lonlar navbati ---
    // status: new | done | duplicate | failed (bo'sh — hammasi); q — matn ichida qidirish
    listPosts({ status, q, limit, offset } = {}) {
      const { where, params } = buildWhere([
        ["status = ?", status],
        ["text LIKE ?", q ? `%${q}%` : null],
      ]);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM posts ${where}`).get(...params).n;
      const rows = db.prepare(`SELECT * FROM posts ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, clampLimit(limit), clampOffset(offset));
      return { total, items: rows.map(postRow) };
    },

    // Xato bilan tugagan e'lonni navbatga qaytaradi. id berilmasa — hamma xatolilarni. → nechtasi qaytdi
    retryFailed(id = null) {
      const sql = "UPDATE posts SET status = 'new', error = NULL, done_at = NULL WHERE status = 'failed'";
      const result = id == null ? db.prepare(sql).run() : db.prepare(`${sql} AND id = ?`).run(id);
      return Number(result.changes);
    },

    // --- Haydovchilar ---
    listDrivers() {
      return db
        .prepare("SELECT * FROM drivers ORDER BY updated_at DESC")
        .all()
        .map((row) => ({
          chatId: row.chat_id,
          name: row.name,
          username: row.username,
          role: row.role ?? (row.profile != null ? "haydovchi" : null),
          profile: parse(row.profile),
          registering: row.profile == null && row.draft != null,
          active: row.active === 1,
          plan: row.plan ?? "free",
          isAdmin: row.is_admin === 1,
          // O'z raqami (ixtiyoriy). Faqat boshqaruv markazida (localhost) ko'rsatiladi, Mini App'dagi admin ro'yxatida — yo'q
          phone: row.phone ?? null,
          phoneAt: row.phone_at ?? null,
          // Hisobdan chiqqan (web «🚪 Chiqish», store.signOut): rol va profil ustunlari bo'sh, lekin ma'lumot o'chmagan —
          // oxirgi rol va o'sha rolning sozlamalari ko'rsatiladi
          signedOutAt: row.signed_out_at ?? null,
          signedOutRole: row.signed_out_role ?? null,
          savedProfile: row.signed_out_role ? ((parse(row.profiles) ?? {})[row.signed_out_role] ?? null) : null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
    },

    // --- Manbalar (collector kuzatadigan guruhlar) ---
    listSources() {
      return db
        .prepare("SELECT * FROM sources ORDER BY created_at, name")
        .all()
        .map((row) => ({ name: row.name, enabled: row.enabled === 1, note: row.note, createdAt: row.created_at }));
    },

    // → true (qo'shildi) yoki false (allaqachon bor)
    addSource(name, { note = null, enabled = true } = {}) {
      const result = db.prepare("INSERT OR IGNORE INTO sources (name, enabled, note, created_at) VALUES (?, ?, ?, ?)").run(name, enabled ? 1 : 0, note, now());
      return result.changes > 0;
    },

    setSourceEnabled(name, enabled) {
      return db.prepare("UPDATE sources SET enabled = ? WHERE name = ?").run(enabled ? 1 : 0, name).changes > 0;
    },

    removeSource(name) {
      return db.prepare("DELETE FROM sources WHERE name = ?").run(name).changes > 0;
    },

    // Jadval bo'sh bo'lsa, .env dagi TG_SOURCES ro'yxatini bir marta yozadi
    seedSources(names) {
      const count = db.prepare("SELECT COUNT(*) AS n FROM sources").get().n;
      if (count > 0) return 0;
      let added = 0;
      for (const name of names) if (this.addSource(name)) added++;
      return added;
    },

    // Har bir manba bo'yicha oxirgi N soat: e'lonlar, takrorlar, yuklar, oxirgi e'lon vaqti
    sourceStats({ hours = 24 } = {}) {
      const since = now() - hours * HOUR;
      const posts = db
        .prepare(
          `SELECT source, COUNT(*) AS posts, SUM(status = 'duplicate') AS duplicates, MAX(posted_at) AS last_post_at
           FROM posts WHERE created_at > ? GROUP BY source`,
        )
        .all(since);
      const loads = db
        .prepare("SELECT p.source, COUNT(*) AS loads FROM loads l JOIN posts p ON p.id = l.post_id WHERE l.created_at > ? AND l.kind = 'yuk' GROUP BY p.source")
        .all(since);
      const out = {};
      for (const row of posts) out[row.source] = { posts: row.posts, duplicates: row.duplicates ?? 0, loads: 0, lastPostAt: row.last_post_at };
      for (const row of loads) (out[row.source] ??= { posts: 0, duplicates: 0, loads: 0, lastPostAt: null }).loads = row.loads;
      return out;
    },

    // --- Ko'rsatkichlar (bosh sahifa) ---
    metrics({ hours = 24 } = {}) {
      const time = now();
      const since = time - hours * HOUR;
      const count = (sql, ...params) => db.prepare(sql).get(...params).n;
      const statuses = Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS n FROM posts GROUP BY status").all().map((r) => [r.status, r.n]));

      // Kechikish: e'lon guruhda chiqqanidan yuk bazaga yozilib yuborilguncha (oxirgi soat), daqiqa
      const delays = db
        .prepare("SELECT l.created_at - p.posted_at AS ms FROM loads l JOIN posts p ON p.id = l.post_id WHERE l.created_at > ?")
        .all(time - HOUR)
        .map((r) => r.ms);
      const oldestNew = db.prepare("SELECT MIN(posted_at) AS t FROM posts WHERE status = 'new'").get().t;

      // Soatma-soat: kelgan e'lonlar (takrorsiz), tahlil qilingan e'lonlar, yangi yuklar
      const bucket = (rows) => {
        const out = new Array(hours).fill(0);
        for (const { t, n } of rows) {
          const index = hours - 1 - Math.floor((time - t) / HOUR);
          if (index >= 0 && index < hours) out[index] += n;
        }
        return out;
      };
      const group = (sql) => db.prepare(sql).all(since);
      const hourly = {
        posts: bucket(group("SELECT created_at AS t, 1 AS n FROM posts WHERE created_at > ? AND status != 'duplicate'")),
        processed: bucket(group("SELECT done_at AS t, 1 AS n FROM posts WHERE done_at > ?")),
        loads: bucket(group("SELECT created_at AS t, 1 AS n FROM loads WHERE created_at > ? AND kind = 'yuk'")),
      };

      // drivers — haydovchilar (rolsiz eski yozuvlar ham), shippers — yuk beruvchilar
      const users = (role) =>
        db
          .prepare("SELECT COUNT(*) AS total, SUM(active) AS active FROM drivers WHERE profile IS NOT NULL AND COALESCE(role, 'haydovchi') = ?")
          .get(role);
      const drivers = users("haydovchi");
      const shippers = users("yuk_beruvchi");
      const loadStats = (kind) =>
        db
          .prepare("SELECT COUNT(*) AS total, SUM(sent_to > 0) AS delivered, SUM(sent_to) AS messages FROM loads WHERE created_at > ? AND kind = ?")
          .get(since, kind);
      const loads = loadStats("yuk");
      const trucks = loadStats("mashina");
      return {
        now: time,
        hours,
        queue: {
          waiting: statuses.new ?? 0,
          failed: statuses.failed ?? 0,
          oldestWaitingMin: oldestNew ? Math.round((time - oldestNew) / 60000) : null,
        },
        posts: statuses,
        lastHour: {
          posts: count("SELECT COUNT(*) AS n FROM posts WHERE created_at > ? AND status != 'duplicate'", time - HOUR),
          duplicates: count("SELECT COUNT(*) AS n FROM posts WHERE created_at > ? AND status = 'duplicate'", time - HOUR),
          processed: count("SELECT COUNT(*) AS n FROM posts WHERE done_at > ?", time - HOUR),
          loads: delays.length,
          medianDelayMin: delays.length ? Math.round((median(delays) / 60000) * 10) / 10 : null,
        },
        loads: { total: loads.total ?? 0, delivered: loads.delivered ?? 0, messages: loads.messages ?? 0 },
        trucks: { total: trucks.total ?? 0, delivered: trucks.delivered ?? 0, messages: trucks.messages ?? 0 },
        drivers: { total: drivers.total ?? 0, active: drivers.active ?? 0 },
        shippers: { total: shippers.total ?? 0, active: shippers.active ?? 0 },
        hourly,
      };
    },
  };
}
