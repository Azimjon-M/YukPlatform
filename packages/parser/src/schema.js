// AI javobining aniq shakli (JSON Schema). API javobni majburan shu shaklda qaytaradi,
// shuning uchun "JSON buzilib keldi" degan muammo bo'lmaydi.
// Maydonlar ma'nosi: docs/haydovchi-suhbati.md va prompt.js dagi qoidalar.
import {
  BODY_TYPE_IDS,
  CATEGORY_IDS,
  CURRENCIES,
  LOADING_SIDE_IDS,
  PAYMENT_TYPE_IDS,
  POST_TYPE_IDS,
  PRICE_UNIT_IDS,
  REGION_IDS,
  TRUCK_CLASS_IDS,
} from "@yuk/shared";

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const text = nullable({ type: "string" });
const oneOf = (ids) => nullable({ type: "string", enum: ids });

export const LOAD_PROPERTIES = {
  category: { type: "string", enum: CATEGORY_IDS },
  // Qayerdan: shahar, aniqroq joy (tuman, bozor, zavod), viloyat kodi, davlat
  fromCity: text,
  fromPlace: text,
  fromRegion: oneOf(REGION_IDS),
  fromCountry: text,
  toCity: text,
  toPlace: text,
  toRegion: oneOf(REGION_IDS),
  toCountry: text,
  cargo: text,
  // Og'irlik oraliq bo'lsa ("20 22 ton") — katta raqam
  weightT: nullable({ type: "number" }),
  volumeM3: nullable({ type: "number" }),
  pallets: nullable({ type: "integer" }),
  // Mashina: sinfi (o'lchami) va kuzov turi — faqat e'londa aytilgan bo'lsa
  truckClass: oneOf(TRUCK_CLASS_IDS),
  bodyType: oneOf(BODY_TYPE_IDS),
  vehicleCount: nullable({ type: "integer" }),
  loadingSides: { type: "array", items: { type: "string", enum: LOADING_SIDE_IDS } },
  partial: { type: "boolean" }, // dogruz / "furaga qo'shimcha yuk"
  // Narx: miqdor, nimaga (reys, kg, tonna, kub), valyuta, to'lov turi, kelishiladimi
  price: nullable({ type: "number" }),
  priceUnit: oneOf(PRICE_UNIT_IDS),
  currency: oneOf(CURRENCIES),
  payment: oneOf(PAYMENT_TYPE_IDS),
  negotiable: { type: "boolean" },
  when: text,
  note: text,
};

const POST_PROPERTIES = {
  postType: { type: "string", enum: POST_TYPE_IDS },
  loads: {
    type: "array",
    items: {
      type: "object",
      properties: LOAD_PROPERTIES,
      required: Object.keys(LOAD_PROPERTIES),
      additionalProperties: false,
    },
  },
};

export const POST_SCHEMA = {
  type: "object",
  properties: POST_PROPERTIES,
  required: ["postType", "loads"],
  additionalProperties: false,
};

// --- Javobni sxemaga moslash ---
// Gemini sxemani o'zi majburlaydi, lekin hamma API shunday emas (1pro.uz bo'sh maydonlarni tashlab yuboradi,
// "Toshkent" kabi ro'yxatda yo'q qiymat yozishi mumkin). Shuning uchun har bir javob shu yerdan o'tadi:
//   yo'q maydon → null ([] yoki false), noto'g'ri tur yoki ro'yxatda yo'q qiymat → null, ortiqcha maydon → tashlanadi.
// Gemini javobi bunda o'zgarmaydi (faqat bo'sh matn "" → null).

// value sxemaga mos kelsa — (tozalangan) qiymat, aks holda undefined
function fit(value, schema) {
  if (schema.anyOf) return fit(value, schema.anyOf.find((s) => s.type !== "null"));
  switch (schema.type) {
    case "string": {
      if (typeof value === "number" && !schema.enum) value = String(value);
      if (typeof value !== "string" || !value.trim()) return undefined;
      const text = value.trim();
      if (!schema.enum) return text;
      // "Tent" → "tent": katta-kichik harf farqi kechiriladi
      return schema.enum.find((id) => id.toLowerCase() === text.toLowerCase());
    }
    case "number":
    case "integer": {
      // "20" yoki "20,5" — son matn ko'rinishida kelsa ham olamiz
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.trim().replace(",", ".")) : NaN;
      if (!Number.isFinite(n)) return undefined;
      return schema.type === "integer" ? Math.round(n) : n;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      return value === "true" ? true : value === "false" ? false : undefined;
    case "array":
      if (!Array.isArray(value)) return undefined;
      return [...new Set(value.map((item) => fit(item, schema.items)).filter((item) => item !== undefined))];
    default:
      return undefined;
  }
}

// Maydon bo'lmasa yoki yaroqsiz bo'lsa qo'yiladigan qiymat
const fallback = (schema) => (schema.type === "array" ? [] : schema.type === "boolean" ? false : null);

export function conformLoad(load) {
  const source = load && typeof load === "object" ? load : {};
  return Object.fromEntries(
    Object.entries(LOAD_PROPERTIES).map(([key, schema]) => {
      const value = fit(source[key], schema);
      return [key, value === undefined ? fallback(schema) : value];
    }),
  );
}

// { postType, loads } — postType ro'yxatda bo'lmasa "boshqa" (bot bunday e'lonni yuk deb yubormaydi)
export function conformPost(data) {
  const postType = fit(data?.postType, POST_PROPERTIES.postType) ?? "boshqa";
  const loads = Array.isArray(data?.loads) ? data.loads.filter((load) => load && typeof load === "object").map(conformLoad) : [];
  return { postType, loads };
}

// Bir so'rovda bir nechta e'lon (batch): har bir e'lonning javobi o'z raqami (id) bilan qaytadi.
// id birinchi turadi — model avval raqamni yozadi, keyin o'sha e'lonni tahlil qiladi.
export const BATCH_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "integer" }, ...POST_PROPERTIES },
        required: ["id", "postType", "loads"],
        additionalProperties: false,
      },
    },
  },
  required: ["posts"],
  additionalProperties: false,
};
