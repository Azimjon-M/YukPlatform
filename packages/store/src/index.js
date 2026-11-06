// Baza: e'lonlar navbati, yuklar, haydovchilar. Node'ning o'zidagi SQLite (node:sqlite) — o'rnatish shart emas, bepul.
// Fayl: data/yuk.db (gitga tushmaydi). Collector va bot — ikki alohida dastur, ikkalasi ham shu faylni ochadi:
// collector e'lonlarni navbatga yozadi, bot navbatdan olib tahlil qiladi va yuboradi.
// Keyinroq apps/api paydo bo'lganda PostgreSQL'ga o'tiladi — shu fayldagi funksiyalar o'sha yerga ko'chadi.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createAdminQueries } from "./admin.js";
import { createAiQueries } from "./ai.js";

export { acquireRunLock, isAlive, readRunLock, RUN_DIR } from "./lock.js";
export { decryptText, encryptText, keyHint, loadSecret, SECRET_FILE } from "./secrets.js";
export { TUNNEL_URL_KEY, tunnelUrl } from "./tunnel.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// YUK_DB — boshqa fayl bilan sinash uchun (masalan, YUK_DB=data/sinov.db); yo'l YukPlatform papkasiga nisbatan
export const DEFAULT_DB_FILE = path.resolve(ROOT, process.env.YUK_DB || path.join("data", "yuk.db"));

// Takror matnni topish kaliti: harf kattaligi, emoji, tinish belgilari va bo'sh joy farq qilmaydi.
// Bir xil e'lon boshqa guruhga boshqa emoji bilan tashlansa ham AI'ga ikkinchi marta yuborilmaydi (limit tejaladi).
export function textKey(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,              -- "@guruh" yoki chat id
  message_id INTEGER NOT NULL,       -- xabarning Telegram'dagi raqami
  link TEXT,                         -- https://t.me/guruh/123 (ochiq guruhlarda)
  text TEXT NOT NULL,
  text_key TEXT NOT NULL,
  posted_at INTEGER NOT NULL,        -- e'lon joylangan vaqt, ms
  status TEXT NOT NULL DEFAULT 'new',-- new | done | duplicate | failed
  error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (source, message_id)
);
CREATE INDEX IF NOT EXISTS posts_status ON posts (status, id);
CREATE INDEX IF NOT EXISTS posts_text_key ON posts (text_key, posted_at);

CREATE TABLE IF NOT EXISTS loads (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts (id),
  key TEXT NOT NULL,                 -- @yuk/shared loadKey: takrorni topish uchun
  data TEXT NOT NULL,                -- parser bergan yuk (JSON)
  sent_to INTEGER NOT NULL DEFAULT 0,-- nechta haydovchiga yuborildi
  channel_message_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS loads_key ON loads (key, created_at);

-- Botning hamma foydalanuvchilari (haydovchi ham, yuk beruvchi ham). Nomi tarixiy: avval faqat haydovchilar edi.
-- role, plan, is_admin ustunlari migrate() da qo'shiladi (eski bazalar uchun)
CREATE TABLE IF NOT EXISTS drivers (
  chat_id INTEGER PRIMARY KEY,       -- Telegram foydalanuvchi id (shaxsiy chat)
  name TEXT,
  username TEXT,
  profile TEXT,                      -- JSON: @yuk/shared match.js dagi haydovchi (vehicle, mode, fromAreas...)
  draft TEXT,                        -- ro'yxatdan o'tish paytidagi javoblar (JSON)
  active INTEGER NOT NULL DEFAULT 0, -- 1 — yuk yuboriladi
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cursors (
  source TEXT PRIMARY KEY,           -- collector qaysi guruhni qayergacha o'qigani
  last_message_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  name TEXT PRIMARY KEY,             -- collector kuzatadigan guruh: "@guruh"
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS posts_created ON posts (created_at);
CREATE INDEX IF NOT EXISTS loads_created ON loads (created_at);

CREATE TABLE IF NOT EXISTS ai_keys (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,            -- gemini | claude
  label TEXT,
  key_enc TEXT,                      -- shifrlangan kalit (secrets.js); NULL — .env dagi kalit ishlatiladi
  key_hint TEXT,                     -- "…a1B2": ekranda qaysi kalit ekanini tanish uchun
  models TEXT NOT NULL,              -- JSON: ["gemini-3.5-flash-lite", ...] — har biri alohida "ulanish"
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_slots (
  id TEXT PRIMARY KEY,               -- "<ai_keys.id>:<model>"
  data TEXT NOT NULL,                -- bot yozadi (JSON): bugungi so'rovlar, dam olish vaqti, oxirgi xato, «muammoli» belgisi
  updated_at INTEGER NOT NULL
  -- control TEXT (migrate) — boshqaruv markazi yozadi: { wakeAt, healthResetAt }
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

// Eski bazaga yangi ustunlar (CREATE TABLE IF NOT EXISTS mavjud jadvalni o'zgartirmaydi)
function migrate(db) {
  const columns = db.prepare("PRAGMA table_info(posts)").all().map((c) => c.name);
  // done_at — e'lon tahlil qilib bo'lingan vaqt (boshqaruv markazida tezlikni ko'rsatish uchun)
  if (!columns.includes("done_at")) db.exec("ALTER TABLE posts ADD COLUMN done_at INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS posts_done ON posts (done_at)");

  // Rollar (2026-11-06): role — haydovchi | yuk_beruvchi | NULL (hali tanlamagan);
  // plan — obuna (hozircha hammasi "free", pullik obuna keyin); is_admin — faqat boshqaruv markazidan yoqiladi
  const users = db.prepare("PRAGMA table_info(drivers)").all().map((c) => c.name);
  if (!users.includes("role")) {
    db.exec("ALTER TABLE drivers ADD COLUMN role TEXT");
    // Rollardan oldin profil to'ldirganlarning hammasi haydovchi edi
    db.exec("UPDATE drivers SET role = 'haydovchi' WHERE profile IS NOT NULL");
  }
  if (!users.includes("plan")) db.exec("ALTER TABLE drivers ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'");
  if (!users.includes("is_admin")) db.exec("ALTER TABLE drivers ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");

  // kind — yuk (yuk bor, mashina kerak) | mashina (mashina bo'sh, yuk kerak — yuk beruvchilarga)
  const loads = db.prepare("PRAGMA table_info(loads)").all().map((c) => c.name);
  if (!loads.includes("kind")) db.exec("ALTER TABLE loads ADD COLUMN kind TEXT NOT NULL DEFAULT 'yuk'");

  // control — boshqaruv markazining buyruqlari (JSON): { wakeAt, healthResetAt }. Bot faqat o'qiydi, data ni esa bot yozadi
  const slots = db.prepare("PRAGMA table_info(ai_slots)").all().map((c) => c.name);
  if (!slots.includes("control")) db.exec("ALTER TABLE ai_slots ADD COLUMN control TEXT");
}

const json = (value) => (value == null ? null : JSON.stringify(value));
const parse = (text) => (text == null ? null : JSON.parse(text));

function driverRow(row) {
  if (!row) return null;
  return {
    chatId: row.chat_id,
    name: row.name,
    username: row.username,
    // Rol ustuni bo'lmagan eski yozuv: profili bo'lsa — haydovchi (migrate shunday to'ldiradi)
    role: row.role ?? (row.profile != null ? "haydovchi" : null),
    profile: parse(row.profile),
    draft: parse(row.draft),
    active: row.active === 1,
    plan: row.plan ?? "free",
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// file — ":memory:" testlar uchun; now — vaqtni testda boshqarish uchun
export function openStore({ file = DEFAULT_DB_FILE, now = () => Date.now() } = {}) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL — bir dastur yozayotganda ikkinchisi o'qiy oladi; busy_timeout — band bo'lsa 5 s kutadi
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);

  const q = {
    insertPost: db.prepare(
      `INSERT OR IGNORE INTO posts (source, message_id, link, text, text_key, posted_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    recentSameText: db.prepare("SELECT id FROM posts WHERE text_key = ? AND posted_at > ? LIMIT 1"),
    newPosts: db.prepare("SELECT * FROM posts WHERE status = 'new' ORDER BY id LIMIT ?"),
    newestPosts: db.prepare("SELECT * FROM posts WHERE status = 'new' ORDER BY posted_at DESC, id DESC LIMIT ?"),
    newPostsExcept: db.prepare(
      "SELECT * FROM posts WHERE status = 'new' AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT ?",
    ),
    newestPostsExcept: db.prepare(
      `SELECT * FROM posts WHERE status = 'new' AND id NOT IN (SELECT value FROM json_each(?))
       ORDER BY posted_at DESC, id DESC LIMIT ?`,
    ),
    finishPost: db.prepare("UPDATE posts SET status = ?, error = ?, done_at = ? WHERE id = ?"),
    expirePosts: db.prepare(
      `UPDATE posts SET status = 'done', error = ?, done_at = ?
       WHERE status = 'new' AND posted_at < ? AND id NOT IN (SELECT value FROM json_each(?))`,
    ),
    recentLoad: db.prepare("SELECT id FROM loads WHERE key = ? AND kind = ? AND created_at > ? LIMIT 1"),
    insertLoad: db.prepare("INSERT INTO loads (post_id, key, data, kind, created_at) VALUES (?, ?, ?, ?, ?)"),
    loadDelivery: db.prepare("UPDATE loads SET sent_to = ?, channel_message_id = ? WHERE id = ?"),
    recentLoads: db.prepare(
      `SELECT l.id, l.data, l.created_at, p.source, p.link, p.posted_at
       FROM loads l JOIN posts p ON p.id = l.post_id
       WHERE l.created_at > ? AND l.kind = ? ORDER BY l.id DESC LIMIT ?`,
    ),
    getDriver: db.prepare("SELECT * FROM drivers WHERE chat_id = ?"),
    insertDriver: db.prepare(
      "INSERT OR IGNORE INTO drivers (chat_id, name, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ),
    // Rolsiz eski yozuv profili bilan — haydovchi (driverRow dagi qoida bilan bir xil)
    activeUsers: db.prepare(
      "SELECT * FROM drivers WHERE active = 1 AND profile IS NOT NULL AND COALESCE(role, 'haydovchi') = ?",
    ),
    getCursor: db.prepare("SELECT last_message_id FROM cursors WHERE source = ?"),
    setCursor: db.prepare(
      `INSERT INTO cursors (source, last_message_id) VALUES (?, ?)
       ON CONFLICT (source) DO UPDATE SET last_message_id = excluded.last_message_id`,
    ),
    postCounts: db.prepare("SELECT status, COUNT(*) AS n FROM posts GROUP BY status"),
    driverCounts: db.prepare(
      `SELECT COALESCE(role, 'haydovchi') AS role, COUNT(*) AS total, SUM(active) AS active
       FROM drivers WHERE profile IS NOT NULL GROUP BY 1`,
    ),
    loadCounts: db.prepare("SELECT kind, COUNT(*) AS total, SUM(sent_to) AS sent FROM loads WHERE created_at > ? GROUP BY kind"),
  };

  return {
    db,
    // Boshqaruv markazi uchun: listLoads, listPosts, listDrivers, sources, metrics (admin.js)
    ...createAdminQueries(db, now),
    // AI kalitlari va ulanishlar holati (ai.js)
    ...createAiQueries(db, now),

    // --- E'lonlar navbati ---
    // Yangi e'lonni navbatga qo'yadi. Shu matn dedupeWindowMs ichida bo'lgan bo'lsa — "duplicate", AI'ga bormaydi.
    // → { id, status } yoki null (bu xabar allaqachon bor)
    addPost({ source, messageId, link = null, text, postedAt = now() }, { dedupeWindowMs } = {}) {
      const key = textKey(text);
      const same = dedupeWindowMs ? q.recentSameText.get(key, postedAt - dedupeWindowMs) : null;
      const status = same ? "duplicate" : "new";
      const result = q.insertPost.run(source, messageId, link, text, key, postedAt, status, now());
      if (result.changes === 0) return null;
      return { id: Number(result.lastInsertRowid), status };
    },

    // newest: true — eng yangi joylangan e'lonlar birinchi (bot shunday oladi: navbat to'lib qolsa ham yangi yuk
    // darhol chiqadi, bir soatlik yukni esa odatda allaqachon olib bo'lishgan). Standart — navbat tartibida.
    // exclude — shu id'lar olinmaydi (bir nechta AI parallel ishlaganda boshqasi allaqachon olgan e'lonlar).
    takeNewPosts(limit = 10, { newest = false, exclude = [] } = {}) {
      const rows = exclude.length
        ? (newest ? q.newestPostsExcept : q.newPostsExcept).all(JSON.stringify(exclude), limit)
        : (newest ? q.newestPosts : q.newPosts).all(limit);
      return rows.map((row) => ({
        id: row.id,
        source: row.source,
        messageId: row.message_id,
        link: row.link,
        text: row.text,
        postedAt: row.posted_at,
        // Navbatga tushgan vaqt. postedAt'dan keyin: collector guruhni har ~1 daqiqada o'qigani uchun
        // e'lon navbatga o'rtacha 40 s kechikib keladi (2026-11-05 o'lchovi)
        queuedAt: row.created_at,
      }));
    },

    finishPost(id, status, error = null) {
      q.finishPost.run(status, error, now(), id);
    },

    // Navbatda `before` dan oldin JOYLANGAN e'lonlarni AI'siz yopadi: done + izoh (admin «Tayyor» ichida izohi bilan
    // ko'rsatadi, xuddi "Boshqa yo'nalish" kabi). exclude — hozir AI'da turgan e'lonlar (ularga tegmaymiz).
    // → nechta e'lon yopildi
    expireOldPosts({ before, error, exclude = [] }) {
      return Number(q.expirePosts.run(error, now(), before, JSON.stringify(exclude)).changes);
    },

    // --- Yuklar va bo'sh mashinalar ---
    // kind: "yuk" (standart) — yuk bor, haydovchilarga; "mashina" — mashina bo'sh, yuk beruvchilarga.
    // Ikkalasi bitta jadvalda: maydonlari bir xil (parser mashina e'lonini ham yuk maydonlari bilan yozadi).

    // Shu kalitli yuk (yoki mashina) oxirgi windowMs ichida bo'lganmi (bo'lsa — takror, yuborilmaydi)
    hasRecentLoad(key, windowMs, kind = "yuk") {
      return Boolean(q.recentLoad.get(key, kind, now() - windowMs));
    },

    addLoad({ postId, key, load, kind = "yuk" }) {
      return Number(q.insertLoad.run(postId, key, JSON.stringify(load), kind, now()).lastInsertRowid);
    },

    setLoadDelivery(id, { sentTo = 0, channelMessageId = null }) {
      q.loadDelivery.run(sentTo, channelMessageId, id);
    },

    // Oxirgi yuklar, eng yangisi birinchi ("📋 Mos yuklar" / "🚚 Bo'sh mashinalar" tugmalari uchun).
    // → [{ id, load, post: { source, link, postedAt }, createdAt }]
    recentLoads({ sinceMs = 24 * 60 * 60 * 1000, limit = 500, kind = "yuk" } = {}) {
      return q.recentLoads.all(now() - sinceMs, kind, limit).map((row) => ({
        id: row.id,
        load: JSON.parse(row.data),
        post: { source: row.source, link: row.link, postedAt: row.posted_at },
        createdAt: row.created_at,
      }));
    },

    // --- Haydovchilar ---
    getDriver(chatId) {
      return driverRow(q.getDriver.get(chatId));
    },

    // fields: name, username, role, profile, draft, active, plan, isAdmin — faqat berilganlari o'zgaradi.
    // Rolni tekshirish (haydovchi | yuk_beruvchi) chaqiruvchining ishi: bu yerga faqat to'g'ri qiymat keladi.
    saveDriver(chatId, fields) {
      const time = now();
      q.insertDriver.run(chatId, fields.name ?? null, fields.username ?? null, time, time);
      const columns = { name: fields.name, username: fields.username, active: fields.active, role: fields.role, plan: fields.plan };
      if ("profile" in fields) columns.profile = json(fields.profile);
      if ("draft" in fields) columns.draft = json(fields.draft);
      if (typeof columns.active === "boolean") columns.active = columns.active ? 1 : 0;
      if (typeof fields.isAdmin === "boolean") columns.is_admin = fields.isAdmin ? 1 : 0;
      const set = Object.entries(columns).filter(([, value]) => value !== undefined);
      const sql = `UPDATE drivers SET ${[...set.map(([k]) => `${k} = ?`), "updated_at = ?"].join(", ")} WHERE chat_id = ?`;
      db.prepare(sql).run(...set.map(([, value]) => value), time, chatId);
      return this.getDriver(chatId);
    },

    // Profili bor va yoqilgan foydalanuvchilar: role = "haydovchi" (yuk oladi) yoki "yuk_beruvchi" (mashina oladi)
    activeUsers(role = "haydovchi") {
      return q.activeUsers.all(role).map(driverRow);
    },

    // Eski nom: faol haydovchilar
    activeDrivers() {
      return this.activeUsers("haydovchi");
    },

    // --- Collector qayergacha o'qigani ---
    getCursor(source) {
      return q.getCursor.get(source)?.last_message_id ?? null;
    },

    setCursor(source, messageId) {
      q.setCursor.run(source, messageId);
    },

    // --- Kichik sozlamalar (kalit → matn): masalan, bot o'z username'ini yozadi, web uni o'qiydi ---
    getSetting(key) {
      return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
    },

    setSetting(key, value) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
        key,
        value == null ? null : String(value),
      );
    },

    // --- Hisobot (/holat) ---
    // drivers — haydovchilar, shippers — yuk beruvchilar; loads24h — yuklar, trucks24h — bo'sh mashinalar
    stats({ sinceMs = 24 * 60 * 60 * 1000 } = {}) {
      const posts = Object.fromEntries(q.postCounts.all().map((r) => [r.status, r.n]));
      const users = Object.fromEntries(q.driverCounts.all().map((r) => [r.role, { total: r.total ?? 0, active: r.active ?? 0 }]));
      const loads = Object.fromEntries(q.loadCounts.all(now() - sinceMs).map((r) => [r.kind, { total: r.total ?? 0, sent: r.sent ?? 0 }]));
      const empty = { total: 0, active: 0 };
      return {
        posts,
        drivers: users.haydovchi ?? empty,
        shippers: users.yuk_beruvchi ?? empty,
        loads24h: loads.yuk ?? { total: 0, sent: 0 },
        trucks24h: loads.mashina ?? { total: 0, sent: 0 },
      };
    },

    close() {
      db.close();
    },
  };
}
