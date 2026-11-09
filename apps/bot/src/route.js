// «📋 Mos yuklar» bosilganda yo'nalish so'raladi: avval «Qayerdan?», keyin «Qayerga?» (Azimjon, 2026-11-07).
// Yo'nalish ro'yxatdan o'tishda emas, shu yerda (va web'dagi «📋 Yuklar» bo'limida) tanlanadi: haydovchi har kuni boshqa joyda bo'ladi.
// Tanlangan yo'nalish eslab qolinadi (profile.routeAt) — yangi yuklar ham shu yo'nalish bo'yicha keladi; tanlamaguncha
// bot unga yuk yubormaydi (aks holda butun O'zbekistondagi yuklar kelardi).
// Joylar va sonlar — @yuk/shared route.js (web server ham shundan); bu yerda faqat Telegram tugmalari va matnlari.
// Har tugmada — oxirgi 24 soatdagi mos yuklar soni (qayerda yuk ko'pligi bir qarashda ko'rinadi).
// Telegram'ga bog'liq emas — testda tekshiriladi. Tugma ma'lumoti: "mr:f:<joy>", "mr:t:<qayerdan>:<qayerga>".
// Har safar ikkala qadam ham so'raladi; hozirgi tanlov ✅ bilan belgilanadi. Avval «Qayerdan?» ning tepasida
// «🔁 Samarqand vil. → istalgan joy» (oxirgi yo'nalish) tugmasi bor edi — Azimjon uni «Samarqand» deb bosdi va «Qayerga?»
// so'ralmay eski «istalgan joy» qo'llandi (2026-11-09), shuning uchun olib tashlandi. "mr:last" — faqat chatda qolgan eski tugmalar uchun.
import { ROUTE_ANY, routeAreaLabel, routeChosen, routeCounts, routeLabel, routeSide } from "@yuk/shared";

export { ROUTE_ANY as ANY, applyRoute, routeAreas, validRouteArea as validArea } from "@yuk/shared";

const button = (text, data) => ({ text, data });
const chunk = (buttons, perRow) => {
  const out = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
};
const withCount = (label, n) => (n ? `${label} (${n})` : label);
// Hozir tanlangan joy — "✅ Samarqand vil. (5)"
const mark = (label, on) => (on ? `✅ ${label}` : label);

// «📍 Qayerdan yuk olasiz?» — rows: store.recentLoads()
export function fromStep({ profile, scope, rows }) {
  const { areas, any } = routeCounts({ profile, scope, rows });
  const current = routeSide(profile, "from"); // "samarqand" | "*" | null (hali tanlanmagan yoki eski forma — bir nechta joy)
  const now = routeChosen(profile) ? `Hozirgi yo'nalish: <b>${routeLabel(profile)}</b>\n` : "";
  return {
    text:
      "📍 <b>Qayerdan yuk olasiz?</b>\n" +
      now +
      "Hozir turgan yoki yuk olmoqchi bo'lgan joyni tanlang, keyin «Qayerga?» so'raladi. Qavs ichida — oxirgi 24 soatdagi mos yuklar soni.",
    keyboard: [
      ...chunk(areas.map((a) => button(mark(withCount(a.label, a.count), a.id === current), `mr:f:${a.id}`)), 2),
      [button(mark(withCount("🌐 Hamma joydan", any), current === ROUTE_ANY), `mr:f:${ROUTE_ANY}`)],
    ],
  };
}

// «🏁 Qayerga borasiz?» — from tanlangach. ✅ — faqat o'sha «Qayerdan» qayta tanlanganda (web RoutePicker ham shunday)
export function toStep({ profile, scope, rows, from }) {
  const { areas, any } = routeCounts({ profile, scope, rows, from });
  const fromText = routeAreaLabel(profile, scope, from) ?? "hamma joy";
  const current = routeSide(profile, "from") === from ? routeSide(profile, "to") : null;
  return {
    text: `📍 Qayerdan: <b>${fromText}</b>\n🏁 <b>Qayerga borasiz?</b>\nUyga qaytish yuki kerak bo'lsa — o'z viloyatingizni tanlang.`,
    keyboard: [
      ...chunk(areas.map((a) => button(mark(withCount(a.label, a.count), a.id === current), `mr:t:${from}:${a.id}`)), 2),
      [button(mark(withCount("🌐 Istalgan joyga", any), current === ROUTE_ANY), `mr:t:${from}:${ROUTE_ANY}`)],
      [button("⬅️ Orqaga", "mr:back")],
    ],
  };
}

// Tanlangandan keyin: "✅ Yo'nalish: Toshkent sh. → istalgan joy"
export function chosenText(profile) {
  return `✅ Yo'nalish: <b>${routeLabel(profile)}</b>\nYangi mos yuklar ham shu yo'nalish bo'yicha keladi. Almashtirish — yana «📋 Mos yuklar».`;
}
