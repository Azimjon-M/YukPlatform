// Haydovchini ro'yxatdan o'tkazish: savollar ketma-ketligi. Telegram'ga bog'liq emas — testda tekshiriladi.
// Har bir qadam: render (matn + tugmalar) va javobni qo'llash (tugma yoki yozilgan matn).
// Tugma ma'lumoti: "w:<qadam>:<qiymat>" (Telegram 64 baytgacha ruxsat beradi).
// Haydovchi bergan ma'lumotlar manbai: docs/haydovchi-suhbati.md (model, o'lcham, sig'im, yuklash eshiklari).
// Xorijiy davlatlar va "xalqaro" savoli yo'nalish doirasiga qarab (draft.scope — .env dagi ROUTE_SCOPE):
// qoshni — 5 ta chegaradosh davlat, ichki — davlat ham, xalqaro savoli ham yo'q, hammasi — umumiy "Xorij".
// Haydovchining yo'nalishi bu yerda so'ralmaydi (2026-11-07) — u «📋 Mos yuklar» da tanlanadi (route.js).
import {
  BODY_LIMITS,
  BODY_TYPES,
  CAPACITY_OPTIONS,
  DEFAULT_ROUTE_SCOPE,
  FORM_SIDES,
  REGIONS,
  SIDE_LABELS,
  TRUCK_CLASSES,
  capacityRangeText,
  describeProfile,
  describeShipperProfile,
  intlChoices,
  needsBodyType,
  needsSides,
  needsSize,
  regionLabel,
  scopeCountries,
  validRouteScope,
  weightText,
} from "@yuk/shared";

export const STEPS = ["class", "body", "capacity", "size", "sides", "intl", "done"];
// Yuk beruvchi (rol "yuk_beruvchi"): yo'nalish va qanday mashina kerakligi — o'z mashinasi yo'q
export const SHIPPER_STEPS = ["from", "to", "classes", "bodies", "intl", "done"];

// "ichki" doirada xalqaro savoli yo'q; yengil mashinada kuzov yo'q, tyagach va sisternada o'lcham so'ralmaydi
const stepsFor = (draft) => {
  const intl = Boolean(intlChoices(draft.scope));
  if (draft.role === "yuk_beruvchi") return intl ? SHIPPER_STEPS : SHIPPER_STEPS.filter((s) => s !== "intl");
  const { truckClass, bodyType } = draft.vehicle;
  const skip = {
    body: !needsBodyType(truckClass),
    size: !needsSize(truckClass, bodyType),
    sides: !needsSides(truckClass, bodyType),
    intl: !intl,
  };
  return STEPS.filter((s) => !skip[s]);
};

// Kuzov tanlovi: "Boshqa" yo'q (haydovchi ro'yxatdagisini tanlaydi; yuk beruvchi uchun — ma'nosiz)
const FORM_BODIES = BODY_TYPES.filter((b) => b.form !== false);
const SHIPPER_BODIES = FORM_BODIES;

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
  // Yo'nalish qoralamada yo'q: saqlaganda bot eskisini qoldiradi (bot.js saved → withRoute)
  if (profile) {
    return {
      scope: validRouteScope(scope),
      step: "class",
      vehicle: { loadingSides: [], bodyGuess: false, ...structuredClone(profile.vehicle ?? {}) },
      domestic: profile.domestic ?? true,
      international: profile.international ?? false,
    };
  }
  return {
    scope: validRouteScope(scope),
    step: "class",
    vehicle: { truckClass: null, bodyType: null, capacityKg: null, body: null, bodyGuess: false, loadingSides: [] },
    domestic: true,
    international: false,
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
const dims = (b) => `${formatT(b.lengthM)} × ${formatT(b.widthM)} × ${formatT(b.heightM)} m`;
const classLabel = (t) => `${t.name} (${capacityRangeText(t.capacityT)})`;
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
  // (from / to — faqat yuk beruvchida)
  bodies: { field: "bodyTypes", ids: () => SHIPPER_BODIES.map((b) => b.id) },
};

// Qadamning matni va tugmalari: { text, keyboard: [[{ text, data }]] }
export function renderStep(draft) {
  const { step, vehicle } = draft;
  switch (step) {
    case "class":
      return {
        text: "🚚 Transportingiz qaysi turdagi?",
        keyboard: rows(TRUCK_CLASSES.map((t) => button(classLabel(t), step, t.id)), 1),
      };
    case "body":
      return {
        text: "📦 Kuzov turi qanaqa?",
        keyboard: [...rows(FORM_BODIES.map((b) => button(b.name, step, b.id)), 2), nav(step)],
      };
    case "capacity": {
      const options = CAPACITY_OPTIONS[vehicle.truckClass] ?? [];
      const example = (truckClass(vehicle.truckClass)?.capacityT[1] ?? 1) < 1 ? "400 kg" : "7,5 tonna";
      return {
        text: `⚖️ Qancha yuk ko'taradi?\n\nTugmani bosing yoki sonni yozib yuboring (masalan: ${example}).`,
        keyboard: [...rows(options.map((t) => button(weightText(t), step, t)), 3), nav(step)],
      };
    }
    case "size": {
      const standard = truckClass(vehicle.truckClass)?.body;
      const buttons = standard
        ? [button(`Standart: ${dims(standard)}`, step, "std"), button("Bilmayman — odatdagi o'lcham olinsin", step, "guess")]
        : [];
      return {
        text:
          "📏 Kuzov ichki o'lchami: uzunligi, eni, balandligi (metr).\n\n" +
          "Yozib yuboring, masalan: 4,85 2,15 1,95\nYuk kubi va paleti kuzovga sig'adimi — shunga qarab tekshiramiz.",
        keyboard: [...rows(buttons, 1), nav(step)],
      };
    }
    case "sides": {
      const chosen = new Set(vehicle.loadingSides);
      const options = FORM_SIDES.map((id) => button(`${chosen.has(id) ? "✅ " : ""}${SIDE_LABELS[id]}`, step, `t.${id}`));
      return {
        text:
          "↕️ Qaysi tomonidan yuklanadi?\n\n" +
          "Bir nechtasini tanlang. O'ng va chap — mashinaga ORQASIDAN qaraganda.",
        keyboard: [...rows(options, 2), [button("Tayyor ➡️", step, "ok")], nav(step)],
      };
    }
    case "from":
      return regionStep(step, draft, "📍 Yukingiz qayerda yuklanadi? Shu yerdagi bo'sh mashinalarni yuboramiz.", "Hamma viloyat");
    case "to":
      return regionStep(step, draft, "🏁 Yuk qayerga boradi?", "Istalgan joy");
    case "classes":
      return pickStep(
        step,
        draft,
        "truckClasses",
        TRUCK_CLASSES.map((t) => ({ id: t.id, label: classLabel(t) })),
        "🚚 Qanday transport kerak?",
        "Istalgan transport",
        1,
      );
    case "bodies":
      return pickStep(step, draft, "bodyTypes", SHIPPER_BODIES.map((b) => ({ id: b.id, label: b.name })), "📦 Qanday kuzov kerak?", "Istalgan kuzov");
    case "intl": {
      const choices = intlChoices(draft.scope);
      const routeNote = draft.role === "yuk_beruvchi" ? "" : "\n\nQayerdan qayerga yuk kerakligini keyin «📋 Mos yuklar» da tanlaysiz — shunga qarab viloyatlar va davlatlar chiqadi.";
      return {
        text: `🌍 ${choices.question}${routeNote}`,
        keyboard: [...rows(Object.entries(choices.options).map(([id, o]) => button(o.label, step, id)), 1), nav(step)],
      };
    }
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
      if (d.vehicle.truckClass !== value) Object.assign(d.vehicle, { capacityKg: null, body: null, bodyGuess: false });
      d.vehicle.truckClass = value;
      if (!needsBodyType(value)) Object.assign(d.vehicle, { bodyType: null, body: null, loadingSides: [] });
      break;
    case "body":
      if (!FORM_BODIES.some((b) => b.id === value)) return { draft };
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
      if (!standard || (value !== "std" && value !== "guess")) return { draft };
      // «Bilmayman» — odatdagi o'lcham olinadi, haydovchi bilmasligi yozib qo'yiladi
      Object.assign(d.vehicle, { body: { ...standard }, bodyGuess: value === "guess" });
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
    if (tonnes == null) return { draft, error: "Sonni tushunmadim. Masalan: 7,5 (tonna) yoki 400 kg" };
    d.vehicle.capacityKg = Math.round(tonnes * 1000);
    d.step = next("capacity", d);
    return { draft: d };
  }
  if (d.step === "size") {
    const body = parseBodySize(text);
    if (!body) return { draft, error: "Uchta sonni yozing: uzunligi eni balandligi. Masalan: 4.85 2.15 1.95" };
    Object.assign(d.vehicle, { body, bodyGuess: false });
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
  // Yo'nalish bo'sh: bot saqlaganda haydovchining «📋 Mos yuklar» dagi yo'nalishini qoldiradi (withRoute)
  const hasBody = needsBodyType(vehicle.truckClass);
  return {
    vehicle: {
      truckClass: vehicle.truckClass,
      bodyType: !hasBody || vehicle.bodyType === "boshqa" ? null : vehicle.bodyType,
      capacityKg: vehicle.capacityKg,
      body: needsSize(vehicle.truckClass, vehicle.bodyType) ? (vehicle.body ?? null) : null,
      bodyGuess: Boolean(vehicle.bodyGuess && vehicle.body),
      loadingSides: needsSides(vehicle.truckClass, vehicle.bodyType) ? [...vehicle.loadingSides] : [],
    },
    fromAreas: [],
    toAreas: [],
    domestic: international ? draft.domestic : true,
    international,
  };
}

// Profil matni ("✅ Saqlandi", /start va «Tekshiring» xabarlari) — @yuk/shared profileText.js:
// web ilova ham ro'yxatdan o'tishning «Tasdiqlash» qadamida xuddi shu qatorlarni ko'rsatadi
export { describeProfile, describeShipperProfile };
