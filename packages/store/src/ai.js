// AI kalitlari (boshqaruv markazining «AI» bo'limidan qo'shiladi) va har bir ulanish holati.
// Ulanish = kalit + model. Gemini'da limit har bir model uchun alohida, shuning uchun bitta kalitga
// bir nechta model qo'shilsa, bot ularni parallel ishlatadi.
// Kalitlar bazada shifrlangan (secrets.js); ekranga va API javobiga faqat "…a1B2" chiqadi.
import { decryptText, encryptText, keyHint } from "./secrets.js";

// .env dagi kalit nomlari: kalit bazada emas, .env da turgan qatorlar uchun (key_enc = NULL)
export const ENV_KEYS = { gemini: "GEMINI_API_KEY", claude: "ANTHROPIC_API_KEY" };

export function createAiQueries(db, now) {
  const rows = () => db.prepare("SELECT * FROM ai_keys ORDER BY id").all();
  const slotStates = () => Object.fromEntries(db.prepare("SELECT id, data FROM ai_slots").all().map((r) => [r.id, JSON.parse(r.data)]));

  // Kalitning o'zi: shifrdan yoki .env dan. access = { secret, env } → { apiKey } yoki { problem: "sabab" }
  function readKey(row, { secret, env } = {}) {
    if (row.key_enc == null) {
      const value = env?.[ENV_KEYS[row.provider]];
      return value ? { apiKey: value } : { problem: `.env da ${ENV_KEYS[row.provider] ?? "kalit"} yozilmagan` };
    }
    if (!secret) return { problem: "shifr kaliti berilmagan" };
    try {
      return { apiKey: decryptText(row.key_enc, secret) };
    } catch {
      return { problem: "Kalit o'qilmadi (data/secret.key o'zgargan bo'lishi mumkin) — kalitni qayta qo'shing" };
    }
  }

  // Ekran uchun: kalitning o'zisiz
  function keyRow(row, states, access) {
    const read = access ? readKey(row, access) : {};
    const fromEnv = row.key_enc == null;
    return {
      id: row.id,
      provider: row.provider,
      label: row.label,
      fromEnv,
      // .env dagi kalit o'zgargan bo'lishi mumkin — ko'rsatkichini har safar yangidan olamiz
      keyHint: fromEnv && read.apiKey ? keyHint(read.apiKey) : row.key_hint,
      enabled: row.enabled === 1,
      problem: read.problem ?? null,
      createdAt: row.created_at,
      models: JSON.parse(row.models).map((model) => ({ model, state: states[`${row.id}:${model}`] ?? null })),
    };
  }

  return {
    // Hamma kalit va har bir modelning holati. access berilsa — kalit o'qiladimi ham tekshiriladi (problem)
    listAiKeys(access = null) {
      const states = slotStates();
      return rows().map((row) => keyRow(row, states, access));
    },

    // Bitta kalit, o'zi bilan (apiKey) — API'da modellar ro'yxati va sinov uchun. Javobga qo'shilmaydi!
    getAiKey(id, access) {
      const row = db.prepare("SELECT * FROM ai_keys WHERE id = ?").get(id);
      if (!row) return null;
      return { ...keyRow(row, slotStates(), null), ...readKey(row, access) };
    },

    // Shu kalit allaqachon qo'shilganmi (shifrlanganlarini ochib solishtiradi) → id yoki null
    findAiKey(provider, apiKey, access) {
      const wanted = String(apiKey).trim();
      for (const row of rows()) {
        if (row.provider === provider && readKey(row, access).apiKey === wanted) return row.id;
      }
      return null;
    },

    addAiKey({ provider, label = null, apiKey, models }, secret) {
      const key = String(apiKey).trim();
      const result = db
        .prepare("INSERT INTO ai_keys (provider, label, key_enc, key_hint, models, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
        .run(provider, label, encryptText(key, secret), keyHint(key), JSON.stringify(models), now());
      return Number(result.lastInsertRowid);
    },

    // Faqat berilgan maydonlar o'zgaradi. → true (bor edi) / false (topilmadi)
    updateAiKey(id, { label, enabled, models } = {}) {
      const fields = {
        label,
        enabled: enabled === undefined ? undefined : enabled ? 1 : 0,
        models: models === undefined ? undefined : JSON.stringify(models),
      };
      const set = Object.entries(fields).filter(([, value]) => value !== undefined);
      if (!set.length) return Boolean(db.prepare("SELECT 1 FROM ai_keys WHERE id = ?").get(id));
      const sql = `UPDATE ai_keys SET ${set.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`;
      return db.prepare(sql).run(...set.map(([, value]) => value), id).changes > 0;
    },

    removeAiKey(id) {
      const removed = db.prepare("DELETE FROM ai_keys WHERE id = ?").run(id).changes > 0;
      if (removed) db.prepare("DELETE FROM ai_slots WHERE id LIKE ?").run(`${id}:%`);
      return removed;
    },

    // .env dagi kalitni ro'yxatga BIR MARTA qo'shadi: keyin o'chirib tashlansa, qayta qo'shilmaydi.
    // entries: [{ provider, models }] — qaysi provayder va model (bot .env dagi PARSER_PROVIDER/PARSER_MODEL dan beradi)
    seedAiKeys(entries, env) {
      if (db.prepare("SELECT 1 FROM settings WHERE key = 'ai_keys_seeded'").get()) return 0;
      const markSeeded = () => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_keys_seeded', ?)").run(String(now()));
      if (rows().length) {
        markSeeded();
        return 0;
      }
      let added = 0;
      for (const { provider, models } of entries) {
        const value = env?.[ENV_KEYS[provider]];
        if (!value) continue;
        db.prepare("INSERT INTO ai_keys (provider, label, key_enc, key_hint, models, enabled, created_at) VALUES (?, ?, NULL, ?, ?, 1, ?)")
          .run(provider, ".env kaliti", keyHint(value), JSON.stringify(models), now());
        added++;
      }
      // .env da kalit hali yo'q bo'lsa — belgilamaymiz: yozilgach keyingi ishga tushishda qo'shiladi
      if (added) markSeeded();
      return added;
    },

    // Bot uchun: yoqilgan kalitlar × modellar = ulanishlar (kalit bilan). Kaliti o'qilmaganlari tashlanadi.
    aiConnections(access) {
      const states = slotStates();
      const out = [];
      for (const row of rows()) {
        if (row.enabled !== 1) continue;
        const { apiKey } = readKey(row, access);
        if (!apiKey) continue;
        const name = row.label || row.provider;
        for (const model of JSON.parse(row.models)) {
          const id = `${row.id}:${model}`;
          out.push({ id, keyId: row.id, label: `${name} · ${model}`, provider: row.provider, model, apiKey, state: states[id] ?? null });
        }
      }
      return out;
    },

    // Bot har bir so'rov va xatodan keyin yozadi; boshqaruv markazi o'qiydi
    saveAiSlot(state) {
      db.prepare(
        `INSERT INTO ai_slots (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      ).run(state.id, JSON.stringify(state), now());
    },
  };
}
