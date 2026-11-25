// Ilova (YukApp) bildirishnomalari uchun telefon tokenlari (FCM). Bitta odamda bir nechta telefon bo'lishi mumkin;
// token boshqa odamga o'tsa (telefonda boshqa hisob bilan kirdi) — yangi egasiniki. last_post_id — shu tokenga oxirgi
// yuborilgan (yoki «ko'rilgan» deb belgilangan) e'lon id: undan kattalari yangi (apps/api/src/push.js).
export const PUSH_SQL = `
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  last_post_id INTEGER,              -- null — hali hech narsa yuborilmagan (birinchi aylanishda eng oxirgisi belgilanadi)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_tokens_chat ON push_tokens (chat_id);
`;

export const PUSH_TOKEN = /^[\w:.\-]{20,4096}$/;

export function createPushQueries(db, now) {
  db.exec(PUSH_SQL);
  const q = {
    save: db.prepare(
      `INSERT INTO push_tokens (token, chat_id, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
         last_post_id = CASE WHEN chat_id = excluded.chat_id THEN last_post_id ELSE NULL END,
         chat_id = excluded.chat_id, platform = excluded.platform, updated_at = excluded.updated_at`,
    ),
    all: db.prepare("SELECT token, chat_id, last_post_id FROM push_tokens ORDER BY chat_id"),
    cursor: db.prepare("UPDATE push_tokens SET last_post_id = ? WHERE token = ?"),
    drop: db.prepare("DELETE FROM push_tokens WHERE token = ?"),
    dropOf: db.prepare("DELETE FROM push_tokens WHERE chat_id = ?"),
  };
  return {
    savePushToken(chatId, token, platform = "android") {
      if (!PUSH_TOKEN.test(String(token))) throw new Error("Token noto'g'ri");
      q.save.run(String(token), Number(chatId), String(platform).slice(0, 16), now(), now());
    },
    // → [{ token, chatId, lastPostId }]
    pushTokens: () => q.all.all().map((row) => ({ token: row.token, chatId: row.chat_id, lastPostId: row.last_post_id })),
    setPushCursor: (token, postId) => void q.cursor.run(Number(postId), token),
    dropPushToken: (token) => void q.drop.run(token),
    dropPushTokensOf: (chatId) => void q.dropOf.run(Number(chatId)),
  };
}
