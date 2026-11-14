// Profilni odamga ko'rsatish: qatorlar ro'yxati. Bot ularni matn qilib yozadi ("✅ Saqlandi" xabari),
// web ilova esa ro'yxatdan o'tishning «Tasdiqlash» qadamida jadval qilib chizadi (har qatorda «O'zgartirish»).
// Har qator: { id, icon, label, value } — id bo'yicha web qaysi qadamga qaytishni biladi; label null bo'lsa — faqat qiymat.
import { BODY_TYPES, TRUCK_CLASSES, bodyId, countsPallets, manyClasses, needsSides, vehicleClasses } from "./vehicles.js";
import { vehiclePallets, vehicleVolumeM3 } from "./match.js";
import { SIDE_LABELS, intlChoices, intlLabel, regionLabel, routeChosen } from "./profile.js";
import { weightText } from "./loadText.js";
import { DEFAULT_ROUTE_SCOPE } from "./scope.js";

const formatT = (t) => String(t).replace(".", ",");
const className = (id) => TRUCK_CLASSES.find((t) => t.id === id)?.name ?? id;
const bodyName = (id) => BODY_TYPES.find((b) => b.id === bodyId(id))?.name ?? id;
const list = (ids, name, empty) => (ids?.length ? ids.map(name).join(", ") : empty);
const areas = (ids, empty) => list(ids, regionLabel, empty);

// "ichki" doirada xalqaro savoli yo'q — u qator ham ko'rsatilmaydi (web'da), bot esa baribir yozadi (eski matn)
function intlRow(profile, scope) {
  return { id: "intl", icon: "🌍", label: null, value: intlLabel(profile, scope) };
}

// Haydovchining yo'nalishi («📋 Mos yuklar» da tanlanadi): "Toshkent sh. → istalgan joy"
export function routeLabel(profile) {
  return `${areas(profile?.fromAreas, "hamma joy")} → ${areas(profile?.toAreas, "istalgan joy")}`;
}

// "13,6 × 2,45 × 2,7 m (≈ 89,3 kub, 33 palet)"
export function bodySizeText(vehicle) {
  const b = vehicle?.body;
  if (!b) return null;
  const pallets = countsPallets(vehicle.bodyType) ? vehiclePallets(vehicle) : null;
  const extra = [`≈ ${formatT(vehicleVolumeM3(vehicle))} kub`, pallets ? `${pallets} palet` : null].filter(Boolean).join(", ");
  return `${formatT(b.lengthM)} × ${formatT(b.widthM)} × ${formatT(b.heightM)} m (${extra})`;
}

// Haydovchi: transport, kuzov o'lchami (bo'lsa), yuklash tomoni, hudud, yo'nalish (route: false — yo'nalishsiz)
export function driverProfileRows(profile, scope = DEFAULT_ROUTE_SCOPE, { route = true } = {}) {
  const v = profile?.vehicle ?? {};
  // Bir nechta transport — faqat nomlari (kuzov va sig'im so'ralmagan)
  const parts = [list(vehicleClasses(v), className, "—")];
  if (v.bodyType) parts.push(bodyName(v.bodyType));
  if (v.capacityKg) parts.push(weightText(v.capacityKg / 1000));
  const rows = [{ id: "vehicle", icon: "🚚", label: "Transport", value: parts.join(", ") }];
  if (v.body) {
    rows.push({ id: "size", icon: "📏", label: "Kuzov", value: `${bodySizeText(v)}${v.bodyGuess ? " — odatdagi o'lcham" : ""}` });
  }
  if (!manyClasses(v) && needsSides(v.truckClass, v.bodyType)) {
    const sides = v.loadingSides?.length ? v.loadingSides.map((s) => SIDE_LABELS[s]?.toLowerCase() ?? s).join(", ") : "aytilmagan";
    rows.push({ id: "sides", icon: "↕️", label: "Yuklash", value: sides });
  }
  rows.push(intlRow(profile, scope));
  if (route) {
    const value = routeChosen(profile) ? routeLabel(profile) : "tanlanmagan — «📋 Mos yuklar» da tanlaysiz";
    rows.push({ id: "route", icon: "📍", label: "Yo'nalish", value });
  }
  return rows;
}

// Yuk beruvchi: yuk qayerda va qayerga, qanday transport va kuzov kerak
export function shipperProfileRows(profile, scope = DEFAULT_ROUTE_SCOPE) {
  return [
    { id: "from", icon: "📍", label: "Yuk qayerda", value: areas(profile?.fromAreas, "hamma viloyat") },
    { id: "to", icon: "🏁", label: "Qayerga", value: areas(profile?.toAreas, "istalgan joy") },
    { id: "classes", icon: "🚚", label: "Transport", value: list(profile?.truckClasses, className, "istalgan") },
    { id: "bodies", icon: "📦", label: "Kuzov", value: list(profile?.bodyTypes, bodyName, "istalgan") },
    intlRow(profile, scope),
  ];
}

// role — "yuk_beruvchi" bo'lsa yuk beruvchi profili, aks holda haydovchi.
// web: true — ro'yxatdan o'tish formasi uchun: "ichki" doirada 🌍 qatori va haydovchining yo'nalishi (formada yo'q) tashlanadi
export function profileRows(profile, scope = DEFAULT_ROUTE_SCOPE, role = "haydovchi", { web = false } = {}) {
  const rows = role === "yuk_beruvchi" ? shipperProfileRows(profile, scope) : driverProfileRows(profile, scope, { route: !web });
  return web && !intlChoices(scope) ? rows.filter((r) => r.id !== "intl") : rows;
}

// Bot xabari uchun matn: "🚚 Transport: Isuzu, Tent / furgon, 5 tonna\n🌍 ..."
export function describeProfile(profile, scope = DEFAULT_ROUTE_SCOPE, role = "haydovchi") {
  return profileRows(profile, scope, role)
    .map((r) => `${r.icon} ${r.label ? `${r.label}: ` : ""}${r.value}`)
    .join("\n");
}

export const describeShipperProfile = (profile, scope = DEFAULT_ROUTE_SCOPE) => describeProfile(profile, scope, "yuk_beruvchi");
