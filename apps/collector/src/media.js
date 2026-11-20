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
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractPhones, fastLook, transcribePauseMs, transcribeWithGemini } from "@yuk/parser";
import { mediaFileName } from "@yuk/store";

export const MEDIA_LIMITS = {
  maxDurationSec: 180, // undan uzuni — e'lon emas (qo'shiq, suhbat), o'girilmaydi
  maxBytes: 19 * 1024 * 1024,
  minTextLength: 10, // o'girilgan matn shundan qisqa bo'lsa («Alo», «Ha») — e'lon emas
  concurrency: 3,
  geminiTries: 3,
  geminiTimeoutMs: 15_000, // bitta urinish shundan uzoq cho'zilsa — keyingi model (odatda 2–5 s; avval 30 s kutilardi)
  showTimeoutMs: 8_000, // botga forward + o'chirish
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

// Sinash tartibi: avval faqat o'girish uchun modellar (models — @yuk/parser TRANSCRIBE_MODELS, limiti matn tahlilidan
// alohida), keyin tahlil bilan umumiy ulanishlar. Kalit — boshqaruv markazidagi Gemini kalit(lar)i.
// 2026-11-20 gacha faqat umumiy ulanishlar edi: tahlil kunlik limitni tushgacha yeb qo'yardi va ovozli xabarlarning ~30% i
// Telegram'ning sifatsiz o'girishiga tushardi (4 kunda 685 ta 429).
function geminiCandidates(connections, models, now) {
  const pool = geminiOrder(connections, now);
  const list = [];
  const seen = new Set();
  const add = (c) => {
    const key = `${c.apiKey}|${c.model}`;
    if (!seen.has(key)) list.push({ ...c, key });
    seen.add(key);
  };
  for (const apiKey of new Set(pool.map((c) => c.apiKey))) for (const model of models) add({ apiKey, model });
  pool.forEach(add);
  return list;
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
  models = [], // faqat o'girish uchun Gemini modellari (accounts.js: .env MEDIA_MODELS yoki TRANSCRIBE_MODELS)
  // Ochiq guruh ovozli xabari faqat shu ro'yxatdagilardan (store.voiceSourceNames — boshqaruv markazida yoqilgan);
  // yopiq guruh ("-100…") — doim. Berilmasa (testlar, eski chaqiruv) — hammasi
  voiceSources = null,
  mediaDir = null, // asl fayl shu papkaga (@yuk/store MEDIA_DIR; accounts.js beradi) — bot haydovchiga uni matni bilan yuboradi
  mediaKeepMs = 24 * 60 * 60_000, // shundan eski fayllar o'chiriladi
  compare = false, // .env MEDIA_COMPARE=1 — Telegram o'girgan xabarni Gemini ham o'giradi, ikkalasi logga (sifatni solishtirish)
}) {
  const queue = [];
  const seen = new Set(); // "@guruh:123" — jonli va so'rab olish bir xabarni ikki marta o'girmasin
  const lastBySender = new Map(); // "@guruh:senderId" → { postId, at } — ketma-ket ovozli xabarlarni birlashtirish
  let running = 0;
  let premium = null; // null — hali so'ralmagan
  let telegramBroken = false; // Telegram o'girishi ishlamadi (masalan, Premium tugagan) — keyin to'g'ri Gemini'ga
  const stats = { telegram: 0, gemini: 0, empty: 0, skipped: 0, failed: 0, totalMs: 0 };
  const resting = new Map(); // "kalit|model" → qachongacha sinalmaydi (limit tugagan, band — transcribePauseMs)

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

  // Ochiq guruh — boshqaruv markazida «🎤 Ovozli xabarlar» yoqilgan bo'lsagina (ro'yxat 30 s da bir qayta o'qiladi)
  let voiceSet = null;
  let voiceAt = -Infinity;
  function voiceAllowed(label) {
    if (!voiceSources || /^-\d+$/.test(label)) return true;
    if (now() - voiceAt > 30_000) {
      try {
        voiceSet = voiceSources();
      } catch {
        voiceSet ??= new Set();
      }
      voiceAt = now();
    }
    return voiceSet.has(String(label).toLowerCase());
  }

  // Asl fayl → mediaDir/<manba>_<xabar id>.<ogg|mp4> (@yuk/store mediaFileName — bot ham shu nom bilan topadi).
  // Har 10 daqiqada bir marta mediaKeepMs dan eski fayllar o'chiriladi
  let cleanedAt = 0;
  async function saveMedia(job, data) {
    await mkdir(mediaDir, { recursive: true });
    await writeFile(path.join(mediaDir, mediaFileName(job.label, job.message.id, job.message.media.kind)), data);
    if (now() - cleanedAt < 10 * 60_000) return;
    cleanedAt = now();
    for (const name of await readdir(mediaDir).catch(() => [])) {
      const full = path.join(mediaDir, name);
      const info = await stat(full).catch(() => null);
      if (info && now() - info.mtimeMs > mediaKeepMs) await unlink(full).catch(() => {});
    }
  }

  // → { text, model } | null (sinaydigan model yo'q). Hammasi xato bersa — oxirgi xato tashlanadi
  // Fayl bir marta yuklanadi (Gemini ham, haydovchiga yuboriladigan asl fayl ham shu)
  const fileOf = (job) => (job.data ??= reader.download(job.message.raw));

  async function viaGemini(job) {
    if (!job.message.raw || !reader.download) return null;
    const list = geminiCandidates(connections(), models, now())
      .filter((c) => !((resting.get(c.key) ?? 0) > now()))
      .slice(0, limits.geminiTries);
    if (!list.length) return null; // hammasi dam olyapti — to'g'ri Telegram'ga
    const data = await fileOf(job);
    let last = null;
    for (const c of list) {
      try {
        const { text } = await transcribe({ apiKey: c.apiKey, model: c.model, data, mime: job.message.media.mime, timeoutMs: limits.geminiTimeoutMs });
        return { text, model: c.model };
      } catch (error) {
        last = error;
        resting.set(c.key, now() + transcribePauseMs(error));
      }
    }
    throw last;
  }

  // Yopiq guruhning matnli e'loni, faqat ID bilan (live.js addMessage → pushContact): botga ko'rsatib, keyin navbatga
  async function workContact(job) {
    await showSender(job, job.fields.text, { voice: false });
    store.addPost(job.fields, { dedupeWindowMs: job.dedupeWindowMs });
  }

  async function work(job) {
    const started = now();
    let text = null;
    let by = null;
    let model = null;
    try {
      const result = await viaGemini(job);
      text = result?.text ?? null;
      model = result?.model ?? null;
      by = text ? "gemini" : null;
    } catch (error) {
      // Google xatosi — uzun JSON: logga boshi yetadi («code 429 … PerDay» ko'rinadi)
      log(`${job.label}: Gemini matnga o'gira olmadi (${String(error?.message ?? error).slice(0, 220)}) — Telegram'ga`);
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
    const how = model ? `${by} · ${model.replace(/^gemini-/, "")}` : by; // logda: «gemini · 3.5-transcribe»
    const ms = now() - started;
    stats.totalMs += ms;
    text = normalizeSpokenPhones(text);
    // Asl fayl diskka — navbatga yozishdan OLDIN (bot e'lonni ko'rganda fayl tayyor bo'lsin)
    if (mediaDir && job.message.raw && reader.download) {
      try {
        await saveMedia(job, await fileOf(job));
      } catch (error) {
        log(`${job.label}: asl fayl saqlanmadi — ${error?.message ?? error} (haydovchiga faqat matn boradi)`);
      }
    }
    await showSender(job, text);
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
      senderPhone: /^-\d+$/.test(job.label) ? (job.message.senderPhone ?? null) : null, // yopiq guruhda — profil raqami
      media: kind,
    };
    const merged = prev && at - prev.at <= MERGE_WINDOW_MS && at >= prev.at ? store.mergePost?.(prev.postId, fields) : null;
    if (merged) {
      lastBySender.set(who, { postId: merged.id, at });
      log(`${job.label}: ${MEDIA_ICON[kind]} davomi oldingi ovozli xabar bilan birlashtirildi (#${prev.postId} → #${merged.id}, ${how}, ${(ms / 1000).toFixed(1)} s) → navbatda`);
      return;
    }
    const result = store.addPost(fields, { dedupeWindowMs: job.dedupeWindowMs });
    if (result && who) {
      lastBySender.set(who, { postId: result.id, at });
      if (lastBySender.size > limits.seenMax) lastBySender.delete(lastBySender.keys().next().value);
    }
    if (result?.status === "new") {
      log(`${job.label}: ${MEDIA_ICON[kind]} ${kind === "voice" ? "ovozli xabar" : "dumaloq video"} matnga o'girildi (${how}, ${(ms / 1000).toFixed(1)} s) → navbatda`);
    }
  }

  // Yopiq guruhdagi username'siz odamning ovozli YUK e'loni (2026-11-20, Azimjon: «Audioda yuk tasdiqlansa jo'natgan odamni
  // lichkasi yoki id si orqali uni chatiga link yasagin. Odatda yopiq guruhlarda … Pro foydalanuvchilarimiz yuk borligini
  // bilsada bog'lana olmasligi mumkin»). Yopiq guruhda «📄 Asl e'lon» havolasi yo'q, bot esa tg://user?id= tugmasini faqat
  // o'zi ko'rgan odamga beradi. O'qiyotgan akkaunt xabarni botga forward qiladi va darhol o'chiradi → bot uni ko'rgan bo'ladi
  // → store.markSenderReachable → bot «💬 Lichkasi» tugmasini beradi. 4 kunlik o'lchov: yopiq guruh ovozli yuklarining 62% i
  // shunday (faqat ID). E'lon emaslari forward qilinmaydi (fastLook — bot ham shu bilan hal qiladi). Botga yetmasa — jim
  // Matnli e'lon ham (2026-11-20): raqami (matnda yoki profilda) va username'i yo'q bo'lsa — xuddi shunday
  async function showSender(job, text, { voice = true } = {}) {
    const id = job.message.senderId;
    if (!/^-\d+$/.test(job.label) || job.message.sender || job.message.senderPhone || !id || !reader.showToBot || store.senderReachable?.(id)) return;
    if (extractPhones(text).length) return; // raqam aytilgan — bog'lanish bor
    const bot = store.getSetting?.("bot_username");
    if (!bot) return;
    try {
      if (fastLook(text, { voice }).chatter) return;
      const shown = await Promise.race([
        reader.showToBot(job.source, job.message.id, bot),
        new Promise((_, reject) => setTimeout(() => reject(new Error("javob kelmadi")), limits.showTimeoutMs)),
      ]);
      if (shown) store.markSenderReachable(id);
      stats.shown = (stats.shown ?? 0) + (shown ? 1 : 0);
      log(`${job.label}: ${shown ? "💬 yozgan odam botga ko'rsatildi — haydovchilarga «Lichkasi» tugmasi chiqadi" : "yozgan odam forward'da yashirin — «Lichkasi» bo'lmaydi"}`);
    } catch (error) {
      log(`${job.label}: yozgan odamni botga ko'rsatib bo'lmadi — ${String(error?.errorMessage ?? error?.message ?? error).slice(0, 160)}`);
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
      (job.contact ? workContact : work)(job)
        .catch((error) => {
          stats.failed++;
          log(`${job.label}: ${job.contact ? "yopiq guruh e'loni navbatga yozilmadi" : `${MEDIA_ICON[job.message.media?.kind] ?? ""} matnga o'girib bo'lmadi`} — ${error?.message ?? error}`);
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
      if (!voiceAllowed(label)) {
        stats.notAllowed = (stats.notAllowed ?? 0) + 1;
        return false;
      }
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
    // Yopiq guruhning matnli e'loni, faqat ID bilan (live.js addMessage): botga ko'rsatiladi, keyin navbatga yoziladi.
    // → true (olindi) | false (allaqachon ko'rilgan)
    pushContact({ source, label, message, via = null, dedupeWindowMs, fields }) {
      const key = `${label}:${message.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > limits.seenMax) seen.delete(seen.values().next().value);
      queue.push({ source, label, message, via, dedupeWindowMs, fields, contact: true });
      pump();
      return true;
    },
    // Hisobot uchun (live.js har 10 daqiqada): shu vaqtgacha nechtasi qaysi yo'l bilan o'girildi
    stats: () => ({ ...stats, queued: queue.length, running }),
    idle: () => queue.length === 0 && running === 0,
  };
}
