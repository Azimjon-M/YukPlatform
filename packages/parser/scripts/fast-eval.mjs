// Tezkor filtr (fastLook) o'lchovi: AI tahlil qilgan oxirgi 48 soatlik e'lonlarda «quruq gap» va «qayerdan» aniqligi,
// «📍 Qayerdan» filtri simulyatsiyasi (2026-11-19). Ishlatish (repo ildizidan):
//   node packages/parser/scripts/fast-eval.mjs [ko'rsatish: yukDropped,missedFargona,junkFargona,noOriginYuk,mistaken] [nechta]
// AI yorliqlari ham xato qiladi (Qo'qon → «buxoro»; «yuk olamiz isuzu» → yuk) — «adashdik» va «yuk tashlandi» ro'yxatini
// ko'z bilan tekshiring. Bazadan faqat o'qiydi; e'lon matnlari faqat ekranga chiqadi (telefonlar yashirilgan).
import { DatabaseSync } from "node:sqlite";
import { fastLook } from "../src/index.js";
const db = new DatabaseSync(process.env.YUK_DB ?? new URL("../../../data/yuk.db", import.meta.url).pathname, { readOnly: true });
const since = Date.now() - 48 * 3600e3;
const posts = db.prepare("SELECT id,text,error FROM posts INDEXED BY posts_created WHERE created_at > ? AND parsed_by='ai' AND status='done' AND direct IS NULL").all(since);
const loadRows = db.prepare("SELECT l.post_id, l.kind, l.data FROM loads l JOIN posts p ON p.id=l.post_id WHERE p.created_at > ? AND p.parsed_by='ai'").all(since);
const by = new Map();
for (const l of loadRows) { const d = JSON.parse(l.data); (by.get(l.post_id) ?? by.set(l.post_id, []).get(l.post_id)).push({ kind: l.kind, from: d.fromRegion ?? null }); }
const set = [];
for (const p of posts) {
  const ls = by.get(p.id) ?? [];
  let type;
  if (ls.some((l) => l.kind === "yuk")) type = "yuk";
  else if (ls.some((l) => l.kind === "mashina")) type = "mashina";
  else if (p.error === "boshqa") type = "boshqa";
  else if (/^Boshqa yo'nalish/.test(p.error ?? "")) type = "tashqi";
  else continue;
  set.push({ id: p.id, type, text: p.text, error: p.error, loads: ls });
}
console.log("e'lonlar", set.length);
const show = process.argv[2] ?? "";
const N = Number(process.argv[3] ?? 15);
const mask = (t) => t.replace(/\+?\d[\d ()-]{7,}\d/g, "<tel>").replace(/\s+/g, " ").slice(0, 170);
const ch = {}; const org = { empty: 0, agree: 0, disagree: 0, aiNone: 0 }; const ex = {};
const push = (k, o, extra = "") => { (ex[k] ??= []).push(`#${o.id} ${extra} | ${mask(o.text)}`); };
let t0 = Date.now();
const looks = set.map((o) => fastLook(o.text));
const ms = (Date.now() - t0) / set.length;
set.forEach((o, i) => {
  const look = looks[i];
  (ch[o.type] ??= { n: 0, chatter: 0 }).n++;
  if (look.chatter) { ch[o.type].chatter++; if (o.type === "yuk") push("yukDropped", o); return; }
  if (o.type === "mashina") push("mashinaPassed", o, `o=${look.origins}`);
  if (o.type === "boshqa") push("boshqaPassed", o, `o=${look.origins}`);
  if (o.type !== "yuk") return;
  const ai = [...new Set(o.loads.map((l) => l.from).filter(Boolean))];
  if (!ai.length) { org.aiNone++; if (look.origins.length) push("oursOnly", o, `o=${look.origins}`); return; }
  if (!look.origins.length) { org.empty++; push("empty", o, `ai=${ai}`); }
  else if (look.origins.some((r) => ai.includes(r))) org.agree++;
  else { org.disagree++; push("disagree", o, `ai=${ai} o=${look.origins}`); }
});
console.log(`ms/post ${ms.toFixed(2)}`);
for (const [k, v] of Object.entries(ch)) console.log(`chatter ${k}: ${v.chatter}/${v.n} = ${(100 * v.chatter / v.n).toFixed(1)}%`);
const tot = org.empty + org.agree + org.disagree;
console.log(`origin (yuk, AI biladi ${tot}): mos ${(100 * org.agree / tot).toFixed(1)}% · topilmadi ${(100 * org.empty / tot).toFixed(1)}% · boshqacha ${(100 * org.disagree / tot).toFixed(1)}% | AI bilmaydi ${org.aiNone}`);
// Filtr simulyatsiyasi: har viloyat uchun — yetkazilganlar nimadan iborat
for (const R of ["fargona", "toshkent_sh", "samarqand", "andijon"]) {
  const c = { sent: 0, right: 0, multi: 0, abroadR: 0, noOriginYuk: 0, noOriginAbroad: 0, mistaken: 0, unknownYuk: 0, junk: 0, truth: 0, missed: 0 };
  set.forEach((o, i) => {
    const look = looks[i];
    const ai = [...new Set(o.loads.map((l) => l.from).filter(Boolean))];
    const isTruth = o.type === "yuk" && ai.includes(R);
    if (isTruth) c.truth++;
    const pass = !look.chatter && (look.origins.length ? look.origins.includes(R) : !look.originUnknown);
    if (!pass) { if (isTruth) { c.missed++; if (R === "fargona") push("missedFargona", o, `o=${look.origins} ch=${look.chatter}`); } return; }
    c.sent++;
    const said = look.origins.includes(R);
    if (isTruth) c.right++;
    else if (o.type === "mashina" || o.type === "boshqa") { c.junk++; if (R === "fargona") push("junkFargona", o, `${o.type} o=${look.origins}`); }
    else if (o.type === "tashqi") { if (said) c.abroadR++; else { c.noOriginAbroad++; if (R === "fargona") push("noOriginAbroad", o, o.error?.slice(0, 45)); } }
    else if (!ai.length) c.unknownYuk++;
    else if (said) { c.mistaken++; if (R === "fargona") push("mistaken", o, `ai=${ai} o=${look.origins}`); }
    else { c.noOriginYuk++; if (R === "fargona") push("noOriginYuk", o, `ai=${ai}`); }
  });
  const good = c.right + c.abroadR;
  console.log(`${R}: yuborildi ${c.sent} | TO'G'RI ${good} (${(100 * good / c.sent).toFixed(0)}%) | joy topilmadi: yuk ${c.noOriginYuk}, chet el ${c.noOriginAbroad}, AI ham bilmaydi ${c.unknownYuk} | adashdik ${c.mistaken} | yuk emas ${c.junk} || haqiqiy ${c.truth}, yo'qotildi ${c.missed}`);
}
if (show) for (const k of show.split(",")) { console.log(`\n== ${k} (${ex[k]?.length ?? 0})`); const list = ex[k] ?? []; const step = Math.max(1, Math.floor(list.length / N)); for (let i = 0; i < list.length && i / step < N; i += step) console.log(list[i]); }
