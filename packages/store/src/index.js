// Baza: e'lonlar navbati, yuklar, haydovchilar. Node'ning o'zidagi SQLite (node:sqlite) — o'rnatish shart emas, bepul.
// Fayl: data/yuk.db (gitga tushmaydi). Collector va bot — ikki alohida dastur, ikkalasi ham shu faylni ochadi:
// collector e'lonlarni navbatga yozadi, bot navbatdan olib tahlil qiladi va yuboradi.
// Keyinroq apps/api paydo bo'lganda PostgreSQL'ga o'tiladi — shu fayldagi funksiyalar o'sha yerga ko'chadi.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { foldText } from "@yuk/shared";
import { fileURLToPath } from "node:url";
import { createAdminQueries } from "./admin.js";
import { createUserSourceQueries } from "./userSources.js";
import { userEvents } from "./history.js";
import { createAiQueries } from "./ai.js";
import { AUTO_PRO_SQL, createTgAccountQueries, hashPhone } from "./tgAccounts.js";
import { createFeedQueries, migrateFeed } from "./feed.js";

export { acquireRunLock, BEAT_MS, isAlive, readRunLock, removeRunLock, RUN_DIR } from "./lock.js";
export { decryptText, encryptText, keyHint, loadSecret, SECRET_FILE } from "./secrets.js";
export { createCallLinks, createSessions, LINK_PERIOD_S, SESSION_TTL_S } from "./sessions.js";
export { TUNNEL_URL_KEY, tunnelUrl } from "./tunnel.js";
export { hashPhone, MAIN_TG_ACCOUNT, SCAN_RECHECK, TG_ACCOUNT_NAME } from "./tgAccounts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// YUK_DB — boshqa fayl bilan sinash uchun (masalan, YUK_DB=data/sinov.db); yo'l YukPlatform papkasiga nisbatan
export const DEFAULT_DB_FILE = path.resolve(ROOT, process.env.YUK_DB || path.join("data", "yuk.db"));
// Profil va guruh rasmlari (boshqaruv markazidagi ro'yxatlar uchun, 2026-11-16): users/<chat id>.jpg, sources/<nom>.jpg.
// API (apps/api avatars.js) bot orqali oladi, yopiq guruhnikini collector (avatars.js) o'qiydigan akkaunt bilan yuklaydi
export const AVATAR_DIR = path.join(path.dirname(DEFAULT_DB_FILE), "avatars");
// Ovozli xabar / dumaloq videoning asl fayli (2026-11-20, Azimjon: «audio va dumaloq video bar xato bo'lishi mumkin ekan, demak
// biz uni asl audio va dumaloq videosini ham qo'shib yo'naltiramiz»): collector media.js yozadi (24 soat turadi), bot
// haydovchiga shu faylni matni bilan bitta xabarda yuboradi. Ichida odamlarning ovozi — data/ gitignored
export const MEDIA_DIR = path.join(path.dirname(DEFAULT_DB_FILE), "media");
export const mediaFileName = (source, messageId, kind) => `${String(source ?? "").replace(/[^\w-]/g, "")}_${Number(messageId)}.${kind === "round" ? "mp4" : "ogg"}`;
export const mediaFileOf = (post, dir = MEDIA_DIR) => (post?.media && post.source && post.messageId ? path.join(dir, mediaFileName(post.source, post.messageId, post.media)) : null);
// Fayl nomi: "@TutGruz" → "@tutgruz", "-1001234" → "-1001234" (boshqa belgilar — tashlanadi)
export const avatarFileName = (key) => `${String(key).toLowerCase().replace(/[^a-z0-9@_-]/g, "")}.jpg`;

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

-- Blok ro'yxati (2026-11-09, Azimjon: boshqaruv markazidan bloklash «username va tel raqamga»). Bitta odam — 3 tagacha
-- qator: kind id (Telegram id), username (kichik harf, @siz), phone (+998...). Shulardan biri mos kelsa — bloklangan:
-- boshqa akkaunt o'sha username yoki raqam bilan kelsa ham. chat_id — kimni bloklaganda qo'shilgani
CREATE TABLE IF NOT EXISTS bans (
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  chat_id INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, value)
);
CREATE INDEX IF NOT EXISTS bans_chat ON bans (chat_id);

-- Botga topshiriq (2026-11-10): server (apps/api) — boshqa jarayon, u chatga bot kabi to'liq javob bera olmaydi
-- (mos yuklar ro'yxati, tugmalar bot kodida). Server shu yerga yozadi, bot har 2 soniyada olib bajaradi.
-- kind: route — haydovchi web'dagi xaritada yo'nalish tanladi → bot chatda «✅ Yo'nalish …» va mos yuklarni ko'rsatadi
CREATE TABLE IF NOT EXISTS bot_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Collector'ning Telegram akkauntlari (2026-11-13, tgAccounts.js): kim ekani va holati — collector yozadi.
-- tg_dialogs — har akkaunt a'zo bo'lgan guruh/kanallar (yopiq guruhni boshqaruv markazida shu ro'yxatdan tanlash uchun)
CREATE TABLE IF NOT EXISTS tg_accounts (
  name TEXT PRIMARY KEY,             -- "asosiy" | sessiya fayli nomi (apps/collector/sessions/<nom>.session)
  user_id TEXT,
  username TEXT,
  first_name TEXT,
  status TEXT,                       -- ok | error | logged_out | duplicate
  error TEXT,
  dialogs_at INTEGER,                -- guruhlar ro'yxati oxirgi marta qachon olingan
  added_by INTEGER,                  -- Mini App'dan kim qo'shgan (chat id); NULL — terminaldan / eski
  phone_hash TEXT,                   -- telefon raqamining xeshi (hashPhone): bir raqam ikki nom bilan ulanmasin; raqamning o'zi saqlanmaydi
  updated_at INTEGER NOT NULL
);
-- Akkauntlar guruhlarini avtomatik tekshirish (2026-11-13, tgAccounts.js dialogsToScan): har guruh bir marta (qaysi
-- akkaunt ko'rsa ham) «➕ Guruh qo'shish» dagi tekshiruvdan o'tadi. tg_dialogs har 30 daqiqada qayta yoziladi —
-- natija shuning uchun alohida jadvalda
CREATE TABLE IF NOT EXISTS dialog_scans (
  peer_id TEXT PRIMARY KEY,
  account TEXT,                      -- qaysi akkaunt tekshirdi
  state TEXT NOT NULL,               -- passed (sinovga olindi) | rejected | error
  note TEXT,
  stats TEXT,                        -- JSON (probe.js judgeProbe stats)
  at INTEGER NOT NULL
);
-- Yopiq guruhning taklif havolasi (t.me/+…) «➕ Guruh qo'shish» da (2026-11-13): qaysi guruh ekanini faqat Telegram
-- akkaunti bila oladi (messages.checkChatInvite). Bot so'rovni yozadi, collector foydalanuvchi ulagan akkaunt(lar)i bilan
-- tekshiradi, natijani bot o'qib, qo'shadi va javob yozadi
CREATE TABLE IF NOT EXISTS invite_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,          -- yuborgan foydalanuvchi
  hash TEXT NOT NULL,
  accounts TEXT NOT NULL,            -- JSON: tekshiradigan akkauntlar (foydalanuvchiniki), navbat bilan
  tried INTEGER NOT NULL DEFAULT 0,  -- nechtasi «a'zo emas» dedi
  state TEXT NOT NULL,               -- new | found | not_member | invalid | error
  peer_id TEXT,
  account TEXT,                      -- guruhga a'zo akkaunt
  title TEXT,
  chat_type TEXT,
  members INTEGER,
  error TEXT,
  reported INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_dialogs (
  account TEXT NOT NULL,
  peer_id TEXT NOT NULL,             -- "-100123…" (kanal / katta guruh) yoki "-123…" (kichik guruh)
  title TEXT,
  username TEXT,                     -- bo'lsa — ochiq guruh
  type TEXT,                         -- guruh | kanal
  members INTEGER,
  PRIMARY KEY (account, peer_id)
);
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
  // sender (2026-11-09) — e'lonni guruhga yozgan odamning Telegram username'i, @ siz («💬 Lichkasi» havolasi uchun).
  // NULL — username'i yo'q, kanal nomidan yozilgan, bot yoki eski e'lon
  if (!columns.includes("sender")) db.exec("ALTER TABLE posts ADD COLUMN sender TEXT");
  // media (2026-11-16) — matn ovozli xabardan (voice) yoki dumaloq videodan (round) o'girilgan (collector media.js). NULL — oddiy matn
  if (!columns.includes("media")) db.exec("ALTER TABLE posts ADD COLUMN media TEXT");
  // sender_id (2026-11-16) — yozgan odamning Telegram ID'si: username'i bo'lmasa bot «💬 Lichkasi» ni tg://user?id= bilan beradi
  if (!columns.includes("sender_id")) db.exec("ALTER TABLE posts ADD COLUMN sender_id TEXT");
  // Bot «taniydigan» yozuvchilar (2026-11-20): bot tg://user?id= tugmasini faqat o'zi ko'rgan odamga beradi
  // (begonasiga BUTTON_USER_INVALID). Yopiq guruhni o'qiyotgan akkaunt username'siz odamning ovozli yuk e'lonini botga
  // forward qilib, darhol o'chiradi — shundan keyin bot o'sha odamni ko'rgan bo'ladi (sinovda tasdiqlangan: o'chirilgandan
  // keyin ham tugma qabul qilinadi). Shu jadval — kimlar shunday «ko'rsatilgan» (collector media.js yozadi, bot o'qiydi)
  db.exec("CREATE TABLE IF NOT EXISTS reachable_senders (id TEXT PRIMARY KEY, at INTEGER NOT NULL)");
  // sender_phone (2026-11-20) — yopiq guruhda e'lon bergan odamning PROFIL raqami (Telegram'da hamma ko'radigan qilib
  // qo'ygan bo'lsa; matnda raqam bo'lmasa haydovchiga shu ko'rsatiladi). Faqat yopiq guruhlar uchun yoziladi (collector live.js)
  if (!columns.includes("sender_phone")) db.exec("ALTER TABLE posts ADD COLUMN sender_phone TEXT");
  // sources.voice (2026-11-20, Azimjon: «audio va dumaloq video yuklarini faqat yopiq va dashboardda men tasdiqlagan
  // guruhlardan chek qilsin! publik guruhlardan check qilsak AI token oqib ketadi»): 1 — ochiq guruhning ovozli xabarlari ham
  // matnga o'giriladi (boshqaruv markazi «Manbalar» → «🎤 Ovozli xabarlar»). Yopiq guruhlar — doim, ustun ularga ta'sir qilmaydi
  if (!db.prepare("PRAGMA table_info(sources)").all().some((c) => c.name === "voice")) db.exec("ALTER TABLE sources ADD COLUMN voice INTEGER");
  // Guruh bo'yicha «shu vaqtdan keyin» (trialStats — sinovdagi har guruh, bot har daqiqada va «Manbalar» sahifasi):
  // indekssiz guruhning hamma e'lonlari aylanardi (~700 ms × 12 guruh = 8 s, 2026-11-16) — indeks bilan ~1 ms.
  // Birinchi ishga tushishda ~2 s quriladi
  db.exec("CREATE INDEX IF NOT EXISTS posts_source_created ON posts (source, created_at)");
  // text_fold (2026-11-16) — qidiruv uchun matn: kichik harf, kirill → lotin, apostrofsiz (@yuk/shared foldText).
  // Yangi e'londa addPost yozadi; eskilari fonda bo'laklab to'ldiriladi (backfillTextFold, apps/api server.js)
  if (!columns.includes("text_fold")) db.exec("ALTER TABLE posts ADD COLUMN text_fold TEXT");
  // Yuk beruvchining o'z yuki (2026-11-10, «📦 Yuk berish»): shipper — kim yubordi (chat id), direct — tayyor yuklar (JSON,
  // @yuk/shared shipperLoad.js yoki botdagi erkin matndan tushunilgani). Bunday e'lon AI'ga bormaydi: bot uni darhol mos
  // haydovchilarga yuboradi (apps/bot pipeline.js). source = "shipper:<chat id>", link yo'q
  if (!columns.includes("shipper")) db.exec("ALTER TABLE posts ADD COLUMN shipper INTEGER");
  if (!columns.includes("direct")) db.exec("ALTER TABLE posts ADD COLUMN direct TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS posts_shipper ON posts (shipper, created_at)");
  // Manbalar: collector akkaunti guruhga a'zomi (a'zo — jonli), qachon tekshirilgan. NULL — hali tekshirilmagan
  const sourceColumns = db.prepare("PRAGMA table_info(sources)").all().map((c) => c.name);
  if (!sourceColumns.includes("joined")) db.exec("ALTER TABLE sources ADD COLUMN joined INTEGER");
  if (!sourceColumns.includes("checked_at")) db.exec("ALTER TABLE sources ADD COLUMN checked_at INTEGER");
  // Collector navbati (2026-11-09): poll_ms — guruh hozir qancha oraliqda so'ralyapti (faolligiga qarab);
  // watch — "tops": yangisi borligini bitta umumiy so'rov bilan bilib turadi, "poll": o'z navbati bilan so'raladi
  if (!sourceColumns.includes("poll_ms")) db.exec("ALTER TABLE sources ADD COLUMN poll_ms INTEGER");
  if (!sourceColumns.includes("watch")) db.exec("ALTER TABLE sources ADD COLUMN watch TEXT");
  // A'zo bo'lish navbati (2026-11-09): join_state — wanted (navbatda) | joined (collector qo'shildi) | requested (guruh
  // adminiga so'rov yuborildi) | error (join_error — nima uchun); join_at — oxirgi urinish (kunlik limit shundan sanaladi)
  if (!sourceColumns.includes("join_state")) db.exec("ALTER TABLE sources ADD COLUMN join_state TEXT");
  if (!sourceColumns.includes("join_error")) db.exec("ALTER TABLE sources ADD COLUMN join_error TEXT");
  if (!sourceColumns.includes("join_at")) db.exec("ALTER TABLE sources ADD COLUMN join_at INTEGER");
  // Foydalanuvchi qo'shgan manba (2026-11-10, userSources.js): added_by — kim (chat id), title/members/chat_type — Bot API
  // getChat dan; check_state — probe | trial | ok | failed (NULL — boshqaruv markazidan qo'shilgan, tekshirilmaydi);
  // check_until — sinov tugaydigan vaqt; check_note — natija matni; check_stats — sonlar (JSON); check_notified —
  // qo'shgan odamga oxirgi aytilgan holat
  for (const [name, type] of [
    ["added_by", "INTEGER"],
    ["title", "TEXT"],
    ["members", "INTEGER"],
    ["chat_type", "TEXT"],
    ["check_state", "TEXT"],
    ["check_at", "INTEGER"],
    ["check_until", "INTEGER"],
    ["check_note", "TEXT"],
    ["check_stats", "TEXT"],
    ["check_notified", "TEXT"],
  ]) {
    if (!sourceColumns.includes(name)) db.exec(`ALTER TABLE sources ADD COLUMN ${name} ${type}`);
  }
  // Qaysi Telegram akkaunti o'qiydi (2026-11-13, tgAccounts.js): NULL — asosiy; boshqasi — yopiq guruhga a'zo qo'shimcha akkaunt
  if (!sourceColumns.includes("account")) db.exec("ALTER TABLE sources ADD COLUMN account TEXT");
  // Akkauntni kim qo'shgan (2026-11-13): oddiy foydalanuvchi Sozlamalarda faqat o'zinikini ko'radi
  const tgColumns = db.prepare("PRAGMA table_info(tg_accounts)").all().map((c) => c.name);
  if (!tgColumns.includes("added_by")) db.exec("ALTER TABLE tg_accounts ADD COLUMN added_by INTEGER");
  // Guruhlarini tekshirish (2026-11-13): faqat boshqaruv markazida «🔎 Auto scan» bosilganda — scan_requested_at
  // (navbat tugaguncha), scan_done_at — oxirgi tekshiruv tugagan vaqt
  if (!tgColumns.includes("scan_requested_at")) db.exec("ALTER TABLE tg_accounts ADD COLUMN scan_requested_at INTEGER");
  if (!tgColumns.includes("scan_done_at")) db.exec("ALTER TABLE tg_accounts ADD COLUMN scan_done_at INTEGER");
  // Telefon-xesh (2026-11-13): shu raqamli akkaunt allaqachon ulangan bo'lsa, kod/parol so'ramasdan rad etish uchun
  if (!tgColumns.includes("phone_hash")) db.exec("ALTER TABLE tg_accounts ADD COLUMN phone_hash TEXT");
  // Manba akkaunt guruhlarini tekshirishdan kelgan (foydalanuvchiga har biri uchun xabar yuborilmaydi)
  if (!sourceColumns.includes("auto_scan")) db.exec("ALTER TABLE sources ADD COLUMN auto_scan INTEGER");

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
  // Kanal va guruhga a'zolik (2026-11-09, Azimjon: bot faqat @Yuk_Ekspert va @Yuk_Ekspert_chat a'zolariga ishlaydi).
  // sub_ok — 1 a'zo | 0 a'zo emas | NULL hali tekshirilmagan; sub_missing — qaysilariga a'zo emas (JSON ["@Yuk_Ekspert"]);
  // sub_checked_at — oxirgi tekshiruv; sub_reminded_at — «a'zo bo'ling, yuk yuborilmadi» eslatmasi yuborilgan vaqt
  if (!users.includes("sub_ok")) db.exec("ALTER TABLE drivers ADD COLUMN sub_ok INTEGER");
  if (!users.includes("sub_missing")) db.exec("ALTER TABLE drivers ADD COLUMN sub_missing TEXT");
  if (!users.includes("sub_checked_at")) db.exec("ALTER TABLE drivers ADD COLUMN sub_checked_at INTEGER");
  if (!users.includes("sub_reminded_at")) db.exec("ALTER TABLE drivers ADD COLUMN sub_reminded_at INTEGER");
  // Ochiq amal (2026-11-19, Azimjon: «amal yakunlab olmagunga qadar e'lonlar bot chatiga kelishi xato»): hold_kind —
  // qaysi oyna ochiq (filtr | wizard | guruh | raqam), hold_at — oxirgi bosish, hold_reminded_at — «tugallanmagan» eslatmasi.
  // Bazada — bot qayta ishga tushsa ham amal ochiq qoladi va e'lonlar kelmaydi
  if (!users.includes("hold_kind")) db.exec("ALTER TABLE drivers ADD COLUMN hold_kind TEXT");
  if (!users.includes("hold_at")) db.exec("ALTER TABLE drivers ADD COLUMN hold_at INTEGER");
  if (!users.includes("hold_reminded_at")) db.exec("ALTER TABLE drivers ADD COLUMN hold_reminded_at INTEGER");
  // commands_on — shu chatda Telegram'ning «Menu» tugmasi (buyruqlar ro'yxati) o'rnatilganmi (2026-11-10, Azimjon: rol
  // tanlanmaguncha ko'rinmasin). Bot apps/bot commands.js: rol bor — qo'yadi, yo'q — olib tashlaydi va shu yerga yozadi
  if (!users.includes("commands_on")) db.exec("ALTER TABLE drivers ADD COLUMN commands_on INTEGER NOT NULL DEFAULT 0");
  // route_msg_id — chatdagi oxirgi «📍 Qayerdan?» / «🏁 Qayerga?» xabari (2026-11-10). Yo'nalish web xaritasida tanlansa,
  // bot o'sha xabarni «✅ Yo'nalish: …» ga almashtiradi (eski tugmalar chatda osilib qolmasin)
  if (!users.includes("route_msg_id")) db.exec("ALTER TABLE drivers ADD COLUMN route_msg_id INTEGER");
  // Yuk beruvchi (2026-11-10): load_draft — botga yozilgan, hali tasdiqlanmagan yuk (JSON: { text, loads, stage, at,
  // messageId }; apps/bot shipperLoads.js); load_phones — oxirgi yukda yozgan raqamlari (keyingi yukda forma shu bilan ochiladi)
  if (!users.includes("load_draft")) db.exec("ALTER TABLE drivers ADD COLUMN load_draft TEXT");
  if (!users.includes("load_phones")) db.exec("ALTER TABLE drivers ADD COLUMN load_phones TEXT");

  // kind — yuk (yuk bor, mashina kerak) | mashina (mashina bo'sh, yuk kerak — yuk beruvchilarga)
  const loads = db.prepare("PRAGMA table_info(loads)").all().map((c) => c.name);
  if (!loads.includes("kind")) db.exec("ALTER TABLE loads ADD COLUMN kind TEXT NOT NULL DEFAULT 'yuk'");

  // called_at — haydovchi yuk xabaridagi «📞 Telefon qilish» tugmasini birinchi bosgan vaqt (2026-11-09).
  // Qo'ng'iroq qilganini bilmaymiz (u telefonda), faqat raqamni qo'ng'iroq oynasiga ochganini
  const sent = db.prepare("PRAGMA table_info(deliveries)").all().map((c) => c.name);
  if (!sent.includes("called_at")) db.exec("ALTER TABLE deliveries ADD COLUMN called_at INTEGER");

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
    autoPro: row.auto_pro === 1, // raqam + bog'langan akkaunt (AUTO_PRO_SQL) — roles.js planAllows Pro deb biladi
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
    // Kanal va guruhga a'zolik: true | false | null (tekshirilmagan); subMissing — a'zo bo'lmaganlari (["@Yuk_Ekspert"])
    // (blok — driverRow da yo'q: store.banOf / listDrivers().banned)
    subOk: row.sub_ok == null ? null : row.sub_ok === 1,
    subMissing: parse(row.sub_missing) ?? [],
    subCheckedAt: row.sub_checked_at ?? null,
    subRemindedAt: row.sub_reminded_at ?? null,
    // Ochiq amal: { kind, at, remindedAt } yoki null — shu paytda e'lonlar bu chatga yuborilmaydi
    hold: row.hold_kind ? { kind: row.hold_kind, at: row.hold_at ?? null, remindedAt: row.hold_reminded_at ?? null } : null,
    // Yuk beruvchi oxirgi yukida yozgan raqamlar (["+998..."]) — keyingi yuk formasi shu bilan ochiladi
    loadPhones: parse(row.load_phones) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Blok kalitlari: Telegram id, username (kichik harf, @siz), raqam. Bo'sh qiymatlar tashlanadi
export function banKeys({ chatId = null, username = null, phone = null } = {}) {
  const keys = [];
  if (chatId != null) keys.push({ kind: "id", value: String(chatId) });
  const name = String(username ?? "").replace(/^@/, "").trim().toLowerCase();
  if (name) keys.push({ kind: "username", value: name });
  if (phone) keys.push({ kind: "phone", value: String(phone) });
  return keys;
}

// SQL: drivers qatori bloklanganmi (activeUsers — bloklanganga yuk va «24 soat» ogohlantirishi bormaydi)
const NOT_BANNED = `NOT EXISTS (SELECT 1 FROM bans b WHERE (b.kind = 'id' AND b.value = CAST(drivers.chat_id AS TEXT))
  OR (b.kind = 'username' AND b.value = lower(drivers.username)) OR (b.kind = 'phone' AND b.value = drivers.phone))`;

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
    sender: row.sender ?? null, // e'lonni yozgan odamning username'i («💬 Lichkasi»)
    media: row.media ?? null, // voice | round — matn ovozdan o'girilgan (🎤 / 📹)
    senderId: row.sender_id ?? null, // yozgan odamning Telegram ID'si (username'siz «💬 Lichkasi» uchun)
    senderPhone: row.sender_phone ?? null, // yopiq guruhda: yozgan odamning profil raqami (ko'rinadigan bo'lsa)
    // Yuk beruvchining o'z yuki: kim yubordi va tayyor yuklar (AI'ga bormaydi, bot darhol yuboradi). Oddiy e'londa — null
    shipper: row.shipper ?? null,
    fromShipper: row.shipper != null,
    direct: row.direct == null ? null : JSON.parse(row.direct),
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
  migrateFeed(db);
  // Qidiruv: fold(matn) LIKE fold(so'rov) — kirill/lotin va katta-kichik harf farqi yo'q (@yuk/shared searchText.js)
  db.function("fold", { deterministic: true }, (value) => (value == null ? null : foldText(value)));
  // Akkaunt egasini raqam bo'yicha topish (tgAccounts.js OWNS_ACCOUNT_SQL): tg_accounts.phone_hash bilan bir xil xesh
  db.function("tg_phone_hash", { deterministic: true }, (value) => (value == null ? null : hashPhone(value)));

  const q = {
    insertPost: db.prepare(
      `INSERT OR IGNORE INTO posts (source, message_id, link, text, text_key, posted_at, status, created_at, via, sender, media, sender_id, text_fold, sender_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
       WHERE status = 'new' AND posted_at < ? AND direct IS NULL AND id NOT IN (SELECT value FROM json_each(?))`,
    ),
    recentLoad: db.prepare("SELECT id FROM loads WHERE key = ? AND kind = ? AND created_at > ? LIMIT 1"),
    insertLoad: db.prepare("INSERT INTO loads (post_id, key, data, kind, created_at) VALUES (?, ?, ?, ?, ?)"),
    loadDelivery: db.prepare("UPDATE loads SET sent_to = ?, channel_message_id = ? WHERE id = ?"),
    recentLoads: db.prepare(
      `SELECT l.id, l.data, l.created_at, p.source, p.link, p.posted_at, p.sender, p.shipper, p.media, p.sender_id
       FROM loads l JOIN posts p ON p.id = l.post_id
       WHERE l.created_at > ? AND l.kind = ? ORDER BY l.id DESC LIMIT ?`,
    ),
    getDriver: db.prepare(`SELECT *, ${AUTO_PRO_SQL} AS auto_pro FROM drivers WHERE chat_id = ?`),
    insertDriver: db.prepare(
      "INSERT OR IGNORE INTO drivers (chat_id, name, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ),
    // Rolsiz eski yozuv profili bilan — haydovchi (driverRow dagi qoida bilan bir xil)
    activeUsers: db.prepare(
      `SELECT *, ${AUTO_PRO_SQL} AS auto_pro FROM drivers WHERE active = 1 AND profile IS NOT NULL AND COALESCE(role, 'haydovchi') = ? AND ${NOT_BANNED}`,
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
    // Foydalanuvchi qo'shgan guruh/kanallar: tekshirish va 24 soatlik sinov (userSources.js)
    ...createUserSourceQueries(db, now),
    // AI kalitlari va ulanishlar holati (ai.js)
    ...createAiQueries(db, now),
    // Collector'ning Telegram akkauntlari va ularning guruhlari ro'yxati (tgAccounts.js)
    ...createTgAccountQueries(db, now),
    // Haydovchining tezkor rejimi: asl matn bilan kimga ketgani, «Mening guruhlarim» ro'yxati (feed.js)
    ...createFeedQueries(db, now),

    // --- E'lonlar navbati ---
    // Yangi e'lonni navbatga qo'yadi. Shu matn dedupeWindowMs ichida bo'lgan bo'lsa — "duplicate", AI'ga bormaydi.
    // → { id, status } yoki null (bu xabar allaqachon bor). via — live | poll (collector), qolganlari null.
    // sender — e'lonni yozgan odamning username'i, @ siz (@yuk/shared telegramUsername tekshirgan; bo'lmasa null)
    addPost({ source, messageId, link = null, text, postedAt = now(), via = null, sender = null, media = null, senderId = null, senderPhone = null }, { dedupeWindowMs } = {}) {
      const key = textKey(text);
      const same = dedupeWindowMs ? q.recentSameText.get(key, postedAt - dedupeWindowMs) : null;
      const status = same ? "duplicate" : "new";
      const result = q.insertPost.run(source, messageId, link, text, key, postedAt, status, now(), via, sender, media, senderId == null ? null : String(senderId), foldText(text), senderPhone);
      if (result.changes === 0) return null;
      return { id: Number(result.lastInsertRowid), status };
    },

    // Ovozli xabarning davomi (collector media.js): shu odam bir necha xabarda aytgan (yuk — birida, telefon — keyingisida).
    // Ikkalasining matni YANGI e'lon bo'lib yoziladi (yangi id — botning tezkor yo'li va qoidaviy parser uni darhol ko'radi),
    // oldingisi «davomi bilan birlashtirildi» deb yopiladi. Oldingisidan yuk topilib yuborilgan bo'lsa — birlashtirilmaydi.
    // post — addPost maydonlari (davomi xabarining o'zi); → { id, status } | null
    mergePost(prevId, post) {
      const prev = db.prepare("SELECT text, status FROM posts WHERE id = ?").get(prevId);
      if (!prev || prev.status === "duplicate") return null;
      if (db.prepare("SELECT 1 FROM loads WHERE post_id = ? LIMIT 1").get(prevId)) return null;
      const text = `${prev.text}\n${String(post.text).trim()}`;
      const added = this.addPost({ ...post, text });
      if (!added) return null;
      db.prepare("UPDATE posts SET status = 'done', error = ?, done_at = ? WHERE id = ?").run(`Davomi bilan birlashtirildi: #${added.id}`, now(), prevId);
      return added;
    },

    // Eski e'lonlarning text_fold ustunini to'ldirish — eng yangisidan, bittada `limit` ta (~5 000 qator ≈ 0,1 s, jarayon
    // qotmaydi). Qayerga yetgani settings «text_fold_cursor» da. → nechta to'ldirildi (0 — hammasi tayyor)
    backfillTextFold(limit = 5000) {
      const key = "text_fold_cursor";
      let cursor = Number(db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value);
      if (!Number.isFinite(cursor)) cursor = (db.prepare("SELECT MAX(id) AS id FROM posts").get().id ?? 0) + 1;
      if (cursor <= 1) return 0;
      const low = Math.max(0, cursor - limit);
      const changed = db.prepare("UPDATE posts SET text_fold = fold(text) WHERE id >= ? AND id < ? AND text_fold IS NULL").run(low, cursor).changes;
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, String(low));
      return low > 0 ? Math.max(Number(changed), 1) : Number(changed);
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

    // Shu vaqtdan keyin JOYLANGAN guruh e'lonlari, holati qanday bo'lsa ham (takrorlar va yuk beruvchining yuki tashqari),
    // eng yangisi birinchi — bot pipeline catchUp (haydovchi e'lon olishni endi boshladi: oxirgi daqiqalardagilari ham)
    recentPostsSince(postedSince, limit = 300) {
      return db
        .prepare(
          `SELECT * FROM posts INDEXED BY posts_created WHERE created_at > ? AND posted_at >= ? AND status != 'duplicate' AND direct IS NULL AND shipper IS NULL
           ORDER BY posted_at DESC, id DESC LIMIT ?`,
        )
        .all(postedSince - 5 * 60_000, postedSince, limit)
        .map(queuedPost);
    },

    // --- Yuk beruvchining o'z yuki («📦 Yuk berish»: web forma yoki botga yozilgan matn) ---
    // Navbatga tushadi (bot pipeline.js uni AI'siz, darhol mos haydovchilarga yuboradi va natijani yuk beruvchiga yozadi).
    // loads — tayyor yuklar (@yuk/shared sanitizeShipperLoad yoki bot tushungani, telefonlari bilan); text — botga yozgani
    // yoki formadan yasalgan matn (shipperLoadText); via — "bot" | "web"; sender — username («💬 Lichkasi»).
    // message_id — shu yuk beruvchining navbatdagi raqami (1, 2, 3...; bitta SQL — bot va server bir vaqtda yozsa ham adashmaydi).
    // → { id }
    addDirectPost({ chatId, text, loads, via = "bot", sender = null }) {
      const time = now();
      const source = `shipper:${chatId}`;
      const result = db
        .prepare(
          `INSERT INTO posts (source, message_id, link, text, text_key, posted_at, status, created_at, via, sender, shipper, direct, text_fold)
           SELECT ?, COALESCE(MAX(message_id), 0) + 1, NULL, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ? FROM posts WHERE source = ?`,
        )
        .run(source, text, textKey(text), time, time, via, sender, chatId, JSON.stringify(loads), foldText(text), source);
      return { id: Number(result.lastInsertRowid) };
    },

    // Oxirgi sinceMs ichida shu yuk beruvchi nechta yuk e'loni yubordi (kunlik limit — @yuk/shared SHIPPER_LOAD_LIMIT)
    shipperPostCount(chatId, sinceMs = 24 * 60 * 60 * 1000) {
      return db.prepare("SELECT COUNT(*) AS n FROM posts WHERE shipper = ? AND created_at > ?").get(chatId, now() - sinceMs).n;
    },

    // Yuk beruvchining yuborgan yuklari, eng yangisi birinchi: natijasi bilan (status, error — masalan «allaqachon bor»,
    // loads — nechta yuk saqlandi, sent — nechta haydovchiga yetdi). Boshqaruv markazidagi «Batafsil» uchun
    shipperPosts(chatId, { limit = 30 } = {}) {
      return db
        .prepare(
          `SELECT p.id, p.text, p.via, p.status, p.error, p.created_at, p.direct,
             (SELECT COUNT(*) FROM loads l WHERE l.post_id = p.id) AS loads,
             (SELECT COALESCE(SUM(sent_to), 0) FROM loads l WHERE l.post_id = p.id) AS sent
           FROM posts p WHERE p.shipper = ? ORDER BY p.id DESC LIMIT ?`,
        )
        .all(chatId, limit)
        .map((row) => ({
          id: row.id,
          text: row.text,
          via: row.via,
          status: row.status,
          error: row.error,
          createdAt: row.created_at,
          direct: row.direct == null ? [] : JSON.parse(row.direct),
          loads: row.loads,
          sent: row.sent,
        }));
    },

    // Botga yozilgan, hali tasdiqlanmagan yuk (apps/bot shipperLoads.js). Web forma «✏️ Formada tuzatish» bilan shuni ochadi
    loadDraft(chatId) {
      return parse(db.prepare("SELECT load_draft FROM drivers WHERE chat_id = ?").get(chatId)?.load_draft ?? null);
    },

    setLoadDraft(chatId, draft) {
      db.prepare("UPDATE drivers SET load_draft = ? WHERE chat_id = ?").run(json(draft ?? null), chatId);
    },

    // Oxirgi yukdagi raqamlar — keyingi yukda forma shu bilan to'ldirilib ochiladi (updated_at o'zgarmaydi — bu sozlama emas)
    setLoadPhones(chatId, phones) {
      db.prepare("UPDATE drivers SET load_phones = ? WHERE chat_id = ?").run(json(phones?.length ? phones : null), chatId);
    },

    // parsedBy — e'lonni kim tushundi: "rules" | "ai" | "shipper" (yuk beruvchining o'zi) (berilmasa — o'zgarmaydi)
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
    // → [{ id, load, post: { source, link, postedAt, sender, fromShipper }, createdAt }]
    // fromShipper — yuk egasining o'zi yuborgan («📦 Yuk berish»). Uning chat id'si BERILMAYDI: bu ro'yxat web'ga ham ketadi
    recentLoads({ sinceMs = 24 * 60 * 60 * 1000, limit = 500, kind = "yuk" } = {}) {
      return q.recentLoads.all(now() - sinceMs, kind, limit).map((row) => ({
        id: row.id,
        load: JSON.parse(row.data),
        // source "shipper:<chat id>" ham yashiriladi — null
        post: {
          source: row.shipper != null ? null : row.source,
          link: row.link,
          postedAt: row.posted_at,
          sender: row.sender ?? null,
          fromShipper: row.shipper != null,
          media: row.media ?? null,
          senderId: row.sender_id ?? null,
        },
        createdAt: row.created_at,
      }));
    },

    // Bitta yuk id bo'yicha («📞 Telefon qilish» sahifasi raqamni shundan oladi) → { id, kind, load, post } yoki null
    getLoad(id) {
      const row = db
        .prepare("SELECT l.id, l.data, l.kind, l.created_at, p.source, p.link, p.posted_at FROM loads l JOIN posts p ON p.id = l.post_id WHERE l.id = ?")
        .get(id);
      if (!row) return null;
      return {
        id: row.id,
        kind: row.kind ?? "yuk",
        load: JSON.parse(row.data),
        post: { source: row.source, link: row.link, postedAt: row.posted_at },
        createdAt: row.created_at,
      };
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
    // foydalanuvchi, unga yuborilganlar ro'yxati, tarixi va (yuk beruvchi bo'lsa) o'zi yuborgan yuklar. Qaytarib bo'lmaydi. → true (bor edi) yoki false
    purgeDriver(chatId) {
      db.prepare("DELETE FROM deliveries WHERE chat_id = ?").run(chatId);
      db.prepare("DELETE FROM post_deliveries WHERE chat_id = ?").run(chatId);
      // Yuk beruvchi bo'lsa — o'zi yuborgan yuklar ham (ularda uning raqamlari bor): yetkazilganlar ro'yxati, yuklar, e'lonlar
      const own = "SELECT id FROM posts WHERE shipper = ?";
      db.prepare(`DELETE FROM deliveries WHERE load_id IN (SELECT id FROM loads WHERE post_id IN (${own}))`).run(chatId);
      db.prepare(`DELETE FROM loads WHERE post_id IN (${own})`).run(chatId);
      db.prepare("DELETE FROM posts WHERE shipper = ?").run(chatId);
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

    // Kanal va guruhga a'zolik tekshirildi (apps/bot members.js). Faqat bor foydalanuvchiga, updated_at o'zgarmaydi.
    // Holat o'zgarsa — tarixga: sub_left (chiqdi yoki hali a'zo emas, qaysilariga) / sub_joined (hammasiga a'zo bo'ldi).
    // Birinchi tekshiruvda a'zo chiqsa — yozilmaydi (hamma eski foydalanuvchi uchun bir xil keraksiz qator bo'lardi)
    setSubscription(chatId, { ok, missing = [] }) {
      const before = db.prepare("SELECT sub_ok, sub_missing FROM drivers WHERE chat_id = ?").get(chatId);
      if (!before) return false;
      const list = ok ? [] : [...missing];
      db.prepare("UPDATE drivers SET sub_ok = ?, sub_missing = ?, sub_checked_at = ? WHERE chat_id = ?").run(ok ? 1 : 0, json(list), now(), chatId);
      const was = before.sub_ok == null ? null : before.sub_ok === 1;
      if (!ok && (was !== false || before.sub_missing !== json(list))) this.logEvent(chatId, "sub_left", { missing: list, first: was == null });
      else if (ok && was === false) this.logEvent(chatId, "sub_joined");
      return true;
    },

    // --- Blok (boshqaruv markazidan; bot va web bloklanganga «Uzr, sizga xizmat ko'rsata olmaymiz!» deydi) ---
    // Bloklanganmi: id, username yoki raqamdan biri ro'yxatda bo'lsa → { kind, value, chatId, at } (birinchi mos), yo'q — null.
    // username — Telegram'dan kelgan hozirgisi (bazadagi eskirgan bo'lishi mumkin), phone — bazadagi (o'zi ulashgan)
    banOf({ chatId = null, username = null, phone = null } = {}) {
      const order = { id: 0, username: 1, phone: 2 };
      const found = banKeys({ chatId, username, phone })
        .map((key) => db.prepare("SELECT kind, value, chat_id, created_at FROM bans WHERE kind = ? AND value = ?").get(key.kind, key.value))
        .filter(Boolean)
        .sort((a, b) => order[a.kind] - order[b.kind])[0];
      return found ? { kind: found.kind, value: found.value, chatId: found.chat_id, at: found.created_at } : null;
    },

    // Bloklash: shu foydalanuvchining id, username va raqami ro'yxatga. → banOf natijasi (yo'q foydalanuvchi — null)
    banDriver(chatId) {
      const user = this.getDriver(chatId);
      if (!user) return null;
      const keys = banKeys(user);
      const add = db.prepare("INSERT OR IGNORE INTO bans (kind, value, chat_id, created_at) VALUES (?, ?, ?, ?)");
      const time = now();
      for (const key of keys) add.run(key.kind, key.value, chatId, time);
      this.logEvent(chatId, "banned", { username: user.username ?? null, phone: user.phone ?? null });
      return this.banOf(user);
    },

    // Blokdan chiqarish: shu qatorni bloklab turgan hamma yozuv (o'zi bloklanganda qo'shilgani va username / raqami bo'yicha
    // mos kelgani). Boshqa odam bloklanganda qo'shilgan id yozuvi qoladi — u odam bloklangan bo'lib qoladi. → o'chgan soni
    unbanDriver(chatId) {
      const user = this.getDriver(chatId) ?? { chatId };
      let removed = db.prepare("DELETE FROM bans WHERE chat_id = ?").run(chatId).changes;
      const drop = db.prepare("DELETE FROM bans WHERE kind = ? AND value = ?");
      for (const key of banKeys(user)) removed += drop.run(key.kind, key.value).changes;
      if (removed) this.logEvent(chatId, "unbanned");
      return removed;
    },

    // «Menu» tugmasi (bot commands.js): kerakli holati (want — rol tanlangan: role yoki eski profil bor) Telegram'dagidan
    // (commands_on) farq qiladigan chatlar. chatId — faqat shu odam. Rol web'da, botda yoki boshqaruv markazida o'zgarsa —
    // shu ro'yxatga tushadi. → [{ chatId, want }]
    commandsToSync({ chatId = null, limit = 50 } = {}) {
      const want = "(role IS NOT NULL OR profile IS NOT NULL)";
      const where = chatId == null ? "" : "AND chat_id = ?";
      return db
        .prepare(`SELECT chat_id, ${want} AS want FROM drivers WHERE ${want} != commands_on ${where} LIMIT ?`)
        .all(...(chatId == null ? [] : [chatId]), limit)
        .map((row) => ({ chatId: row.chat_id, want: Boolean(row.want) }));
    },

    setCommandsOn(chatId, on) {
      db.prepare("UPDATE drivers SET commands_on = ? WHERE chat_id = ?").run(on ? 1 : 0, chatId);
    },

    // Buyruqlar ro'yxatining o'zi o'zgarganda (yangi buyruq qo'shildi): «o'rnatilgan» deb yozilgan hamma chat qaytadan
    // farqli bo'lib qoladi — keyingi tekshiruv ularga yangi ro'yxatni qo'yadi. → nechta chat
    resetCommandsOn() {
      return Number(db.prepare("UPDATE drivers SET commands_on = 0 WHERE commands_on = 1").run().changes);
    },

    // Chatdagi yo'nalish tanlash xabari (bot): ko'rsatilganda — id, tanlab bo'lingach — null
    setRouteMessage(chatId, messageId) {
      db.prepare("UPDATE drivers SET route_msg_id = ? WHERE chat_id = ?").run(messageId ?? null, chatId);
    },

    routeMessage(chatId) {
      return db.prepare("SELECT route_msg_id FROM drivers WHERE chat_id = ?").get(chatId)?.route_msg_id ?? null;
    },

    // Botga topshiriq (bot_notices jadvali): server yozadi, bot oladi. Bir odamning bir xil topshirig'i navbatda bir marta
    addBotNotice(chatId, kind) {
      const waiting = db.prepare("SELECT 1 FROM bot_notices WHERE chat_id = ? AND kind = ?").get(chatId, kind);
      if (!waiting) db.prepare("INSERT INTO bot_notices (chat_id, kind, created_at) VALUES (?, ?, ?)").run(chatId, kind, now());
    },

    // Navbatdagilarni olib, o'chiradi (bot har 2 soniyada). maxAgeMs dan eskisi (bot uzoq o'chiq turgan) — bajarilmaydi,
    // faqat o'chiriladi: odam 10 daqiqa oldingi tanlovi uchun kutilmagan xabar olmasin
    takeBotNotices({ limit = 20, maxAgeMs = 10 * 60 * 1000 } = {}) {
      const rows = db.prepare("SELECT id, chat_id, kind, created_at FROM bot_notices ORDER BY id LIMIT ?").all(limit);
      const drop = db.prepare("DELETE FROM bot_notices WHERE id = ?");
      for (const row of rows) drop.run(row.id);
      const since = now() - maxAgeMs;
      return rows.filter((row) => row.created_at >= since).map((row) => ({ id: row.id, chatId: row.chat_id, kind: row.kind, createdAt: row.created_at }));
    },

    // Ochiq amal (bot.js holdWindow / release): har bosishda vaqt yangilanadi, eslatma qayta qurollanadi
    setHold(chatId, kind) {
      db.prepare("UPDATE drivers SET hold_kind = ?, hold_at = ?, hold_reminded_at = NULL WHERE chat_id = ?").run(kind, now(), chatId);
    },
    clearHold(chatId) {
      db.prepare("UPDATE drivers SET hold_kind = NULL, hold_at = NULL, hold_reminded_at = NULL WHERE chat_id = ? AND hold_kind IS NOT NULL").run(chatId);
    },
    // before dan oldin oxirgi marta bosilgan, hali eslatilmagan ochiq amallar → [{ chatId, kind, at }]
    holdsToRemind(before) {
      return db
        .prepare("SELECT chat_id, hold_kind, hold_at FROM drivers WHERE hold_kind IS NOT NULL AND hold_reminded_at IS NULL AND hold_at < ?")
        .all(before)
        .map((row) => ({ chatId: row.chat_id, kind: row.hold_kind, at: row.hold_at }));
    },
    markHoldReminded(chatId) {
      db.prepare("UPDATE drivers SET hold_reminded_at = ? WHERE chat_id = ?").run(now(), chatId);
    },

    // «A'zo bo'ling — yuk yuborilmadi» eslatmasi yuborildi (bot members.js, kuniga ko'pi bilan bir marta)
    markSubReminded(chatId) {
      db.prepare("UPDATE drivers SET sub_reminded_at = ? WHERE chat_id = ?").run(now(), chatId);
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

    // «📞 Telefon qilish» bosildi: shu odamga yuborilgan shu yukka birinchi bosilgan vaqt yoziladi (keyingilari — yo'q).
    // «📋 Mos yuklar» ro'yxatidan bosilganda deliveries qatori bo'lmasligi mumkin — unda hech narsa o'zgarmaydi
    markCalled({ loadId, chatId }) {
      return (
        db
          .prepare(
            `UPDATE deliveries SET called_at = ? WHERE id = (
               SELECT id FROM deliveries WHERE load_id = ? AND chat_id = ? AND ok = 1 AND called_at IS NULL ORDER BY id DESC LIMIT 1)`,
          )
          .run(now(), loadId, chatId).changes > 0
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

    // Bot ko'rgan yozuvchi (forward orqali) — unga «💬 Lichkasi» tugmasini berish mumkin. 30 kundan eskisi — qayta ko'rsatiladi
    markSenderReachable(id) {
      if (id == null) return;
      db.prepare("INSERT INTO reachable_senders (id, at) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET at = excluded.at").run(String(id), now());
    },
    senderReachable(id, { maxAgeMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
      if (id == null) return false;
      return Boolean(db.prepare("SELECT 1 FROM reachable_senders WHERE id = ? AND at > ?").get(String(id), now() - maxAgeMs));
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
