// Ilova «📝 E'lon berish» chatining tarixi (Azimjon, 2026-11-25: «ilova o'chirib boshidan kirsa yoki ushbu accountga boshqa
// qurilmadan kirsa ushbu audio yuklab olish eshitadigan huddi telegramdagidek»). Har xabar — qator: kim (me | bot), matn,
// ovozli bo'lsa — fayl nomi va davomiyligi (fayl data/chat-audio/ da, apps/api loadChat), bot javobidagi kartalar va
// bosqich (confirm | phone), yuborilgan yuk id si (natija keyin shu qatorga bog'lanadi).
export const LOAD_CHAT_SQL = `
CREATE TABLE IF NOT EXISTS load_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  sender TEXT NOT NULL,              -- me | bot
  text TEXT,
  audio TEXT,                        -- ovoz fayli nomi (data/chat-audio/<chat_id>/<nom>)
  duration_ms INTEGER,
  extra TEXT,                        -- JSON: { cards, stage, phones, postId, result }
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS load_chat_chat ON load_chat (chat_id, id);
`;

const parse = (text) => {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
};
const rowOf = (row) => ({
  id: row.id,
  from: row.sender,
  text: row.text ?? "",
  audio: row.audio ?? null,
  durationMs: row.duration_ms ?? null,
  ...parse(row.extra),
  at: row.created_at,
});

export function createLoadChatQueries(db, now) {
  db.exec(LOAD_CHAT_SQL);
  const q = {
    add: db.prepare("INSERT INTO load_chat (chat_id, sender, text, audio, duration_ms, extra, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    get: db.prepare("SELECT * FROM load_chat WHERE id = ? AND chat_id = ?"),
    last: db.prepare("SELECT * FROM (SELECT * FROM load_chat WHERE chat_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id"),
    extra: db.prepare("UPDATE load_chat SET extra = ? WHERE id = ?"),
    purge: db.prepare("DELETE FROM load_chat WHERE chat_id = ?"),
  };
  return {
    // → qo'shilgan xabar
    addChatMessage(chatId, { from, text = "", audio = null, durationMs = null, extra = null }) {
      const { lastInsertRowid } = q.add.run(chatId, from, text, audio, durationMs, extra && Object.keys(extra).length ? JSON.stringify(extra) : null, now());
      return rowOf(q.get.get(Number(lastInsertRowid), chatId));
    },
    chatMessages: (chatId, limit = 100) => q.last.all(chatId, limit).map(rowOf),
    chatMessage: (chatId, id) => {
      const row = q.get.get(Number(id), chatId);
      return row ? rowOf(row) : null;
    },
    setChatExtra(chatId, id, extra) {
      const row = q.get.get(Number(id), chatId);
      if (row) q.extra.run(JSON.stringify({ ...parse(row.extra), ...extra }), row.id);
    },
    purgeChat: (chatId) => void q.purge.run(chatId),
  };
}
