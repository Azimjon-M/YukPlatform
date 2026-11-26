// Ilova qurilmalari (Azimjon, 2026-11-26: «1 akkauntda bir nechta qurilma ishlay olmasin, max 2 ta; yana kirmoqchi bo'lsa
// qaysidir qurilmani chiqaradigan qil. Bu faqat ilova uchun»). Har ilovaga kirish — bitta qator: tokenning sha256 izi
// (tokenning o'zi saqlanmaydi), qurilma nomi, qachon kirdi / oxirgi marta ko'rindi, chiqarilgan bo'lsa — qachon.
// Faol qurilma — chiqarilmagan va tokeni hali amal qiladigan (sinceMs dan keyin kirgan). Mini App / sayt bu yerga yozilmaydi.
export function createAppDeviceQueries(db, now) {
  const q = {
    insert: db.prepare("INSERT OR IGNORE INTO app_devices (id, chat_id, token_hash, name, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)"),
    byToken: db.prepare("SELECT * FROM app_devices WHERE token_hash = ?"),
    active: db.prepare(
      "SELECT * FROM app_devices WHERE chat_id = ? AND revoked_at IS NULL AND created_at >= ? ORDER BY seen_at DESC, created_at DESC",
    ),
    touch: db.prepare("UPDATE app_devices SET seen_at = ? WHERE id = ?"),
    revoke: db.prepare("UPDATE app_devices SET revoked_at = ? WHERE chat_id = ? AND id = ? AND revoked_at IS NULL"),
    revokeAll: db.prepare("UPDATE app_devices SET revoked_at = ? WHERE chat_id = ? AND revoked_at IS NULL"),
    clean: db.prepare("DELETE FROM app_devices WHERE created_at < ?"),
  };
  const row = (r) =>
    r && { id: r.id, chatId: r.chat_id, name: r.name, createdAt: r.created_at, seenAt: r.seen_at, revokedAt: r.revoked_at ?? null };
  return {
    addAppDevice({ id, chatId, tokenHash, name = null }) {
      q.clean.run(now() - 90 * 24 * 60 * 60 * 1000);
      q.insert.run(id, chatId, tokenHash, name, now(), now());
      return row(q.byToken.get(tokenHash));
    },
    appDeviceByToken: (tokenHash) => row(q.byToken.get(tokenHash)) ?? null,
    activeAppDevices: (chatId, sinceMs) => q.active.all(chatId, sinceMs).map(row),
    touchAppDevice: (id) => q.touch.run(now(), id),
    revokeAppDevice: (chatId, id) => q.revoke.run(now(), chatId, id).changes > 0,
    revokeAppDevicesOf: (chatId) => q.revokeAll.run(now(), chatId).changes,
  };
}
