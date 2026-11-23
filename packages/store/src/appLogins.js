// Mobil / kompyuter ilovasi uchun «Telegram orqali kirish» (2026-11-23, Azimjon: «ilova yasayabman unga eshik ochishimiz kerak»).
// Ilovada Mini App initData ham, saytdagi Login Widget ham yo'q — shuning uchun kirish bot orqali tasdiqlanadi:
//   1) ilova  POST /pub/auth/app        → server tasodifiy kod yaratadi (shu jadvalga yoziladi)
//   2) ilova  t.me/<bot>?start=app_<kod> ni ochadi, odam botda «✅ Ha, kiraman» ni bosadi → bot chat_id ni yozadi
//   3) ilova  GET /pub/auth/app/<kod>    ni so'rab turadi → tasdiqlangan bo'lsa BIR MARTA token beriladi (used_at)
// Bot (apps/bot) va server (apps/api) alohida jarayon — kod faqat shu jadval orqali o'tadi.
export const APP_LOGIN_TTL_MS = 10 * 60 * 1000; // kod 10 daqiqa yaroqli
export const APP_LOGIN_CODE = /^[A-Za-z0-9_-]{20,48}$/;

export function createAppLoginQueries(db, now) {
  const q = {
    insert: db.prepare("INSERT INTO app_logins (code, created_at) VALUES (?, ?)"),
    clean: db.prepare("DELETE FROM app_logins WHERE created_at < ?"),
    get: db.prepare("SELECT * FROM app_logins WHERE code = ?"),
    // Faqat yaroqli, hali hech kim tasdiqlamagan kod (birinchi tasdiqlagan — egasi)
    confirm: db.prepare(
      `UPDATE app_logins SET chat_id = ?, confirmed_at = ?
       WHERE code = ? AND chat_id IS NULL AND created_at >= ? RETURNING code`,
    ),
    // Token bir marta beriladi: ikki so'rov bir vaqtda kelsa ham faqat bittasi oladi
    consume: db.prepare(
      `UPDATE app_logins SET used_at = ?
       WHERE code = ? AND chat_id IS NOT NULL AND used_at IS NULL AND created_at >= ? RETURNING chat_id`,
    ),
  };
  const fresh = () => now() - APP_LOGIN_TTL_MS;

  return {
    createAppLogin(code) {
      if (!APP_LOGIN_CODE.test(code)) throw new Error("Kod noto'g'ri");
      q.clean.run(now() - 24 * 60 * 60 * 1000); // bir kundan eskilari kerak emas
      q.insert.run(code, now());
      return { code, expiresAt: now() + APP_LOGIN_TTL_MS };
    },
    // → pending | confirmed | used | expired | missing
    appLoginState(code) {
      const row = APP_LOGIN_CODE.test(String(code)) ? q.get.get(code) : null;
      if (!row) return "missing";
      if (row.used_at != null) return "used";
      if (row.created_at < fresh()) return "expired";
      return row.chat_id == null ? "pending" : "confirmed";
    },
    // Bot: odam «✅ Ha, kiraman» ni bosdi → true (kod yaroqli edi va endi shu odamniki)
    confirmAppLogin(code, chatId) {
      if (!APP_LOGIN_CODE.test(String(code))) return false;
      return Boolean(q.confirm.get(chatId, now(), code, fresh()));
    },
    // Server: tasdiqlangan kod → chat_id (bir marta), aks holda null
    consumeAppLogin(code) {
      if (!APP_LOGIN_CODE.test(String(code))) return null;
      return q.consume.get(now(), code, fresh())?.chat_id ?? null;
    },
  };
}
