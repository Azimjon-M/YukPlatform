// «📋 Mos yuklar» bosilganda yo'nalish so'raladi: avval «Qayerdan?», keyin «Qayerga?» (Azimjon, 2026-11-07).
// Yo'nalish ro'yxatdan o'tishda emas, shu yerda (va web'dagi «📋 Yuklar» bo'limida) tanlanadi: haydovchi har kuni boshqa joyda bo'ladi.
// Tanlangan yo'nalish eslab qolinadi (profile.routeAt) — yangi yuklar ham shu yo'nalish bo'yicha keladi; tanlamaguncha
// bot unga yuk yubormaydi (aks holda butun O'zbekistondagi yuklar kelardi).
// Joylar — @yuk/shared route.js (web server ham shundan); bu yerda faqat Telegram tugmalari va matnlari.
// Tugmalarda yuklar soni YO'Q (Azimjon, 2026-11-10; 2026-11-07…10 da «Farg'ona vil. (12)» edi — web'da hali bor).
// Strelka yuk qaysi tomonga ketishini bildiradi (Azimjon, 2026-11-10): «Qayerdan?» da — «Farg'ona vil. →» (olib ketish),
// «Qayerga?» da — «→ Toshkent vil.» (olib kelish).
// «Qayerdan?» da «🌐 Hamma joydan» YO'Q (Azimjon, 2026-11-10: «birdaniga hamma joyda paydo bo'lib qola olmaydi»).
// Uning o'rnida — «🗺 Xaritadan tanlash»: web ilovadagi xarita (Mini App, inline web_app tugmasi). Xaritada ham
// avval «Qayerdan?», keyin «Qayerga?»; «Qayerga?» qadamidagi xarita tugmasi tanlangan «Qayerdan» bilan ochiladi.
// Xaritada saqlangach, bot shu xabarni «✅ Yo'nalish: …» ga almashtiradi va mos yuklarni yuboradi (bot.js, bot_notices).
// Telegram'ga bog'liq emas — testda tekshiriladi. Tugma ma'lumoti: "mr:f:<joy>", "mr:t:<qayerdan>:<qayerga>";
// xarita tugmasi — { text, webApp: url } (url yo'q — https Mini App manzili yo'q — tugma ham yo'q).
// Har safar ikkala qadam ham so'raladi; hozirgi tanlov ✅ bilan belgilanadi. Avval «Qayerdan?» ning tepasida
// «🔁 Samarqand vil. → istalgan joy» (oxirgi yo'nalish) tugmasi bor edi — Azimjon uni «Samarqand» deb bosdi va «Qayerga?»
// so'ralmay eski «istalgan joy» qo'llandi (2026-11-09), shuning uchun olib tashlandi. "mr:last" — faqat chatda qolgan eski tugmalar uchun.
// "mr:f:*" (eski «Hamma joydan» tugmasi) chatda qolgan bo'lsa ham ishlayveradi.
import { ROUTE_ANY, routeAreas, routeChosen, routeLabel, routeSide } from "@yuk/shared";

export { ROUTE_ANY as ANY, applyRoute, routeAreas, validRouteArea as validArea } from "@yuk/shared";

export const MAP_BUTTON = "🗺 Xaritadan tanlash";

const button = (text, data) => ({ text, data });
const chunk = (buttons, perRow) => {
  const out = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
};
// Hozir tanlangan joy — "✅ Samarqand vil. →"
const mark = (label, on) => (on ? `✅ ${label}` : label);
const outOf = (label) => `${label} →`; // yuk shu yerdan olib ketiladi
const into = (label) => `→ ${label}`; // yuk shu yerga olib boriladi
const mapRow = (url) => (url ? [[{ text: MAP_BUTTON, webApp: url }]] : []);

// «📍 Qayerdan yuk olasiz?» — mapUrl: xarita sahifasi (yoki null)
export function fromStep({ profile, scope, mapUrl = null }) {
  const current = routeSide(profile, "from"); // "samarqand" | "*" | null (hali tanlanmagan yoki eski forma — bir nechta joy)
  const now = routeChosen(profile) ? `Hozirgi yo'nalish: <b>${routeLabel(profile)}</b>\n` : "";
  return {
    text:
      "📍 <b>Qayerdan yuk olasiz?</b>\n" + now + "Hozir turgan yoki yuk olmoqchi bo'lgan joyni tanlang, keyin «Qayerga?» so'raladi.",
    keyboard: [
      ...chunk(routeAreas(profile, scope).map((a) => button(mark(outOf(a.label), a.id === current), `mr:f:${a.id}`)), 2),
      ...mapRow(mapUrl),
    ],
  };
}

// «📍 Qayerga yuk olib bormoqchisiz? 🏁» (Azimjon matni, 2026-11-10) — from tanlangach.
// ✅ — faqat o'sha «Qayerdan» qayta tanlanganda (web RoutePicker ham shunday). mapUrl — xarita «Qayerga?» qadamida ochiladi
export function toStep({ profile, scope, from, mapUrl = null }) {
  const current = routeSide(profile, "from") === from ? routeSide(profile, "to") : null;
  return {
    text: "📍 <b>Qayerga yuk olib bormoqchisiz?</b> 🏁",
    keyboard: [
      ...chunk(routeAreas(profile, scope).map((a) => button(mark(into(a.label), a.id === current), `mr:t:${from}:${a.id}`)), 2),
      [button(mark(into("🌐 Istalgan joyga"), current === ROUTE_ANY), `mr:t:${from}:${ROUTE_ANY}`)],
      ...mapRow(mapUrl),
      [button("⬅️ Orqaga", "mr:back")],
    ],
  };
}

// Tanlangandan keyin: "✅ Yo'nalish: Toshkent sh. → istalgan joy"
export function chosenText(profile) {
  return `✅ Yo'nalish: <b>${routeLabel(profile)}</b>\nYangi mos yuklar ham shu yo'nalish bo'yicha keladi. Almashtirish — yana «📋 Mos yuklar».`;
}
