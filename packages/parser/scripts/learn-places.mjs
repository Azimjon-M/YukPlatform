// «Qayta o'qitish»: AI yorliqlaridan joy nomlarini o'rganadi va src/rules/learnedPlaces.js ni qayta yozadi (2026-11-19).
// Ishlatish (repo ildizidan): node packages/parser/scripts/learn-places.mjs [kunlar=20]
// Bazadan faqat o'qiydi (data/yuk.db yoki YUK_DB). Oxirgi 48 soat olinmaydi — u fast-eval.mjs uchun sinov to'plami.
// Yangi ro'yxatni ko'zdan kechiring: oddiy so'zlar (joy emas) chiqsa — pastdagi BAD ga qo'shing va qayta ishga tushiring.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
process.env.YUK_NO_LEARNED = "1"; // avval o'rganilganlar ham qaytadan nomzod bo'lsin (places.js)
const { parseByRules } = await import("../src/index.js");
const { wordKey } = await import("../src/rules/text.js");
const db = new DatabaseSync(process.env.YUK_DB ?? new URL("../../../data/yuk.db", import.meta.url).pathname, { readOnly: true });
const until = Date.now() - 48 * 3600e3, since = until - Number(process.argv[2] ?? 20) * 86400e3;
const rows = db.prepare(`SELECT p.id, p.text, l.data FROM loads l JOIN posts p ON p.id = l.post_id
  WHERE p.created_at > ? AND p.created_at <= ? AND p.parsed_by = 'ai' AND l.kind = 'yuk'`).all(since, until);
const byPost = new Map();
for (const r of rows) { const d = JSON.parse(r.data); (byPost.get(r.id) ?? byPost.set(r.id, { text: r.text, loads: [] }).get(r.id)).loads.push(d); }
console.log("posts", byPost.size);
const SUF = { from: ["dagidan", "dan", "din", "den"], to: ["gacha", "ga", "ka", "qa"] };
const stat = new Map(); // key → { n, regions: {r: n}, forms: {form: n} }
let done = 0;
for (const { text, loads } of byPost.values()) {
  if (loads.length !== 1) continue; // bitta yukli e'lon — yorliq aniq
  const d = loads[0];
  const parsed = parseByRules(text);
  if (!parsed.lines) continue;
  for (const line of parsed.lines) for (const w of line.words) {
    if (w.used) continue;
    for (const [side, list] of Object.entries(SUF)) for (const suf of list) {
      if (!w.text.endsWith(suf) || w.text.length - suf.length < 4) continue;
      const stem = w.text.slice(0, -suf.length);
      const region = side === "from" ? d.fromRegion : d.toRegion;
      const country = side === "from" ? d.fromCountry : d.toCountry;
      if (!region) continue;
      const key = wordKey(stem);
      const s = stat.get(key) ?? stat.set(key, { n: 0, regions: {}, forms: {}, cities: {} }).get(key);
      s.n++; s.regions[region] = (s.regions[region] ?? 0) + 1; s.forms[stem] = (s.forms[stem] ?? 0) + 1;
      const city = side === "from" ? d.fromCity : d.toCity; if (city) s.cities[city] = (s.cities[city] ?? 0) + 1;
    }
  }
  if (++done % 5000 === 0) console.error(done);
}
const out = [];
for (const [key, s] of stat) {
  const [region, n] = Object.entries(s.regions).sort((a, b) => b[1] - a[1])[0];
  if (s.n < 3 || n / s.n < 0.85 || region === "xorij") continue;
  const form = Object.entries(s.forms).sort((a, b) => b[1] - a[1])[0][0];
  const city = Object.entries(s.cities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  out.push({ key, form, region, n: s.n, share: +(n / s.n).toFixed(2), city });
}
out.sort((a, b) => b.n - a.n);
console.log("nomzodlar", out.length);
const list = out;
// Joy nomi emas — oddiy so'zlar (qo'lda ko'rib chiqilgan)
const BAD = new Set(`talik tali metir super lola platina sino izza chim vizin pachkasi haladnli shredir lakakraska progruz zakazchi tsilindrv
trikotaj metro metan sprinterlar ikkita viloyatlari pasyolka kirpichka kichgina stadion panel avval orom metalbaza handal gres guruz dala
archa savod sovxoz aeraporti shamol shomol polvon tomi kuru tegirmon alanga chorvador tavarni tavarniy seti pulati buxoriy barsa mutabar
ulugbek yuksalish raximov sobiraximov raxmov surum pakana kurgon qorashina yitom ipadrom derenche xaladenlik selxoz seliskiy piravda
piyoonerka parovuz kason kosoni maxeyev alekseyev mayskiy klyon forj noviy`.split(/\s+/));
const keep = list.filter((o) => ((o.n >= 4 && o.share >= 0.9) || (o.n === 3 && o.share === 1 && o.key.length >= 6)) && o.key.length >= 4 && !BAD.has(o.form) && !BAD.has(o.key));
const tableRows = keep.map((o) => `  [${JSON.stringify(o.form)}, ${JSON.stringify(o.region)}, ${JSON.stringify(o.city && o.city.toLowerCase() !== o.form ? o.city : o.city)}],`);
const text = `// AI yorliqlaridan o'rganilgan joy nomlari va yozilishlari (2026-11-19). Manba: 20 kunlik, AI tahlil qilgan bitta yukli
// e'lonlar — e'londa -dan / -ga bilan kelgan, lug'atda yo'q so'z kamida 4 marta uchragan va AI uni 90%+ holda (3 marta bo‘lsa — har safar, 6+ harfli) bitta viloyatga
// bog'lagan (shahar nomi — AI eng ko'p yozgani). Oddiy so'zlar qo'lda olib tashlangan. Faqat joy nomlari — shaxsiy ma'lumot yo'q.
// Qayta yasash: node packages/parser/scripts/learn-places.mjs [yozilishi, viloyat, shahar | null]
export const LEARNED_PLACES = [
${tableRows.join("\n")}
];
`;
fs.writeFileSync(new URL("../src/rules/learnedPlaces.js", import.meta.url), text);
console.log("kept", keep.length, "hits", keep.reduce((a, o) => a + o.n, 0));
