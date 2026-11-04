// AI javobining aniq shakli (JSON Schema). API javobni majburan shu shaklda qaytaradi,
// shuning uchun "JSON buzilib keldi" degan muammo bo'lmaydi.
import { CATEGORY_IDS, POST_TYPE_IDS, REGION_IDS, VEHICLE_IDS } from "@yuk/shared";

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const text = nullable({ type: "string" });

const LOAD_PROPERTIES = {
  category: { type: "string", enum: CATEGORY_IDS },
  fromCity: text,
  fromRegion: nullable({ type: "string", enum: REGION_IDS }),
  fromCountry: text,
  toCity: text,
  toRegion: nullable({ type: "string", enum: REGION_IDS }),
  toCountry: text,
  cargo: text,
  weightT: nullable({ type: "number" }),
  vehicle: nullable({ type: "string", enum: VEHICLE_IDS }),
  vehicleCount: nullable({ type: "integer" }),
  price: nullable({ type: "number" }),
  currency: nullable({ type: "string", enum: ["UZS", "USD", "RUB", "KZT"] }),
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
