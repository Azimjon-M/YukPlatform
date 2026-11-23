// fastLook + embedding aralashmasi hukmlari (2026-11-23, apps/bot embedLook.js). Faqat fastLook ikkilangan e'lonlar
// (ball embed_config.lo–hi oralig'ida) yoziladi: embedding nima dedi, aralashma nima dedi, qaror ishlatildimi, qancha kutildi.
//   fast / mixed — 1 = yuk e'loni, 0 = e'lon emas; used — 1: aralash qaror haqiqatda ishlatildi (live, vaqtida keldi)
//   mode — shadow | live (yozilgan paytdagi rejim)
export function createEmbedVerdictQueries(db, now) {
  const q = {
    put: db.prepare(
      `INSERT INTO embed_verdicts (post_id, p, fast_score, fast, mixed, used, ms, mode, signature, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(post_id) DO NOTHING`,
    ),
    summary: db.prepare(
      `SELECT mode, fast, mixed, used, COUNT(*) AS n, AVG(ms) AS ms, MAX(ms) AS maxMs FROM embed_verdicts WHERE at > ?
       GROUP BY mode, fast, mixed, used ORDER BY n DESC`,
    ),
  };
  const bit = (v) => (v ? 1 : 0);
  return {
    addEmbedVerdict({ postId, p, fastScore, fast, mixed, used, ms, mode, signature }) {
      q.put.run(postId, Math.round(p * 1e5) / 1e5, fastScore ?? null, bit(fast), bit(mixed), bit(used), ms ?? null, mode, signature, now());
    },
    // Oxirgi `hours` soat: rejim × fastLook × aralashma × ishlatilgan — soni va kechikish (ms)
    embedVerdictSummary(hours = 24) {
      return q.summary.all(now() - hours * 3600e3).map((r) => ({ ...r, ms: Math.round(r.ms ?? 0) }));
    },
  };
}
