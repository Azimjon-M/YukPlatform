// «📋 Mos yuklar» bosilganda yo'nalish so'raladi: avval «Qayerdan?», keyin «Qayerga?» (Azimjon, 2026-11-07).
// Yo'nalish ro'yxatdan o'tishda emas, shu yerda (va web'dagi «📋 Yuklar» bo'limida) tanlanadi: haydovchi har kuni boshqa joyda bo'ladi.
// Tanlangan yo'nalish eslab qolinadi (profile.routeAt) — yangi yuklar ham shu yo'nalish bo'yicha keladi; tanlamaguncha
// bot unga yuk yubormaydi (aks holda butun O'zbekistondagi yuklar kelardi).
// Joylar va sonlar — @yuk/shared route.js (web server ham shundan); bu yerda faqat Telegram tugmalari va matnlari.
// Har tugmada — oxirgi 24 soatdagi mos yuklar soni (qayerda yuk ko'pligi bir qarashda ko'rinadi).
// Telegram'ga bog'liq emas — testda tekshiriladi. Tugma ma'lumoti: "mr:f:<joy>", "mr:t:<qayerdan>:<qayerga>", "mr:last".
import { ROUTE_ANY, routeAreaLabel, routeChosen, routeCounts, routeLabel } from "@yuk/shared";

export { ROUTE_ANY as ANY, applyRoute, routeAreas, validRouteArea as validArea } from "@yuk/shared";

const button = (text, data) => ({ text, data });
const chunk = (buttons, perRow) => {
  const out = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
};
const withCount = (label, n) => (n ? `${label} (${n})` : label);

// «📍 Qayerdan yuk olasiz?» — rows: store.recentLoads()
export function fromStep({ profile, scope, rows }) {
  const { areas, any } = routeCounts({ profile, scope, rows });
  const keyboard = [];
  if (routeChosen(profile)) keyboard.push([button(`🔁 ${routeLabel(profile)}`, "mr:last")]);
  keyboard.push(
    ...chunk(areas.map((a) => button(withCount(a.label, a.count), `mr:f:${a.id}`)), 2),
    [button(withCount("🌐 Hamma joydan", any), `mr:f:${ROUTE_ANY}`)],
  );
  return {
    text:
      "📍 <b>Qayerdan yuk olasiz?</b>\n" +
      "Hozir turgan yoki yuk olmoqchi bo'lgan joyni tanlang. Qavs ichida — oxirgi 24 soatdagi mos yuklar soni.",
    keyboard,
  };
}

// «🏁 Qayerga borasiz?» — from tanlangach
export function toStep({ profile, scope, rows, from }) {
  const { areas, any } = routeCounts({ profile, scope, rows, from });
  const fromText = routeAreaLabel(profile, scope, from) ?? "hamma joy";
  return {
    text: `📍 Qayerdan: <b>${fromText}</b>\n🏁 <b>Qayerga borasiz?</b>\nUyga qaytish yuki kerak bo'lsa — o'z viloyatingizni tanlang.`,
    keyboard: [
      ...chunk(areas.map((a) => button(withCount(a.label, a.count), `mr:t:${from}:${a.id}`)), 2),
      [button(withCount("🌐 Istalgan joyga", any), `mr:t:${from}:${ROUTE_ANY}`)],
      [button("⬅️ Orqaga", "mr:back")],
    ],
  };
}

// Tanlangandan keyin: "✅ Yo'nalish: Toshkent sh. → istalgan joy"
export function chosenText(profile) {
  return `✅ Yo'nalish: <b>${routeLabel(profile)}</b>\nYangi mos yuklar ham shu yo'nalish bo'yicha keladi. Almashtirish — yana «📋 Mos yuklar».`;
}
