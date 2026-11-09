// Baza: e'lonlar navbati, yuklar, haydovchilar. Node'ning o'zidagi SQLite (node:sqlite) — o'rnatish shart emas, bepul.
// Fayl: data/yuk.db (gitga tushmaydi). Collector va bot — ikki alohida dastur, ikkalasi ham shu faylni ochadi:
// collector e'lonlarni navbatga yozadi, bot navbatdan olib tahlil qiladi va yuboradi.
// Keyinroq apps/api paydo bo'lganda PostgreSQL'ga o'tiladi — shu fayldagi funksiyalar o'sha yerga ko'chadi.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createAdminQueries } from "./admin.js";
import { userEvents } from "./history.js";
import { createAiQueries } from "./ai.js";

export { acquireRunLock, BEAT_MS, isAlive, readRunLock, removeRunLock, RUN_DIR } from "./lock.js";
export { decryptText, encryptText, keyHint, loadSecret, SECRET_FILE } from "./secrets.js";
export { createSessions, LINK_PERIOD_S, SESSION_TTL_S } from "./sessions.js";
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
-- role, plan, is_admin, phone, phone_at, phone_asked_at, profiles ustunlari migrate() da qo'shiladi (eski bazalar uchun)
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

-- Kimga qaysi yuk (yuk beruvchiga — bo'sh mashina) yuborildi (2026-11-09): boshqaruv markazidagi «Olgan yuklari».
-- ok = 0 — Telegram qabul qilmadi (error: masalan «bot was blocked by the user»). Foydalanuvchi o'chirilsa — uniki ham o'chadi
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY,
  load_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deliveries_chat ON deliveries (chat_id, sent_at);

-- Foydalanuvchi tarixi (2026-11-09, history.js): botga kelgani, rol, ro'yxatdan o'tgani, yo'nalish, pauza, raqam,
-- hisobdan chiqqani, hisobini o'chirgani (detail — o'sha paytdagi hamma ma'lumot) va qaytgani. detail — JSON
CREATE TABLE IF NOT EXISTS user_events (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_events_chat ON user_events (chat_id, id);
`;

// Eski bazaga yangi ustunlar (CREATE TABLE IF NOT EXISTS mavjud jadvalni o'zgartirmaydi)
function migrate(db) {
  const columns = db.prepare("PRAGMA table_info(posts)").all().map((c) => c.name);
  // done_at — e'lon tahlil qilib bo'lingan vaqt (boshqaruv markazida tezlikni ko'rsatish uchun)
  if (!columns.includes("done_at")) db.exec("ALTER TABLE posts ADD COLUMN done_at INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS posts_done ON posts (done_at)");
  // via (2026-11-09) — e'lon qanday kelgan: live (a'zo bo'lingan guruhdan Telegram o'zi yubordi) | poll (collector so'rab oldi) | NULL (eski / bot)
  if (!columns.includes("via")) db.exec("ALTER TABLE posts ADD COLUMN via TEXT");
  // parsed_by (2026-11-09) — e'lonni kim tushundi: rules (AI'siz qoidaviy parser, @yuk/parser parseByRules) | ai | NULL (eski / xato)
  if (!columns.includes("parsed_by")) db.exec("ALTER TABLE posts ADD COLUMN parsed_by TEXT");
  // Manbalar: collector akkaunti guruhga a'zomi (a'zo — jonli), qachon tekshirilgan. NULL — hali tekshirilmagan
  const sourceColumns = db.prepare("PRAGMA table_info(sources)").all().map((c) => c.name);
  if (!sourceColumns.includes("joined")) db.exec("ALTER TABLE sources ADD COLUMN joined INTEGER");
  if (!sourceColumns.includes("checked_at")) db.exec("ALTER TABLE sources ADD COLUMN checked_at INTEGER");

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
  // Telefon (2026-11-06, ixtiyoriy): foydalanuvchi botga «📱 Raqam ulashish» bilan o'zi yuborgan raqami.
  // phone_at — qachon ulashgan; phone_asked_at — bot qachon so'ragan (bir marta so'raydi, «Keyinroq» bossa — boshqa so'ramaydi)
  if (!users.includes("phone")) db.exec("ALTER TABLE drivers ADD COLUMN phone TEXT");
  if (!users.includes("phone_at")) db.exec("ALTER TABLE drivers ADD COLUMN phone_at INTEGER");
  if (!users.includes("phone_asked_at")) db.exec("ALTER TABLE drivers ADD COLUMN phone_asked_at INTEGER");
  // profiles — har rolning oxirgi sozlamalari (JSON: { haydovchi: {...}, yuk_beruvchi: {...} }). Rol almashganda
  // eskisi shu yerga yashiriladi, qaytganda tiklanadi (switchRole). profile ustuni — hozirgi rolniki, qidiruvlar shundan
  if (!users.includes("profiles")) db.exec("ALTER TABLE drivers ADD COLUMN profiles TEXT");
  // Hisobdan chiqish (2026-11-07, signOut): qachon va qaysi roldan. Rol/profil ustunlari bo'shaydi (bot uni yangi odamdek
  // ko'radi), boshqaruv markazi esa shu ikkisi va `profiles` dan oxirgi rol va sozlamalarni ko'rsatadi. Qayta kirsa — tozalanadi
  const addSignedOut = !users.includes("signed_out_at");
  if (addSignedOut) db.exec("ALTER TABLE drivers ADD COLUMN signed_out_at INTEGER");
  if (!users.includes("signed_out_role")) db.exec("ALTER TABLE drivers ADD COLUMN signed_out_role TEXT");
  if (addSignedOut) markEarlySignOuts(db);
  // Oxirgi faollik (2026-11-09): botga yozgan / tugma bosgan yoki web'ni ishlatgan vaqt; seen_via — "bot" | "web".
  // updated_at dan farqi: u — sozlama o'zgargan vaqt, bu — shunchaki kirib ko'rgani ham
  if (!users.includes("seen_at")) db.exec("ALTER TABLE drivers ADD COLUMN seen_at INTEGER");
  if (!users.includes("seen_via")) db.exec("ALTER TABLE drivers ADD COLUMN seen_via TEXT");
  // Hisobni o'chirish (2026-11-09, Azimjon: «o'chirsa ham turishi kerak»): qator qoladi, bot uni yangi odamdek ko'radi.
  // deleted_snapshot — o'chirgan paytdagi rol, sozlamalar, raqam (JSON); deleted_count — necha marta o'chirgan;
  // returned_at — o'chirgandan keyin oxirgi marta qaytgan vaqti
  if (!users.includes("deleted_at")) db.exec("ALTER TABLE drivers ADD COLUMN deleted_at INTEGER");
  if (!users.includes("deleted_via")) db.exec("ALTER TABLE drivers ADD COLUMN deleted_via TEXT");
  if (!users.includes("deleted_count")) db.exec("ALTER TABLE drivers ADD COLUMN deleted_count INTEGER NOT NULL DEFAULT 0");
  if (!users.includes("deleted_snapshot")) db.exec("ALTER TABLE drivers ADD COLUMN deleted_snapshot TEXT");
  if (!users.includes("returned_at")) db.exec("ALTER TABLE drivers ADD COLUMN returned_at INTEGER");
  // Pauza (2026-11-09): kim va qachon to'xtatdi — paused_by: "user" (o'zi ⏸) | "idle" (48 soat kirmagan, avtomatik) |
  // "blocked" (botni bloklagan, 403) | "admin" (eski: boshqaruv markazidan — endi bu tugma yo'q). Yoqilsa — tozalanadi.
  // idle_warned_at — «24 soat kirmadingiz» ogohlantirishi yuborilgan vaqt (@yuk/shared idle.js)
  if (!users.includes("paused_at")) db.exec("ALTER TABLE drivers ADD COLUMN paused_at INTEGER");
  if (!users.includes("paused_by")) db.exec("ALTER TABLE drivers ADD COLUMN paused_by TEXT");
  if (!users.includes("idle_warned_at")) db.exec("ALTER TABLE drivers ADD COLUMN idle_warned_at INTEGER");

  // kind — yuk (yuk bor, mashina kerak) | mashina (mashina bo'sh, yuk kerak — yuk beruvchilarga)
  const loads = db.prepare("PRAGMA table_info(loads)").all().map((c) => c.name);
  if (!loads.includes("kind")) db.exec("ALTER TABLE loads ADD COLUMN kind TEXT NOT NULL DEFAULT 'yuk'");

  // control — boshqaruv markazining buyruqlari (JSON): { wakeAt, healthResetAt }. Bot faqat o'qiydi, data ni esa bot yozadi
  const slots = db.prepare("PRAGMA table_info(ai_slots)").all().map((c) => c.name);
  if (!slots.includes("control")) db.exec("ALTER TABLE ai_slots ADD COLUMN control TEXT");
}

const json = (value) => (value == null ? null : JSON.stringify(value));
const parse = (text) => (text == null ? null : JSON.parse(text));

// Ustunlar qo'shilishidan oldin (2026-11-07 kunduzi) hisobdan chiqqanlar: rol va profil bo'sh, `profiles` da esa
// sozlamalari bor — bunga faqat signOut olib keladi (rol almashtirish rolni doim qo'yadi). Vaqti — yozuvning oxirgi
// o'zgarishi, roli — saqlangan yagona rol (ikkalasi saqlangan bo'lsa, qaysi biridan chiqqani noma'lum → null)
function markEarlySignOuts(db) {
  const rows = db.prepare("SELECT chat_id, profiles, updated_at FROM drivers WHERE role IS NULL AND profile IS NULL AND profiles IS NOT NULL").all();
  const mark = db.prepare("UPDATE drivers SET signed_out_at = ?, signed_out_role = ? WHERE chat_id = ?");
  for (const row of rows) {
    let saved = null;
    try {
      saved = JSON.parse(row.profiles);
    } catch {
      continue;
    }
    const roles = Object.keys(saved ?? {}).filter((role) => saved[role]);
    if (roles.length > 0) mark.run(row.updated_at, roles.length === 1 ? roles[0] : null, row.chat_id);
  }
}

function driverRow(row) {
  if (!row) return null;
  return {
    chatId: row.chat_id,
    name: row.name,
    username: row.username,
    // Rol ustuni bo'lmagan eski yozuv: profili bo'lsa — haydovchi (migrate shunday to'ldiradi)
    role: row.role ?? (row.profile != null ? "haydovchi" : null),
    profile: parse(row.profile),
    // Rol almashganda saqlab qo'yilgan sozlamalar (switchRole). Hozirgi rolniki eskirgan bo'lishi mumkin — haqiqiysi profile
    profiles: parse(row.profiles) ?? {},
    draft: parse(row.draft),
    active: row.active === 1,
    plan: row.plan ?? "free",
    isAdmin: row.is_admin === 1,
    phone: row.phone ?? null,
    phoneAt: row.phone_at ?? null,
    phoneAskedAt: row.phone_asked_at ?? null,
    // Hisobdan chiqqan bo'lsa: qachon va qaysi roldan (o'sha rolning sozlamalari — profiles[signedOutRole])
    signedOutAt: row.signed_out_at ?? null,
    signedOutRole: row.signed_out_role ?? null,
    seenAt: row.seen_at ?? null,
    seenVia: row.seen_via ?? null,
    // Hisobini o'chirgan bo'lsa: qachon, qayerdan (bot | web); qaytsa — deletedAt null, returnedAt bor, deletedCount qoladi
    deletedAt: row.deleted_at ?? null,
    deletedVia: row.deleted_via ?? null,
    deletedCount: row.deleted_count ?? 0,
    returnedAt: row.returned_at ?? null,
    // Pauza: qachon va kim (user | idle | blocked | admin); idleWarnedAt — «24 soat kirmadingiz» ogohlantirishi
    pausedAt: row.paused_at ?? null,
    pausedBy: row.paused_by ?? null,
    idleWarnedAt: row.idle_warned_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// touchDriver vaqtni shundan tez-tez yozmaydi (har xabarda bazaga yozish shart emas — «hozir faol» uchun yetarli)
export const SEEN_EVERY_MS = 15_000;

// Navbatdagi e'lon: bazadagi qator → bot ko'radigan shakl
function queuedPost(row) {
  return {
    id: row.id,
    source: row.source,
    messageId: row.message_id,
    link: row.link,
    text: row.text,
    postedAt: row.posted_at,
    // Navbatga tushgan vaqt. postedAt'dan keyin: collector guruhni har ~1 daqiqada o'qigani uchun
    // e'lon navbatga o'rtacha 40 s kechikib keladi (2026-11-05 o'lchovi)
    queuedAt: row.created_at,
    via: row.via, // live — a'zo bo'lingan guruhdan jonli kelgan (bot uni tezroq AI'ga yuboradi)
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
      `INSERT OR IGNORE INTO posts (source, message_id, link, text, text_key, posted_at, status, created_at, via)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    finishPost: db.prepare("UPDATE posts SET status = ?, error = ?, done_at = ?, parsed_by = COALESCE(?, parsed_by) WHERE id = ?"),
    newPostsAfter: db.prepare("SELECT * FROM posts WHERE status = 'new' AND id > ? ORDER BY id LIMIT ?"),
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
    // → { id, status } yoki null (bu xabar allaqachon bor). via — live | poll (collector), qolganlari null
    addPost({ source, messageId, link = null, text, postedAt = now(), via = null }, { dedupeWindowMs } = {}) {
      const key = textKey(text);
      const same = dedupeWindowMs ? q.recentSameText.get(key, postedAt - dedupeWindowMs) : null;
      const status = same ? "duplicate" : "new";
      const result = q.insertPost.run(source, messageId, link, text, key, postedAt, status, now(), via);
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
      return rows.map(queuedPost);
    },

    // Navbatdagi, id'si afterId dan katta e'lonlar, kelgan tartibida. Bot ularni qoidaviy parserdan o'tkazadi:
    // har e'lonni bir marta ko'radi (ishonchli bo'lmasa, e'lon navbatda AI'ni kutadi). Hech narsani band qilmaydi
    takeNewPostsAfter(afterId = 0, limit = 50) {
      return q.newPostsAfter.all(afterId, limit).map(queuedPost);
    },

    // parsedBy — e'lonni kim tushundi: "rules" | "ai" (berilmasa — o'zgarmaydi)
    finishPost(id, status, error = null, parsedBy = null) {
      q.finishPost.run(status, error, now(), parsedBy, id);
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

    // fields: name, username, role, profile, draft, active, plan, isAdmin, phone, phoneAskedAt — faqat berilganlari o'zgaradi.
    // Rol berilsa (qayta kirdi) — «hisobdan chiqqan» belgisi tozalanadi.
    // Rolni tekshirish (haydovchi | yuk_beruvchi) va raqamni tozalash (@yuk/shared normalizeContactPhone) chaqiruvchining ishi.
    // phone: null — raqamni o'chiradi (phone_at ham).
    // why — kim / nega (tarix va paused_by uchun): "blocked" (bot yubora olmadi, 403) | "idle" (48 soat kirmagan —
    // apps/bot idle.js) | "admin" (boshqaruv markazidan, endi faqat isAdmin). Berilmasa — foydalanuvchining o'zi.
    // Nima o'zgargan bo'lsa — user_events ga yoziladi (history.js: rol, ro'yxatdan o'tdi, yo'nalish, pauza, raqam...)
    saveDriver(chatId, fields) {
      const time = now();
      const before = this.getDriver(chatId);
      q.insertDriver.run(chatId, fields.name ?? null, fields.username ?? null, time, time);
      const columns = { name: fields.name, username: fields.username, active: fields.active, role: fields.role, plan: fields.plan };
      if ("profile" in fields) columns.profile = json(fields.profile);
      if ("profiles" in fields) columns.profiles = json(fields.profiles);
      if ("draft" in fields) columns.draft = json(fields.draft);
      if (typeof columns.active === "boolean") {
        // Pauza bo'lsa — kim va qachon; yoqilsa — tozalanadi (faqat holat o'zgarganda)
        if (before && before.active !== columns.active) {
          columns.paused_at = columns.active ? null : time;
          columns.paused_by = columns.active ? null : (fields.why ?? "user");
        }
        columns.active = columns.active ? 1 : 0;
      }
      if (typeof fields.isAdmin === "boolean") columns.is_admin = fields.isAdmin ? 1 : 0;
      if ("phone" in fields) {
        columns.phone = fields.phone ?? null;
        columns.phone_at = fields.phone ? time : null;
      }
      if ("phoneAskedAt" in fields) columns.phone_asked_at = fields.phoneAskedAt ?? null;
      if (fields.role) {
        columns.signed_out_at = null;
        columns.signed_out_role = null;
      }
      const set = Object.entries(columns).filter(([, value]) => value !== undefined);
      const sql = `UPDATE drivers SET ${[...set.map(([k]) => `${k} = ?`), "updated_at = ?"].join(", ")} WHERE chat_id = ?`;
      db.prepare(sql).run(...set.map(([, value]) => value), time, chatId);
      const after = this.getDriver(chatId);
      for (const event of userEvents(before, after, fields.why ?? null)) this.logEvent(chatId, event.type, event.detail);
      return after;
    },

    // Tarixga bitta voqea (history.js; signout / deleted / returned — shu fayldagi funksiyalardan)
    logEvent(chatId, type, detail = null) {
      db.prepare("INSERT INTO user_events (chat_id, type, detail, at) VALUES (?, ?, ?, ?)").run(chatId, type, json(detail), now());
    },

    // Rolni almashtirish — bot (/rol, «🔄 Rolni almashtirish»), Mini App va admin shu bitta funksiya orqali.
    // Har rolning sozlamalari alohida saqlanadi: hozirgi rolniki `profiles` ga yashiriladi, yangi rolniki
    // (avval to'ldirgan bo'lsa) qaytariladi — haydovchi bir martalik yuki uchun yuk beruvchi bo'lib, keyin qaytsa,
    // mashinasini qaytadan kiritmaydi. Yangi rolda sozlama bo'lmasa, profile = null (foydalanuvchi to'ldiradi).
    // Bir xil rol — hech narsa o'zgarmaydi. → yangilangan foydalanuvchi (profile bor — tiklandi)
    switchRole(chatId, role) {
      const user = this.getDriver(chatId) ?? this.saveDriver(chatId, {});
      if (user.role === role) return user;
      const profiles = { ...user.profiles };
      if (user.role && user.profile) profiles[user.role] = user.profile;
      return this.saveDriver(chatId, { role, profile: profiles[role] ?? null, profiles, draft: null, active: true });
    },

    // Hisobdan chiqish (web Sozlamalar → «🚪 Chiqish», Azimjon 2026-11-07: «chiqganida Ro'yxatdan o'tish bo'lib, Mos yuklar
    // ishlamay qolishi kerak»). Telegram'da odamni bot baribir taniydi, shuning uchun chiqish serverda: rol va sozlamalar
    // yashiriladi (`profiles` ga, switchRole dagidek), yuborish to'xtaydi — bot uni yangi foydalanuvchidek ko'radi
    // («Siz kimsiz?», «🚚 Ro'yxatdan o'tish»). Qayta kirib rolni tanlasa — switchRole o'sha rolning sozlamalarini tiklaydi.
    // Raqam, ism, admin belgisi qoladi (o'chirish — deleteDriver). Qachon va qaysi roldan chiqqani yoziladi — boshqaruv
    // markazi uni «🚪 Hisobdan chiqqan» deb, oxirgi rol va sozlamalari bilan ko'rsatadi. → yangilangan foydalanuvchi yoki null
    signOut(chatId) {
      const user = this.getDriver(chatId);
      if (!user) return null;
      if (user.signedOutAt != null && !user.role) return user; // allaqachon chiqqan — vaqti va roli o'zgarmasin
      const profiles = { ...user.profiles };
      if (user.role && user.profile) profiles[user.role] = user.profile;
      this.saveDriver(chatId, { role: null, profile: null, profiles, draft: null, active: false });
      db.prepare("UPDATE drivers SET signed_out_at = ?, signed_out_role = ? WHERE chat_id = ?").run(now(), user.role ?? null, chatId);
      this.logEvent(chatId, "signout", { role: user.role ?? null });
      return this.getDriver(chatId);
    },

    // Hisobni o'chirish: botdagi /ochirish → «Hisobni o'chirish» yoki web Sozlamalar → «🗑 Hisobni o'chirish».
    // Azimjon (2026-11-09, «Hammasi saqlansin»): qator va hamma ma'lumot qoladi — boshqaruv markazida «🗑 Hisobini o'chirgan».
    // Foydalanuvchi uchun esa hisob yopiladi: rol, sozlamalar, raqam va admin belgisi tozalanadi (o'sha paytdagisi
    // deleted_snapshot da va tarixdagi «deleted» voqeasida), yuborish to'xtaydi, web tokenlari ishlamaydi (public.js).
    // Qaytsa (comeBack) — bot uni yangi odamdek ko'radi, boshidan ro'yxatdan o'tadi; «necha marta o'chirgan» qoladi.
    // Butunlay o'chirish (odam talab qilsa) — faqat boshqaruv markazidan: purgeDriver. via — "bot" | "web".
    // → true (o'chirildi) yoki false (yo'q yoki allaqachon o'chirilgan)
    deleteDriver(chatId, { via = null } = {}) {
      const user = this.getDriver(chatId);
      if (!user || user.deletedAt != null) return false;
      const snapshot = {
        role: user.role,
        profile: user.profile,
        profiles: user.profiles,
        phone: user.phone,
        phoneAt: user.phoneAt,
        isAdmin: user.isAdmin,
        active: user.active,
        signedOutAt: user.signedOutAt,
        signedOutRole: user.signedOutRole,
      };
      db.prepare(
        `UPDATE drivers SET role = NULL, profile = NULL, profiles = NULL, draft = NULL, active = 0, is_admin = 0,
           phone = NULL, phone_at = NULL, phone_asked_at = NULL, signed_out_at = NULL, signed_out_role = NULL,
           deleted_at = ?, deleted_via = ?, deleted_count = deleted_count + 1, deleted_snapshot = ?
         WHERE chat_id = ?`,
      ).run(now(), via, json(snapshot), chatId);
      this.logEvent(chatId, "deleted", { via, ...snapshot });
      return true;
    },

    // O'chirgan odam qaytdi (botga yozdi yoki ilovaga qayta kirdi): «o'chirilgan» belgisi olinadi, qaytgan vaqti yoziladi.
    // Ma'lumotlari tiklanmaydi — u hisobini o'chirgan, boshidan boshlaydi. → true (qaytdi) yoki false (o'chirilmagan edi)
    comeBack(chatId, via = null) {
      const changed = db
        .prepare("UPDATE drivers SET deleted_at = NULL, deleted_snapshot = NULL, returned_at = ? WHERE chat_id = ? AND deleted_at IS NOT NULL")
        .run(now(), chatId).changes;
      if (changed) this.logEvent(chatId, "returned", { via });
      return changed > 0;
    },

    // Butunlay o'chirish — faqat boshqaruv markazidan (odam shaxsiy ma'lumotini o'chirishni talab qilsa):
    // foydalanuvchi, unga yuborilganlar ro'yxati va tarixi. Qaytarib bo'lmaydi. → true (bor edi) yoki false
    purgeDriver(chatId) {
      db.prepare("DELETE FROM deliveries WHERE chat_id = ?").run(chatId);
      db.prepare("DELETE FROM user_events WHERE chat_id = ?").run(chatId);
      return db.prepare("DELETE FROM drivers WHERE chat_id = ?").run(chatId).changes > 0;
    },

    // Oxirgi faollik: bot (har xabar / tugmadan keyin) va web (har so'rovda) chaqiradi. Faqat bor foydalanuvchiga,
    // updated_at o'zgarmaydi; SEEN_EVERY_MS dan tez-tez yozilmaydi (bot ↔ web almashsa — darrov)
    touchDriver(chatId, via = "bot") {
      const time = now();
      db.prepare("UPDATE drivers SET seen_at = ?, seen_via = ? WHERE chat_id = ? AND (seen_at IS NULL OR seen_at <= ? OR seen_via IS NOT ?)").run(
        time,
        via,
        chatId,
        time - SEEN_EVERY_MS,
        via,
      );
    },

    // «24 soat kirmadingiz» ogohlantirishi yuborildi (apps/bot idle.js). updated_at o'zgarmaydi — bu sozlama emas
    markIdleWarned(chatId) {
      db.prepare("UPDATE drivers SET idle_warned_at = ? WHERE chat_id = ?").run(now(), chatId);
      this.logEvent(chatId, "idle_warned");
    },

    // Bot har bir shaxsiy yuk xabaridan keyin yozadi (pipeline): ok — Telegram qabul qildimi, error — nega yo'q
    addDelivery({ loadId, chatId, ok, error = null }) {
      db.prepare("INSERT INTO deliveries (load_id, chat_id, ok, error, sent_at) VALUES (?, ?, ?, ?, ?)").run(
        loadId,
        chatId,
        ok ? 1 : 0,
        ok ? null : String(error ?? "xato").slice(0, 200),
        now(),
      );
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
