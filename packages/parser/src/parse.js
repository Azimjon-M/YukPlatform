// E'lonni AI orqali JSON'ga aylantiradi: bittasini (parse) yoki bir nechtasini bitta so'rovda (parseBatch).
// Qaysi AI ishlashi .env dagi PARSER_PROVIDER ga bog'liq: gemini (standart, bepul) yoki claude.
import { extractPhones, maskPhones } from "./phones.js";
import { cargoCategory, normalizePlaces } from "@yuk/shared";
import { formatBatch, readBatchAnswer } from "./batch.js";
import { BATCH_SYSTEM_PROMPT } from "./prompt.js";
import { DEFAULT_PROVIDER, getProvider } from "./providers/index.js";
import { BATCH_SCHEMA } from "./schema.js";

export const DEFAULT_EFFORT = "low"; // qanchalik chuqur o'ylashi — hozircha faqat Claude'da ishlatiladi
// Bitta so'rovdagi e'lonlar soni (bot ishchisi navbatdan shuncha oladi). 1 — har e'lon alohida so'rov (eski usul).
export const DEFAULT_BATCH_SIZE = 10;
// Navbatda batch'dan kam e'lon bo'lsa, bot eng eski e'lon joylanganidan shuncha soniya o'tguncha yig'ilishini kutadi
export const DEFAULT_BATCH_WAIT_SEC = 60;

// .env dagi son: bo'sh, "abc" yoki min'dan kichik bo'lsa — standart qiymat
function numberSetting(value, fallback, min) {
  const n = Math.floor(Number(value));
  return value !== undefined && value !== "" && n >= min ? n : fallback;
}

export function resolveSettings(options = {}) {
  // || — .env da qiymat bo'sh qoldirilgan bo'lsa ham standart qiymat olinadi
  const provider = getProvider(options.provider || process.env.PARSER_PROVIDER || DEFAULT_PROVIDER);
  return {
    provider,
    model: options.model || process.env.PARSER_MODEL || provider.defaultModel,
    effort: options.effort || process.env.PARSER_EFFORT || DEFAULT_EFFORT,
    batchSize: numberSetting(options.batchSize ?? process.env.PARSER_BATCH, DEFAULT_BATCH_SIZE, 1),
    batchWaitMs: numberSetting(options.batchWaitSec ?? process.env.PARSER_BATCH_WAIT, DEFAULT_BATCH_WAIT_SEC, 0) * 1000,
  };
}

// AI javobidagi bitta e'lon → bizning natija.
// Telefonlar AI'dan emas, regex'dan olinadi va e'londagi har bir yukka biriktiriladi.
// Shahar ro'yxatda bo'lsa, viloyat/davlat ro'yxatdan olinadi (AI adashsa ham to'g'ri chiqadi).
// Toifa (fura / yengil) ham AI'dan emas, mashina sinfi va og'irlikdan hisoblanadi.
function readPost(data, phones) {
  return {
    ok: true,
    postType: data.postType,
    loads: data.loads.map((load) => {
      const fixed = normalizePlaces(load);
      return { ...fixed, category: cargoCategory(fixed), phones };
    }),
  };
}

// options.client — testlarda soxta client berish uchun; odatda kerak emas.
// options.apiKey — boshqaruv markazida qo'shilgan kalit (berilmasa .env dan); options.attempts — SDK urinishlari.
// options.onRequest — har bir AI so'rovidan oldin chaqiriladi (bugun nechta so'rov ketganini sanash uchun).
export function createParser(options = {}) {
  const { provider, model, effort, batchSize, batchWaitMs } = resolveSettings(options);
  const client = options.client ?? provider.createClient({ apiKey: options.apiKey, attempts: options.attempts });
  const generate = (request) => {
    options.onRequest?.();
    return provider.generate(client, request);
  };

  // Bu xatolarda e'lonni bittadan qayta yuborishdan foyda yo'q: limit tugagan (429), model band (503),
  // kalit noto'g'ri. Ularni chaqiruvchi hal qiladi (kutadi yoki to'xtaydi), e'lonlar keyin qayta yuboriladi.
  const mustStop = (error) => provider.retryAfterMs?.(error) != null || Boolean(provider.isFatal?.(error));

  async function parse(text) {
    const phones = extractPhones(text);
    // AI telefon raqamlarini ko'rmaydi — ular yuqorida regex bilan olingan
    const result = await generate({ text: maskPhones(text), model, effort });
    const meta = { model: result.model, usage: result.usage, phones };
    if (!result.ok) return { ok: false, error: result.error, ...meta };

    let data;
    try {
      data = JSON.parse(result.json);
    } catch {
      return { ok: false, error: "AI javobidagi JSON o'qilmadi", ...meta };
    }
    return { ...readPost(data, phones), ...meta };
  }

  // Bitta e'lon (batch'ning oxirgi qadami): kutilmagan xato (tarmoq, 500) shu e'longa yoziladi, qolganlar davom etadi
  async function parseSafe(text) {
    try {
      return await parse(text);
    } catch (error) {
      // Limit/band bo'lsa — butun guruh keyinroq qayta yuboriladi (shu paytgacha tayyorlari ham)
      if (mustStop(error)) throw error;
      return { ok: false, error: provider.describeError?.(error) ?? error.message, phones: extractPhones(text) };
    }
  }

  // Batch javobi yaroqsiz bo'lsa — guruh ikkiga bo'linib qayta yuboriladi (10 → 5 + 5 → 3 + 2 → ... → bittadan).
  // Nega darhol bittadan emas: bepul limit kuniga 500 so'rov. 30 talik guruhda bitta "yomon" e'lon bo'lsa,
  // bittadan — 30 so'rov, bo'lib — ~10 so'rov; yaxshi yarmi esa baribir bitta so'rovda tahlil qilinadi.
  // Natijada `fallback` = birinchi guruh nega yaroqsiz bo'lgani.
  async function splitAndRetry(texts, reason) {
    const mid = Math.ceil(texts.length / 2);
    const results = [...(await parseBatch(texts.slice(0, mid))), ...(await parseBatch(texts.slice(mid)))];
    return results.map((result) => ({ ...result, fallback: reason }));
  }

  // Bir nechta e'lon — BITTA so'rov. → natijalar massivi, texts bilan bir xil tartibda (har biri parse() natijasidek).
  // Javob e'lonlarga raqami (id) bo'yicha qaytariladi. Javob yaroqsiz bo'lsa (JSON buzuq, e'lon tushib qolgan,
  // raqam adashgan, javob uzilgan, bloklangan) — guruh bo'linib qayta yuboriladi, oxiri bittadan.
  // Limit (429), model band (503) yoki kalit xatosida throw qilinadi: chaqiruvchi kutadi va hammasini qayta yuboradi.
  async function parseBatch(texts) {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await parseSafe(texts[0])];
    // (text) => ... — map funksiyaga indeksni ham beradi, maskPhones esa uni "o'rniga yoziladigan matn" deb oladi
    const phones = texts.map((text) => extractPhones(text));

    let answer;
    try {
      // Telefonlar har bir e'londa alohida yashiriladi, keyin e'lonlar "=== POST n ===" sarlavhasi bilan birlashtiriladi
      const text = formatBatch(texts.map((post) => maskPhones(post)));
      answer = await generate({ text, model, effort, system: BATCH_SYSTEM_PROMPT, schema: BATCH_SCHEMA });
    } catch (error) {
      if (mustStop(error)) throw error;
      return splitAndRetry(texts, `so'rov xatosi: ${provider.describeError?.(error) ?? error.message}`);
    }

    const { items, problem } = answer.ok ? readBatchAnswer(answer.json, texts.length) : { items: [], problem: answer.error };
    if (problem) return splitAndRetry(texts, problem);

    return items.map((data, i) => ({
      ...readPost(data, phones[i]),
      model: answer.model,
      // Token sarfi butun so'rovniki — ikki marta sanalmasligi uchun faqat birinchi e'longa yoziladi
      usage: i === 0 ? answer.usage : null,
      phones: phones[i],
      batch: texts.length,
    }));
  }

  return { provider, model, effort, batchSize, batchWaitMs, client, parse, parseBatch };
}
