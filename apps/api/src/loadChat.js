// Ilovadagi «📝 E'lon berish» chati (YukApp, Azimjon 2026-11-25: «E'lon berish chat bo'lsin … bot qanday ishlayotgan
// bo'lsa qarab ko'r»). Botdagi «📦 Yuk berish» (apps/bot shipperLoads.js createLoadDesk) bilan BIR XIL qoida:
//   yuk beruvchi oddiy matn yozadi → qoidaviy parser (darhol) yoki AI tushunadi → raqam bo'lmasa so'raladi (YOZILADI,
//   oldingi raqamlari tugma) → «haydovchilarga shunday boradi» → [✅ Yuborish] → navbat (store.addDirectPost, via "app")
//   → bot ishchisi mos haydovchilarga yuboradi → natija (ilova posts dan so'raydi; bot ham Telegram chatiga yozadi).
// Qoralama o'sha joyda — drivers.load_draft: botda boshlangani ilovada ham ko'rinadi va aksincha.
// Javoblar HTMLsiz oddiy matn: ilova o'zi chizadi.
import { extractPhones } from "@yuk/parser";
import { SHIPPER_LOAD_LIMIT, formatContactPhone, placeText, routeInScope, scopeCountries, shipperLoadText } from "@yuk/shared";

export const DRAFT_TTL_MS = 60 * 60_000; // bot bilan bir xil
export const MAX_DRAFT_LOADS = 5;
export const EXAMPLE = "Andijondan Toshkentga 20 tonna un bor, tent fura kerak, 3 mln, ertaga. 90 123 45 67";

export const CHAT_TEXT = {
  intro: `Yukingizni oddiy yozib yuboring — mos haydovchilar sizga o'zlari qo'ng'iroq qiladi.\n\nMasalan:\n${EXAMPLE}`,
  // Texnik gap yo'q (Azimjon, 2026-11-25: «"salom" … "AI band" … texnik gaplar kerak emas … boshidan yozing degan ma'noda»)
  notLoad: `🙂 Bu yuk e'loniga o'xshamadi. Yukingiz haqida qaytadan yozing: qayerdan, qayerga, nima yuk va necha tonna.\n\nMasalan:\n${EXAMPLE}`,
  truck: "🙂 Bu bo'sh mashina e'loniga o'xshaydi. Bu yerda yuk e'loni beriladi — yukingiz haqida yozing: qayerdan, qayerga, nima yuk va necha tonna.",
  // Tushunib bo'lmadi (AI ham javob bermadi) — foydalanuvchiga sabab emas, nima qilish kerakligi
  busy: `🙂 Xabaringizni tushuna olmadim. Yukingiz haqida qaytadan, aniqroq yozing: qayerdan, qayerga, nima yuk va necha tonna.\n\nMasalan:\n${EXAMPLE}`,
  limit: (limit) => `⚠️ 24 soatda ${limit} ta yuk yubordingiz — bu chegara. Keyingisini birozdan keyin yuboring.`,
  askPhone: "📞 E'londa telefon raqami yo'q. Haydovchilar qaysi raqamga qo'ng'iroq qilsin? Raqamni tekshiring (o'zgartirsa bo'ladi) va «✅ Yuborish» ni bosing.",
  // Ma'lumot yetishmaydi — yozgani qaytariladi, «✏️ Tahrirlash» bilan to'ldirib qayta yuboradi (Azimjon, 2026-11-25)
  missing: (parts) => `✏️ E'londa ${parts.join(" va ")} yozilmagan. Pastdagi «✏️ Tahrirlash» ni bosing, qo'shib qayta yuboring.`,
  // Ovoz 3 marta ketma-ket tushunilmadi — yozib berishni taklif qilamiz
  voiceHelp: `🎤 Ovozingizni yaxshi tushuna olmayapman. Yaxshisi, e'lonni yozib yuboring — shunday:\n\n${EXAMPLE}\n\n📍 qayerdan → qayerga · 📦 nima yuk, necha tonna · 🚚 mashina · 💰 narx · 📞 telefon`,
  badPhone: "Raqamni tushunmadim. Masalan: 90 123 45 67",
  confirm: (n) => (n > 1 ? `📋 ${n} ta yuk — haydovchilarga shunday boradi. Hammasi to'g'rimi?` : "📋 Haydovchilarga shunday boradi. Hammasi to'g'rimi?"),
  more: (n) => `⚠️ Bitta xabarda ko'pi bilan ${MAX_DRAFT_LOADS} ta yuk — qolgan ${n} tasini alohida yuboring.`,
  sending: "📤 Yuborildi — natijasini hozir yozaman.",
  cancelled: "❌ Bekor qilindi.",
  stale: "Bu yuk eskirgan yoki allaqachon yuborilgan — qaytadan yozing.",
};

const isUz = (scope) => scopeCountries(scope).length === 0;
export function scopeText(loads, scope) {
  const routes = [...new Set(loads.map((load) => `${placeText(load, "from")} → ${placeText(load, "to")}`))].slice(0, 3).join(", ");
  return (
    `⚠️ Bu yo'nalish hozircha qo'llanmaydi: ${routes}.\n` +
    (isUz(scope) ? "Hozircha faqat O'zbekiston ichidagi yuklar." : "Hozircha faqat O'zbekiston ichidagi va O'zbekiston bilan qo'shni davlatlar orasidagi yuklar.")
  );
}

// Yuborilgan yukning natijasi (posts qatori, store.shipperPosts) — bot resultText bilan bir ma'noda.
// → { done: false } (hali navbatda) | { done: true, ok, text }
export function postResult(post) {
  if (!post) return { done: true, ok: false, text: "Topilmadi" };
  if (post.status === "new") return { done: false, text: "⏳ Haydovchilar qidirilyapti…" };
  if (post.status === "failed") return { done: true, ok: false, text: `⚠️ Yukingizni yuborib bo'lmadi: ${post.error ?? "xato"}. Birozdan keyin qayta urinib ko'ring.` };
  if (/^Boshqa yo'nalish/.test(post.error ?? "")) return { done: true, ok: false, text: "⚠️ Yukingiz yuborilmadi: bu yo'nalish hozircha qo'llanmaydi." };
  if (!post.loads) return { done: true, ok: true, text: "ℹ️ Bu yuk yaqinda allaqachon yuborilgan (yo'nalishi, og'irligi va raqami bir xil) — ikkinchi marta yuborilmadi." };
  const stays = "Yuk 24 soat davomida haydovchilarning ro'yxatida ham turadi.";
  if (!post.sent) return { done: true, ok: true, text: `✅ Yukingiz qabul qilindi. Hozircha unga mos haydovchi topilmadi.\n${stays}` };
  return { done: true, ok: true, text: `✅ Yukingiz ${post.sent} ta mos haydovchiga yuborildi. Ular sizga o'zlari qo'ng'iroq qilishadi.\n${stays}` };
}

export const phonesIn = (text) => extractPhones(String(text ?? "")).slice(0, 2);
// Yetishmayotgan asosiy ma'lumot: yo'nalish (ikkala tomoni) va yuk (nima yoki necha tonna)
export function missingParts(loads) {
  const parts = [];
  if (loads.some((l) => !(l.fromRegion || l.fromCountry) || !(l.toRegion || l.toCountry))) parts.push("📍 qayerdan → qayerga");
  if (loads.some((l) => !l.cargo && l.weightT == null && l.weightKg == null)) parts.push("📦 nima yuk, necha tonna");
  return parts;
}

// Yuk kartasi: qatorlar (yo'nalish, yuk, mashina, narx, qachon, izoh, raqam) — haydovchilarning ilova lentasidagi matn shu
const cardOf = (load) => shipperLoadText(load).split(" · ");

// parse(text) → { ok, postType, loads, by } | null (AI band). store — @yuk/store
export function createLoadChat({ store, parse, scope, now = Date.now, limit = SHIPPER_LOAD_LIMIT }) {
  const fresh = (draft) => (draft?.loads?.length && now() - (draft.at ?? 0) < DRAFT_TTL_MS ? draft : null);
  const current = (chatId) => fresh(store.loadDraft(chatId));
  const saved = (user) => (user?.loadPhones?.length ? user.loadPhones : user?.phone ? [user.phone] : []);
  const phoneChoices = (user) => saved(user).slice(0, 3).map((phone) => ({ phone, label: formatContactPhone(phone) }));

  // Qoralamaning «ko'rinishi»: { stage, text, cards, editText, phones? } — editText: yozgani («✏️ Tahrirlash»)
  function viewOf(draft, user) {
    const cards = draft.loads.map(cardOf);
    if (draft.stage === "phone") return { stage: "phone", text: CHAT_TEXT.askPhone, cards, phones: phoneChoices(user), editText: draft.text };
    const text = CHAT_TEXT.confirm(draft.loads.length) + (draft.more > 0 ? `\n${CHAT_TEXT.more(draft.more)}` : "");
    return { stage: "confirm", text, cards, editText: draft.text };
  }
  function show(chatId, draft, user) {
    store.setLoadDraft(chatId, draft);
    return viewOf(draft, user);
  }
  const withPhones = (draft, phones) => ({ ...draft, stage: "confirm", loads: draft.loads.map((load) => ({ ...load, phones })) });
  const note = (text, extra = {}) => ({ stage: null, text, ...extra });

  return {
    // Chat ochilganda: tugallanmagan qoralama (bot yoki ilovada boshlangan) — davom etadi
    current(chatId, user) {
      const draft = current(chatId);
      return draft ? viewOf(draft, user) : null;
    },

    async read(chatId, text, user) {
      const draft = current(chatId);
      if (draft?.stage === "phone") {
        const phones = phonesIn(text);
        if (phones.length) return show(chatId, withPhones(draft, phones), user);
        if (text.trim().length < 25) return { ...viewOf(draft, user), text: CHAT_TEXT.badPhone };
      }
      if (store.shipperPostCount(chatId) >= limit) return note(CHAT_TEXT.limit(limit));
      const editText = text.slice(0, 2000);
      const result = await parse(text);
      if (!result) return note(CHAT_TEXT.busy, { editText });
      if (result.ok && result.postType === "mashina_bor") return note(CHAT_TEXT.truck, { editText });
      if (!result.ok || result.postType !== "yuk_bor" || !result.loads?.length) return note(CHAT_TEXT.notLoad, { editText, failed: true });
      const missing = missingParts(result.loads);
      if (missing.length) return note(CHAT_TEXT.missing(missing), { editText, failed: true });
      const inScope = result.loads.filter((load) => routeInScope(load, scope));
      if (!inScope.length) return note(scopeText(result.loads, scope), { editText });
      const loads = inScope.slice(0, MAX_DRAFT_LOADS);
      const next = { text: text.slice(0, 2000), loads, more: inScope.length - loads.length, at: now(), by: result.by ?? "ai" };
      const stage = loads.every((load) => load.phones?.length) ? "confirm" : "phone";
      return show(chatId, { ...next, stage }, user);
    },

    // Raqam: tayyor raqamlardan biri yoki o'zi yozgani (tahrirlagani). → ko'rinish | null (qoralama yo'q) |
    // { stage: "phone", text: badPhone, … } (raqam tushunilmadi)
    setPhone(chatId, phoneText, user) {
      const draft = current(chatId);
      if (!draft) return null;
      const phones = saved(user).includes(phoneText) ? [phoneText] : phonesIn(phoneText);
      if (!phones.length) return { ...viewOf(draft, user), text: CHAT_TEXT.badPhone };
      return show(chatId, withPhones(draft, phones), user);
    },

    // → { ok: true, id } | { ok: false, reason: "stale" | "phone" | "limit" }
    send(chatId, user, { sender = null } = {}) {
      const draft = current(chatId);
      if (!draft) return { ok: false, reason: "stale" };
      if (draft.stage !== "confirm" || !draft.loads.every((load) => load.phones?.length)) return { ok: false, reason: "phone" };
      if (store.shipperPostCount(chatId) >= limit) return { ok: false, reason: "limit" };
      const { id } = store.addDirectPost({ chatId, text: draft.text, loads: draft.loads, via: "app", sender });
      store.setLoadDraft(chatId, null);
      store.setLoadPhones(chatId, draft.loads[0].phones);
      return { ok: true, id };
    },

    cancel(chatId) {
      const had = Boolean(current(chatId));
      store.setLoadDraft(chatId, null);
      return had;
    },
  };
}
