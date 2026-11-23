// fastLook + embedding aralashmasi (2026-11-23, Azimjon: «muqobil ishlatish yo'lini qilsak … qaysi biri yaxshi bo'lsa
// anashu yo'nalishda undan foydalanish»). O'lchov (11 673 ta AI belgilagan e'lon, yarmida tanlab, yarmida tekshirilgan):
// faqat fastLook ikkilangan e'lonlarda (ball 0,01–0,99, ≈ 13%) embedding qo'shilsa — aniqlik 95,4% → 96,1%,
// yo'qolgan yuk 67 → 41, o'tib ketgan «e'lon emas» 200 → 185. Qolgan e'lonlar hozirgidek darhol.
//
// Rejim — bazadagi sozlama embed_config.mode (botni qayta yoqmasdan almashadi, har e'londa o'qiladi):
//   off    — embedding yo'q;
//   shadow — (standart) so'raladi va store embed_verdicts ga yoziladi, qaror fastLook'niki — yetkazish kutmaydi;
//   live   — ikkilangan e'lon embedding javobini timeoutMs (1,5 s) gacha kutadi va aralash qaror ishlatiladi.
// 1pro ishlamasa / kechiksa — fastLook qarori (e'lon yo'qolmaydi), xato tashlanmaydi. Qolgan sozlamalar (w, t, lo, hi)
// model faylidagi tavsiyadan, embed_config ularni ustidan yozadi.
import { embedScore, mixedIsLoad, needsEmbedding } from "@yuk/parser/embed";

export const EMBED_MODES = ["off", "shadow", "live"];
const DEFAULTS = { mode: "shadow", w: 0.3, t: -1, lo: 0.01, hi: 0.99, timeoutMs: 1500 };

export function createEmbedLook({ store, embedder, model, log = () => {}, now = () => Date.now() }) {
  const stats = { asked: 0, failed: 0, late: 0, changed: 0 };
  let saved = { raw: undefined, value: {} };
  function config() {
    let raw = null;
    try {
      raw = store.getSetting("embed_config");
    } catch {}
    if (raw !== saved.raw) {
      let value = {};
      try {
        value = JSON.parse(raw ?? "{}") ?? {};
      } catch {
        log("embed_config sozlamasi buzilgan — standart qiymatlar");
      }
      saved = { raw, value };
    }
    const cfg = { ...DEFAULTS, ...(model.recommended ?? {}), ...saved.value };
    if (!EMBED_MODES.includes(cfg.mode)) cfg.mode = DEFAULTS.mode;
    return cfg;
  }

  function record(row) {
    try {
      store.addEmbedVerdict(row);
    } catch (error) {
      log(`Embedding hukmi yozilmadi: ${error.message}`);
    }
  }

  return {
    stats,
    config,
    // → null (embedding kerak emas yoki soya rejimi — kutilmaydi) yoki Promise<look> (live: aralash qarorli look; hech qachon reject emas)
    check(post, look) {
      const cfg = config();
      if (cfg.mode === "off" || post.shipper != null || post.direct || !needsEmbedding(look.score, cfg)) return null;
      stats.asked++;
      const started = now();
      let used = cfg.mode === "live";
      const work = embedder
        .embed([post.text])
        .then((vectors) => {
          if (!vectors) {
            stats.failed++;
            return look;
          }
          const p = embedScore(model, vectors[0]);
          const load = mixedIsLoad(look.score, p, cfg);
          if (load === look.chatter) stats.changed++; // aralashma fastLook'ni o'zgartirdi
          record({ postId: post.id, p, fastScore: look.score, fast: !look.chatter, mixed: load, used, ms: now() - started, mode: cfg.mode, signature: model.signature });
          return { ...look, chatter: !load, embed: p };
        })
        .catch((error) => {
          stats.failed++;
          log(`Embedding xatosi: ${error.message}`);
          return look;
        });
      if (cfg.mode !== "live") return null; // soya: fonda yoziladi, qaror fastLook'niki
      let timer;
      const late = new Promise((resolve) => {
        timer = setTimeout(() => {
          used = false; // javob kelsa ham qaror fastLook'niki edi — yozuvda shunday turadi
          stats.late++;
          resolve(look);
        }, cfg.timeoutMs);
      });
      return Promise.race([work, late]).finally(() => clearTimeout(timer));
    },
  };
}
