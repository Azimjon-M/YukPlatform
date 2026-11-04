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

export const POST_SCHEMA = {
  type: "object",
  properties: {
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
  },
  required: ["postType", "loads"],
  additionalProperties: false,
};
