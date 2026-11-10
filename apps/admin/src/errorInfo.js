// Xato → odam tushunadigan matn (xato sahifasi va «Xatolar» bo'limi uchun) va xatolar ro'yxatini guruhlash.
// Toza funksiyalar (React'siz, brauzersiz) — test/logic.test.js tekshiradi.

const seconds = (ms) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const withoutQuery = (path) => String(path ?? "").split("?")[0];

// Holat kodlari — sarlavhada
const STATUS_TITLE = {
  400: "So'rov noto'g'ri",
  403: "Ruxsat yo'q",
  404: "Topilmadi",
  409: "Bajarib bo'lmadi",
  413: "Ma'lumot juda katta",
  429: "Juda ko'p so'rov",
};

// Turlar: nomi (ro'yxatdagi belgi uchun) va belgisi
export const KINDS = {
  crash: { label: "Sahifa yiqildi", icon: "💥" },
  js: { label: "Dastur xatosi", icon: "⚠" },
  action: { label: "Amal bajarilmadi", icon: "✖" },
  timeout: { label: "Javob kelmadi (timeout)", icon: "⏱" },
  slow: { label: "Sekin javob", icon: "🐢" },
  offline: { label: "Aloqa yo'q", icon: "🔌" },
  network: { label: "Tarmoq xatosi", icon: "🔌" },
  server: { label: "Server xatosi", icon: "✖" },
  client: { label: "So'rov bajarilmadi", icon: "✖" },
  invalid: { label: "Tushunarsiz javob", icon: "❓" },
  notfound: { label: "Sahifa topilmadi", icon: "🔎" },
  ai: { label: "AI", icon: "🤖" },
  process: { label: "Jarayon", icon: "⚙" },
  error: { label: "Xato", icon: "✖" },
};
// source — server jarayonining «crash»i sahifa emas, dasturning o'zi yiqilgani (stderr / «kutilmaganda to'xtadi»)
export const kindInfo = (kind, source = "browser") =>
  kind === "crash" && source !== "browser" ? { label: "Dastur yiqildi", icon: "💥" } : (KINDS[kind] ?? KINDS.error);

// Xato qayerdan: server jarayonlari nomi, «api» — boshqaruv markazi serveri, «web» — haydovchilar serveri
export const SOURCES = {
  browser: "Boshqaruv markazi (brauzer)",
  api: "Server (API)",
  web: "Haydovchilar serveri",
  bot: "Bot",
  collector: "Collector",
  nginx: "nginx",
  tunnel: "Tunnel",
};
export const sourceLabel = (source) => SOURCES[source] ?? source;

// Xato turi: ApiError o'zi aytadi (api.js), React chizishda yiqilsa — crash, qolgani — js
export function kindOf(error, fallback = "js") {
  if (error?.kind && KINDS[error.kind]) return error.kind;
  return fallback;
}

// Xato sahifasi uchun: { kind, icon, title, text, hint, rows: [[nomi, qiymati]], stack }
// options: { kind, componentStack, page, path } — kind: "crash" | "notfound" | ...; path — topilmagan manzil
export function describeError(error, { kind: forced = null, componentStack = null, page = null, path = null } = {}) {
  const kind = forced ?? kindOf(error, "crash");
  const { icon } = kindInfo(kind);
  const rows = [];
  if (error?.method) rows.push(["So'rov", `${error.method} ${error.path ?? ""}`]);
  if (error?.status) rows.push(["Holat kodi", String(error.status)]);
  if (error?.durationMs != null) rows.push(["Kutildi", seconds(error.durationMs)]);
  if (page) rows.push(["Sahifa", page]);
  if (error?.at) rows.push(["Vaqt", new Date(error.at).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })]);
  const stack = [error?.stack && kind !== "notfound" && !error.method ? error.stack : null, componentStack ? `Komponentlar:${componentStack}` : null]
    .filter(Boolean)
    .join("\n\n");
  const message = error?.message ?? "";

  switch (kind) {
    case "timeout":
      return {
        kind,
        icon,
        title: "Server javob bermadi",
        text: `So'rov ${seconds(error?.timeoutMs ?? error?.durationMs ?? 0)} kutildi, lekin javob kelmadi. Server band yoki osilib qolgan bo'lishi mumkin.`,
        hint: "Bir ozdan keyin «Qayta urinish» ni bosing. Takrorlansa — «Xatolar» bo'limida server tomonidagi sababni ko'ring yoki npm start oynasini tekshiring.",
        rows,
        stack: "",
      };
    case "offline":
      return {
        kind,
        icon,
        title: "Server bilan aloqa yo'q",
        text: `Boshqaruv markazi serveri (${typeof window === "undefined" ? "localhost:3000" : window.location.host}) javob bermayapti — u o'chgan yoki qayta ishga tushyapti.`,
        hint: "ishga-tushirish.bat (npm start) oynasi ochiqmi? Ishga tushiring va «Qayta urinish» ni bosing.",
        rows,
        stack: "",
      };
    case "server":
      return {
        kind,
        icon,
        title: `Serverda xato${error?.status ? ` (${error.status})` : ""}`,
        text: message || "Server so'rovni bajara olmadi.",
        hint: "Xato «Xatolar» bo'limida server tomonidan ham yozildi (to'liq stack bilan).",
        rows,
        stack: "",
      };
    case "client":
      return {
        kind,
        icon,
        title: `${STATUS_TITLE[error?.status] ?? "So'rov bajarilmadi"}${error?.status ? ` (${error.status})` : ""}`,
        text: message,
        hint: "",
        rows,
        stack: "",
      };
    case "invalid":
      return { kind, icon, title: "Server tushunarsiz javob qaytardi", text: message, hint: "Sahifani yangilang: server yangilangan bo'lishi mumkin.", rows, stack: "" };
    case "notfound":
      return { kind, icon, title: "Sahifa topilmadi", text: `«${path ?? page ?? ""}» manzili bo'yicha sahifa yo'q.`, hint: "Chapdagi menyudan kerakli bo'limni tanlang.", rows: [], stack: "" };
    case "js":
      return {
        kind,
        icon,
        title: "Kutilmagan xato",
        text: errorText(error),
        hint: "Sahifani yangilang. Takrorlansa — «Nusxa olish» bilan matnni Claude'ga yuboring.",
        rows,
        stack,
      };
    default:
      return {
        kind: "crash",
        icon: KINDS.crash.icon,
        title: "Sahifada xato yuz berdi",
        text: errorText(error),
        hint: "Bu boshqaruv markazi kodidagi xato — bot, collector va server ishlashda davom etyapti. «Qayta urinish» yoki sahifani yangilang; takrorlansa — «Nusxa olish» bilan matnni Claude'ga yuboring.",
        rows,
        stack,
      };
  }
}

// «TypeError: x is not a function». Error bo'lmagan narsa tashlansa ham (throw "matn") — matni
export function errorText(error) {
  if (error instanceof Error || (error && typeof error.message === "string")) {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
    return `${name}${error.message || "(xabarsiz xato)"}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

// --- Jurnal (brauzerdagi xatolar) ---
// Yozuv: { id, source, level: "error" | "warning", kind, text, where, details, first, last, count }

// Raqamlar (id, soniya, port) boshqa bo'lsa ham — o'sha xato
export const shapeOf = (text) =>
  String(text ?? "")
    .replace(/\d+([.,]\d+)?/g, "#")
    .slice(0, 300);
export const journalKey = (e) => [e.source, e.level, e.kind, withoutQuery(e.where), shapeOf(e.text)].join("|");

// ApiError / Error → jurnal yozuvi
export function entryFromError(error, { kind = null, page = null, componentStack = null, now = Date.now() } = {}) {
  const k = kind ?? kindOf(error);
  const isApi = Boolean(error?.method);
  const details = [];
  if (isApi) {
    details.push(`So'rov: ${error.method} ${error.path}`);
    if (error.status) details.push(`Holat kodi: ${error.status}`);
    if (error.durationMs != null) details.push(`Kutildi: ${seconds(error.durationMs)}`);
  }
  if (page) details.push(`Sahifa: ${page}`);
  if (!isApi && error?.stack) details.push("", error.stack);
  if (componentStack) details.push("", `Komponentlar:${componentStack}`);
  return {
    source: "browser",
    // 4xx — server so'rovni ataylab rad etdi (masalan, «Bot terminalda ishlayapti»): ogohlantirish
    level: k === "client" ? "warning" : "error",
    kind: k,
    text: isApi ? error.message : errorText(error),
    where: isApi ? `${error.method} ${withoutQuery(error.path)}` : page,
    details: details.join("\n").trim() || null,
    first: now,
    last: now,
    count: 1,
  };
}

// Jurnalga qo'shish: o'sha xato bo'lsa — count++ va tepaga. → yangi ro'yxat (eng yangisi birinchi), max tadan oshmaydi
export function addToJournal(list, entry, max = 200) {
  const key = journalKey(entry);
  const found = list.find((e) => journalKey(e) === key);
  const merged = found
    ? { ...found, count: found.count + (entry.count ?? 1), last: entry.last, text: entry.text, details: entry.details ?? found.details }
    : { ...entry, id: entry.id ?? `b${entry.first}-${Math.random().toString(36).slice(2, 8)}` };
  return [merged, ...list.filter((e) => e !== found)].slice(0, max);
}

// --- «O'chirish» va «E'tiborsiz qoldirish» (brauzer jurnali; serverdagisi — apps/api errorLog.js, ma'nosi bir xil) ---
// state = { journal, ignored }: ignored — qoidalar [{ key, source, level, kind, text, where, at, hits, lastHit }].
// Hammasi yangi obyekt qaytaradi (errors.js localStorage'ga yozadi). Kalit — journalKey: bir xil xato = bitta qoida
const MAX_IGNORED = 200;

// Yangi xato: e'tiborsiz qoldirilgan bo'lsa — jurnalga yozilmaydi, faqat qoidada sanaladi
export function recordInto(state, entry, max) {
  const key = journalKey(entry);
  if (state.ignored.some((r) => r.key === key)) {
    const ignored = state.ignored.map((r) => (r.key === key ? { ...r, hits: (r.hits ?? 0) + (entry.count ?? 1), lastHit: entry.last } : r));
    return { journal: state.journal, ignored };
  }
  return { journal: addToJournal(state.journal, entry, max), ignored: state.ignored };
}

// «O'chirish»: faqat shu yozuv (xato yana chiqsa — qaytadi)
export const removeFrom = (state, id) => ({ ...state, journal: state.journal.filter((e) => e.id !== id) });

// «E'tiborsiz qoldirish»: yozuv o'chadi va shu xato boshqa yozilmaydi
export function ignoreIn(state, id, at = Date.now()) {
  const entry = state.journal.find((e) => e.id === id);
  if (!entry) return state;
  const key = journalKey(entry);
  const rule = { key, source: entry.source, level: entry.level, kind: entry.kind, text: entry.text, where: entry.where ?? null, at, hits: 0, lastHit: null };
  return {
    journal: state.journal.filter((e) => journalKey(e) !== key),
    ignored: [rule, ...state.ignored.filter((r) => r.key !== key)].slice(0, MAX_IGNORED),
  };
}

// «Qaytarish»
export const unignoreIn = (state, key) => ({ ...state, ignored: state.ignored.filter((r) => r.key !== key) });

// Brauzer va server yozuvlari bitta ro'yxatda, eng oxirgi chiqqani birinchi.
// serverId — server yozuvining o'z id'si (o'chirish / e'tiborsiz qoldirish so'rovi uchun); brauzernikida yo'q
export function mergeJournals(local, server) {
  return [...local, ...server.map((e) => ({ ...e, id: `s${e.id}`, serverId: e.id }))].sort((a, b) => b.last - a.last);
}

// E'tiborsiz qoldirilganlar: brauzer va server, oxirgi qoldirilgani birinchi. fromServer — «Qaytarish» serverga boradi
export function mergeIgnored(local, server) {
  return [...local.map((r) => ({ ...r, fromServer: false })), ...server.map((r) => ({ ...r, fromServer: true }))].sort((a, b) => b.at - a.at);
}

// Oxirgi ko'rgandan keyin chiqqan xatolar soni (yon paneldagi qizil son). warnings hisoblanmaydi
export function unseenCount(lasts, seenAt) {
  return lasts.filter((t) => t > seenAt).length;
}

// Nusxa olish uchun oddiy matn (Claude'ga yoki boshqaga yuborish)
export function reportText(entries) {
  const time = (t) => new Date(t).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  return entries
    .map((e) => {
      const head = `[${e.level === "error" ? "XATO" : "OGOHLANTIRISH"}] ${sourceLabel(e.source)} · ${kindInfo(e.kind, e.source).label}${e.count > 1 ? ` · ${e.count} marta` : ""}`;
      const when = e.count > 1 ? `${time(e.first)} — ${time(e.last)}` : time(e.last);
      return [head, when, e.where ? `Qayerda: ${e.where}` : null, e.text, e.details].filter(Boolean).join("\n");
    })
    .join("\n\n---\n\n");
}
