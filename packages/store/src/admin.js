// Boshqaruv markazi (apps/api) uchun so'rovlar: yuklar ro'yxati va filtrlar, navbat, haydovchilar, manbalar, ko'rsatkichlar.
// Bot va collector bularni ishlatmaydi — ular index.js dagi asosiy funksiyalar bilan ishlaydi.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const parse = (text) => (text == null ? null : JSON.parse(text));

// Toshkent kunining boshi (UTC+5, yozgi vaqt yo'q): «bugun olgan yuklari» shu paytdan sanaladi
export const tashkentDayStart = (time) => Math.floor((time + 5 * HOUR) / DAY) * DAY - 5 * HOUR;
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
    parsedBy: row.parsed_by ?? null, // rules — AI'siz qoidaviy parser tushundi, ai — AI
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
    // Har foydalanuvchiga: oxirgi faollik (seenAt/seenVia) va olgan yuklari (deliveries: bugun — Toshkent vaqti bilan)
    listDrivers() {
      const time = now();
      const sent = new Map(
        db
          .prepare(
            `SELECT chat_id, SUM(ok) AS total, SUM(ok = 1 AND sent_at >= ?) AS today, MAX(CASE WHEN ok = 1 THEN sent_at END) AS last_at,
                    SUM(ok = 0) AS failed, MAX(CASE WHEN ok = 0 THEN id END) AS failed_id
             FROM deliveries GROUP BY chat_id`,
          )
          .all(tashkentDayStart(time))
          .map((r) => [r.chat_id, r]),
      );
      // Oxirgi yuborilgan yuk (yo'nalishi ko'rinsin) va oxirgi xato matni
      const lastLoad = db.prepare(
        "SELECT l.data FROM deliveries d JOIN loads l ON l.id = d.load_id WHERE d.chat_id = ? AND d.ok = 1 ORDER BY d.sent_at DESC, d.id DESC LIMIT 1",
      );
      const failure = db.prepare("SELECT error, sent_at FROM deliveries WHERE id = ?");
      const deliveries = (chatId) => {
        const r = sent.get(chatId);
        if (!r) return { today: 0, total: 0, lastAt: null, lastLoad: null, failed: 0, lastError: null, lastErrorAt: null };
        const fail = r.failed_id ? failure.get(r.failed_id) : null;
        return {
          today: r.today ?? 0,
          total: r.total ?? 0,
          lastAt: r.last_at ?? null,
          lastLoad: r.last_at ? parse(lastLoad.get(chatId)?.data) : null,
          failed: r.failed ?? 0,
          lastError: fail?.error ?? null,
          lastErrorAt: fail?.sent_at ?? null,
        };
      };
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
          seenAt: row.seen_at ?? null,
          seenVia: row.seen_via ?? null,
          deliveries: deliveries(row.chat_id),
          // Hisobini o'chirgan (store.deleteDriver): o'sha paytdagi rol, sozlamalar, raqam — deletedSnapshot da.
          // deletedCount — necha marta o'chirgan (qaytgan bo'lsa ham qoladi), returnedAt — oxirgi qaytgani
          deletedAt: row.deleted_at ?? null,
          deletedVia: row.deleted_via ?? null,
          deletedCount: row.deleted_count ?? 0,
          deletedSnapshot: parse(row.deleted_snapshot),
          returnedAt: row.returned_at ?? null,
          // Pauza: kim (user | idle | blocked | admin) va qachon; «24 soat kirmadingiz» ogohlantirishi
          pausedAt: row.paused_at ?? null,
          pausedBy: row.paused_by ?? null,
          idleWarnedAt: row.idle_warned_at ?? null,
          // Botdagi savol-javobda qaysi qadamda turibdi (ro'yxatdan o'tishni tugatmagan bo'lsa)
          draftStep: parse(row.draft)?.step ?? null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
    },

    // «Batafsil» (boshqaruv markazi akkordeoni): ikkala rolning saqlangan sozlamalari, tarix va oxirgi yuborilganlar
    driverDetails(chatId, { events = 100, sent = 30 } = {}) {
      const row = db.prepare("SELECT profiles, draft, phone_asked_at FROM drivers WHERE chat_id = ?").get(chatId);
      if (!row) return null;
      return {
        profiles: parse(row.profiles) ?? {},
        draft: parse(row.draft),
        phoneAskedAt: row.phone_asked_at ?? null,
        events: db
          .prepare("SELECT type, detail, at FROM user_events WHERE chat_id = ? ORDER BY id DESC LIMIT ?")
          .all(chatId, events)
          .map((r) => ({ type: r.type, detail: parse(r.detail), at: r.at })),
        deliveries: db
          .prepare(
            `SELECT d.ok, d.error, d.sent_at, l.data, l.kind, p.link FROM deliveries d
             LEFT JOIN loads l ON l.id = d.load_id LEFT JOIN posts p ON p.id = l.post_id
             WHERE d.chat_id = ? ORDER BY d.id DESC LIMIT ?`,
          )
          .all(chatId, sent)
          .map((r) => ({ ok: r.ok === 1, error: r.error, at: r.sent_at, load: parse(r.data), kind: r.kind ?? "yuk", link: r.link ?? null })),
      };
    },

    // Jonli yangilanish (apps/api live.js har soniyada so'raydi): har bo'lim uchun qisqa «belgi» — o'zgarsa, ochiq sahifa
    // qayta so'raydi. Bot va collector boshqa jarayon, shuning uchun o'zgarishni bazadan sezamiz. So'rovlar arzon:
    // MAX(id) — darhol, qolganlari indeks yoki kichik jadval
    changeMarks() {
      const one = (sql) => Object.values(db.prepare(sql).get()).join("|");
      const deliveries = one("SELECT MAX(id) FROM deliveries");
      return {
        drivers: `${one("SELECT COUNT(*), MAX(updated_at), MAX(seen_at), SUM(active), SUM(is_admin) FROM drivers")}|${deliveries}|${one("SELECT MAX(id) FROM user_events")}`,
        posts: one("SELECT MAX(id), MAX(done_at) FROM posts"),
        loads: `${one("SELECT MAX(id) FROM loads")}|${deliveries}`,
        ai: `${one("SELECT COUNT(*), MAX(updated_at) FROM ai_slots")}|${one("SELECT COUNT(*), MAX(id), SUM(enabled) FROM ai_keys")}`,
        sources: one("SELECT COUNT(*), SUM(enabled), SUM(joined) FROM sources"),
      };
    },

    // --- Manbalar (collector kuzatadigan guruhlar) ---
    listSources() {
      return db
        .prepare("SELECT * FROM sources ORDER BY created_at, name")
        .all()
        .map((row) => ({
          name: row.name,
          enabled: row.enabled === 1,
          note: row.note,
          createdAt: row.created_at,
          // collector akkaunti a'zomi: true — jonli, false — so'rab turiladi, null — collector hali tekshirmagan
          joined: row.joined == null ? null : row.joined === 1,
          checkedAt: row.checked_at,
        }));
    },

    // Collector har 10 daqiqada yozadi. Ro'yxatda yo'q nom (terminaldan berilgan guruh) — e'tiborsiz
    setSourceMembership(name, joined) {
      return db.prepare("UPDATE sources SET joined = ?, checked_at = ? WHERE name = ?").run(joined ? 1 : 0, now(), name).changes > 0;
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

    // Har bir manba bo'yicha oxirgi N soat: e'lonlar, takrorlar, yuklar, oxirgi e'lon vaqti;
    // live — jonli kelganlari; delaySec — guruhga yozilganidan navbatga tushguncha o'rtacha soniya
    // (10 daqiqadan ko'p kechikkanlari hisobga olinmaydi: ular collector to'xtab turganda yozilgan eski e'lonlar;
    // jonli e'lon kompyuter soati Telegram'dan orqada bo'lsa manfiy chiqadi (09.11: −2 s) — 0 deb olinadi)
    sourceStats({ hours = 24 } = {}) {
      const since = now() - hours * HOUR;
      const posts = db
        .prepare(
          `SELECT source, COUNT(*) AS posts, SUM(status = 'duplicate') AS duplicates, MAX(posted_at) AS last_post_at,
                  SUM(via = 'live') AS live,
                  AVG(CASE WHEN created_at - posted_at BETWEEN -60000 AND 600000 THEN MAX(created_at - posted_at, 0) END) AS delay_ms
           FROM posts WHERE created_at > ? GROUP BY source`,
        )
        .all(since);
      const loads = db
        .prepare("SELECT p.source, COUNT(*) AS loads FROM loads l JOIN posts p ON p.id = l.post_id WHERE l.created_at > ? AND l.kind = 'yuk' GROUP BY p.source")
        .all(since);
      const out = {};
      for (const row of posts) {
        out[row.source] = {
          posts: row.posts,
          duplicates: row.duplicates ?? 0,
          loads: 0,
          lastPostAt: row.last_post_at,
          live: row.live ?? 0,
          delaySec: row.delay_ms == null ? null : Math.round(row.delay_ms / 1000),
        };
      }
      for (const row of loads) (out[row.source] ??= { posts: 0, duplicates: 0, loads: 0, lastPostAt: null, live: 0, delaySec: null }).loads = row.loads;
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
        // Kim tushundi (oxirgi hours soatda tugagan e'lonlar): AI'siz qoidaviy parser yoki AI
        parsedBy: {
          rules: count("SELECT COUNT(*) AS n FROM posts WHERE done_at > ? AND parsed_by = 'rules'", since),
          ai: count("SELECT COUNT(*) AS n FROM posts WHERE done_at > ? AND parsed_by = 'ai'", since),
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
