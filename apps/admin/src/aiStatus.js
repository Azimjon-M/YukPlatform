// AI ulanishlari (kalit + model) holati: "Ishlayapti", "Tayyor", "Dam olyapti", "Xato"; bugungi hisoblar; sinov natijasi.
// Ma'lumot: GET /api/ai. Har bir model holatini (state) bot yozadi: so'rovlar, xatolar, dam olish muddati.
// Oddiy funksiyalar — brauzersiz test qilinadi (test/ai.test.js).
import { REGIONS, regionLabel } from "@yuk/shared";
import { bodyTypeName, formatNumber, formatTime, truckClassName, weightText } from "./format.js";

// Dam olish sababi (bot yozadi)
export const REASON_TEXT = {
  minute: "daqiqalik limit",
  daily: "kunlik limit",
  busy: "model band",
  key: "kalit xato",
  model: "model topilmadi",
};
const BROKEN = new Set(["key", "model"]); // odam tuzatmaguncha ishlamaydi — "Xato"

// Google bepul limitni Tinch okeani vaqti bilan yarim tunda yangilaydi (Toshkentda 12:00 yoki 13:00).
// Bot "bugungi" so'rovlarni shu kun bo'yicha sanaydi: "2026-11-05"
const pacific = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
export function pacificDay(time = Date.now()) {
  const p = Object.fromEntries(pacific.formatToParts(new Date(time)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Bugungi hisoblar. Holat kechagi bo'lsa (bot bugun bu modelni hali ishlatmagan) — nol
export function todayStats(state, now = Date.now()) {
  if (!state || state.day !== pacificDay(now)) return { requests: 0, posts: 0, errors: 0 };
  return { requests: state.requests ?? 0, posts: state.posts ?? 0, errors: state.errors ?? 0 };
}

// "bugun: 123 so'rov · 1 230 e'lon · 2 xato"
export function todayText(stats) {
  const parts = [`${formatNumber(stats.requests)} so'rov`, `${formatNumber(stats.posts)} e'lon`];
  if (stats.errors) parts.push(`${formatNumber(stats.errors)} xato`);
  return `bugun: ${parts.join(" · ")}`;
}

export const isResting = (state, now = Date.now()) => (state?.cooldownUntil ?? 0) > now;

// Bitta ulanish (kalit + model) holati → { kind, label, tone, icon, detail }
// kind: off | problem | error | resting | working | ready. busy faqat bot ishlayotganda hisobga olinadi
// (bot to'xtab qolsa, bazada eski "busy: true" qolib ketishi mumkin).
export function slotStatus(key, state, { now = Date.now(), botRunning = false, timeZone } = {}) {
  if (!key.enabled) return { kind: "off", label: "O'chirilgan", tone: "neutral", icon: "■", detail: null };
  if (key.problem) return { kind: "problem", label: "Xato", tone: "critical", icon: "✖", detail: key.problem };
  if (isResting(state, now)) {
    const until = formatTime(state.cooldownUntil, { timeZone });
    const reason = REASON_TEXT[state.reason] ?? "limit";
    if (BROKEN.has(state.reason)) {
      return { kind: "error", label: "Xato", tone: "critical", icon: "✖", detail: `${reason} · ${until} da qayta uriniladi` };
    }
    return { kind: "resting", label: "Dam olyapti", tone: "warning", icon: "◷", detail: `${until} gacha · ${reason}` };
  }
  if (botRunning && state?.busy) return { kind: "working", label: "Ishlayapti", tone: "info", icon: "●", detail: null };
  return { kind: "ready", label: "Tayyor", tone: "good", icon: "✓", detail: state ? null : "hali ishlatilmagan" };
}

// Sahifa tepasidagi yig'indi. Bugungi so'rovlar o'chirilgan kalitlarnikini ham qo'shadi (ular bugun ishlagan).
export function aiTotals(keys = [], options = {}) {
  const now = options.now ?? Date.now();
  const out = { connections: 0, active: 0, working: 0, resting: 0, failing: 0, soonest: null, requests: 0, posts: 0, errors: 0 };
  for (const key of keys) {
    for (const { state } of key.models ?? []) {
      const today = todayStats(state, now);
      out.requests += today.requests;
      out.posts += today.posts;
      out.errors += today.errors;
      if (!key.enabled) continue;
      out.connections++;
      const { kind } = slotStatus(key, state, { ...options, now });
      if (kind === "ready" || kind === "working") out.active++;
      if (kind === "working") out.working++;
      if (kind === "resting") {
        out.resting++;
        out.soonest = Math.min(out.soonest ?? Infinity, state.cooldownUntil);
      }
      if (kind === "error" || kind === "problem") out.failing++;
    }
  }
  return out;
}

// Bosh sahifadagi qisqa yozuv: "3 ta faol · 1 tasi dam olyapti"
export function aiSummaryText(totals) {
  if (!totals.connections) return "ulanish yo'q — AI sahifasida kalit qo'shing";
  const parts = [`${formatNumber(totals.active)} / ${formatNumber(totals.connections)} faol`];
  if (totals.resting) parts.push(`${formatNumber(totals.resting)} tasi dam olyapti`);
  if (totals.failing) parts.push(`${formatNumber(totals.failing)} tasi xato`);
  return parts.join(" · ");
}

export const providerOptionLabel = (p) => `${p.title} — ${p.free ? "bepul" : "pullik"}`;

// Kalitga hali qo'shilmagan modellar (ro'yxat tartibi saqlanadi — eng foydalisi birinchi)
export const newModels = (available = [], existing = []) => available.filter((m) => !existing.includes(m));

// 1234 ms → "1,2 s"
export const secondsText = (ms) => `${formatNumber((ms ?? 0) / 1000, 1)} s`;

const place = (value) => (REGIONS.some((r) => r.id === value) ? regionLabel(value) : (value ?? "?"));

// Sinov javobidagi yuk: "Toshkent → Samarqand, 20 t un · fura, tent"
export function testLoadText(load) {
  const what = [weightText(load.weightT), load.cargo].filter(Boolean).join(" ");
  const vehicle = [truckClassName(load.truckClass), bodyTypeName(load.bodyType)].filter(Boolean).join(", ").toLowerCase();
  return `${place(load.from)} → ${place(load.to)}${what ? `, ${what}` : ""}${vehicle ? ` · ${vehicle}` : ""}`;
}

// POST /api/ai/keys/:id/test javobi → { ok, title, text }
export function testResultText(result) {
  if (!result?.ok) return { ok: false, title: "✖ Ishlamadi", text: result?.error || "Noma'lum xato" };
  const loads = result.loads ?? [];
  return {
    ok: true,
    title: `✓ ${secondsText(result.ms)}`,
    text: loads.length ? loads.map(testLoadText).join("; ") : "Javob keldi, lekin yuk ajratilmadi — boshqa modelni sinab ko'ring",
  };
}
