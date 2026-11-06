// Haydovchini ro'yxatdan o'tkazish: savollar ketma-ketligi. Telegram'ga bog'liq emas — testda tekshiriladi.
// Har bir qadam: render (matn + tugmalar) va javobni qo'llash (tugma yoki yozilgan matn).
// Tugma ma'lumoti: "w:<qadam>:<qiymat>" (Telegram 64 baytgacha ruxsat beradi).
// Haydovchi bergan ma'lumotlar manbai: docs/haydovchi-suhbati.md (model, o'lcham, sig'im, yuklash eshiklari).
// Xorijiy davlatlar va "xalqaro" savoli yo'nalish doirasiga qarab (draft.scope — .env dagi ROUTE_SCOPE):
// qoshni — 5 ta chegaradosh davlat, ichki — davlat ham, xalqaro savoli ham yo'q, hammasi — umumiy "Xorij".
import {
  BODY_LIMITS,
  BODY_TYPES,
  CAPACITY_OPTIONS,
  DEFAULT_ROUTE_SCOPE,
  LOADING_SIDES,
  MODE_OPTIONS,
  REGIONS,
  SIDE_LABELS,
  TRUCK_CLASSES,
  intlChoices,
  intlLabel,
  regionLabel,
  scopeCountries,
  validRouteScope,
  vehiclePallets,
  vehicleVolumeM3,
} from "@yuk/shared";

export const STEPS = ["class", "body", "capacity", "size", "sides", "from", "to", "intl", "mode", "done"];
// Yuk beruvchi (rol "yuk_beruvchi"): yo'nalish va qanday mashina kerakligi — o'z mashinasi yo'q
export const SHIPPER_STEPS = ["from", "to", "classes", "bodies", "intl", "done"];

// "ichki" doirada xalqaro savoli yo'q
const stepsFor = (draft) => {
  const steps = draft.role === "yuk_beruvchi" ? SHIPPER_STEPS : STEPS;
  return intlChoices(draft.scope) ? steps : steps.filter((s) => s !== "intl");
};

// Yuk beruvchi tanlay oladigan kuzovlar: "Boshqa" ma'nosiz (e'londa kuzov aytilmasa, baribir mos keladi)
const SHIPPER_BODIES = BODY_TYPES.filter((b) => b.id !== "boshqa");

// scope — yo'nalish doirasi (@yuk/shared ROUTE_SCOPES). Qoralama bilan saqlanadi: savol-javob o'rtasida o'zgarmaydi.
// role — "haydovchi" (standart) yoki "yuk_beruvchi": savollar ro'yxati shunga qarab
export function newDraft(profile = null, scope = DEFAULT_ROUTE_SCOPE, role = "haydovchi") {
  if (role === "yuk_beruvchi") {
    return {
      role,
      scope: validRouteScope(scope),
      step: "from",
      fromAreas: [...(profile?.fromAreas ?? [])],
      toAreas: [...(profile?.toAreas ?? [])],
      domestic: profile?.domestic ?? true,
      international: profile?.international ?? false,
      truckClasses: [...(profile?.truckClasses ?? [])],
      bodyTypes: [...(profile?.bodyTypes ?? [])],
    };
  }
  if (profile) {
    return {
      scope: validRouteScope(scope),
      step: "class",
      vehicle: { loadingSides: [], ...structuredClone(profile.vehicle ?? {}) },
      fromAreas: [...(profile.fromAreas ?? [])],
      toAreas: [...(profile.toAreas ?? [])],
      domestic: profile.domestic ?? true,
      international: profile.international ?? false,
      mode: profile.mode ?? "own",
    };
  }
  return {
    scope: validRouteScope(scope),
    step: "class",
    vehicle: { truckClass: null, bodyType: null, capacityKg: null, body: null, loadingSides: [] },
    fromAreas: [],
    toAreas: [],
    domestic: true,
    international: false,
    mode: "own",
  };
}

const truckClass = (id) => TRUCK_CLASSES.find((t) => t.id === id);
const button = (text, step, value) => ({ text, data: `w:${step}:${value}` });
const rows = (buttons, perRow) => {
  const out = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
};
const formatT = (t) => String(t).replace(".", ",");
const nav = (step) => [button("⬅️ Orqaga", step, "back")];

// Viloyatlar + doiradagi davlatlar. "hammasi" doirasida davlatlar ko'p — bitta umumiy "Xorij" tugmasi
function areaOptions(scope) {
  const regions = REGIONS.filter((r) => r.id !== "xorij").map((r) => ({ id: r.id, label: regionLabel(r.id) }));
  const countries = scopeCountries(scope);
  if (countries.length === 0) return regions;
  if (validRouteScope(scope) === "hammasi") return [...regions, { id: "xorij", label: regionLabel("xorij") }];
  return [...regions, ...countries.map((name) => ({ id: name, label: `🌍 ${name}` }))];
}

// Bir nechtasini tanlash mumkin bo'lgan qadam: tugma bosilsa ✅ qo'yiladi/olinadi, "Tayyor" — keyingi qadam.
// field — qoralamadagi ro'yxat, options — [{ id, label }], emptyLabel — hech narsa tanlanmasa nimani bildiradi
function pickStep(step, draft, field, options, title, emptyLabel, perRow = 2) {
  const chosen = new Set(draft[field]);
  const buttons = options.map((o) => button(`${chosen.has(o.id) ? "✅ " : ""}${o.label}`, step, `t.${o.id}`));
  return {
    text: `${title}\n\nBir nechtasini tanlash mumkin. Hech birini tanlamasangiz — ${emptyLabel.toLowerCase()}.`,
    keyboard: [
      ...rows(buttons, perRow),
      [button(chosen.size ? "🧹 Tozalash" : `• ${emptyLabel}`, step, "all"), button("Tayyor ➡️", step, "ok")],
      nav(step),
    ],
  };
}

function regionStep(step, draft, title, emptyLabel) {
  return pickStep(step, draft, step === "from" ? "fromAreas" : "toAreas", areaOptions(draft.scope), title, emptyLabel);
}

// Tanlov qadamlari: qaysi maydon va qaysi qiymatlar ruxsat etilgan
const PICK_FIELDS = {
  from: { field: "fromAreas", ids: (d) => areaOptions(d.scope).map((a) => a.id) },
  to: { field: "toAreas", ids: (d) => areaOptions(d.scope).map((a) => a.id) },
  classes: { field: "truckClasses", ids: () => TRUCK_CLASSES.map((t) => t.id) },
  bodies: { field: "bodyTypes", ids: () => SHIPPER_BODIES.map((b) => b.id) },
};

// Qadamning matni va tugmalari: { text, keyboard: [[{ text, data }]] }
export function renderStep(draft) {
  const { step, vehicle } = draft;
  switch (step) {
    case "class":
      return {
        text: "🚚 Mashinangiz qaysi turdagi?",
        keyboard: rows(TRUCK_CLASSES.map((t) => button(`${t.name} (${formatT(t.capacityT[0])}–${formatT(t.capacityT[1])} t)`, step, t.id)), 1),
      };
    case "body":
      return {
        text: "📦 Kuzov turi qanaqa?",
        keyboard: [...rows(BODY_TYPES.map((b) => button(b.name, step, b.id)), 2), nav(step)],
      };
    case "capacity": {
      const options = CAPACITY_OPTIONS[vehicle.truckClass] ?? [];
      return {
        text: "⚖️ Necha tonna yuk ko'taradi?\n\nTugmani bosing yoki sonni yozib yuboring (masalan: 7,5).",
        keyboard: [rows(options.map((t) => button(`${formatT(t)} t`, step, t)), 5).flat(), nav(step)],
      };
    }
    case "size": {
      const standard = truckClass(vehicle.truckClass)?.body;
      const buttons = [button("O'tkazib yuborish", step, "skip")];
      if (standard) buttons.unshift(button(`Standart: ${standard.lengthM} × ${standard.widthM} × ${standard.heightM} m`, step, "std"));
      return {
        text:
          "📏 Kuzov ichki o'lchami: uzunligi, eni, balandligi (metr).\n\n" +
          "Yozib yuboring, masalan: 4.85 2.15 1.95\nBu kub va paletni hisoblash uchun kerak.",
        keyboard: [...rows(buttons, 1), nav(step)],
      };
    }
    case "sides": {
      const chosen = new Set(vehicle.loadingSides);
      const options = LOADING_SIDES.map((s) => button(`${chosen.has(s.id) ? "✅ " : ""}${SIDE_LABELS[s.id]}`, step, `t.${s.id}`));
      return {
        text:
          "↕️ Yukni qaysi tomondan yuklash mumkin?\n\n" +
          "Bir nechtasini tanlang. Chap va o'ng — mashinaga ORQASIDAN qaraganda.",
        keyboard: [...rows(options, 3), [button("Tayyor ➡️", step, "ok")], nav(step)],
      };
    }
    case "from":
      return draft.role === "yuk_beruvchi"
        ? regionStep(step, draft, "📍 Yukingiz qayerda yuklanadi? Shu yerdagi bo'sh mashinalarni yuboramiz.", "Hamma viloyat")
        : regionStep(step, draft, "📍 Qaysi viloyatlardan yuk olasiz?", "Hamma viloyat");
    case "to":
      return draft.role === "yuk_beruvchi"
        ? regionStep(step, draft, "🏁 Yuk qayerga boradi?", "Istalgan joy")
        : regionStep(step, draft, "🏁 Qayerga borasiz? (masalan, uyga qaytish yuki uchun)", "Istalgan joy");
    case "classes":
      return pickStep(
        step,
        draft,
        "truckClasses",
        TRUCK_CLASSES.map((t) => ({ id: t.id, label: `${t.name} (${formatT(t.capacityT[0])}–${formatT(t.capacityT[1])} t)` })),
        "🚚 Qanday mashina kerak?",
        "Istalgan mashina",
        1,
      );
    case "bodies":
      return pickStep(step, draft, "bodyTypes", SHIPPER_BODIES.map((b) => ({ id: b.id, label: b.name })), "📦 Qanday kuzov kerak?", "Istalgan kuzov");
    case "intl": {
      const choices = intlChoices(draft.scope);
      return {
        text: `🌍 ${choices.question}`,
        keyboard: [...rows(Object.entries(choices.options).map(([id, o]) => button(o.label, step, id)), 1), nav(step)],
      };
    }
    case "mode":
      return {
        text: "👁 Qaysi yuklarni yuboraylik?",
        keyboard: [...rows(Object.entries(MODE_OPTIONS).map(([id, label]) => button(label, step, id)), 1), nav(step)],
      };
    case "done":
      return {
        text: `Tekshiring:\n\n${describeProfile(profileFromDraft(draft), draft.scope, draft.role)}`,
        keyboard: [[button("✅ Saqlash", step, "save")], [button("✏️ Qaytadan", step, "restart")], nav(step)],
      };
    default:
      throw new Error(`Noma'lum qadam: ${step}`);
  }
}

const next = (step, draft) => {
  const steps = stepsFor(draft);
  return steps[steps.indexOf(step) + 1];
};
const prev = (step, draft) => {
  const steps = stepsFor(draft);
  return steps[Math.max(0, steps.indexOf(step) - 1)];
};

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// Tugma bosilganda. → { draft, saved?: true } — saved bo'lsa profil tayyor (profileFromDraft)
export function applyAction(draft, step, value) {
  // Eski xabardagi tugma bosilsa — hech narsa o'zgarmaydi, joriy qadam qayta ko'rsatiladi
  if (step !== draft.step) return { draft };
  const d = structuredClone(draft);
  if (value === "back") return { draft: { ...d, step: prev(step, d) } };

  switch (step) {
    case "class":
      if (!truckClass(value)) return { draft };
      if (d.vehicle.truckClass !== value) Object.assign(d.vehicle, { capacityKg: null, body: null });
      d.vehicle.truckClass = value;
      break;
    case "body":
      if (!BODY_TYPES.some((b) => b.id === value)) return { draft };
      d.vehicle.bodyType = value;
      break;
    case "capacity": {
      const tonnes = Number(value);
      if (!(tonnes > 0)) return { draft };
      d.vehicle.capacityKg = Math.round(tonnes * 1000);
      break;
    }
    case "size": {
      const standard = truckClass(d.vehicle.truckClass)?.body;
      if (value === "std" && standard) d.vehicle.body = { ...standard };
      else if (value === "skip") d.vehicle.body = null;
      else return { draft };
      break;
    }
    case "sides":
      if (value.startsWith("t.")) {
        d.vehicle.loadingSides = toggle(d.vehicle.loadingSides, value.slice(2));
        return { draft: d };
      }
      if (value !== "ok") return { draft };
      break;
    case "from":
    case "to":
    case "classes":
    case "bodies": {
      const { field, ids } = PICK_FIELDS[step];
      if (value.startsWith("t.")) {
        const id = value.slice(2);
        if (!ids(d).includes(id)) return { draft };
        d[field] = toggle(d[field], id);
        return { draft: d };
      }
      if (value === "all") {
        d[field] = [];
        return { draft: d };
      }
      if (value !== "ok") return { draft };
      break;
    }
    case "intl": {
      const option = intlChoices(d.scope)?.options[value];
      if (!option) return { draft };
      d.domestic = option.domestic;
      d.international = option.international;
      break;
    }
    case "mode":
      if (!MODE_OPTIONS[value]) return { draft };
      d.mode = value;
      break;
    case "done":
      if (value === "save") return { draft: d, saved: true };
      if (value === "restart") return { draft: newDraft(null, d.scope, d.role) };
      return { draft };
  }
  d.step = next(step, d);
  return { draft: d };
}

// "7,5" → 7.5 t; "7500 kg" yoki 7500 → 7.5 t (100 dan katta son — kilogramm deb olinadi)
export function parseCapacityT(text) {
  const match = String(text).replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  let value = Number(match[0]);
  if (/kg|кг/i.test(text) || value > 100) value /= 1000;
  return value >= 0.1 && value <= 60 ? Math.round(value * 1000) / 1000 : null;
}

// "4.85 2.15 1.95", "4,85x2,15x1,95", "13.6 × 2.45 × 2.7" → { lengthM, widthM, heightM }
export function parseBodySize(text) {
  const numbers = [...String(text).matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
  if (numbers.length !== 3) return null;
  const [lengthM, widthM, heightM] = numbers;
  const body = { lengthM, widthM, heightM };
  const ok = Object.entries(BODY_LIMITS).every(([key, [min, max]]) => body[key] >= min && body[key] <= max);
  return ok ? body : null;
}

// Haydovchi matn yozganda (sig'im va o'lcham qadamlarida). → { draft, error? }
export function applyText(draft, text) {
  const d = structuredClone(draft);
  if (d.step === "capacity") {
    const tonnes = parseCapacityT(text);
    if (tonnes == null) return { draft, error: "Sonni tushunmadim. Masalan: 7,5 yoki 24" };
    d.vehicle.capacityKg = Math.round(tonnes * 1000);
    d.step = next("capacity", d);
    return { draft: d };
  }
  if (d.step === "size") {
    const body = parseBodySize(text);
    if (!body) return { draft, error: "Uchta sonni yozing: uzunligi eni balandligi. Masalan: 4.85 2.15 1.95" };
    d.vehicle.body = body;
    d.step = next("size", d);
    return { draft: d };
  }
  return { draft, error: "Iltimos, tugmalardan birini bosing." };
}

// Qoralamadan @yuk/shared match.js tushunadigan haydovchi profili.
// Faqat O'zbekiston tanlansa, belgilangan xorijiy davlatlar tashlanadi (Mini App formasi ham shunday qiladi)
export function profileFromDraft(draft) {
  const { vehicle } = draft;
  const international = Boolean(intlChoices(draft.scope)) && draft.international;
  const domesticOnly = (list) => list.filter((id) => id !== "xorij" && REGIONS.some((r) => r.id === id));
  const areas = (list) => (international ? [...list] : domesticOnly(list));
  // Yuk beruvchi (@yuk/shared sanitizeShipperProfile ko'rinishida)
  if (draft.role === "yuk_beruvchi") {
    return {
      fromAreas: areas(draft.fromAreas),
      toAreas: areas(draft.toAreas),
      domestic: international ? draft.domestic : true,
      international,
      truckClasses: [...draft.truckClasses],
      bodyTypes: [...draft.bodyTypes],
    };
  }
  return {
    vehicle: {
      truckClass: vehicle.truckClass,
      bodyType: vehicle.bodyType === "boshqa" ? null : vehicle.bodyType,
      capacityKg: vehicle.capacityKg,
      body: vehicle.body ?? null,
      loadingSides: [...vehicle.loadingSides],
    },
    fromAreas: areas(draft.fromAreas),
    toAreas: areas(draft.toAreas),
    domestic: international ? draft.domestic : true,
    international,
    mode: draft.mode,
  };
}

// Yuk beruvchi profilining matni
export function describeShipperProfile(profile, scope = DEFAULT_ROUTE_SCOPE) {
  const list = (ids, name, empty) => (ids?.length ? ids.map(name).join(", ") : empty);
  const areas = (ids, empty) => list(ids, regionLabel, empty);
  return [
    `📍 Yuk qayerda: ${areas(profile.fromAreas, "hamma viloyat")}`,
    `🏁 Qayerga: ${areas(profile.toAreas, "istalgan joy")}`,
    `🚚 Mashina: ${list(profile.truckClasses, (id) => truckClass(id)?.name ?? id, "istalgan")}`,
    `📦 Kuzov: ${list(profile.bodyTypes, (id) => BODY_TYPES.find((b) => b.id === id)?.name ?? id, "istalgan")}`,
    `🌍 ${intlLabel(profile, scope)}`,
  ].join("\n");
}

// Profilni foydalanuvchiga ko'rsatish uchun matn. scope — "qo'shni davlatlar" / "xalqaro" yozuvi uchun,
// role — "yuk_beruvchi" bo'lsa yuk beruvchi profili
export function describeProfile(profile, scope = DEFAULT_ROUTE_SCOPE, role = "haydovchi") {
  if (role === "yuk_beruvchi") return describeShipperProfile(profile, scope);
  const v = profile.vehicle ?? {};
  const parts = [truckClass(v.truckClass)?.name ?? "—"];
  if (v.bodyType) parts.push(BODY_TYPES.find((b) => b.id === v.bodyType)?.name ?? v.bodyType);
  if (v.capacityKg) parts.push(`${formatT(v.capacityKg / 1000)} t`);
  const volume = vehicleVolumeM3(v);
  const size = v.body
    ? `\n📏 Kuzov: ${v.body.lengthM} × ${v.body.widthM} × ${v.body.heightM} m (${formatT(volume)} kub, ${vehiclePallets(v)} palet)`
    : "";
  const sides = v.loadingSides?.length ? v.loadingSides.map((s) => SIDE_LABELS[s].toLowerCase()).join(", ") : "aytilmagan";
  const areas = (list, empty) => (list?.length ? list.map(regionLabel).join(", ") : empty);
  return [
    `🚚 Mashina: ${parts.join(", ")}${size}`,
    `↕️ Yuklash: ${sides}`,
    `📍 Qayerdan: ${areas(profile.fromAreas, "hamma viloyat")}`,
    `🏁 Qayerga: ${areas(profile.toAreas, "istalgan joy")}`,
    `🌍 ${intlLabel(profile, scope)}`,
    `👁 ${MODE_OPTIONS[profile.mode] ?? MODE_OPTIONS.own}`,
  ].join("\n");
}
