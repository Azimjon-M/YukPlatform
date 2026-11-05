// Haydovchini ro'yxatdan o'tkazish: savollar ketma-ketligi. Telegram'ga bog'liq emas — testda tekshiriladi.
// Har bir qadam: render (matn + tugmalar) va javobni qo'llash (tugma yoki yozilgan matn).
// Tugma ma'lumoti: "w:<qadam>:<qiymat>" (Telegram 64 baytgacha ruxsat beradi).
// Haydovchi bergan ma'lumotlar manbai: docs/haydovchi-suhbati.md (model, o'lcham, sig'im, yuklash eshiklari).
import { BODY_TYPES, LOADING_SIDES, REGIONS, TRUCK_CLASSES, vehiclePallets, vehicleVolumeM3 } from "@yuk/shared";

export const STEPS = ["class", "body", "capacity", "size", "sides", "from", "to", "intl", "mode", "done"];

// Sig'im tugmalari, tonna (do'stimiz aytgan odatdagi qiymatlar)
const CAPACITY_OPTIONS = {
  fura: [20, 22, 24, 25, 26],
  mini_fura: [9, 10, 12, 15],
  isuzu: [5, 6, 7, 8, 9],
  kichik: [1, 1.5, 2, 2.5, 3],
  labo: [0.5, 0.7],
};

const INTL_OPTIONS = {
  yoq: { label: "Faqat O'zbekiston", domestic: true, international: false },
  ham: { label: "O'zbekiston va xalqaro", domestic: true, international: true },
  faqat: { label: "Faqat xalqaro", domestic: false, international: true },
};

const MODE_OPTIONS = {
  own: "Faqat mashinamga mos yuklar",
  all: "Hamma yuklar",
};

const SIDE_LABELS = { ust: "Ustidan", orqa: "Orqadan", yon: "Yonidan", chap: "Chapdan", ong: "O'ngdan" };

export function newDraft(profile = null) {
  if (profile) {
    return {
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
const regionLabel = (id) =>
  REGIONS.find((r) => r.id === id)?.name.replace(" viloyati", " vil.").replace(" Respublikasi", "") ?? id;
const button = (text, step, value) => ({ text, data: `w:${step}:${value}` });
const rows = (buttons, perRow) => {
  const out = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
};
const formatT = (t) => String(t).replace(".", ",");
const nav = (step) => [button("⬅️ Orqaga", step, "back")];

function regionStep(step, draft, title, emptyLabel) {
  const field = step === "from" ? "fromAreas" : "toAreas";
  const chosen = new Set(draft[field]);
  const options = REGIONS.map((r) => button(`${chosen.has(r.id) ? "✅ " : ""}${regionLabel(r.id)}`, step, `t.${r.id}`));
  return {
    text: `${title}\n\nBir nechtasini tanlash mumkin. Hech birini tanlamasangiz — ${emptyLabel.toLowerCase()}.`,
    keyboard: [
      ...rows(options, 2),
      [button(chosen.size ? "🧹 Tozalash" : `• ${emptyLabel}`, step, "all"), button("Tayyor ➡️", step, "ok")],
      nav(step),
    ],
  };
}

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
      return regionStep(step, draft, "📍 Qaysi viloyatlardan yuk olasiz?", "Hamma viloyat");
    case "to":
      return regionStep(step, draft, "🏁 Qayerga borasiz? (masalan, uyga qaytish yuki uchun)", "Istalgan joy");
    case "intl":
      return {
        text: "🌍 Xalqaro yuklar ham kerakmi?",
        keyboard: [...rows(Object.entries(INTL_OPTIONS).map(([id, o]) => button(o.label, step, id)), 1), nav(step)],
      };
    case "mode":
      return {
        text: "👁 Qaysi yuklarni yuboraylik?",
        keyboard: [...rows(Object.entries(MODE_OPTIONS).map(([id, label]) => button(label, step, id)), 1), nav(step)],
      };
    case "done":
      return {
        text: `Tekshiring:\n\n${describeProfile(profileFromDraft(draft))}`,
        keyboard: [[button("✅ Saqlash", step, "save")], [button("✏️ Qaytadan", step, "restart")], nav(step)],
      };
    default:
      throw new Error(`Noma'lum qadam: ${step}`);
  }
}

const next = (step) => STEPS[STEPS.indexOf(step) + 1];
const prev = (step) => STEPS[Math.max(0, STEPS.indexOf(step) - 1)];

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// Tugma bosilganda. → { draft, saved?: true } — saved bo'lsa profil tayyor (profileFromDraft)
export function applyAction(draft, step, value) {
  // Eski xabardagi tugma bosilsa — hech narsa o'zgarmaydi, joriy qadam qayta ko'rsatiladi
  if (step !== draft.step) return { draft };
  const d = structuredClone(draft);
  if (value === "back") return { draft: { ...d, step: prev(step) } };

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
    case "to": {
      const field = step === "from" ? "fromAreas" : "toAreas";
      if (value.startsWith("t.")) {
        d[field] = toggle(d[field], value.slice(2));
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
      const option = INTL_OPTIONS[value];
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
      if (value === "restart") return { draft: { ...newDraft(), step: "class" } };
      return { draft };
  }
  d.step = next(step);
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
  if (lengthM < 1 || lengthM > 20 || widthM < 1 || widthM > 3.2 || heightM < 0.5 || heightM > 4.5) return null;
  return { lengthM, widthM, heightM };
}

// Haydovchi matn yozganda (sig'im va o'lcham qadamlarida). → { draft, error? }
export function applyText(draft, text) {
  const d = structuredClone(draft);
  if (d.step === "capacity") {
    const tonnes = parseCapacityT(text);
    if (tonnes == null) return { draft, error: "Sonni tushunmadim. Masalan: 7,5 yoki 24" };
    d.vehicle.capacityKg = Math.round(tonnes * 1000);
    d.step = next("capacity");
    return { draft: d };
  }
  if (d.step === "size") {
    const body = parseBodySize(text);
    if (!body) return { draft, error: "Uchta sonni yozing: uzunligi eni balandligi. Masalan: 4.85 2.15 1.95" };
    d.vehicle.body = body;
    d.step = next("size");
    return { draft: d };
  }
  return { draft, error: "Iltimos, tugmalardan birini bosing." };
}

// Qoralamadan @yuk/shared match.js tushunadigan haydovchi profili
export function profileFromDraft(draft) {
  const { vehicle } = draft;
  return {
    vehicle: {
      truckClass: vehicle.truckClass,
      bodyType: vehicle.bodyType === "boshqa" ? null : vehicle.bodyType,
      capacityKg: vehicle.capacityKg,
      body: vehicle.body ?? null,
      loadingSides: [...vehicle.loadingSides],
    },
    fromAreas: [...draft.fromAreas],
    toAreas: [...draft.toAreas],
    domestic: draft.domestic,
    international: draft.international,
    mode: draft.mode,
  };
}

// Profilni haydovchiga ko'rsatish uchun matn
export function describeProfile(profile) {
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
  const intl = Object.values(INTL_OPTIONS).find((o) => o.domestic === profile.domestic && o.international === profile.international);
  return [
    `🚚 Mashina: ${parts.join(", ")}${size}`,
    `↕️ Yuklash: ${sides}`,
    `📍 Qayerdan: ${areas(profile.fromAreas, "hamma viloyat")}`,
    `🏁 Qayerga: ${areas(profile.toAreas, "istalgan joy")}`,
    `🌍 ${intl?.label ?? "Faqat O'zbekiston"}`,
    `👁 ${MODE_OPTIONS[profile.mode] ?? MODE_OPTIONS.own}`,
  ].join("\n");
}
