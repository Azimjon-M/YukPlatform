// Ovozli xabar va dumaloq video → matn → odatdagi navbat (2026-11-16, Azimjon: «audio va telegramni dumaloq videoni
// chek qilib u e'lon va e'lon emasligini check qilamiz. buni juda tez check qiladigan qilishimiz kerak!»; yo'l — uning
// tanlovi «Ikkalasi»):
//   1) Gemini (@yuk/parser transcribeWithGemini, fayl yuklab olinadi);
//   2) Gemini ulanishi yo'q / hammasi xato (limit) yoki bo'sh javob — akkaunt Premium bo'lsa, Telegram'ning o'zi
//      (messages.transcribeAudio: bepul, AI limiti sarflanmaydi).
// Tartib o'lchovdan (2026-11-16, bir xil 5 ta haqiqiy xabar, MEDIA_COMPARE=1): Gemini 2,3–2,9 s va o'zbekchani aniq
// yozdi («Samarqanddan Toshkentga 4–4,5 tonna yukimiz bor. Nomerimiz 94 lik …»), Telegram 7–31 s va o'zbekchada
// ko'pincha ma'nosiz («salomdagi markalari choraklari … tortlarimiz bor»), raqamlarni ham buzdi. Avval Telegram edi.
// Matn posts jadvaliga media = "voice" | "round" bilan yoziladi: keyin hammasi matnli e'londek — tezkor yo'l (asl matn),
// qoidaviy parser, AI. Ya'ni «e'lonmi yoki yo'q» ni matnli e'lon bilan bir xil qoidalar hal qiladi.
// Tezlik: navbat xabar kelishi bilan ishlaydi (so'rab olish halqasini kutmaydi), bir vaqtda `concurrency` tagacha.
import { transcribeWithGemini } from "@yuk/parser";

export const MEDIA_LIMITS = {
  maxDurationSec: 180, // undan uzuni — e'lon emas (qo'shiq, suhbat), o'girilmaydi
  maxBytes: 19 * 1024 * 1024,
  minTextLength: 10, // o'girilgan matn shundan qisqa bo'lsa («Alo», «Ha») — e'lon emas
  concurrency: 3,
  geminiTries: 3,
  seenMax: 5_000,
};

export const MEDIA_ICON = { voice: "🎤", round: "📹" };

// Bir odamning ovozli xabarlari shu oraliqda bo'lsa — bitta e'lon (yuk birida, telefon keyingisida aytiladi:
// 2026-11-16, «…Toshkandan Yangi qo'rg'onga yuk bor, 5 tonna, Isuzu…» + «Nomerimiz 93 lik … akalar.»)
export const MERGE_WINDOW_MS = 3 * 60_000;

// Ovozdagi telefon: operator kodi alohida aytiladi — «93 lik 123 45 67», «94-lik, 169-16-67» → «+998 93 123 45 67»
// (@yuk/parser extractPhones shundan keyin taniydi). Gemini'ga ham aytilgan, lekin har doim bajarmaydi
// Kirillcha ham («93 лик 123 45 67»): \b o'rniga (?!\p{L}) — JS'da \b kirill harfini so'z deb bilmaydi
const OPERATOR_PHONE = /(^|[^\d+])(\d{2})\s*-?\s*(?:lik|lig'i|ligi|li|лик|лиги|ли)(?!\p{L})[\s,.:;-]*((?:\d[\s-]?){6}\d)(?!\d)/giu;
export function normalizeSpokenPhones(text) {
  return String(text ?? "").replace(OPERATOR_PHONE, (_, before, code, rest) => {
    const d = rest.replace(/\D/g, "");
    return `${before}+998 ${code} ${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)}`;
  });
}

// Gemini ulanishlari: muammoli (📌) va pauzadagilar oxirida — avval ishlayotgani sinaladi
function geminiOrder(connections, now) {
  const rank = (c) => (c.state?.problem ? 2 : (c.state?.cooldownUntil ?? 0) > now ? 1 : 0);
  return connections.filter((c) => c.provider === "gemini").sort((a, b) => rank(a) - rank(b));
}

// reader — telegram.js createReader (isPremium, transcribe, download); connections() — store.aiConnections(access)
// transcribe — testda soxtasi (berilmasa @yuk/parser transcribeWithGemini)
export function createMediaQueue({
  reader,
  store,
  connections = () => [],
  log = console.log,
  now = Date.now,
  limits = MEDIA_LIMITS,
  transcribe = transcribeWithGemini,
  compare = false, // .env MEDIA_COMPARE=1 — Telegram o'girgan xabarni Gemini ham o'giradi, ikkalasi logga (sifatni solishtirish)
}) {
  const queue = [];
  const seen = new Set(); // "@guruh:123" — jonli va so'rab olish bir xabarni ikki marta o'girmasin
  const lastBySender = new Map(); // "@guruh:senderId" → { postId, at } — ketma-ket ovozli xabarlarni birlashtirish
  let running = 0;
  let premium = null; // null — hali so'ralmagan
  let telegramBroken = false; // Telegram o'girishi ishlamadi (masalan, Premium tugagan) — keyin to'g'ri Gemini'ga
  const stats = { telegram: 0, gemini: 0, empty: 0, skipped: 0, failed: 0, totalMs: 0 };

  async function viaTelegram(job) {
    if (telegramBroken || !reader.transcribe) return null;
    if (premium == null) premium = await reader.isPremium?.().catch(() => false);
    if (!premium) return null;
    try {
      return await reader.transcribe(job.source, job.message.id);
    } catch (error) {
      const text = error?.errorMessage ?? error?.message ?? String(error);
      // PREMIUM_ACCOUNT_REQUIRED / TRANSCRIPTION_FAILED / MSG_VOICE_MISSING — shu xabar yoki akkaunt uchun
      if (/PREMIUM/i.test(text)) telegramBroken = true;
      log(`${job.label}: Telegram ham matnga o'gira olmadi (${text})`);
      return null;
    }
  }

  async function viaGemini(job) {
    const list = geminiOrder(connections(), now()).slice(0, limits.geminiTries);
    if (!list.length || !job.message.raw || !reader.download) return null;
    const data = await reader.download(job.message.raw);
    let last = null;
    for (const c of list) {
      try {
        const { text } = await transcribe({ apiKey: c.apiKey, model: c.model, data, mime: job.message.media.mime });
        return text;
      } catch (error) {
        last = error;
      }
    }
    throw last ?? new Error("Gemini ulanishi yo'q");
  }

  async function work(job) {
    const started = now();
    let text = null;
    let by = null;
    try {
      text = await viaGemini(job);
      by = text ? "gemini" : null;
    } catch (error) {
      log(`${job.label}: Gemini matnga o'gira olmadi (${error?.message ?? error}) — Telegram'ga`);
    }
    if (!text) {
      text = await viaTelegram(job);
      by = text ? "telegram" : null;
    }
    const kind = job.message.media.kind;
    if (compare && by === "gemini") {
      const t0 = now();
      const mask = (x) => String(x ?? "").replace(/\d[\d\s-]{6,}\d/g, "[raqam]").slice(0, 300);
      viaTelegram(job)
        .then((t) => log(`${job.label}: SOLISHTIRISH #${job.message.id}\n  Gemini   (${((t0 - started) / 1000).toFixed(1)} s): «${mask(text)}»\n  Telegram (${((now() - t0) / 1000).toFixed(1)} s): «${mask(t)}»`))
        .catch((error) => log(`${job.label}: SOLISHTIRISH #${job.message.id} — Telegram xato: ${error?.message ?? error}`));
    }
    if (!text || text.trim().length < limits.minTextLength) {
      stats.empty++;
      return;
    }
    stats[by]++;
    const ms = now() - started;
    stats.totalMs += ms;
    text = normalizeSpokenPhones(text);
    // Shu odamning shu guruhdagi oldingi ovozli xabari yaqinda bo'lsa — o'sha e'lonning davomi
    const who = job.message.senderId ? `${job.label}:${job.message.senderId}` : null;
    const prev = who ? lastBySender.get(who) : null;
    const at = job.message.date * 1000;
    const fields = {
      source: job.label,
      messageId: job.message.id,
      link: job.link,
      text: text.trim(),
      postedAt: at,
      via: job.via,
      sender: job.message.sender ?? null,
      senderId: job.message.senderId ?? null,
      media: kind,
    };
    const merged = prev && at - prev.at <= MERGE_WINDOW_MS && at >= prev.at ? store.mergePost?.(prev.postId, fields) : null;
    if (merged) {
      lastBySender.set(who, { postId: merged.id, at });
      log(`${job.label}: ${MEDIA_ICON[kind]} davomi oldingi ovozli xabar bilan birlashtirildi (#${prev.postId} → #${merged.id}, ${by}, ${(ms / 1000).toFixed(1)} s) → navbatda`);
      return;
    }
    const result = store.addPost(fields, { dedupeWindowMs: job.dedupeWindowMs });
    if (result && who) {
      lastBySender.set(who, { postId: result.id, at });
      if (lastBySender.size > limits.seenMax) lastBySender.delete(lastBySender.keys().next().value);
    }
    if (result?.status === "new") {
      log(`${job.label}: ${MEDIA_ICON[kind]} ${kind === "voice" ? "ovozli xabar" : "dumaloq video"} matnga o'girildi (${by}, ${(ms / 1000).toFixed(1)} s) → navbatda`);
    }
  }

  // Bir odamning xabarlari ketma-ket (birlashtirish uchun oldingisi navbatga yozilgan bo'lishi kerak), boshqalari parallel
  const busy = new Set();
  const whoOf = (job) => (job.message.senderId ? `${job.label}:${job.message.senderId}` : null);
  function pump() {
    while (running < limits.concurrency && queue.length) {
      const index = queue.findIndex((j) => !busy.has(whoOf(j)));
      if (index < 0) return;
      const [job] = queue.splice(index, 1);
      const who = whoOf(job);
      if (who) busy.add(who);
      running++;
      work(job)
        .catch((error) => {
          stats.failed++;
          log(`${job.label}: ${MEDIA_ICON[job.message.media.kind]} matnga o'girib bo'lmadi — ${error?.message ?? error}`);
        })
        .finally(() => {
          running--;
          if (who) busy.delete(who);
          pump();
        });
    }
  }

  return {
    // → true (navbatga olindi) | false (juda uzun / katta yoki allaqachon ko'rilgan)
    push({ source, label, link = null, message, via = null, dedupeWindowMs }) {
      const key = `${label}:${message.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > limits.seenMax) seen.delete(seen.values().next().value);
      const { duration = 0, size = 0 } = message.media;
      if (duration > limits.maxDurationSec || size > limits.maxBytes) {
        stats.skipped++;
        return false;
      }
      queue.push({ source, label, link, message, via, dedupeWindowMs });
      pump();
      return true;
    },
    // Hisobot uchun (live.js har 10 daqiqada): shu vaqtgacha nechtasi qaysi yo'l bilan o'girildi
    stats: () => ({ ...stats, queued: queue.length, running }),
    idle: () => queue.length === 0 && running === 0,
  };
}
