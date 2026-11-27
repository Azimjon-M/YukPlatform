// «📦 Yuk berish» — yuk beruvchining o'z yuki botda (2026-11-10, Azimjon: «Forma va oddiy yozish bo'lsin (o'z xohishiga qarab
// yozaversin)»). 2026-11-27 dan (Azimjon: «Ilovadagi kabi yozib (abrazavanyaga qarab) yoki audioham jo'nataversin, buyerda
// Formaga yo'naltirish (qo'rqinchli) kerak emas») — faqat chatda, formasiz:
//   1) shu yerga oddiy xabar: «Andijondan Toshkentga 20 tonna un, tent kerak, 90 123 45 67»;
//   2) ovozli xabar — Gemini matnga o'giradi (main.js transcribeVoice, ilova chati bilan bir xil), keyin matndek.
// Oddiy xabarni qoidaviy parser (darhol) yoki AI tushunadi — guruh e'lonlaridagi bilan bir xil. Keyin yuk beruvchi
// haydovchilarga qanday borishini ko'radi va tasdiqlaydi (Azimjon: «Tasdiqlatsin»): [✅ Yuborish] [❌].
// Matnda telefon bo'lmasa — so'raladi va YOZILADI (ulashilmaydi: «raqam ulashish emas balki raqam yozish kerak»); oxirgi
// yozgan raqamlari tugma bo'lib turadi. Tasdiqlansa — navbatga (store.addDirectPost), bot ishchisi uni darhol mos
// haydovchilarga yuboradi (pipeline.js) va natijani shu yerga yozadi (resultText).
// Chegara: 24 soatda SHIPPER_LOAD_LIMIT ta e'lon (Azimjon: «Darhol, kunlik limit bilan»; spam — boshqaruv markazidan blok).
import { InlineKeyboard } from "grammy";
import { extractPhones } from "@yuk/parser";
import { SHIPPER_LOAD_LIMIT, formatContactPhone, placeText, routeInScope, scopeCountries } from "@yuk/shared";
import { escapeHtml, formatLoad } from "./format.js";
import { MENU } from "./menu.js";

export const LOAD_BUTTON = MENU.giveLoad;
// Qoralama (tasdiqlanmagan yuk) shuncha vaqt turadi; keyin «Yuborish» bosilsa — «eskirgan»
export const DRAFT_TTL_MS = 60 * 60_000;
// Bitta xabardan ko'pi bilan shuncha yuk (Telegram xabari 4096 belgi; ko'prog'i — formadan yoki alohida xabarlar)
export const MAX_DRAFT_LOADS = 5;
export const LOAD_CALLBACKS = { send: "yb:send", cancel: "yb:no", phone: /^yb:ph:(\d)$/ };

const EXAMPLE = "Andijondan Toshkentga 20 tonna un bor, tent fura kerak, 3 mln, ertaga. 90 123 45 67";

// «Yuk berish» haqida (rol tanlangach, /yordam, menyudagi tugma): ilovadagi «📝 E'lon berish» namunasi bilan bir xil —
// nima yozish (yoki aytish) kerakligi qatorma-qator, misol va ovozli xabar ham bo'lishi
export const GUIDE = [
  ["📍", "Qayerdan → qayerga", "Andijondan Toshkentga"],
  ["📦", "Nima yuk, necha tonna", "20 tonna un"],
  ["🚚", "Qanday mashina", "tent fura"],
  ["💰", "Narxi, qachon", "3 mln, ertaga"],
  ["📞", "Telefon", "90 123 45 67"],
];
export function loadIntro() {
  return [
    `📦 <b>Yukingizni shu chatga yozib yuboring yoki 🎤 ovozli xabar qilib ayting</b> — mos haydovchilar o'zlari qo'ng'iroq qiladi.`,
    "",
    ...GUIDE.map(([icon, what, sample]) => `${icon} ${what}: <i>${sample}</i>`),
    "",
    `Masalan:\n<b>${EXAMPLE}</b>`,
  ].join("\n");
}

export const LOAD_TEXT = {
  // Azimjon, 2026-11-12: misol endi QALIN (<b>) — loadIntro bilan bir xil ko'rinish
  notLoad: () => `🤔 Bu xabardan yukni tushunmadim. Qayerdan, qayerga, nima yuk va necha tonna ekanini yozing, masalan:\n<b>${EXAMPLE}</b>`,
  truck: "🤔 Bu bo'sh mashina e'loniga o'xshaydi. Siz yuk beruvchisiz — yukingizni yozing (qayerdan, qayerga, necha tonna). " +
    "Haydovchi bo'lsangiz — «🔄 Rolni almashtirish».",
  busy: () => "⏳ Hozir xabaringizni tushuna olmadim. Bir daqiqadan keyin qayta yuboring.",
  // Ovozli xabar (2026-11-27): eshitilgani ko'rsatiladi, keyin matndek; tushunilmasa — yozib yuborishni taklif qilamiz
  heard: (text) => `🎤 Eshitdim: <i>«${escapeHtml(text)}»</i>`,
  voiceFail: `🎤 Ovozingizni tushuna olmadim. Qaytadan, aniqroq ayting — yoki yozib yuboring, masalan:\n<b>${EXAMPLE}</b>`,
  voiceLong: "🎤 Ovozli xabar juda uzun — 2 daqiqagacha qilib ayting yoki yozib yuboring.",
  limit: (limit) => `⚠️ 24 soatda ${limit} ta yuk yubordingiz — bu chegara. Keyingisini birozdan keyin yuboring.`,
  askPhone:
    "📞 <b>Haydovchilar qaysi raqamga qo'ng'iroq qilsin?</b>\nRaqamni yozib yuboring, masalan: <code>90 123 45 67</code> " +
    "(ikkita bo'lsa — vergul bilan).",
  badPhone: "Raqamni tushunmadim. Masalan: <code>90 123 45 67</code> — yoki «❌ Bekor qilish».",
  sending: "📤 <b>Yuborildi</b> — natijasini hozir yozaman.",
  cancelled: "❌ Bekor qilindi.",
  stale: "Bu yuk eskirgan yoki allaqachon yuborilgan",
};

const isUz = (scope) => scopeCountries(scope).length === 0;
export function scopeText(loads, scope) {
  // Shahar darajasida («Andijon → Moskva») — yuk beruvchi o'z yozganini taniydi
  const routes = [...new Set(loads.map((load) => `${placeText(load, "from")} → ${placeText(load, "to")}`))].slice(0, 3).join(", ");
  return (
    `⚠️ Bu yo'nalish hozircha qo'llanmaydi: ${escapeHtml(routes)}.\n` +
    (isUz(scope) ? "Hozircha faqat O'zbekiston ichidagi yuklar." : "Hozircha faqat O'zbekiston ichidagi va O'zbekiston bilan qo'shni davlatlar orasidagi yuklar.")
  );
}

// Tasdiqlash xabari: haydovchiga aynan qanday borishi (format.js formatLoad — haydovchi oladigan matn)
export function previewText(loads, { more = 0 } = {}) {
  const shown = loads.map((load, i) => `${loads.length > 1 ? `<b>${i + 1})</b> ` : ""}${formatLoad(load, {}).text}`);
  const head = loads.length > 1 ? `📋 <b>${loads.length} ta yuk — haydovchilarga shunday boradi:</b>` : "📋 <b>Haydovchilarga shunday boradi:</b>";
  const extra = more > 0 ? `\n\n⚠️ Bitta xabarda ko'pi bilan ${MAX_DRAFT_LOADS} ta yuk — qolgan ${more} tasini alohida yuboring.` : "";
  return `${head}\n\n${shown.join("\n\n")}${extra}\n\nHammasi to'g'rimi?`;
}

// editUrl — «✏️ Formada tuzatish» (web forma qoralama bilan; faqat bitta yuk bo'lsa va https manzil bo'lsa)
export function previewKeyboard({ editUrl = null } = {}) {
  const keyboard = new InlineKeyboard().text("✅ Yuborish", LOAD_CALLBACKS.send).row();
  if (editUrl) keyboard.webApp("✏️ Formada tuzatish", editUrl).row();
  return keyboard.text("❌ Bekor qilish", LOAD_CALLBACKS.cancel);
}

// Raqam so'rash: oldin yozgan (yoki ulashgan) raqamlari — bir bosishda
export function phoneKeyboard(saved = []) {
  const keyboard = new InlineKeyboard();
  saved.slice(0, 3).forEach((phone, i) => keyboard.text(`📞 ${formatContactPhone(phone)}`, `yb:ph:${i}`).row());
  return keyboard.text("❌ Bekor qilish", LOAD_CALLBACKS.cancel);
}

// Yuborilgandan keyin (pipeline.js handleParsed natijasi) — yuk beruvchiga
export function resultText(outcome) {
  if (outcome.status === "failed") return `⚠️ Yukingizni yuborib bo'lmadi: ${escapeHtml(outcome.error ?? "xato")}. Birozdan keyin qayta urinib ko'ring.`;
  if (outcome.status !== "done") {
    if (outcome.reason === "route") return "⚠️ Yukingiz yuborilmadi: bu yo'nalish hozircha qo'llanmaydi.";
    return "⚠️ Yukingiz yuborilmadi.";
  }
  if (outcome.fresh === 0) {
    return "ℹ️ Bu yuk yaqinda allaqachon yuborilgan (yo'nalishi, og'irligi va raqami bir xil) — haydovchilar uni olgan, ikkinchi marta yuborilmadi.";
  }
  const stays = "Yuk 24 soat davomida haydovchilarning «📋 Mos yuklar» ro'yxatida ham turadi — keyin mos yo'nalishni tanlagan haydovchi ham ko'radi.";
  if (outcome.sent === 0) return `✅ Yukingiz qabul qilindi. Hozircha unga mos haydovchi topilmadi.\n${stays}`;
  const what = outcome.fresh > 1 ? `${outcome.fresh} ta yukingiz mos haydovchilarga yuborildi (jami ${outcome.sent} ta xabar)` : `Yukingiz ${outcome.sent} ta mos haydovchiga yuborildi`;
  return `✅ ${what}. Ular sizga o'zlari qo'ng'iroq qilishadi.\n${stays}`;
}

// Raqamni yozdi (yoki matn ichida raqam bor). → ["+998..."] (ko'pi bilan 2 ta)
export const phonesIn = (text) => extractPhones(String(text ?? "")).slice(0, 2);

// Qoralama bilan ishlash. parse(text) → parser natijasi ({ ok, postType, loads }) yoki null (AI band — main.js);
// store — @yuk/store; scope — yo'nalish doirasi; onQueued — navbatga tushdi (main.js: ishchini uyg'otadi).
// Hamma natija — «ko'rinish»: { text, keyboard?, stage? } — bot uni yuboradi (bot.js). Holat bazada (drivers.load_draft):
// bot qayta ishga tushsa ham, web forma («Formada tuzatish») ham shu qoralamani ko'radi
export function createLoadDesk({ store, parse, scope, now = Date.now, limit = SHIPPER_LOAD_LIMIT, onQueued = () => {}, editUrl = () => null }) {
  const fresh = (draft) => (draft && now() - (draft.at ?? 0) < DRAFT_TTL_MS ? draft : null);
  const current = (chatId) => fresh(store.loadDraft(chatId));
  const saved = (user) => (user?.loadPhones?.length ? user.loadPhones : user?.phone ? [user.phone] : []);

  // Tayyor yuklar bilan qoralama: raqam yo'q — so'raladi, bor — tasdiqlash
  function show(chatId, draft, user) {
    store.setLoadDraft(chatId, draft);
    if (draft.stage === "phone") return { text: LOAD_TEXT.askPhone, keyboard: phoneKeyboard(saved(user)), stage: "phone" };
    const url = draft.loads.length === 1 ? editUrl() : null;
    return { text: previewText(draft.loads, { more: draft.more ?? 0 }), keyboard: previewKeyboard({ editUrl: url }), stage: "confirm" };
  }

  const withPhones = (draft, phones) => ({ ...draft, stage: "confirm", loads: draft.loads.map((load) => ({ ...load, phones })) });

  return {
    current,

    // Yuk beruvchi chatga oddiy xabar yozdi. → ko'rinish
    async read(chatId, text, user) {
      const draft = current(chatId);
      // Raqam kutilyapti va raqam yozdi — o'sha qoralamaga
      if (draft?.stage === "phone") {
        const phones = phonesIn(text);
        if (phones.length) return show(chatId, withPhones(draft, phones), user);
        // Raqam emas, uzun matn — yangi yuk deb tushunamiz; qisqasi — «raqamni tushunmadim»
        if (text.trim().length < 25) return { text: LOAD_TEXT.badPhone, keyboard: phoneKeyboard(saved(user)), stage: "phone" };
      }
      if (store.shipperPostCount(chatId) >= limit) return { text: LOAD_TEXT.limit(limit) };
      const result = await parse(text);
      if (!result) return { text: LOAD_TEXT.busy() };
      if (result.ok && result.postType === "mashina_bor") return { text: LOAD_TEXT.truck };
      if (!result.ok || result.postType !== "yuk_bor" || !result.loads?.length) return { text: LOAD_TEXT.notLoad() };
      const inScope = result.loads.filter((load) => routeInScope(load, scope));
      if (!inScope.length) return { text: scopeText(result.loads, scope) };
      const loads = inScope.slice(0, MAX_DRAFT_LOADS);
      const next = { text: text.slice(0, 2000), loads, more: inScope.length - loads.length, at: now(), by: result.by ?? "ai" };
      // Parser raqamni matndan oladi (har yukka bir xil). Yo'q bo'lsa — so'raymiz
      const stage = loads.every((load) => load.phones?.length) ? "confirm" : "phone";
      return show(chatId, { ...next, stage }, user);
    },

    // Raqam tugmasi (oldin yozgani) → ko'rinish yoki null (qoralama yo'q)
    pickPhone(chatId, index, user) {
      const draft = current(chatId);
      const phone = saved(user)[index];
      if (!draft || draft.stage !== "phone" || !phone) return null;
      return show(chatId, withPhones(draft, [phone]), user);
    },

    // «✅ Yuborish». → { ok: true, id, loads } | { ok: false, reason: "stale" | "phone" | "limit" }
    send(chatId, user, { sender = null } = {}) {
      const draft = current(chatId);
      if (!draft) return { ok: false, reason: "stale" };
      if (draft.stage !== "confirm" || !draft.loads.every((load) => load.phones?.length)) return { ok: false, reason: "phone" };
      if (store.shipperPostCount(chatId) >= limit) return { ok: false, reason: "limit" };
      const { id } = store.addDirectPost({ chatId, text: draft.text, loads: draft.loads, via: "bot", sender });
      store.setLoadDraft(chatId, null);
      store.setLoadPhones(chatId, draft.loads[0].phones);
      onQueued();
      return { ok: true, id, loads: draft.loads };
    },

    cancel(chatId) {
      const had = Boolean(current(chatId));
      store.setLoadDraft(chatId, null);
      return had;
    },
  };
}
