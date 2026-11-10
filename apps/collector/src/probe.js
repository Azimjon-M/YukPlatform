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
