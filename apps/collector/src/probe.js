// Foydalanuvchi qo'shgan guruh/kanalni darhol ko'rib chiqish (2026-11-10). Bot havolani qabul qilgach manba «probe»
// holatida turadi; collector guruhning oxirgi 50 ta xabarini BITTA so'rov bilan o'qiydi (tarixni ochiq guruhda hamma
// o'qiy oladi, a'zo bo'lish shart emas) va shu yerda baho beradi — AI'siz, @yuk/parser looksLikeLoad bilan.
// Nega: 24 soatlik sinovni kutmasdan suhbat guruhi, yangiliklar kanali yoki o'lik guruhni darhol rad etish
// (ular sinov davomida AI kvotasini va Telegram so'rovlarini behuda yerdi), «yuk berilmaydigan payt» ga tushib qolsa
// ham adolatli: bir soatlik kuzatish emas, guruhning o'tmishiga qaraladi.
import { hasContact, looksLikeLoad } from "@yuk/parser/rules";

const DAY = 24 * 60 * 60 * 1000;

export const PROBE = {
  limit: 50, // nechta oxirgi xabar o'qiladi
  minLoadLike: 3, // shundan kam yuk e'loniga o'xshasa — rad etiladi
  deadAfterMs: 7 * DAY, // oxirgi xabar shundan eski bo'lsa — guruh o'lik
};

const dayText = (time) =>
  new Date(time).toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric" });

// messages — reader.since natijasi [{ id, text, date (soniya), sender }] (eskisidan yangisiga); now — ms.
// requireContact — faqat aloqasi bor yuk e'lonlari sanaladi (telefon raqami yoki yozgan odamning username'i —
// @yuk/parser hasContact): bot aloqasiz e'lonni baribir hech kimga yubormaydi (apps/bot pipeline.js NO_CONTACT,
// .env REQUIRE_CONTACT). Masalan, GLogistics / Targo.uz e'lonlari guruhi: hammasi yukka o'xshaydi, lekin aloqa — saytda.
// → { ok, note (foydalanuvchiga va boshqaruv markaziga), stats: { messages, texts, loadLike, withContact, loadLikeDay, lastAt } }
export function judgeProbe(
  messages,
  { now, limit = PROBE.limit, minLoadLike = PROBE.minLoadLike, deadAfterMs = PROBE.deadAfterMs, requireContact = true } = {},
) {
  const texts = messages.filter((m) => (m.text ?? "").trim().length >= 20);
  const looks = texts.filter((m) => looksLikeLoad(m.text));
  const loadLike = requireContact ? looks.filter((m) => hasContact(m)) : looks;
  const lastAt = messages.length ? Math.max(...messages.map((m) => m.date * 1000)) : null;
  const stats = {
    messages: messages.length,
    texts: texts.length,
    loadLike: looks.length,
    withContact: looks.filter((m) => hasContact(m)).length,
    loadLikeDay: loadLike.filter((m) => m.date * 1000 >= now - DAY).length,
    lastAt,
  };
  const shown = Math.min(messages.length, limit);
  if (!messages.length) return { ok: false, note: "Guruhda birorta ham xabar topilmadi", stats };
  if (now - lastAt > deadAfterMs) {
    return { ok: false, note: `Guruhda ${Math.round(deadAfterMs / DAY)} kundan beri xabar yo'q (oxirgisi ${dayText(lastAt)} da)`, stats };
  }
  if (loadLike.length < minLoadLike && looks.length >= minLoadLike) {
    const note = loadLike.length
      ? `Oxirgi ${shown} ta xabaridagi ${looks.length} ta yuk e'lonidan faqat ${loadLike.length} tasida telefon raqami yoki yozgan odamning lichkasi bor`
      : `Oxirgi ${shown} ta xabaridagi ${looks.length} ta yuk e'lonining birortasida ham telefon raqami yoki yozgan odamning lichkasi yo'q`;
    return { ok: false, note, stats };
  }
  if (loadLike.length < minLoadLike) {
    const note = loadLike.length
      ? `Oxirgi ${shown} ta xabaridan faqat ${loadLike.length} tasi yuk e'loniga o'xshaydi`
      : `Oxirgi ${shown} ta xabaridan birortasi ham yuk e'loniga o'xshamaydi`;
    return { ok: false, note, stats };
  }
  return { ok: true, note: `Oxirgi ${shown} ta xabaridan ${loadLike.length} tasi yuk e'loniga o'xshaydi`, stats };
}

// Telegram «bunday guruh yo'q / yopiq» xatolari — qayta urinish befoyda
export const MISSING_ERROR = /USERNAME_NOT_OCCUPIED|USERNAME_INVALID|CHANNEL_PRIVATE|CHANNEL_INVALID|CHAT_FORBIDDEN|No user has|Cannot find any entity/i;

// --- Yopiq guruh (2026-11-16, Azimjon: «Agar yopiq guruh yuk e'lonlariga tegishli bo'lsa … oddiy gaplashgan va o'rtada
// haydovchilar e'lonni xabar qilgan ham bo'lishi mumkin, yaxshiroq tekshir … 24 soatlik test sinovi qilmasdan to'g'ridan
// to'g'ri qo'sh») ---
// Yopiq guruhda gap-so'z ko'p, e'lon orada-orada keladi va ko'pincha telefonsiz (yozgan odamning o'zi aloqa). Shuning uchun
// ochiq guruhdagi bahodan farqi: 100 ta xabar o'qiladi, aloqa talab qilinmaydi, jimlik rad sababi emas (istalgan payt
// e'lon tushishi mumkin), guruh nomi va yuk so'zlari ham hisobga olinadi. O'tsa — sinovsiz, darhol doimiy manba.
export const CLOSED_PROBE = { limit: 100 };

// Guruh nomida yuk tashishga oid so'z (lotin va kirill): «ISUZU 2020…», «Кукон ISUZU ва KIA юк ташиш», «… LABO CHANGAN».
// So'z chegarasi \b emas, (?<!\p{L}) … (?!\p{L}) bilan: JS'da \b faqat lotin harflarini taniydi («\bкия\b» hech qachon topilmasdi)
const CARGO_TITLE =
  /yuk|юк|груз|gruz|fura|фура|isuz|исуз|labo|лабо|damas|дамас|kamaz|камаз|gazel|газел|dostavka|доставка|logist|логист|tashish|ташиш|perevoz|перевоз|tentofka|тентовк|sprint|спринт|porter|портер|bongo|бонго|hyundai|хундай|(?<!\p{L})(?:kia|кия)(?!\p{L})|haydovch|ҳайдовч|хайдовч|shofer|шофер|шофё|шафё|truck|cargo|petak|петак|reys|рейс/iu;
// Yo'lovchi taksisi — yuk guruhi emas (manzil + telefon bo'lgani uchun e'lonlari yukka o'xshab qolishi mumkin)
const TAXI_TITLE = /taks|taxi|такси/i;
// Xabarda yuk ishiga oid so'z — e'lon bo'lmasa ham (haydovchilar gaplashyapti: «fura bo'shadi», «ertaga zagruzka bor»)
const CARGO_WORDS =
  /yuk|юк|груз|gruz|fura|фура|isuz|исуз|labo|лабо|damas|дамас|kamaz|камаз|gazel|газел|tent|тент|refri|реф|tonna|тонн|kub|куб|zagruz|загруз|vigruz|выгруз|plashatka|площадк|sprinter|спринтер|porter|портер|dostavka|доставк|perevoz|перевоз|reys|рейс|mashina kerak|машина керак|mashina bor|машина бор/i;

const TAXI_MIN_LOADS = 3;

// Yopiq KANAL — gap-so'z yo'q, faqat egasi yozadi: yangiliklar kanalida ham ba'zan yuk e'loni chiqadi
// («Surxondaryoliklar.Uz | Расмий»: 100 tadan 5 tasi, 2026-11-16). Kanal — e'lonlar matnlarning kamida 30% i bo'lsa
// (nomida yuk so'zi bo'lsa — 15%), kamida 3 ta
const CHANNEL_SHARE = 0.3;
const CHANNEL_SHARE_TITLED = 0.15;
const CHANNEL_MIN_LOADS = 3;

// messages — reader.since [{ id, text, date, sender }]; title — guruh nomi; channel — kanal (guruh emas).
// → { ok, note, stats } (judgeProbe bilan bir xil shakl)
export function judgeClosed(messages, { now, title = "", channel = false, limit = CLOSED_PROBE.limit } = {}) {
  const texts = messages.filter((m) => (m.text ?? "").trim().length >= 10);
  const looks = texts.filter((m) => (m.text ?? "").trim().length >= 20 && looksLikeLoad(m.text));
  const talk = texts.filter((m) => CARGO_WORDS.test(m.text));
  const lastAt = messages.length ? Math.max(...messages.map((m) => m.date * 1000)) : null;
  const titleHit = CARGO_TITLE.test(title ?? "");
  const taxi = TAXI_TITLE.test(title ?? "");
  const stats = {
    messages: messages.length,
    texts: texts.length,
    loadLike: looks.length,
    withContact: looks.filter((m) => hasContact(m)).length,
    loadLikeDay: looks.filter((m) => m.date * 1000 >= now - DAY).length,
    cargoTalk: talk.length,
    titleHit,
    lastAt,
  };
  const shown = Math.min(messages.length, limit);
  const quiet = lastAt != null && now - lastAt > PROBE.deadAfterMs ? ` Guruh hozir jim (oxirgi xabar ${dayText(lastAt)} da), lekin kuzatiladi.` : "";
  const why = [
    looks.length ? `${looks.length} ta yuk e'loni` : null,
    talk.length ? `${talk.length} ta xabarda yuk ishi haqida gap` : null,
    titleHit ? "nomida yuk tashishga oid so'z" : null,
  ]
    .filter(Boolean)
    .join(", ");
  let ok;
  const share = texts.length ? looks.length / texts.length : 0;
  if (channel) ok = looks.length >= CHANNEL_MIN_LOADS && share >= (titleHit ? CHANNEL_SHARE_TITLED : CHANNEL_SHARE);
  else if (taxi) ok = looks.length >= TAXI_MIN_LOADS && talk.length >= TAXI_MIN_LOADS;
  else ok = looks.length >= 2 || (looks.length >= 1 && (titleHit || talk.length >= 3)) || (titleHit && talk.length >= 5);
  if (!messages.length) return { ok: false, note: "Guruhda birorta ham xabar topilmadi", stats };
  if (ok) return { ok: true, note: `Yuk ${channel ? "kanali" : "guruhi"}: oxirgi ${shown} ta xabarda ${why}.${quiet}`, stats };
  return {
    ok: false,
    note: why
      ? `Yuk ${channel ? "kanaliga" : "guruhiga"} o'xshamaydi: oxirgi ${shown} ta xabarda faqat ${why}${channel ? ` (kanalda yuk e'lonlari asosiy bo'lishi kerak)` : taxi ? " (taksi guruhi)" : ""}`
      : `Oxirgi ${shown} ta xabarda yuk haqida hech narsa yo'q`,
    stats,
  };
}
