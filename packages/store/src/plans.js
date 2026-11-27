// Obuna muddati va to'lovlar (2026-11-27, Azimjon: «obunani tanlab pulni Click qilib chek tashlasa — tekshirib, yoki tekshira
// olmasa mendan so'rab, akkauntiga obunani beradigan qilish kerak … mendan tasdiqni kutmay obunani berib, meni ogohlantirsa,
// men tasdiqlasam obuna bekor bo'lmasligi»).
//
// drivers.plan_until — obuna qachongacha (ms; NULL — muddatsiz: boshqaruv markazidan qo'lda berilgan). Muddati o'tgan obuna
// o'qilganda Free deb ko'rinadi (index.js driverRow / admin.js listDrivers — effectivePlan).
//
// payments — foydalanuvchi yuborgan to'lov cheki (yordamchi akkaunt «Sarvar» qabul qiladi, apps/collector opsResponder.js):
//   held      — chek ishonchli ko'rindi: obuna DARHOL yoqildi, lekin egasi hold_until gacha tasdiqlashi kerak;
//   asked     — chekni tekshirib bo'lmadi (yoki bu odam avval rad etilgan): obuna berilmadi, egasidan so'raldi;
//   confirmed — egasi tasdiqladi (asked bo'lsa — obuna shu paytda yoqiladi; held bo'lsa — o'zgarishsiz qoladi);
//   rejected  — egasi rad etdi (held bo'lsa — avvalgi obunasi qaytariladi);
//   lapsed    — held, lekin egasi muddatida tasdiqlamadi — avvalgi obunasi qaytarildi (egasi keyin ham tasdiqlashi mumkin).
// notified — oxirgi aytilgan holat (yordamchi foydalanuvchiga va egasiga yozadi; ikki marta yozmaslik uchun).
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SETTINGS_KEY = "plan_settings";
export const PAID_PLANS = ["pro", "max"];
export const PAYMENT_OPEN = ["held", "asked"];

// Narx va to'lov sozlamalari (boshqaruv markazi «Haydovchilar» → «💳 Obuna va to'lov»). prices 0 — hali belgilanmagan
export const DEFAULT_PLAN_SETTINGS = { prices: { pro: 0, max: 0 }, days: 30, payInfo: "", holdHours: 48 };

export function cleanPlanSettings(input = {}) {
  const num = (value, fallback, min, max) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    prices: { pro: num(input.prices?.pro, 0, 0, 1e9), max: num(input.prices?.max, 0, 0, 1e9) },
    days: num(input.days, DEFAULT_PLAN_SETTINGS.days, 1, 366),
    payInfo: String(input.payInfo ?? "").trim().slice(0, 500),
    holdHours: num(input.holdHours, DEFAULT_PLAN_SETTINGS.holdHours, 1, 24 * 14),
  };
}

// Muddati o'tgan pulli obuna — Free
export const effectivePlan = (row, time) => (row.plan && row.plan !== "free" && row.plan_until != null && row.plan_until <= time ? "free" : (row.plan ?? "free"));

export function migratePlans(db) {
  const columns = db.prepare("PRAGMA table_info(drivers)").all().map((c) => c.name);
  if (!columns.includes("plan_until")) db.exec("ALTER TABLE drivers ADD COLUMN plan_until INTEGER");
  db.exec(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    plan TEXT NOT NULL,
    days INTEGER NOT NULL,
    amount INTEGER,                    -- chekdagi summa (so'm), o'qib bo'lmasa NULL
    price INTEGER,                     -- o'sha paytdagi narx
    status TEXT NOT NULL,              -- held | asked | confirmed | rejected | lapsed
    receipt TEXT,                      -- chek fayli (apps/collector/receipts/…)
    note TEXT,                         -- yordamchining izohi (chekda nimani ko'rdi)
    reason TEXT,                       -- egasining sababi (rad etganda)
    prev_plan TEXT, prev_until INTEGER,-- held: rad etilsa yoki muddat o'tsa shu qaytariladi
    hold_until INTEGER,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    notified TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS payments_chat ON payments (chat_id, created_at)");
}

const paymentRow = (row) =>
  row && {
    id: row.id,
    chatId: row.chat_id,
    plan: row.plan,
    days: row.days,
    amount: row.amount ?? null,
    price: row.price ?? null,
    status: row.status,
    receipt: row.receipt ?? null,
    note: row.note ?? null,
    reason: row.reason ?? null,
    holdUntil: row.hold_until ?? null,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
    notified: row.notified ?? null,
    name: row.name ?? null, // listPayments: foydalanuvchi ismi / username
    username: row.username ?? null,
  };

export function createPlanQueries(db, now) {
  const get = (id) => paymentRow(db.prepare("SELECT p.*, d.name, d.username FROM payments p LEFT JOIN drivers d ON d.chat_id = p.chat_id WHERE p.id = ?").get(id));
  const setPlan = (chatId, plan, until) => db.prepare("UPDATE drivers SET plan = ?, plan_until = ?, updated_at = ? WHERE chat_id = ?").run(plan, until, now(), chatId);
  const settings = () => {
    try {
      return cleanPlanSettings(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY)?.value ?? "{}"));
    } catch {
      return cleanPlanSettings();
    }
  };

  return {
    planSettings: settings,
    setPlanSettings(input) {
      const value = cleanPlanSettings({ ...settings(), ...input, prices: { ...settings().prices, ...(input?.prices ?? {}) } });
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(SETTINGS_KEY, JSON.stringify(value));
      return value;
    },

    getPayment: get,
    // status: "open" (held + asked) | aniq holat | berilmasa — hammasi; eng yangisi birinchi
    listPayments({ status = null, chatId = null, limit = 50 } = {}) {
      const where = [];
      const params = [];
      if (status === "open") where.push("p.status IN ('held', 'asked')");
      else if (status) (where.push("p.status = ?"), params.push(status));
      if (chatId != null) (where.push("p.chat_id = ?"), params.push(chatId));
      return db
        .prepare(`SELECT p.*, d.name, d.username FROM payments p LEFT JOIN drivers d ON d.chat_id = p.chat_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.id DESC LIMIT ?`)
        .all(...params, limit)
        .map(paymentRow);
    },

    // Chek keldi. sure — yordamchi chekni ishonchli deb topdi (summa yetarli, yangi, to'g'ri qabul qiluvchi).
    // → { ok: true, payment } yoki { ok: false, error: "no_user" | "plan" | "open" (ochiq so'rovi bor; payment — o'shasi) }.
    // Darhol yoqish (held) faqat: sure, narx belgilangan va summa ≥ narx, bu odamning oxirgi 30 kunda rad etilgan / muddati
    // o'tgan cheki yo'q. Aks holda — asked (egasi hal qiladi). Obuna muddati: hozirgisi shu obuna va hali tugamagan bo'lsa —
    // uning ustiga qo'shiladi (uzaytirish)
    claimPayment({ chatId, plan, amount = null, receipt = null, note = null, sure = false }) {
      if (!PAID_PLANS.includes(plan)) return { ok: false, error: "plan" };
      const user = db.prepare("SELECT chat_id, plan, plan_until FROM drivers WHERE chat_id = ?").get(chatId);
      if (!user) return { ok: false, error: "no_user" };
      const open = db.prepare("SELECT id FROM payments WHERE chat_id = ? AND status IN ('held', 'asked') ORDER BY id DESC").get(chatId);
      if (open) return { ok: false, error: "open", payment: get(open.id) };
      const time = now();
      const { prices, days, holdHours } = settings();
      const price = prices[plan] || null;
      const paid = Number.isFinite(Number(amount)) && Number(amount) > 0 ? Math.round(Number(amount)) : null;
      const bad = db.prepare("SELECT 1 FROM payments WHERE chat_id = ? AND status IN ('rejected', 'lapsed') AND created_at > ?").get(chatId, time - 30 * DAY);
      const held = Boolean(sure) && price != null && paid != null && paid >= price && !bad;
      const id = db
        .prepare(
          `INSERT INTO payments (chat_id, plan, days, amount, price, status, receipt, note, prev_plan, prev_until, hold_until, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(chatId, plan, days, paid, price, held ? "held" : "asked", receipt, note ? String(note).slice(0, 500) : null, user.plan ?? "free", user.plan_until ?? null, held ? time + holdHours * HOUR : null, time)
        .lastInsertRowid;
      if (held) setPlan(chatId, plan, this.planEnd(user, plan, days, time));
      return { ok: true, payment: get(Number(id)) };
    },

    // Yangi muddat oxiri: shu obuna hali amalda bo'lsa — ustiga qo'shiladi
    planEnd(user, plan, days, time = now()) {
      const from = user.plan === plan && user.plan_until != null && user.plan_until > time ? user.plan_until : time;
      return from + days * DAY;
    },

    // Egasining qarori. → yangilangan to'lov | null (topilmadi yoki allaqachon hal qilingan: confirmed / rejected)
    decidePayment(id, ok, reason = null) {
      const p = db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
      if (!p || ["confirmed", "rejected"].includes(p.status)) return null;
      const time = now();
      if (ok) {
        // asked / lapsed — obuna shu paytda yoqiladi; held — allaqachon yoqilgan
        if (p.status !== "held") {
          const user = db.prepare("SELECT plan, plan_until FROM drivers WHERE chat_id = ?").get(p.chat_id);
          if (user) setPlan(p.chat_id, p.plan, this.planEnd(user, p.plan, p.days, time));
        }
      } else if (p.status === "held") {
        setPlan(p.chat_id, p.prev_plan ?? "free", p.prev_until ?? null);
      }
      db.prepare("UPDATE payments SET status = ?, decided_at = ?, reason = ? WHERE id = ?").run(ok ? "confirmed" : "rejected", time, reason ? String(reason).slice(0, 500) : null, id);
      return get(id);
    },

    // Tasdiqlanmagan (held) va muddati o'tganlar: avvalgi obuna qaytariladi → [to'lov, ...]
    lapsePayments() {
      const time = now();
      const rows = db.prepare("SELECT * FROM payments WHERE status = 'held' AND hold_until IS NOT NULL AND hold_until <= ?").all(time);
      for (const p of rows) {
        setPlan(p.chat_id, p.prev_plan ?? "free", p.prev_until ?? null);
        db.prepare("UPDATE payments SET status = 'lapsed', decided_at = ? WHERE id = ?").run(time, p.id);
      }
      return rows.map((p) => get(p.id));
    },

    // Yordamchi hali aytmagan holatlar (yangi chek → egasiga; qaror / muddat o'tdi → foydalanuvchiga)
    paymentNotices() {
      return db
        .prepare("SELECT p.*, d.name, d.username FROM payments p LEFT JOIN drivers d ON d.chat_id = p.chat_id WHERE p.notified IS NULL OR p.notified <> p.status ORDER BY p.id")
        .all()
        .map(paymentRow);
    },
    markPaymentNotified(id, status) {
      return db.prepare("UPDATE payments SET notified = ? WHERE id = ?").run(status, id).changes > 0;
    },
  };
}
