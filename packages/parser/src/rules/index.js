// Qoidaviy parser — e'lonni AI'siz, lug'at va qoidalar bilan tahlil qiladi (2026-11-09, sinov bosqichi).
//
// Maqsad: oddiy e'lonni ("Нукусдан Янгийўлга 20 тонна тент фура кк") ~1 ms da tushunish, AI kutmasdan.
// Asosiy qoida — ISHONCH: e'londagi har bir so'z va son tushunilgan bo'lsagina natija «ishonchli» (confident).
// Tushunilmagan narsa qolsa (noma'lum joy, bir nechta yo'nalish, narx-mi-og'irlik-mi son, bo'sh mashina e'loni) —
// confident: false va reasons'da nega. Bunday e'lonni AI tahlil qiladi.
//
// Natija AI natijasi bilan bir xil shaklda (schema.js LOAD_PROPERTIES): bot uni o'zgartirmasdan ishlata oladi.
// Hozircha bot buni ishlatmaydi — avval `npm run parse:rules` bilan AI natijalariga solishtirib o'lchanadi.
import { HOME_COUNTRY, REGIONS, cargoCategory, normalizePlaces, routeInScope, sameArea, scopeCountries, truckFamily } from "@yuk/shared";
import { extractPhones, maskPhones } from "../phones.js";
// collector @yuk/parser/rules ni import qiladi (AI SDK'larini yuklamaslik uchun) — aloqa tekshiruvi ham shu yerdan
export { hasContact } from "../phones.js";
import { conformLoad } from "../schema.js";
import { readNumbers } from "./numbers.js";
import { findPlace, isCommonWordPlace } from "./places.js";
import { cleanTemplates } from "./templates.js";
import { editDistance, toLatin, tokenizeLine, wordKey } from "./text.js";
import {
  BODY_WORDS,
  CARGO_AFTER,
  CARGO_BEFORE,
  CARGO_WORDS,
  FILLER,
  CHATTER_PATTERNS,
  FREE_TRUCK_PATTERNS,
  LOAD_SURE,
  PARTIAL_WORDS,
  PLACE_DETAILS,
  PLACE_NOUNS,
  SERVICE_PATTERNS,
  SIDE_WORDS,
  TRUCK_FREE_WORDS,
  TRUCK_WORDS,
  VEHICLE_HINTS,
} from "./words.js";

// O'zbekcha (va qozoqcha) yo'nalish qo'shimchalari: -dan «qayerdan», -ga / -ka / -qa «qayerga», -da «qayerda»
// (-tan / -ten qozoqcha ham bor, lekin "Turkistan", "Kazaxstan" kabi nomlarni buzadi — olinmagan)
const SUFFIXES = [
  ["from", ["dagidan", "dan", "din", "den", "dn"]],
  ["to", ["gacha", "ga", "ka", "qa", "ge", "ke"]],
  ["at", ["dagi", "da"]],
  [null, ["ning", "ni", "lar", "si"]],
];
// "kerak" ma'nosidagi so'zlar: oldidagi so'z — kerakli mashina ("tent kerak", "линтейка керак")
const NEED = new Set(["kerak", "kk", "kere", "kerek", "керак", "керек", "kerakk", "nujen", "nujna", "nujno", "нужен", "нужна", "lazim", "trebuyetsya"].map(wordKey));
// Yuk yopilgan / savol e'lonlari (lotinlashtirilgan, kichik harfdagi matnda)
const CLOSED_RE = /(?:^|[^\p{L}'])(?:yopildi|yopilgan|zakrit|zakryt|zakrito)(?![\p{L}'])/u;
const QUESTION_RE = /(?:^|[^\p{L}'])(?:(?:bor|yo'?q|yuq|yug|kerak|bo'?ladi|olasiz|oladi)mi(?:di|kan)?|\p{L}{3,}(?:ga|da|dan)mi|kim\s+ol(?:adi|asiz))(?![\p{L}'])/u;
// Yuk beruvchi yozadigan so'zlar (mashina egasi emas)
const LOAD_SIGNAL = new Set([...NEED, ...CARGO_BEFORE, ...CARGO_AFTER, ...["pogruzka", "zagruzka", "yuklanadi", "ortiladi", "yuklash", "yuklanish", "tushiriladi", "pogruzki"].map(wordKey)]);
// Mashina so'zi (sinfi aytilmagan): "5 avto", "3 mashina" — oldidagi son mashinalar soni
const GENERIC_VEHICLE = new Set(["avto", "mash", "avtomobil", "avtomobiley", "mashina", "mashin", "mashini", "mashinalar", "moshina", "moshin"].map(wordKey));
// Qo'shimcha alohida yozilgan: "Kogon dan", "Samarqand ga"
const LOOSE_SUFFIX = { dan: "from", din: "from", dn: "from", ga: "to", ka: "to", qa: "to", gacha: "to", da: "at" };
// Ruscha old ko'makchilar: "из Ташкента" (qayerdan), "в Москву", "до Самарканда" (qayerga)
const RU_FROM = new Set(["iz", "s"]);
const RU_TO = new Set(["v", "vo", "do"]);

// So'zning qo'shimchasiz shakllari: avval o'zi, keyin har bir mos qo'shimchasiz
// "samarqanddan" → [{samarqanddan}, {samarqand, from}]
function stems(word) {
  const out = [{ stem: word, role: null, suffix: "" }];
  for (const [role, list] of SUFFIXES) {
    for (const suffix of list) {
      if (word.length - suffix.length >= 3 && word.endsWith(suffix)) out.push({ stem: word.slice(0, -suffix.length), role, suffix });
    }
  }
  // Og'zaki "-dan" → "-an" t / n dan keyin: "Urgutan", "Тошкентан", "Romitanan" (= Urgutdan, Toshkentdan, Romitandan)
  if (word.length >= 6 && /[tn]an$/.test(word)) out.push({ stem: word.slice(0, -2), role: "from", suffix: "an" });
  // "-dan" d bilan tugagan nomda bitta d bilan yoziladi: "Bog'dodan", "Xonobodan", "Samarqandan" (= Bog'doddan…)
  if (word.length >= 7 && word.endsWith("dan")) out.push({ stem: word.slice(0, -2), role: "from", suffix: "an" });
  // Qozoqcha "-ten" t dan keyin: "Шымкенттен" (= Shymkentdan)
  if (word.length >= 7 && word.endsWith("tten")) out.push({ stem: word.slice(0, -3), role: "from", suffix: "ten" });
  return out;
}

// Noma'lum so'z -dan / -ga bilan tugasa — ehtimol bizda yo'q joy ("Hasanboydan", "Buvaydaga").
// -ka faqat k/g dan keyin o'zbekcha qo'shimcha ("Pitnakka"); aks holda ruscha so'z: kartoshka, upakovka, texnika
const looksLikePlace = (word) =>
  !CARGO_WORDS.has(wordKey(word)) &&
  stems(word).some((s) => (s.role === "from" || s.role === "to") && (s.suffix !== "ka" || /[kg]$/.test(s.stem)) && s.suffix !== "ke");

// Ruscha kelishik qo'shimchasi: "ташкента" → "ташкент", "москву" → "москва"
const ruForms = (word) => [word, word.slice(0, -1), `${word.slice(0, -1)}a`];

// Viloyat nomi bilan bir xil shahar (Andijon, Samarqand, Toshkent) — "Samarqand Urgutdan" da viloyatni bildiradi
const REGION_NAME = new Map(REGIONS.map((r) => [r.id, wordKey(r.name.replace(/ (viloyati|shahri|Respublikasi)$/, ""))]));
function regionLike(entry) {
  if (entry.kind === "region" || entry.kind === "country") return true;
  return entry.name != null && REGION_NAME.get(entry.region) === wordKey(entry.name);
}
// a (keng joy) b ni o'z ichiga oladimi: viloyat → undagi shahar, davlat → undagi shahar
function contains(a, b) {
  if (!regionLike(a) || sameEntry(a, b)) return false;
  if (a.kind === "country") return a.country === b.country && b.kind !== "country";
  return b.country === a.country && sameArea(a.region, b.region);
}
const sameEntry = (a, b) => a.name === b.name && a.region === b.region && a.country === b.country && a.place === b.place;

// "viloyati", "obl" — oldidagi viloyat nomli shahar aslida viloyatni bildiradi
const REGION_NOUNS = new Set(["viloyat", "viloyati", "vil", "obl", "oblast", "oblasti"].map(wordKey));
// Viloyat nomli shahar (Buxoro, Samarqand) → o'sha viloyat. Toshkent: shahar alohida hudud, viloyati — "toshkent"
function regionEntry(city) {
  const region = REGIONS.find((r) => /viloyati$/.test(r.name) && REGION_NAME.get(r.id) === wordKey(city.name));
  return { name: null, region: region?.id ?? city.region, country: city.country, place: null, kind: "region" };
}

// Yo'nalish doirasidagi davlatlar (O'zbekiston + chegaradoshlar, ROUTE_SCOPE standarti)
const IN_SCOPE_COUNTRIES = new Set([HOME_COUNTRY, ...scopeCountries()]);

// Joy qanchalik aniq: tuman > shahar > viloyat > davlat
const RANK = { district: 3, city: 2, region: 1, country: 0 };

// Yo'nalish ko'rsatkichlari: "→", "➡️", "->", "=>". Chiziqcha ("-") bu yerda yo'q: u "20-22 t" da ham uchraydi
const ARROWS = new Set(["→", "➡", "->", "=>", "⇒"]);

// Yo'nalishi aniq qator: shablon yorlig'i ("Qayerdan: X", hint) yoki bitta strelkali "A ➡️ B" (chapi — qayerdan, o'ngi —
// qayerga). Har tomondagi joylarga o'sha yo'nalish beriladi; bir tomonda keng joy va uning ichidagisi bo'lsa
// ("O'zbekiston, Navoiy shahri", "Farg'ona viloyati, O'zbekiston") — aniqrog'i qoladi.
// → { mentions, sided } — sided: qator yo'nalishli (undagi noma'lum so'z — noma'lum joy deb hisoblanadi)
function sideRoles(mentions, tokens, hint) {
  let sideOf = null;
  if (hint === "from" || hint === "to") sideOf = () => hint;
  else {
    const arrows = tokens.filter((t) => t.type === "sep" && ARROWS.has(t.text));
    const at = arrows.length === 1 ? arrows[0].index : null;
    if (at != null && mentions.some((m) => m.index < at) && mentions.some((m) => m.index > at)) sideOf = (m) => (m.index < at ? "from" : "to");
  }
  if (!sideOf) return { mentions, sided: false };
  const out = mentions.filter((m) => m.ambiguous);
  for (const side of ["from", "to"]) {
    const group = mentions.filter((m) => !m.ambiguous && sideOf(m) === side);
    // m — keng joy, ichidagisi (o) ham aytilgan bo'lsa tashlanadi. "Andijon tumani, Andijon viloyati",
    // "Yunusobod tumani, Toshkent shahri": viloyat nomli shahar va viloyat bir-birini «o'z ichiga oladi» —
    // bunda aniqrog'i qoladi (tuman → shahar → viloyat → davlat), teng bo'lsa — birinchisi
    const wider = (m, o) => contains(m.entry, o.entry) && (!contains(o.entry, m.entry) || RANK[o.entry.kind] > RANK[m.entry.kind] || (RANK[o.entry.kind] === RANK[m.entry.kind] && o.index < m.index));
    for (const m of group) {
      if (group.some((o) => o !== m && wider(m, o))) continue;
      out.push({ ...m, role: m.role ?? side });
    }
  }
  return { mentions: out.sort((a, b) => a.index - b.index), sided: true };
}

// Ruscha ko'plik va kelishik qo'shimchalari: "тенты", "рефов", "площадки", "ставки" → tent, ref, ploshadka, stavka.
// Faqat lug'atda AYNAN bor so'zga olib kelsa ishlatiladi (asosi kamida 3 harf)
const RU_ENDINGS = ["ami", "iye", "ov", "ev", "ax", "om", "oy", "ye", "i", "y", "a", "e", "u"];
function ruStems(word) {
  const out = [];
  for (const end of RU_ENDINGS) {
    if (word.length - end.length < 3 || !word.endsWith(end)) continue;
    const base = word.slice(0, -end.length);
    out.push(base, `${base}a`);
  }
  return out;
}
// So'z lug'atda bormi: o'zi, o'zbekcha qo'shimchasiz, ruscha qo'shimchasiz
const inSet = (set, word) => stems(word).some((s) => set.has(wordKey(s.stem))) || ruStems(word).some((s) => set.has(wordKey(s)));

// Lug'atdan qidirish: avval ko'p so'zli iboralar, keyin bitta so'z (qo'shimchasiz shakllari bilan).
// ru — ruscha qo'shimchalarni ham olib ko'rish (mashina va kuzov so'zlari uchun)
function lexiconAt(lex, words, i, { ru = false } = {}) {
  for (const { parts, value } of lex.phrases) {
    const group = words.slice(i, i + parts.length);
    if (group.length === parts.length && group.every((t, k) => !t.used && stems(t.text).some((s) => wordKey(s.stem) === parts[k]))) {
      return { value, len: parts.length };
    }
  }
  const word = words[i];
  for (const { stem } of stems(word.text)) {
    const key = wordKey(stem);
    if (lex.single.has(key)) return { value: lex.single.get(key), len: 1 };
  }
  if (ru) {
    for (const stem of ruStems(word.text)) {
      const key = wordKey(stem);
      if (lex.single.has(key)) return { value: lex.single.get(key), len: 1 };
    }
  }
  return null;
}

// Noma'lum so'z mashina/kuzov so'ziga o'xshaydimi: imlo xatosi ("Тень" ~ tent, "isuzzi") yoki ichida bor ("Tentfurakerak").
// Bunday so'z qolsa, mashina noto'g'ri tushunilgan bo'lishi mumkin — e'lon AI'ga
const VEHICLE_KEYS = [...TRUCK_WORDS.single.keys(), ...BODY_WORDS.single.keys()].filter((key) => key.length >= 3);
const LONG_VEHICLE_KEYS = VEHICLE_KEYS.filter((key) => key.length >= 4);
function looksLikeVehicle(word) {
  const key = wordKey(word);
  if (key.length < 3) return false;
  if (VEHICLE_HINTS.has(key)) return true;
  if (LONG_VEHICLE_KEYS.some((v) => key.length > v.length && key.includes(v))) return true;
  // Imlo xatosi faqat 5+ harfli so'zlarda: qisqa so'zlarda bitta harf farqi boshqa so'z ("meva" ~ "mega", "tonna" ~ "tonar")
  return key.length >= 5 && VEHICLE_KEYS.some((v) => v.length >= 5 && Math.abs(v.length - key.length) <= 1 && v[0] === key[0] && editDistance(key, v, 1) <= 1);
}

// Ikki so'z qo'shib yozilgan: "tentfura" → tent + fura. Ikkala yarmi ham mashina/kuzov lug'atida bo'lishi shart
function splitCompound(word) {
  const lookup = (part) => {
    for (const [lex, key] of [[TRUCK_WORDS, "trucks"], [BODY_WORDS, "bodies"]]) {
      for (const { stem } of stems(part)) {
        const value = lex.single.get(wordKey(stem));
        if (value) return { key, value };
      }
    }
    return null;
  };
  for (let i = 3; i <= word.length - 3; i++) {
    const a = lookup(word.slice(0, i));
    const b = a && lookup(word.slice(i));
    if (a && b) return [a, b];
  }
  return null;
}

// Ketma-ket so'zlar orasida ajratuvchi yo'qmi ("Toshkent viloyati" — ha, "Toshkent - Andijon" — yo'q)
const adjacent = (group) => group.every((t, k) => k === 0 || t.index === group[k - 1].index + 1);

// i-so'zdan boshlanadigan joy nomi (1–3 so'z). fuzzy — imlo xatosiga ruxsat (qo'shimchali so'zda doim bor)
function placeAt(words, i, { routeLine }) {
  for (const len of [3, 2, 1]) {
    const group = words.slice(i, i + len);
    if (group.length < len || group.some((t) => t.used) || !adjacent(group)) continue;
    // "Salarka" — yoqilg'i (yuk nomi), Salar + -ka emas
    if (len === 1 && CARGO_WORDS.has(wordKey(group[0].text))) continue;
    const head = group.slice(0, -1).map((t) => t.text).join(" ");
    for (const { stem, role } of stems(group.at(-1).text)) {
      const text = head ? `${head} ${stem}` : stem;
      // Qo'shimchali so'zda («adijonga») xatoga ruxsat; qo'shimchasiz so'zda — faqat «A - B» qatorida
      const found = findPlace(text, { exact: !(role === "from" || role === "to" || routeLine) });
      if (!found) continue;
      if (found.ambiguous) return { ambiguous: true, len, text };
      // "Juma", "Uzun", "Shirin" — oddiy so'z ham: qo'shimchasiz bo'lsa, faqat yo'nalish qatorida joy
      if (!role && !routeLine && isCommonWordPlace(text)) continue;
      // "Jumaga" — Juma shaharchasigami yoki juma kunigami, aniq emas
      if (!routeLine && wordKey(text) === "juma") return { ambiguous: true, len, text };
      return { entry: found.entry, role, typo: found.typo, len, text };
    }
  }
  return null;
}

// hint — shablon yorlig'idan (templates.js): "from" | "to" — qatordagi joylar shu tomon, "cargo" — qator yuk nomi
function classifyLine(line, lineNo, hint = null) {
  const { facts } = readNumbers(line);
  const tokens = tokenizeLine(line).map((t, index) => ({ ...t, index, line: lineNo, used: null }));
  // Son-qoida qamragan bo'laklar (son, "tonna", "so'm", "kub"...) — tushunilgan
  for (const t of tokens) if (facts.some((f) => t.start >= f.start && t.start < f.end)) t.used = "num";
  const words = tokens.filter((t) => t.type === "word");
  const mentions = [];
  const found = { trucks: [], bodies: [], sides: [], partial: false, free: false, cargo: [] };

  // Faqat joy nomlari va ajratuvchilardan iborat qator ("Toshkent - Andijon", "🇷🇺Екатеренбург"): imlo xatosiga ruxsat
  const free = words.filter((t) => !t.used);
  // Shablonning "Qayerdan: Pop tumani, …" qatori ham yo'nalish qatori: "Pop", "Juma" bu yerda joy nomi
  const routeLine = hint === "from" || hint === "to" || (free.length > 0 && free.length <= 3 && free.every((t, k) => placeAt(free, k, { routeLine: true }) || PLACE_NOUNS.has(wordKey(t.text))));

  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    if (t.used) continue;
    // 1) "bo'sh mashina", "isuzu bor" — haydovchi yuk qidiryapti
    const free1 = lexiconAt(TRUCK_FREE_WORDS, words, i);
    if (free1) {
      found.free = true;
      for (let k = 0; k < free1.len; k++) words[i + k].used = "free";
      i += free1.len - 1;
      continue;
    }
    // 2) mashina, kuzov, yuklash tomoni, dogruz
    let matched = false;
    for (const [lex, key] of [[TRUCK_WORDS, "trucks"], [BODY_WORDS, "bodies"], [SIDE_WORDS, "sides"], [PARTIAL_WORDS, "partial"]]) {
      const hit = lexiconAt(lex, words, i, { ru: key === "trucks" || key === "bodies" });
      if (!hit) continue;
      if (key === "partial") found.partial = true;
      else found[key].push({ value: hit.value, index: t.index });
      // "tyagach" — ham sinf (fura), ham kuzov
      if (key === "trucks") {
        const body = lexiconAt(BODY_WORDS, words, i, { ru: true });
        if (body) found.bodies.push({ value: body.value, index: t.index });
      }
      for (let k = 0; k < hit.len; k++) words[i + k].used = key;
      // "шаланда бор", "5 tonali esuzi bor" — mashina bor (haydovchi yuk qidiryapti); "sement bor" esa yuk
      const after = words[i + hit.len];
      if ((key === "trucks" || key === "bodies") && after && after.index === words[i + hit.len - 1].index + 1 && wordKey(after.text) === "bor") found.free = true;
      i += hit.len - 1;
      matched = true;
      break;
    }
    if (matched) continue;
    // 3) joy nomi
    const place = placeAt(words, i, { routeLine });
    if (place?.ambiguous) {
      for (let k = 0; k < place.len; k++) words[i + k].used = "ambiguous";
      mentions.push({ ambiguous: true, text: place.text, line: lineNo, index: t.index });
      i += place.len - 1;
      continue;
    }
    if (place) {
      let role = place.role;
      let entry = place.entry;
      const last = words[i + place.len - 1];
      for (let k = 0; k < place.len; k++) words[i + k].used = "place";
      let end = last.index;
      // "Koson tumanidan", "Toshkent shahriga", "Kogon dan": yo'nalish keyingi so'zda
      const next = words[i + place.len];
      if (next && next.index === last.index + 1 && !next.used) {
        const noun = stems(next.text).find((s) => PLACE_NOUNS.has(wordKey(s.stem)));
        const loose = !role && LOOSE_SUFFIX[next.text];
        if (noun || loose) {
          next.used = "place";
          role = role ?? noun?.role ?? loose;
          end = next.index;
          // "Buxoro viloyati" — Buxoro shahri emas, butun viloyat (AI ham shahar yozmaydi)
          if (noun && REGION_NOUNS.has(wordKey(noun.stem)) && entry.kind === "city" && regionLike(entry)) entry = regionEntry(entry);
        }
      }
      // "из Ташкента", "в Москву"
      const prev = words[i - 1];
      if (!role && prev && prev.index === t.index - 1 && (RU_FROM.has(prev.text) || RU_TO.has(prev.text))) {
        role = RU_FROM.has(prev.text) ? "from" : "to";
        prev.used = "place";
      }
      mentions.push({ entry, role, typo: place.typo, line: lineNo, index: t.index, end });
      i += place.len - 1 + (end > last.index ? 1 : 0);
      continue;
    }
    // Ruscha kelishikdagi joy: "из ташкента", "в москву"
    const prev = words[i - 1];
    if (prev && prev.index === t.index - 1 && (RU_FROM.has(prev.text) || RU_TO.has(prev.text))) {
      const hit = ruForms(t.text).map((form) => findPlace(form, { exact: true })).find((f) => f?.entry);
      if (hit) {
        t.used = "place";
        prev.used = "place";
        mentions.push({ entry: hit.entry, role: RU_FROM.has(prev.text) ? "from" : "to", typo: 0, line: lineNo, index: t.index, end: t.index });
        continue;
      }
    }
    // Qo'shib yozilgan: "tentfura", "реффура"
    const parts = splitCompound(t.text);
    if (parts) {
      for (const part of parts) found[part.key].push({ value: part.value, index: t.index });
      t.used = parts[0].key;
    }
  }

  // 4) joy aniqlovchilari: "Navoiydan (Xatirchi)", "Mirobod bozoridan" — yo'nalishni o'zgartirmaydi, AI ham faqat izohga yozadi
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "sep" && t.text === "(" && tokens[i - 1]?.used === "place") {
      const inside = [];
      for (let k = i + 1; k < tokens.length && tokens[k].text !== ")"; k++) if (tokens[k].type === "word" && !tokens[k].used) inside.push(tokens[k]);
      for (const w of inside) w.used = "detail";
      // "Namangan (pop)": viloyat nomli shahar + qavsda shu viloyatdagi joy → aniqrog'i (AI yo'lidagi normalizePlaces kabi).
      // "Qo'qon (Uchko'prik)" — Qo'qon haqiqiy shahar, o'zgarmaydi
      const m = mentions.find((x) => x.end === tokens[i - 1].index);
      const hit = m && inside.length && inside.length <= 2 ? findPlace(inside.map((w) => w.text).join(" "), { exact: true }) : null;
      if (hit?.entry && regionLike(m.entry) && !regionLike(hit.entry) && sameArea(m.entry.region, hit.entry.region)) m.entry = hit.entry;
    }
    if (t.type === "word" && !t.used && stems(t.text).some((s) => PLACE_DETAILS.has(wordKey(s.stem)))) t.used = "detail";
  }

  // 5) tanish so'zlar (salom, kerak, tel, srochno...) — ma'lumot emas, lekin e'lonni tushunarsiz ham qilmaydi
  for (const t of words) {
    if (t.used) continue;
    // "viloyati", "tumani" o'zi yolg'iz (joy nomidan keyin emas) — ham zararsiz
    if (inSet(FILLER, t.text) || stems(t.text).some((s) => PLACE_NOUNS.has(wordKey(s.stem)))) t.used = "filler";
  }
  // Nechta mashina kerak: "Тент 2", "Fura 3" (mashina so'zidan keyin) yoki "3 tent", "5 avto" (oldin)
  const vehicleWord = (x) => x && (x.used === "trucks" || x.used === "bodies" || (x.type === "word" && GENERIC_VEHICLE.has(wordKey(x.text))));
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "num" || t.used || !/^\d{1,2}$/.test(t.text) || Number(t.text) > 20) continue;
    if (vehicleWord(tokens[i - 1]) || vehicleWord(tokens[i + 1])) {
      t.used = "count";
      found.count = Number(t.text);
    }
  }
  // Ro'yxat raqami: "1) Toshkent - Andijon", "2. Samarqand..."
  if (tokens[0]?.type === "num" && !tokens[0].used && /^[).]/.test(line.slice(tokens[0].end).trimStart())) tokens[0].used = "list";
  // Ko'p uchraydigan yuk nomlari (ro'yxatda): "kafel", "taxta", "bumaga"
  for (const t of words) {
    if (t.used || !stems(t.text).some((s) => CARGO_WORDS.has(wordKey(s.stem)))) continue;
    t.used = "cargo";
    found.cargo.push(t.text);
  }
  // 6) yuk nomi: "metallom bor", "Груз: Пряжа", "Tovar Bigbag", "Mol ortiladi". Noma'lum joyga o'xshagan so'z
  // ("Jomdan") yoki mashinaga o'xshagan so'z ("Tentfurakerak", "Тень") yuk nomi bo'lmaydi — u e'lonni AI'ga yuboradi
  const cargoWord = (w) => w && !w.used && !looksLikePlace(w.text) && !looksLikeVehicle(w.text);
  // Shablondagi "Yuk turi: Qurilish mollari" — qatorning qolgani yuk nomi
  if (hint === "cargo") {
    const cargo = words.filter(cargoWord);
    for (const c of cargo) c.used = "cargo";
    if (cargo.length) found.cargo.push(cargo.map((c) => c.text).join(" "));
  }
  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    const key = wordKey(t.text);
    if (CARGO_BEFORE.has(key)) {
      const cargo = [];
      for (let k = i - 1; k >= 0 && cargo.length < 3 && cargoWord(words[k]) && words[k].index === words[k + 1].index - 1; k--) cargo.unshift(words[k]);
      for (const c of cargo) c.used = "cargo";
      if (cargo.length) found.cargo.push(cargo.map((c) => c.text).join(" "));
    }
    if (CARGO_AFTER.has(key)) {
      const cargo = [];
      for (let k = i + 1; k < words.length && cargo.length < 3 && cargoWord(words[k]); k++) cargo.push(words[k]);
      for (const c of cargo) c.used = "cargo";
      if (cargo.length) found.cargo.push(cargo.map((c) => c.text).join(" "));
    }
  }
  // Faqat 1–2 noma'lum so'zdan iborat qator ("Bitum", "Armatura", "Тахта") — yuk nomi
  const rest = words.filter((w) => !w.used);
  if (rest.length && rest.length <= 2 && rest.length === words.length && rest.every(cargoWord) && !tokens.some((x) => x.type === "num" && !x.used)) {
    for (const w of rest) w.used = "cargo";
    found.cargo.push(rest.map((w) => w.text).join(" "));
  }
  // Yo'nalishli qatordagi noma'lum so'z — bizda yo'q joy nomi bo'lishi mumkin ("Qayerdan: Xorgos, Xitoy",
  // "O'zbekiston, Xyz shahri ➡️ …"). Uni oddiy noma'lum so'z deb kechirsak, yuk faqat davlat bilan («O'zbekiston»)
  // hamma haydovchiga ketardi. Yorliqli qatorda — har noma'lum so'z, strelkali qatorda — davlat nomi yonidagisi
  // Istisno: qatorda doiradan tashqari davlat bor ("Sverdlovsk viloyati, Rossiya") — shahri qaysi bo'lmasin, yuk
  // baribir hech kimga ketmaydi, noma'lum shahar nomi oddiy noma'lum so'z bo'lib qoladi
  const sided = sideRoles(mentions, tokens, hint);
  if (sided.sided) {
    const countries = mentions.filter((m) => m.entry?.kind === "country");
    const far = countries.some((m) => !IN_SCOPE_COUNTRIES.has(m.entry.country));
    for (const w of words) if (!w.used && !far && (hint || countries.some((m) => Math.abs(m.index - w.index) <= 2))) w.placeLike = true;
  }
  return { tokens, words, facts, mentions: sided.mentions, found, lineNo, hint };
}

// Qatorlarni yuk bloklariga ajratadi: e'londa bir nechta yuk bo'lsa, har biri o'z yo'nalishi bilan boshlanadi.
// Yangi blok — yo'nalishi to'liq (2 ta joy) blokdan keyin, orada yuk ma'lumoti (og'irlik, mashina, telefon) bo'lgan
// qatordan keyin yana joy nomi kelsa
function segmentsOf(lines) {
  const segments = [];
  let current = null;
  for (const line of lines) {
    const hasContent = line.tokens.length > 0;
    if (!hasContent) continue;
    const places = line.mentions.length > 0;
    if (!current || (places && current.mentions.length >= 2 && current.detailAfter)) {
      current = { lines: [], mentions: [], detailAfter: false };
      segments.push(current);
    }
    current.lines.push(line);
    current.mentions.push(...line.mentions);
    if (!places && current.mentions.length >= 2) current.detailAfter = true;
    if (places && current.mentions.length >= 2 && line.tokens.some((t) => t.used && t.used !== "place" && t.used !== "detail")) current.detailAfter = true;
  }
  return segments;
}

// Bloknining joy nomlaridan yo'nalish: → { from, to } yoki { problem }
// Qo'shimchasiz joy (N) yo'nalishga faqat ikkinchi joy bilan bir qatorda yoki qo'shni qatorda bo'lsa qo'shiladi:
// "Toshkent - Andijon", "Buxoro⏎Xorazm" — ha; "CHINOZ - TOSHKENT 12ta⏎Chilonzor 3ta⏎Xasanboy 5ta⏎Qorasuv" — yo'q
function routeOf(mentions, lines) {
  if (mentions.some((m) => m.ambiguous)) return { problem: `noaniq joy: ${mentions.find((m) => m.ambiguous).text}` };
  // "Samarqand Urgutdan", "Toshkent Sergeli", "Каракалпок нукусдан" — viloyat + undagi joy → aniqrog'i
  const merged = [];
  for (const m of mentions) {
    const prev = merged.at(-1);
    if (prev && prev.line === m.line && m.index === prev.end + 1 && !prev.role && contains(prev.entry, m.entry)) {
      merged[merged.length - 1] = m;
      continue;
    }
    // Bir joy takrorlangan ("Toshkent → Mangit ... Тошкентдан Мангитга") — bitta
    const same = merged.find((x) => sameEntry(x.entry, m.entry) && (x.role === m.role || !x.role || !m.role));
    if (same) {
      same.role = same.role ?? m.role;
      continue;
    }
    merged.push(m);
  }
  const by = (role) => merged.filter((m) => m.role === role);
  const [from, to, at, none] = [by("from"), by("to"), by("at"), by(null)];
  const n = merged.length;
  // Qator tartibi (blokdagi bo'sh bo'lmagan qatorlar) va qator ichidagi o'rni
  const row = (m) => lines.findIndex((l) => l.lineNo === m.line);
  const before = (a, b) => row(a) < row(b) || (row(a) === row(b) && a.index < b.index);
  const near = (a, b) => Math.abs(row(a) - row(b)) <= 1;
  if (from.length === 1 && to.length === 1 && n === 2) return { from: from[0], to: to[0] };
  if (from.length === 1 && none.length === 1 && n === 2 && before(from[0], none[0]) && near(from[0], none[0])) return { from: from[0], to: none[0] };
  if (to.length === 1 && none.length === 1 && n === 2 && before(none[0], to[0]) && near(none[0], to[0])) return { from: none[0], to: to[0] };
  if (at.length === 1 && to.length === 1 && n === 2) return { from: at[0], to: to[0] };
  if (none.length === 2 && n === 2 && near(none[0], none[1])) return { from: none[0], to: none[1] };
  if (from.length === 1 && n === 1) return { from: from[0], to: null };
  if (to.length === 1 && n === 1) return { from: null, to: to[0] };
  if (n === 0) return { problem: "yo'nalish topilmadi" };
  if (n === 1) return { problem: "bitta joy, yo'nalishi noma'lum" };
  return { problem: `${n} ta joy — yo'nalish aniq emas` };
}

function placeFields(side, mention) {
  const e = mention?.entry;
  return {
    [`${side}City`]: e?.name ?? null,
    [`${side}Place`]: e?.place ?? null,
    [`${side}Region`]: e?.region ?? null,
    [`${side}Country`]: e?.country ?? null,
  };
}

const distinct = (list) => [...new Set(list)];

// Bitta blok → { load, problems }
function readSegment(segment) {
  const problems = [];
  const route = routeOf(segment.mentions, segment.lines);
  if (route.problem) problems.push(route.problem);
  // "Мирбозордан Жонбойга": joy ichidagi nuqta (bozor, zavod) -dan / -ga bilan, lekin uning shahri aytilmagan —
  // o'sha tomon noma'lum qoladi, AI esa uni taxmin qila oladi (Mirbozor → Samarqand)
  for (const side of ["from", "to"]) {
    if (route.problem || route[side]) continue;
    const detail = segment.lines.flatMap((l) => l.words).find((w) => w.used === "detail" && stems(w.text).some((x) => x.role === side));
    if (detail) problems.push(`joy aniq emas: ${detail.text}`);
  }

  const facts = segment.lines.flatMap((l) => l.facts);
  const values = (key) => distinct(facts.filter((f) => f[key] != null).map((f) => f[key]));
  const weights = values("weightT");
  const volumes = values("volumeM3");
  const pallets = values("pallets");
  const prices = distinct(facts.filter((f) => f.kind === "price").map((f) => `${f.price}|${f.priceUnit}|${f.currency}`));
  if (weights.length > 1) problems.push(`bir nechta og'irlik: ${weights.join(", ")}`);
  if (volumes.length > 1) problems.push("bir nechta hajm");
  if (pallets.length > 1) problems.push("bir nechta palet soni");
  if (prices.length > 1) problems.push("bir nechta narx");
  const price = prices.length === 1 ? facts.find((f) => f.kind === "price") : null;

  const found = { trucks: [], bodies: [], sides: [], cargo: [], partial: false, free: false };
  for (const line of segment.lines) {
    for (const key of ["trucks", "bodies", "sides", "cargo"]) found[key].push(...line.found[key]);
    found.partial ||= line.found.partial;
    found.free ||= line.found.free;
  }
  const trucks = distinct(found.trucks.map((t) => t.value));
  const bodies = distinct(found.bodies.map((b) => b.value));
  // Soni: "2 ta fura" — sondan keyin mashina so'zi kelsa; "Тент 2" — mashina so'zidan keyin
  let vehicleCount = segment.lines.map((l) => l.found.count).find((n) => n != null) ?? null;
  for (const line of segment.lines) {
    for (const f of line.facts.filter((x) => x.kind === "count")) {
      const next = line.words.find((w) => w.start >= f.end);
      if (next && (next.used === "trucks" || next.used === "bodies")) vehicleCount = f.count;
    }
  }
  const when = segment.lines.flatMap((l) => l.facts.filter((f) => f.kind === "when").map((f) => f.when))[0] ?? null;

  const weightT = weights.length === 1 ? weights[0] : null;
  // AI qoidasi: sinf yozilmagan bo'lsa, 15 t dan og'ir yukni faqat fura ko'taradi
  const truckClass = trucks[0] ?? (weightT != null && weightT > 15 ? "fura" : null);
  const load = conformLoad({
    ...placeFields("from", route.from),
    ...placeFields("to", route.to),
    cargo: found.cargo[0] ?? null,
    weightT,
    volumeM3: volumes.length === 1 ? volumes[0] : null,
    pallets: pallets.length === 1 ? pallets[0] : null,
    truckClass,
    bodyType: bodies[0] ?? null,
    vehicleCount,
    loadingSides: distinct(found.sides.map((s) => s.value)),
    partial: found.partial,
    price: price?.price ?? null,
    priceUnit: price?.priceUnit ?? null,
    currency: price?.currency ?? null,
    payment: null,
    negotiable: segment.lines.some((l) => l.words.some((w) => /^(kelish|dogovor|torg)/.test(w.text))),
    when,
    note: null,
  });
  return { load, problems, trucks, bodies, free: found.free };
}

// E'lon → { confident, reasons, postType, loads, unknown, service }
// options.maxUnknown — nechta noma'lum so'zga chidaymiz (yuk nomi, izohdagi so'zlar). Ko'p bo'lsa — AI.
const NO_LOAD_SIGNAL = "yuk yoki mashina e'loni — aniq emas";

export function parseByRules(text, { maxUnknown = 2, allowAlternatives = true } = {}) {
  const phones = extractPhones(text);
  const latin = toLatin(maskPhones(text));
  const result = (confident, reasons, postType, loads, extra = {}) => ({ confident, reasons, postType, loads, ...extra });

  if (SERVICE_PATTERNS.some((re) => re.test(latin))) return result(true, [], "boshqa", [], { service: true, unknown: [], suspects: [], numbers: [] });

  // Avto-joylash shablonlari: reklama qatorlari olib tashlanadi, "Qayerdan:/Qayerga:" yorliqlari yo'nalish beradi
  const lines = cleanTemplates(latin).map(({ text: line, hint }, i) => classifyLine(line, i, hint));
  const reasons = [];
  const tokens = lines.flatMap((l) => l.tokens);
  const unknown = tokens.filter((t) => t.type === "word" && !t.used);
  const numbers = tokens.filter((t) => t.type === "num" && !t.used);

  const suspects = unknown.filter((t) => t.placeLike || looksLikePlace(t.text));
  if (suspects.length) reasons.push(`noma'lum joy: ${suspects.map((t) => t.text).join(", ")}`);
  // Tushunilmagan son va undan keyingi so'z (lug'atni to'ldirish uchun: "15 tonnadan" — nimaga tushmadi)
  const numberContext = numbers.map((t) => {
    const line = lines[t.line].tokens;
    const next = line[line.indexOf(t) + 1];
    return `${t.text}${next ? ` ${next.text}` : ""}`;
  });
  const others = unknown.filter((t) => !suspects.includes(t));
  if (others.length > maxUnknown) reasons.push(`${others.length} ta noma'lum so'z`);
  if (numbers.length) reasons.push(`tushunilmagan son: ${numbers.map((t) => t.text).join(", ")}`);
  // Mashinaga o'xshagan noma'lum so'z ("Тень фура", "Tentfurakerak") yoki "kerak" oldidagi noma'lum so'z
  // ("линтейка керак") — bu so'z kerakli mashinani aytyapti, biz uni bilmaymiz
  const vehicleLike = others.filter((t) => {
    if (looksLikeVehicle(t.text)) return true;
    const line = lines[t.line].words;
    const next = line[line.indexOf(t) + 1];
    return next && next.index === t.index + 1 && NEED.has(wordKey(next.text));
  });
  if (vehicleLike.length) reasons.push(`noaniq mashina so'zi: ${vehicleLike.map((t) => t.text).join(", ")}`);

  // Yuk e'loni belgisi: "kerak", "yuk bor", "gruz", yuk nomi, yuklash, narx. Belgisi yo'q e'lon ("Ташкент бишкек тент мега",
  // "Nukus ⏎ Urganch ⏎ Tent ⏎ Shalanda") yuk ham, bo'sh mashina ham bo'lishi mumkin — AI hal qilsin
  const loadSignal =
    lines.some((l) => l.facts.some((f) => f.kind === "price")) ||
    tokens.some((t) => t.type === "word" && (t.used === "cargo" || LOAD_SIGNAL.has(wordKey(t.text))));
  if (!loadSignal) reasons.push(NO_LOAD_SIGNAL);
  // "Юк ёпилди" — yuk berib bo'lingan; "видийгами ... йук йугмиди" — savol (haydovchi so'rayapti)
  if (CLOSED_RE.test(latin)) reasons.push("yuk yopilgan");
  if (QUESTION_RE.test(latin)) reasons.push("savol");

  const segments = segmentsOf(lines);
  const read = segments.map(readSegment);
  if (read.some((s) => s.free)) reasons.push("bo'sh mashina e'loni");
  for (const s of read) reasons.push(...s.problems);
  // "Isuzi kerak chakman", "Катта Исузу ёки мини фура": har xil sinf sanalgan. Sxemada bitta sinf — qaysi birini olish
  // AI'da ham turlicha (ba'zan birinchisi, ba'zan oxirgisi), shuning uchun AI hal qilsin. Bir oila (katta isuzu / isuzu) — mayli
  const families = (s) => distinct(s.trucks.map((t) => truckFamily(t)));
  if (read.some((s) => families(s).length > 1 || (!allowAlternatives && s.trucks.length > 1))) reasons.push("bir nechta mashina turi");

  // Bir xil yuk ikki blokda (sarlavha + matn) — bitta
  const loads = [];
  for (const { load } of read) {
    if (!loads.some((l) => JSON.stringify(l) === JSON.stringify(load))) loads.push(load);
  }
  const ready = loads.map((load) => {
    const fixed = normalizePlaces(load);
    return { ...fixed, category: cargoCategory(fixed), phones };
  });
  // Bir nechta yukli e'lon: umumiy ma'lumot (mashina, og'irlik) qaysi yukka tegishli ekani ko'pincha noaniq
  // ("...Qorasuv 5ta ⏎ Tent plashadka farqi yoq" — oxirgi qator hammasiga). Faqat HAMMASI doiradan tashqari bo'lsa
  // ishonamiz (bunda e'lon baribir hech kimga ketmaydi)
  if (ready.length > 1 && ready.some((load) => routeInScope(load))) reasons.push("bir nechta yuk");
  const parsed = result(reasons.length === 0, distinct(reasons), "yuk_bor", ready, {
    truckClasses: distinct([...read.flatMap((s) => s.trucks), ...ready.map((l) => l.truckClass).filter(Boolean)]),
    unknown: others.map((t) => t.text),
    suspects: suspects.map((t) => t.text),
    numbers: numberContext,
    segments: segments.length,
  });
  // Tahlil qilingan qatorlar — fastLook (originsOf) uchun; JSON'ga va solishtirishlarga chiqmaydi
  Object.defineProperty(parsed, "lines", { value: lines, enumerable: false });
  return parsed;
}

// Yuk QAYERDAN yuklanadi — tezkor filtr uchun yagona muhim narsa (2026-11-19, Azimjon: «bizga faqat yuk qayerdan
// ketishi muhim … strelkaning chap tomoni; qayerga borishiga tupur». «Farg'onadan» filtri yoqilganda «Хоразм—>Брест»,
// «Наманган - Мурино» kelgan edi). parseByRules yo'nalishni faqat butun e'lon tushunilganda beradi; bu yerda har bir joy
// nomining O'ZI qaraladi — yuk tuzilishi tushunilmasa ham «qayerdan» topiladi. E'lon — yuklar ro'yxati bo'lishi mumkin,
// shuning uchun qatorma-qator, har yuk (blok) uchun alohida:
//   1) -dan / «из» / «Qayerdan:» / strelkaning chapi — qayerdan
//   2) qo'shimchasiz joylar: -ga li joydan OLDIN turgani («Toshkent Samarqandga»); bir qatorda ikki joyning birinchisi
//      («Наманган - Мурино», «TOSHKENT CHINOZ»)
//   3) qatorda yolg'iz qo'shimchasiz joy: blokda hali «qayerdan» yo'q bo'lsa — o'sha («Angren ⏎ Andijon Qorasuv», «Qo'qon
//      isuzu kerak»); undan keyingi qatordagi joylar — qayerga. Telefon qatori blokni yopadi
// «Qayerga» faqat bitta maqsadda o'qiladi: boradigan joyni «qayerdan» deb olmaslik uchun.
// → { origins: [viloyat kodlari], unknown: bool — «qayerdan» aytilgan, lekin biz bilmaydigan joy («Hasanboydan») }
function originsOf(lines) {
  const from = new Set();
  const regionOf = (m) => m.entry.region ?? (m.entry.country && m.entry.country !== HOME_COUNTRY ? "xorij" : null);
  const add = (m) => {
    const region = regionOf(m);
    if (region) from.add(region);
  };
  let awaiting = false; // blokda «qayerdan» yolg'iz qatordan olindi — keyingi joy(lar) «qayerga»
  let complete = false; // blokda yo'nalish to'liq — keyingi yolg'iz joy boshqa narsa (bozor, mo'ljal), yangi juftlik esa yangi yuk
  let unknown = false;
  for (const line of lines) {
    if (line.tokens.some((t) => t.type === "phone")) {
      awaiting = false;
      complete = false;
    }
    // «Toshkent Sergeli», «Samarqand Urgutdan» — viloyat + undagi joy: kengi tashlanadi
    const all = line.mentions.filter((m) => m.entry).sort((a, b) => a.index - b.index);
    const ms = all.filter((m, i) => !(all[i + 1] && !m.role && all[i + 1].index === m.end + 1 && contains(m.entry, all[i + 1].entry)));
    // Bizda yo'q joy -dan bilan («Hasanboydan», «Jomdan») yoki «Qayerdan:» qatoridagi noma'lum so'z
    // … shuningdek joy ichidagi nuqta («Mirbozordan», «Farxod bozoridan») va alohida yozilgan «dan» («sergili dan»)
    const stranger =
      line.words.find((w, i) => {
        if (w.used && w.used !== "detail") return false;
        if (CARGO_WORDS.has(wordKey(w.text))) return false;
        if (w.placeLike) return line.hint === "from";
        if (stems(w.text).some((x) => x.role === "from" && x.stem.length >= 4)) return true;
        const next = line.words[i + 1];
        return !w.used && w.text.length >= 4 && next && !next.used && next.index === w.index + 1 && LOOSE_SUFFIX[next.text] === "from";
      }) ??
      // «Qayerdan: …» qatorida yoki -dan bilan kelgan, lekin qaysi joyligi noaniq nom («Qorako'l», «Uchtepadan»)
      (line.hint === "from" && !all.length ? { index: -1 } : null) ??
      (line.mentions.some((m) => m.ambiguous) && line.words.some((w) => w.used === "ambiguous" && stems(w.text).some((x) => x.role === "from")) ? { index: -1 } : null);
    if (!ms.length) {
      if (stranger && !awaiting && !complete) unknown = true;
      continue;
    }
    const froms = ms.filter((m) => m.role === "from");
    const tos = ms.filter((m) => m.role === "to");
    const loose = ms.filter((m) => m.role !== "from" && m.role !== "to"); // qo'shimchasiz yoki -da
    if (froms.length) {
      for (const m of froms) {
        add(m);
        // «Farg'ona Yangiqo'rg'ondan»: oldidagi viloyat nomi — shu joyning viloyati (bir nomli joy bir necha viloyatda bor)
        const prev = all[all.indexOf(m) - 1];
        if (prev && !prev.role && regionLike(prev.entry) && prev.end + 1 === m.index) add(prev);
      }
      awaiting = false;
      complete = true;
    } else if (stranger) {
      // «Farg'ona Beshboladan», «Qo'qon promzonadan»: noma'lum joy oldidagi tanish joy — qayerdan (viloyati / shahri).
      // «Hasanboydan Bog'dodga»: oldida tanish joy yo'q — qayerdan noma'lum; keyingi tanish joylar qayerga
      // Tanish joy noma'lum so'zga yopishib turmasa: ikki tanish joy bo'lsa — birinchisi («Samarqand Qo'qon … mo'ljaldan»)
      const before = loose.filter((m) => m.index < stranger.index);
      const glued = before.find((m) => m.end + 1 === stranger.index);
      if (glued) add(glued);
      else if (before.length) add(before[0]);
      else unknown = true;
      awaiting = false;
      complete = true;
    } else if (tos.length) {
      const before = loose.filter((m) => m.index < tos[0].index);
      for (const m of before) add(m);
      awaiting = false;
      complete = complete || before.length > 0;
    } else if (awaiting) {
      awaiting = false;
      complete = true;
    } else if (loose.length >= 2) {
      add(loose[0]);
      complete = true;
    } else if (!complete) {
      // «Quyichirchiq. Yozyovon yuk», «Ko'kdala Qo'qon fura kerak»: tanish joy oldida noma'lum so'z — u «qayerdan» bo'lishi
      // mumkin (bizda yo'q joy), tanish joy esa qayerga. Aniq emas — «qayerdan noma'lum»
      const m = loose[0];
      const prev = line.words.find((w) => w.index === m.index - 1);
      if (prev && !prev.used && prev.text.length >= 5 && !CARGO_WORDS.has(wordKey(prev.text))) {
        unknown = true;
        complete = true;
      } else {
        add(m);
        awaiting = true;
      }
    }
  }
  return { origins: [...from], unknown: unknown && from.size === 0 };
}

// «Yuk (yoki bo'sh mashina) e'loniga o'xshaydimi» — AI'siz, tezkor: foydalanuvchi qo'shgan guruhning oxirgi xabarlarini
// ko'rib chiqishda (apps/collector probe.js). parseByRules ishonchli bo'lishi shart emas: joy topildi (qayerdan yoki qayerga)
// va telefon raqami bor yoki yuk belgisi (kerak, yuk bor, gruz, narx…) bor. Xizmat xabarlari («obuna bo'ling») — yo'q.
// 10.11 da AI tahlil qilgan 6 000 e'londa: «ha» deganlarining 99,9% i AI'da ham yuk e'loni, AI yuk deganlarining 96% i topiladi
export function looksLikeLoad(text) {
  return loadLike(parseByRules(String(text ?? "")), text);
}

const hasPlace = (load) => Boolean(load.fromRegion || load.fromCountry || load.toRegion || load.toCountry);

function loadLike(parsed, text) {
  if (parsed.service) return false;
  if (!parsed.loads.some(hasPlace)) return false;
  return extractPhones(String(text ?? "")).length > 0 || !parsed.reasons.includes(NO_LOAD_SIGNAL);
}

// Haydovchining «⚡ Tezkor» va «📌 Mening guruhlarim» rejimi (apps/bot pipeline.js, 2026-11-14): AI'ni kutmasdan,
// bitta qoidaviy tahlil bilan ikki savol. → { load, outOfScope }
//   load — yuk (yoki bo'sh mashina) e'loniga o'xshaydimi (looksLikeLoad bilan bir xil)
//   outOfScope — topilgan HAMMA yo'nalish doiradan tashqarida (scope — @yuk/shared ROUTE_SCOPES: Rossiya, Yevropa…).
//     Tezkor rejim shunday e'lonni tashlaydi. 2026-11-10/11 o'lchovi (AI natijasi bilan): uzoq yo'nalishlarning 96% i
//     ushlanadi, O'zbekiston ichi / qo'shnilar yukining 1,6% i adashib «tashqarida» chiqadi
export function quickLook(text, { scope } = {}) {
  const parsed = parseByRules(String(text ?? ""));
  const load = loadLike(parsed, text);
  const placed = parsed.loads.filter(hasPlace);
  const outOfScope = placed.length > 0 && placed.every((l) => !routeInScope(l, scope));
  return { load, outOfScope };
}

// Tezkor oqim filtri (apps/bot pipeline.js, 2026-11-19, Azimjon: «eng tez filter qiladigan yo'nalishlar kerak»). Bitta qoidaviy
// tahlil (~3 ms), AI yo'q. → { chatter, origins, trucks }
//   chatter — «quruq gap»: guruh botlarining xabari (obuna bo'ling, odam qo'shing, reklama tarqatmang), bo'sh mashina e'loni
//     (aniq andoza bilan) yoki na telefon, na joy bor matn («Clik borlar lichga», salom-alik). Haydovchiga hech qachon ketmaydi.
//     Ataylab yumshoq: shubhali bo'lsa — yuk deb o'tkaziladi (yuk yo'qolmasin). 2026-11-19 o'lchovi (5 000 e'lon):
//     ~22% tashlanadi; looksLikeLoad'dan farqi — joyi topilmagan, lekin telefonli yuklar o'tadi
//   origins — «qayerdan» viloyat kodlari (regions.js), trucks — transport turi kodlari (vehicles.js TRUCK_CLASSES).
//     Bo'sh — e'londa topilmadi (bunday e'lon har qanday filtrdan o'tadi)
export function fastLook(text) {
  const raw = String(text ?? "");
  const parsed = parseByRules(raw);
  const { origins, unknown: originUnknown } = parsed.lines ? originsOf(parsed.lines) : { origins: [], unknown: false };
  const trucks = parsed.truckClasses ?? [];
  if (parsed.service) return { chatter: true, origins, originUnknown, trucks };
  const latin = toLatin(raw);
  // Joy bormi: yuk tuzilishi tushunilmagan bo'lsa ham, matnda biror joy nomi tanilgan bo'lsa — bor
  const placed = parsed.loads.some(hasPlace) || (parsed.lines ?? []).some((l) => l.mentions.some((m) => m.entry));
  const phone = extractPhones(raw).length > 0;
  // Telefonsiz matn: joy ham bo'lmasa yoki yuk belgisi (yuk bor, kerak, tonna narxi…) bo'lmasa — suhbat (ovozli xabar matni:
  // «Angrenda metan qalay ekan, ochered kattami?»)
  const noSignal = parsed.reasons.includes(NO_LOAD_SIGNAL);
  // Joy nomi yo'q matn (telefoni bo'lsa ham) faqat aniq yuk belgisi bilan o'tadi: «yuk bor», «fura kerak», mashina turi yoki
  // og'irlik. Aks holda — reklama («…зарабатывать … пиши мне»), «<tel> shu nomerda ekan», ehtiyot qism savdosi
  const sure = LOAD_SURE.test(latin) || trucks.length > 0 || (parsed.lines ?? []).some((l) => l.facts.some((f) => f.weightT != null));
  const idle = placed ? !phone && noSignal : !sure || (!phone && noSignal);
  const freeTruck = !LOAD_SURE.test(latin) && FREE_TRUCK_PATTERNS.some((re) => re.test(latin));
  const chatter = freeTruck || CHATTER_PATTERNS.some((re) => re.test(latin)) || idle;
  return { chatter, origins, originUnknown, trucks };
}
