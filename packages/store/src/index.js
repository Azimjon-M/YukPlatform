// Baza: e'lonlar navbati, yuklar, haydovchilar. Node'ning o'zidagi SQLite (node:sqlite) — o'rnatish shart emas, bepul.
// Fayl: data/yuk.db (gitga tushmaydi). Collector va bot — ikki alohida dastur, ikkalasi ham shu faylni ochadi:
// collector e'lonlarni navbatga yozadi, bot navbatdan olib tahlil qiladi va yuboradi.
// Keyinroq apps/api paydo bo'lganda PostgreSQL'ga o'tiladi — shu fayldagi funksiyalar o'sha yerga ko'chadi.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

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
`;

const json = (value) => (value == null ? null : JSON.stringify(value));
const parse = (text) => (text == null ? null : JSON.parse(text));

function driverRow(row) {
  if (!row) return null;
  return {
    chatId: row.chat_id,
    name: row.name,
    username: row.username,
    profile: parse(row.profile),
    draft: parse(row.draft),
    active: row.active === 1,
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

  const q = {
    insertPost: db.prepare(
      `INSERT OR IGNORE INTO posts (source, message_id, link, text, text_key, posted_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    recentSameText: db.prepare("SELECT id FROM posts WHERE text_key = ? AND posted_at > ? LIMIT 1"),
    newPosts: db.prepare("SELECT * FROM posts WHERE status = 'new' ORDER BY id LIMIT ?"),
    finishPost: db.prepare("UPDATE posts SET status = ?, error = ? WHERE id = ?"),
    recentLoad: db.prepare("SELECT id FROM loads WHERE key = ? AND created_at > ? LIMIT 1"),
    insertLoad: db.prepare("INSERT INTO loads (post_id, key, data, created_at) VALUES (?, ?, ?, ?)"),
    loadDelivery: db.prepare("UPDATE loads SET sent_to = ?, channel_message_id = ? WHERE id = ?"),
    recentLoads: db.prepare(
      `SELECT l.id, l.data, l.created_at, p.source, p.link, p.posted_at
       FROM loads l JOIN posts p ON p.id = l.post_id
       WHERE l.created_at > ? ORDER BY l.id DESC LIMIT ?`,
    ),
    getDriver: db.prepare("SELECT * FROM drivers WHERE chat_id = ?"),
    insertDriver: db.prepare(
      "INSERT OR IGNORE INTO drivers (chat_id, name, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ),
    activeDrivers: db.prepare("SELECT * FROM drivers WHERE active = 1 AND profile IS NOT NULL"),
    getCursor: db.prepare("SELECT last_message_id FROM cursors WHERE source = ?"),
    setCursor: db.prepare(
      `INSERT INTO cursors (source, last_message_id) VALUES (?, ?)
       ON CONFLICT (source) DO UPDATE SET last_message_id = excluded.last_message_id`,
    ),
    postCounts: db.prepare("SELECT status, COUNT(*) AS n FROM posts GROUP BY status"),
    driverCounts: db.prepare("SELECT COUNT(*) AS total, SUM(active) AS active FROM drivers WHERE profile IS NOT NULL"),
    loadCounts: db.prepare("SELECT COUNT(*) AS total, SUM(sent_to) AS sent FROM loads WHERE created_at > ?"),
  };

  return {
    db,

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

    takeNewPosts(limit = 10) {
      return q.newPosts.all(limit).map((row) => ({
        id: row.id,
        source: row.source,
        messageId: row.message_id,
        link: row.link,
        text: row.text,
        postedAt: row.posted_at,
      }));
    },

    finishPost(id, status, error = null) {
      q.finishPost.run(status, error, id);
    },

    // --- Yuklar ---
    // Shu kalitli yuk oxirgi windowMs ichida bo'lganmi (bo'lsa — takror, yuborilmaydi)
    hasRecentLoad(key, windowMs) {
      return Boolean(q.recentLoad.get(key, now() - windowMs));
    },

    addLoad({ postId, key, load }) {
      return Number(q.insertLoad.run(postId, key, JSON.stringify(load), now()).lastInsertRowid);
    },

    setLoadDelivery(id, { sentTo = 0, channelMessageId = null }) {
      q.loadDelivery.run(sentTo, channelMessageId, id);
    },

    // Oxirgi yuklar, eng yangisi birinchi ("📋 Mos yuklar" tugmasi uchun).
    // → [{ id, load, post: { source, link, postedAt }, createdAt }]
    recentLoads({ sinceMs = 24 * 60 * 60 * 1000, limit = 500 } = {}) {
      return q.recentLoads.all(now() - sinceMs, limit).map((row) => ({
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

    // fields: name, username, profile, draft, active — faqat berilganlari o'zgaradi
    saveDriver(chatId, fields) {
      const time = now();
      q.insertDriver.run(chatId, fields.name ?? null, fields.username ?? null, time, time);
      const columns = { name: fields.name, username: fields.username, active: fields.active };
      if ("profile" in fields) columns.profile = json(fields.profile);
      if ("draft" in fields) columns.draft = json(fields.draft);
      if (typeof columns.active === "boolean") columns.active = columns.active ? 1 : 0;
      const set = Object.entries(columns).filter(([, value]) => value !== undefined);
      const sql = `UPDATE drivers SET ${[...set.map(([k]) => `${k} = ?`), "updated_at = ?"].join(", ")} WHERE chat_id = ?`;
      db.prepare(sql).run(...set.map(([, value]) => value), time, chatId);
      return this.getDriver(chatId);
    },

    activeDrivers() {
      return q.activeDrivers.all().map(driverRow);
    },

    // --- Collector qayergacha o'qigani ---
    getCursor(source) {
      return q.getCursor.get(source)?.last_message_id ?? null;
    },

    setCursor(source, messageId) {
      q.setCursor.run(source, messageId);
    },

    // --- Hisobot (/holat) ---
    stats({ sinceMs = 24 * 60 * 60 * 1000 } = {}) {
      const posts = Object.fromEntries(q.postCounts.all().map((r) => [r.status, r.n]));
      const drivers = q.driverCounts.get();
      const loads = q.loadCounts.get(now() - sinceMs);
      return {
        posts,
        drivers: { total: drivers.total ?? 0, active: drivers.active ?? 0 },
        loads24h: { total: loads.total ?? 0, sent: loads.sent ?? 0 },
      };
    },

    close() {
      db.close();
    },
  };
}
