// Xatolar jurnali (boshqaruv markazining «Xatolar» bo'limi uchun): bot, collector, nginx, tunnel va API serverning
// o'zida chiqqan xato va ogohlantirishlar bir joyda.
//
// Qayerdan keladi:
//   1) Jarayonlar loglari (processes.js onLine): stderr qatorlari (dastur yiqilganda stack trace), «kutilmaganda
//      to'xtadi» kabi tizim qatorlari va oddiy loglardagi xato matnlari («… yuborilmadi», «javob bermadi», «⚠ …»).
//      Bot va collector xatoni alohida oqimga emas, oddiy log'ga yozadi — shuning uchun matniga qarab ajratamiz (classifyLine).
//   2) API'ning o'zi: 500 xatolar (app.js xato ushlagichi), sekin javoblar va brauzer kutmay uzgan so'rovlar.
//
// Bir xil xato ko'p marta chiqadi (masalan, AI modeli band — har daqiqada): raqamlarni olib tashlagan «shakli» bir xil
// bo'lsa, bitta yozuv bo'ladi — count (necha marta), first / last (birinchi / oxirgi marta). Xotirada saqlanadi:
// server (npm start) qayta yoqilsa — jurnal bo'shaydi. Bot / collector qayta yoqilishi jurnalga ta'sir qilmaydi.
//
// Bitta xatoni olib tashlash (Azimjon, 2026-11-10: «bosganimda o'sha xato yo'qolib qolsin»):
//   remove(id) — «O'chirish»: shu yozuv o'chadi; xato yana chiqsa — yangi yozuv bo'lib qaytadi.
//   ignore(id) — «E'tiborsiz qoldirish»: shu shakldagi xato (kalit — manba + daraja + raqamsiz matn) endi jurnalga
//   yozilmaydi, faqat necha marta chiqqani sanaladi (hits). Qoidalar onIgnoredChange bilan bazaga yoziladi (server.js) —
//   server qayta yoqilsa ham qoladi. unignore(key) — «Qaytarish».

const MAX_GROUPS = 300;
const MAX_IGNORED = 200;
const MAX_TEXT = 600;
const MAX_DETAILS = 6000;
const BURST_MS = 1000; // stderr'dagi ketma-ket qatorlar (stack trace) — bitta xato

// Log boshidagi vaqt: «[13:56:12] Bot ishga tushdi» → «Bot ishga tushdi» (vaqt yozuvning o'zida bor)
const stripTime = (text) => String(text).replace(/^\[\d{1,2}:\d{2}(:\d{2})?\]\s*/, "");

// Raqamlar, havolalar, @guruhlar — boshqacha bo'lsa ham o'sha xato
export function shapeOf(text) {
  return String(text)
    .replace(/https?:\/\/\S+/g, "URL")
    .replace(/\d+([.,]\d+)?/g, "#")
    .slice(0, 300);
}

// Xato emas, garchi so'zi o'xshasa ham: eskirgan e'lonlar AI'ga yuborilmaydi (bu qoida), «0 ta xato» — hisobot
const NOT_PROBLEM = /AI'ga yuborilmadi|\b0 ta xato|xatosiz/i;
const SYSTEM_ERROR = /kutilmaganda to'xtadi|yoqilmadi|qayta ishga tushmadi|majburan to'xtatildi|martadan ko'p to'xtadi|^xato:/i;
const SYSTEM_WARNING = /eskirgan|terminalda ishlayotgan nusxa/i;
const TIMEOUT = /javob bermadi|javob kelmadi|timed? ?out|ETIMEDOUT|osilib|\b524\b|kutib qoldi/i;
const NETWORK = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network|ulanib bo'lmadi|aloqa uzildi|uzilib qoldi/i;
const ERROR_WORDS =
  /xato|xatosi|yuborilmadi|yozilmadi|bo'lmadi|yoqilmadi|yangilanmadi|qabul qilinmadi|javob bermadi|javob kelmadi|javob yaroqsiz|ishlamayapti|osilib|uzildi|\[error\]|\[crit\]|\[alert\]|\[emerg\]|\bERR\b|\berror\b|failed|exception|ECONN|ETIMEDOUT/i;
const WARNING_WORDS = /^⚠|\[warn\]|\bWRN\b|band \(\d{3}\)|limit/i;
// AI ulanishi xatosi: «AI [kalit · model]: Model hozir band (503) …» — bot e'lonlarni boshqa AI'ga o'zi o'tkazadi,
// shuning uchun bu ogohlantirish; hamma AI to'xtagan bo'lsa («AI vaqtincha ishlamayapti») — xato
const AI_LINE = /^⚠?\s*AI ?(\[[^\]]*\])?( guruh xatosi)?:/;

function kindOf(text) {
  if (TIMEOUT.test(text)) return "timeout";
  if (NETWORK.test(text)) return "network";
  if (AI_LINE.test(text) || /^AI\b/.test(text)) return "ai";
  return "error";
}

// Bitta log qatori → { level: "error" | "warning", kind, text } yoki null (oddiy qator).
// line — processes.js qatori: { stream: "out" | "err" | "system", text }
export function classifyLine(line) {
  const text = stripTime(line.text).trim();
  if (!text || NOT_PROBLEM.test(text)) return null;
  if (line.stream === "err") return { level: "error", kind: TIMEOUT.test(text) ? "timeout" : "crash", text };
  if (line.stream === "system") {
    if (SYSTEM_ERROR.test(text)) return { level: "error", kind: "crash", text };
    if (SYSTEM_WARNING.test(text)) return { level: "warning", kind: "process", text };
    return null;
  }
  if (/AI vaqtincha ishlamayapti/i.test(text)) return { level: "error", kind: "ai", text };
  // «AI [..]: 10 ta e'lon bitta so'rovda» — oddiy ish; faqat xato / band / limit / javob bermadi bo'lsa
  if (AI_LINE.test(text)) {
    const bad = ERROR_WORDS.test(text) || WARNING_WORDS.test(text) || TIMEOUT.test(text) || /muammoli/i.test(text);
    return bad ? { level: "warning", kind: kindOf(text), text } : null;
  }
  if (WARNING_WORDS.test(text) && !/\[error\]|\bERR\b/.test(text)) return { level: "warning", kind: kindOf(text), text };
  if (ERROR_WORDS.test(text)) return { level: "error", kind: kindOf(text), text };
  return null;
}

// Bir xil xatolar shu kalit bilan bitta yozuv bo'ladi (e'tiborsiz qoldirish ham shu kalit bo'yicha)
export const errorKey = ({ source, level = "error", text }) => `${source}|${level}|${shapeOf(String(text ?? "").slice(0, MAX_TEXT))}`;

// Bazadan o'qilgan qoidalarni tekshirish (buzilgan yoki eski yozuv — tashlanadi)
const validRule = (rule) => rule && typeof rule.key === "string" && rule.key.length > 0;

// now — testda vaqtni boshqarish uchun; ignored — saqlangan «e'tiborsiz» qoidalari ([{ key, source, level, kind, text, at }]);
// onIgnoredChange(qoidalar) — ular o'zgarganda (bazaga yozish uchun)
export function createErrorLog({ now = () => Date.now(), maxGroups = MAX_GROUPS, ignored = [], onIgnoredChange = () => {} } = {}) {
  const groups = new Map(); // kalit → yozuv
  const bursts = new Map(); // jarayon → { entry, at } — stderr'dagi davomi shu yozuvga qo'shiladi (entry null — e'tiborsiz xato)
  // kalit → qoida. hits / lastHit — e'tiborsiz qoldirilgandan (yoki server yoqilgandan) beri necha marta chiqdi: xotirada
  const rules = new Map((Array.isArray(ignored) ? ignored : []).filter(validRule).map((r) => [r.key, { ...r, hits: 0, lastHit: null }]));
  let seq = 0; // har o'zgarishda +1 (jonli yangilanish belgisi)
  let nextId = 1;

  const findById = (id) => [...groups.entries()].find(([, e]) => e.id === Number(id)) ?? null;
  // Bazaga — faqat qoidaning o'zi (hits har xatoda o'zgaradi, uni yozib o'tirmaymiz)
  const saveRules = () => onIgnoredChange([...rules.values()].map(({ key, source, level, kind, text, at }) => ({ key, source, level, kind, text, at })));
  // stderr davomi o'chgan / e'tiborsiz yozuvga qo'shilmasin
  const dropBursts = (entry) => {
    for (const burst of bursts.values()) if (burst.entry === entry) burst.entry = null;
  };

  // { source, level, kind, text, details? } → yozuv; e'tiborsiz qoldirilgan xato bo'lsa — null (faqat sanaladi)
  function add({ source, level = "error", kind = "error", text, details = null, at = now() }) {
    const clean = String(text ?? "").slice(0, MAX_TEXT);
    const key = errorKey({ source, level, text: clean });
    const rule = rules.get(key);
    if (rule) {
      // seq oshirilmaydi: tez-tez takrorlanadigan e'tiborsiz xato sahifani har soniyada yangilatmasin
      rule.hits++;
      rule.lastHit = at;
      return null;
    }
    let entry = groups.get(key);
    if (entry) {
      entry.count++;
      entry.last = at;
      entry.text = clean; // oxirgi marta qanday chiqqani (raqamlari bilan)
      if (details) entry.details = String(details).slice(0, MAX_DETAILS);
      groups.delete(key); // Map tartibi: oxirgi qo'shilgan — oxirida
    } else {
      entry = { id: nextId++, key, source, level, kind, text: clean, details: details ? String(details).slice(0, MAX_DETAILS) : null, first: at, last: at, count: 1 };
    }
    groups.set(key, entry);
    // Eng eski (eng uzoq takrorlanmagan) yozuvlar tushib qoladi
    while (groups.size > maxGroups) groups.delete(groups.keys().next().value);
    seq++;
    return entry;
  }

  // processes.js onLine dan: (jarayon nomi, qator)
  function fromProcessLine(name, line) {
    const at = line.time ?? now();
    const burst = bursts.get(name);
    // Stack trace: stderr'ga ketma-ket kelgan qatorlar bitta xatoning davomi
    if (line.stream === "err" && burst && at - burst.at <= BURST_MS) {
      const entry = burst.entry;
      burst.at = at;
      if (!entry) return null; // e'tiborsiz (yoki o'chirilgan) xatoning davomi — alohida xato bo'lib chiqmasin
      const text = stripTime(line.text);
      entry.details = `${entry.details ?? ""}${entry.details ? "\n" : ""}${text}`.slice(0, MAX_DETAILS);
      // «file:///…:12» dan ko'ra «TypeError: …» qatori xabar sifatida tushunarliroq
      if (/^\w*Error\b|^\w+Exception\b/.test(text.trim()) && !/^\w*Error\b/.test(entry.text)) entry.text = text.trim().slice(0, MAX_TEXT);
      seq++;
      return entry;
    }
    const found = classifyLine(line);
    if (!found) return null;
    const entry = add({ source: name, ...found, at });
    if (line.stream === "err") bursts.set(name, { entry, at }); // entry null — e'tiborsiz: davomi ham yutiladi
    else bursts.delete(name);
    return entry;
  }

  // «O'chirish»: shu yozuv. → true (o'chdi) / false (allaqachon yo'q)
  function remove(id) {
    const found = findById(id);
    if (!found) return false;
    groups.delete(found[0]);
    dropBursts(found[1]);
    seq++;
    return true;
  }

  // «E'tiborsiz qoldirish»: yozuv o'chadi va shu xato endi ko'rsatilmaydi. → qoida yoki null (yozuv topilmadi)
  function ignore(id) {
    const found = findById(id);
    if (!found) return null;
    const [key, entry] = found;
    const rule = { key, source: entry.source, level: entry.level, kind: entry.kind, text: entry.text, at: now(), hits: 0, lastHit: null };
    rules.delete(key);
    rules.set(key, rule);
    // Eng eski qoidalar tushib qoladi (cheksiz o'smasin)
    while (rules.size > MAX_IGNORED) rules.delete(rules.keys().next().value);
    groups.delete(key);
    dropBursts(entry);
    seq++;
    saveRules();
    return { ...rule };
  }

  // «Qaytarish»: shu xato yana chiqsa — jurnalga yoziladi. → true / false (bunday qoida yo'q)
  function unignore(key) {
    if (!rules.delete(key)) return false;
    seq++;
    saveRules();
    return true;
  }

  return {
    add,
    fromProcessLine,
    remove,
    ignore,
    unignore,
    // Eng yangisi birinchi
    list() {
      return [...groups.values()].reverse().map((e) => ({ ...e }));
    },
    // E'tiborsiz qoldirilganlar, oxirgisi birinchi
    ignoredList() {
      return [...rules.values()].reverse().map((r) => ({ ...r }));
    },
    // «Tozalash» — jurnal bo'shaydi, «e'tiborsiz» qoidalari qoladi
    clear() {
      groups.clear();
      bursts.clear();
      seq++;
    },
    seq: () => seq,
    // Yon panel uchun: xatolarning oxirgi vaqtlari (brauzer «oxirgi ko'rganimdan keyin nechta» deb sanaydi)
    summary() {
      const errors = [];
      const warnings = [];
      for (const e of groups.values()) (e.level === "error" ? errors : warnings).push(e.last);
      return { errors, warnings };
    },
  };
}
