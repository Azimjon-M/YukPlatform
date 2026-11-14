// Qoidaviy parser (src/rules) testlari. AI chaqirilmaydi — hammasi lug'at va qoidalar.
// Telefon raqamlari soxta (+998 90 000 00 0X).
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeLoad, parseByRules, quickLook } from "../src/index.js";
import { readNumbers } from "../src/rules/numbers.js";
import { findPlace } from "../src/rules/places.js";
import { editDistance, toLatin, wordKey } from "../src/rules/text.js";
import { cleanTemplates } from "../src/rules/templates.js";
import { routeInScope } from "@yuk/shared";

const PHONE = "+998900000001";
// Ishonchli natijaning yagona yukini qaytaradi (bo'lmasa — nega ishonchsizligini ko'rsatib yiqiladi)
function one(text) {
  const r = parseByRules(`${text}\n${PHONE}`);
  assert.equal(r.confident, true, `ishonchsiz: ${r.reasons.join("; ")}`);
  assert.equal(r.loads.length, 1);
  return r.loads[0];
}
const unsure = (text) => parseByRules(`${text}\n${PHONE}`);

test("toLatin: kirill → lotin, 'е' so'z boshida ye", () => {
  assert.equal(toLatin("Нукусдан Янгийўлга"), "nukusdan yangiyo'lga");
  assert.equal(toLatin("Ташкент"), "tashkent");
  assert.equal(toLatin("Ер"), "yer");
});

test("wordKey: imlo farqlari bir xil kalit", () => {
  assert.equal(wordKey("Qo'qon"), wordKey("kokon"));
  assert.equal(wordKey("isuzzu"), wordKey("isuzu"));
  assert.equal(wordKey("Xorazm"), wordKey("horazm"));
});

test("editDistance: Damerau (yonma-yon harflar almashuvi = 1)", () => {
  assert.equal(editDistance("samarqand", "samraqand"), 1);
  assert.equal(editDistance("andijon", "adijon"), 1);
  assert.equal(editDistance("buxoro", "navoiy", 2), 3); // chegaradan oshdi — max + 1
});

test("findPlace: aniq, imlo xatosi bilan, noaniq", () => {
  assert.equal(findPlace("Samarqand").entry.region, "samarqand");
  assert.equal(findPlace("Samarkant").entry.name, "Samarqand");
  assert.equal(findPlace("Samarkant", { exact: true }), null);
  // Bitta joyning ikki yozilishi (toshkent / toshken) teng masofada — tenglik emas
  assert.equal(findPlace("toshket").entry.name, "Toshkent");
  assert.equal(findPlace("Vodiy").ambiguous, true);
});

test("readNumbers: og'irlik, narx, hajm", () => {
  const kinds = (line) => readNumbers(line).facts.map((f) => [f.kind, f.weightT ?? f.price ?? f.volumeM3 ?? null]);
  assert.deepEqual(kinds("20-22 tonna"), [["weight", 22]]);
  assert.deepEqual(kinds("3800 so'm"), [["price", 3_800_000]]);
  assert.deepEqual(kinds("kilosiga 200 so'm"), [["price", 200]]);
  assert.deepEqual(kinds("4,5 mln"), [["price", 4_500_000]]);
  assert.deepEqual(kinds("60.kub"), [["volume", 60]]); // readNumbers lotin matn oladi (toLatin dan keyin)
  assert.deepEqual(kinds("5 kilo"), [["weight", 0.005]]);
});

test("oddiy e'lon: yo'nalish, mashina, og'irlik", () => {
  const load = one("Нукусдан Янгийўлга 20 тонна тент фура кк");
  assert.equal(load.fromCity, "Nukus");
  assert.equal(load.toCity, "Yangiyo'l");
  assert.equal(load.toRegion, "toshkent");
  assert.equal(load.truckClass, "fura");
  assert.equal(load.bodyType, "tent");
  assert.equal(load.weightT, 20);
  assert.deepEqual(load.phones, [PHONE]);
});

test("viloyat + undagi joy → aniqrog'i; tuman → Toshkent shahri", () => {
  assert.equal(one("Samarqand Urgutdan Toshkentga 10 tonna yuk bor").fromCity, "Urgut");
  const load = one("Sergelidan Andijonga isuzu kerak 5 tonna");
  assert.equal(load.fromCity, "Toshkent");
  assert.equal(load.fromPlace, "Sergeli");
});

test("og'zaki qo'shimchalar: -an, qozoqcha -ten, ruscha kelishik", () => {
  assert.equal(one("Urgutan Navoiyga yuk bor 5 tonna isuzu").fromCity, "Urgut");
  assert.equal(one("Шымкенттен Тошкентка фура керак юк бор").fromCountry, "Qozog'iston");
  const ru = one("Груз из Ташкента в Самарканд 20 тонн тент");
  assert.equal(ru.fromCity, "Toshkent");
  assert.equal(ru.toCity, "Samarqand");
});

test("AI qoidalari: kuzov yolg'iz sinf emas; 15 t dan og'ir — fura", () => {
  assert.equal(one("Qarshidan Buxoroga plashatka kerak").truckClass, null);
  assert.equal(one("Toshkentdan Samarqandga 22 tonna tent kerak").truckClass, "fura");
  assert.equal(one("Toshkentdan Samarqandga 8 tonna tent kerak").truckClass, null);
});

test("ruscha ko'plik va imlo xatolari: тенты, рефов, isizu, teyet fura", () => {
  assert.equal(one("Toshkentdan Andijonga 20 tonna yuk bor tenti kerak").bodyType, "tent");
  assert.equal(one("Toshkentdan Andijonga 5 tonna yuk bor isizu kerak").truckClass, "isuzu");
  assert.equal(one("Andijon Qo'rg'ontepadan Farg'onaga teyet fura kk").bodyType, "tent");
});

test("yuklash tomoni: «usti ochiladigon» — ustidan", () => {
  assert.deepEqual(one("Samarqanddan Gulistonga 7 tonna metallom bor isuzu kerak usti ochiladigon").loadingSides, ["ust"]);
});

test("ishonchsiz: noma'lum joy, ko'p yo'nalish, bo'sh mashina, savol", () => {
  assert.match(unsure("Hasanboydan Toshkentga 20 tonna yuk bor").reasons.join(), /noma'lum joy/);
  assert.match(unsure("Toshkent - Andijon\n20 tonna\nSamarqand - Buxoro\n10 tonna\nyuk bor").reasons.join(), /joy|yuk/);
  assert.match(unsure("тошкентдан Самаркандга шаланда бор").reasons.join(), /bo'sh mashina/);
  assert.match(unsure("Toshkent Navoiy yuk olamiz 24 tonnagacha tentofka").reasons.join(), /bo'sh mashina/);
  assert.match(unsure("Самарканддан видийгами тошкентгами йук бормиди").reasons.join(), /savol/);
  assert.match(unsure("Жиззах Сирдарё юк ёпилди").reasons.join(), /yopilgan/);
});

test("ishonchsiz: har xil sinf sanalgan, mashinaga o'xshash noma'lum so'z", () => {
  assert.match(unsure("Toshkent - Andijon katta isuzu yoki mini fura kerak 13 tonna yuk bor").reasons.join(), /bir nechta mashina turi/);
  assert.match(unsure("Toshkentdan Andijonga 20 tonna yuk bor linteyka kerak").reasons.join(), /noaniq mashina/);
});

test("ishonchsiz: yuk belgisi yo'q (yuk ham, mashina ham bo'lishi mumkin)", () => {
  assert.match(unsure("Ташкент бишкек тент мега").reasons.join(), /aniq emas/);
});

test("xizmat xabari — boshqa, yuklarsiz", () => {
  const r = parseByRules("Akmal, guruh qoidalariga amal qiling. Reklama tarqatmang!");
  assert.equal(r.confident, true);
  assert.equal(r.postType, "boshqa");
  assert.deepEqual(r.loads, []);
});

test("doiradan tashqari yo'nalish ham ishonchli (bot uni baribir yubormaydi)", () => {
  const load = one("Москва - Ташкент 20 тонн тент груз есть");
  assert.equal(load.fromCountry, "Rossiya");
  assert.equal(load.toCity, "Toshkent");
});

// --- Avto-joylash shablonlari (GLogistics, Logistik.uz, kanal boti) — 2026-11-09 ---
const GLOG_FOOTER = `ℹ️ Batafsil ma'lumot va bog'lanish:
👉 https://glogistics.xyz/uz/cargo/0000000000000000

━━━━━━━━━━━━━━━━━━━━━
⚡️ YUKBOR & GLOGISTICS — TEZKOR LOGISTIKA
Barcha yangi yuklarni ko'rish yoki bepul e'lon berish uchun:
🤖 Telegram Bot: @soxta_bot (Tezkor yuk/mashina topish)
🌐 Rasmiy Sayt: https://glogistics.xyz (Kunlik 1000+ yangi yuklar)
━━━━━━━━━━━━━━━━━━━━━
🔥 E'loningizni bitta joyga joylang — biz uni 50+ guruhlarga avtomatik tarqatamiz!`;
const glog = (route, short, body = "Tent", weight = "20 tonna") =>
  `🔥 YANGI YUK E'LONI!\n\n${route}\n\n📦 Yuk: ${short} yuk (${body})\n🚛 Transport: ${body}\n⚖️ Vazni: ${weight}\n💰 To'lov: Kelishiladi\n\n${GLOG_FOOTER}`;
const LOGISTIK_FOOTER = `📞 Aloqa: Bog'lanish / Связаться
📲 Ilovani yuklab olish

⏱ Vaqtingizni tejang!
Logistik.uz’da e’lon joylang — 🤖 botimiz e’lonlaringizni guruhlarga avtomatik tashlaydi.`;
const logistik = (from, to, { title = "📦 🇺🇿 MAHALLIY YUK #ID44DAD7", body = "Tent", cargo = "Yuk", weight = "⚖️ Og'irligi: 20.0 t", price = "Kelishilgan holda" } = {}) =>
  `${title}\n\n📍 Qayerdan: ${from}\n🏁 Qayerga: ${to}\n\n🚚 Transport turi: ${body}\n📦 Yuk turi: ${cargo}\n${weight}\n📏 Hajmi: —\n\n💰 ${price}\n💳 To'lov turi: Naqd\n\n${LOGISTIK_FOOTER}`;
// Shablon e'lonlarida telefon matnda yo'q (havolada) — parseByRules o'zi chaqiriladi
const sure = (text) => {
  const r = parseByRules(text);
  assert.equal(r.confident, true, `ishonchsiz: ${r.reasons.join("; ")}`);
  assert.equal(r.loads.length, 1);
  return r.loads[0];
};

test("cleanTemplates: reklama qatorlari bo'shaydi, yorliqlar yo'nalish beradi, qatorlar soni o'zgarmaydi", () => {
  const latin = toLatin(logistik("🇺🇿 Xorazm viloyati", "🇺🇿 Buxoro viloyati"));
  const lines = cleanTemplates(latin);
  assert.equal(lines.length, latin.split("\n").length);
  assert.deepEqual(lines.filter((l) => l.hint).map((l) => [l.hint, l.text.trim()]), [
    ["from", "🇺🇿 xorazm viloyati"],
    ["to", "🇺🇿 buxoro viloyati"],
    ["cargo", "yuk"],
  ]);
  assert.equal(lines.some((l) => /logistik|bog'lanish|ilovani|#id/.test(l.text)), false);
  // GLogistics: "YUKBOR & GLOGISTICS" dan oxirigacha — reklama (faqat "━━━" chizig'i qoladi, unda so'z yo'q)
  assert.deepEqual(cleanTemplates(toLatin(GLOG_FOOTER)).filter((l) => /\p{L}/u.test(l.text)), []);
});

test("GLogistics: «Davlat, Joy shahri ➡️ Davlat, Joy shahri», reklama pastda", () => {
  const load = sure(glog("🇺🇿 O'zbekiston, Surxondaryo shahri ➡️ 🇺🇿 O'zbekiston, Qashqadaryo shahri", "Surxondaryo ➡️ Qashqadaryo"));
  assert.deepEqual([load.fromCity, load.fromRegion, load.toCity, load.toRegion], [null, "surxondaryo", null, "qashqadaryo"]);
  assert.deepEqual([load.weightT, load.truckClass, load.bodyType, load.negotiable], [20, "fura", "tent", true]);
  const kz = sure(glog("🇰🇿 Qozog'iston, Chimkent shahri ➡️ 🇺🇿 O'zbekiston, Toshkent shahri", "Chimkent ➡️ Toshkent", "Ref"));
  assert.deepEqual([kz.fromCity, kz.fromCountry, kz.toCity, kz.toRegion, kz.bodyType], ["Shymkent", "Qozog'iston", "Toshkent", "toshkent_sh", "ref"]);
  // Moskva — doiradan tashqari, lekin ishonchli: bot e'lonni AI'siz yopadi
  assert.equal(routeInScope(sure(glog("🇺🇿 O'zbekiston, Samarqand shahri ➡️ 🇷🇺 Rossiya, Moskva shahri", "Samarqand ➡️ Moskva"))), false);
});

test("Logistik.uz: «Qayerdan: / Qayerga:», tuman + viloyat → aniqrog'i", () => {
  const a = sure(logistik("🇺🇿 Xorazm viloyati", "🇺🇿 Buxoro viloyati", { body: "Bort" }));
  // "Buxoro viloyati" — viloyat, Buxoro shahri emas
  assert.deepEqual([a.fromRegion, a.toCity, a.toRegion, a.bodyType, a.weightT], ["xorazm", null, "buxoro", "ploshatka", 20]);
  const b = sure(logistik("🇺🇿 Andijon tumani, Andijon viloyati", "🇺🇿 Namangan shahri, Namangan viloyati"));
  assert.deepEqual([b.fromCity, b.fromRegion, b.toCity, b.toRegion], ["Andijon", "andijon", "Namangan", "namangan"]);
  const c = sure(logistik("🇺🇿 Yunusobod tumani, Toshkent shahri", "🇺🇿 Pop tumani, Namangan viloyati"));
  assert.deepEqual([c.fromRegion, c.fromPlace, c.toCity, c.toRegion], ["toshkent_sh", "Yunusobod", "Pop", "namangan"]);
  const d = sure(logistik("🇺🇿 Farg'ona viloyati, O'zbekiston", "🇷🇺 Sverdlovsk viloyati, Rossiya", { title: "🔥 DIQQAT! 🌐 XALQARO YUK #ID3CF23F", cargo: "Kafel", weight: "⚖️ Og'irligi: 22.0 t", price: "2750 USD" }));
  assert.deepEqual([d.fromRegion, d.toCountry, d.cargo, d.price, d.currency, d.weightT], ["fargona", "Rossiya", "kafel", 2750, "USD", 22]);
});

test("Logistik.uz: ishonchsiz — noma'lum joy (doiradagi davlatda) va mashina e'loni", () => {
  // Bizda yo'q joy + O'zbekiston: faqat davlat bilan yuk hamma haydovchiga ketardi — AI hal qilsin
  assert.match(parseByRules(logistik("🇺🇿 Xyzobod tumani, O'zbekiston", "🇺🇿 Buxoro viloyati")).reasons.join(), /noma'lum joy/);
  const truck = logistik("🇺🇿 Toshkent shahri", "🇺🇿 Andijon viloyati", { title: "🔥 DIQQAT! 🇺🇿 MAHALLIY MASHINA #ID41581A", weight: "⚖️ Yuk ko'tarishi: 22 t" });
  assert.match(parseByRules(truck).reasons.join(), /bo'sh mashina/);
});

test("kanal boti: «🅰️ … → 🅱️ …» sarlavhasi, heshteglar va muallif qatori hisobga olinmaydi", () => {
  const text = `📦 YUK BOR\n🅰️ Samarqand → 🅱️ Koson\n🚛 Fura\n\nSamarqanddan Kosonga 20 tonna yuk bor tent fura kerak\n\n📞 ${PHONE}\n✍️ Soxta Muallif\n📢 Kanalga qo\`shilish: @soxta_kanal\n\n#Samarqand #Самарканд #Qashqadaryo #Qarshi #Fura #YukBor\n━━━━━━━━━━━━━━━━━\n🔎 Kuchli qidiruv: #Samarqand_Fura #Qashqadaryo_Fura\n━━━━━━━━━━━━━━━━━\n🎯 Filtrlangan e'lonlar: @soxta_filtr\n━━━━━━━━━━━━━━━━━\n\n🤖 @soxta_bot orqali joylashtirildi`;
  const load = sure(text);
  assert.deepEqual([load.fromCity, load.toCity, load.toRegion, load.weightT, load.bodyType, load.truckClass], ["Samarqand", "Koson", "qashqadaryo", 20, "tent", "fura"]);
  assert.deepEqual(load.phones, [PHONE]);
});

test("strelkali qator: noma'lum yuk nomi kechiriladi, davlat yonidagi noma'lum joy — yo'q", () => {
  assert.equal(one("Toshkent → Andijon divan 5 tonna isuzu kerak").toRegion, "andijon");
  assert.match(unsure("O'zbekiston, Xyzobod ➡️ Qozog'iston, Chimkent 20 tonna tent kerak").reasons.join(), /noma'lum joy/);
});

test("Targo.uz boti xabari — xizmat xabari", () => {
  const r = parseByRules("Soxta Ism, кечирасиз, бу гуруҳда ёзиш учун Targo.uz канали ва гуруҳига обуна бўлинг 👇\nОбуна бўлгач, «✅ Текшириш» тугмасини босинг");
  assert.deepEqual([r.confident, r.postType, r.loads.length], [true, "boshqa", 0]);
});

test("looksLikeLoad: joy + telefon yoki yuk belgisi — e'lon; salomlashish, ob-havo, obuna reklamasi — yo'q", () => {
  assert.equal(looksLikeLoad("Toshkentdan Samarqandga 20 tonna un bor, tent kerak +998 90 000 00 01"), true);
  assert.equal(looksLikeLoad("Fargona Buxoro fura kerak"), true, "telefonsiz, lekin «kerak»");
  assert.equal(looksLikeLoad("Isuzu bor, Andijon Toshkent yuk olamiz +998 90 000 00 02"), true, "bo'sh mashina e'loni ham");
  assert.equal(looksLikeLoad("Assalomu alaykum, hammaga xayrli kun"), false);
  assert.equal(looksLikeLoad("Toshkentda bugun havo issiq"), false, "joy bor, lekin yuk belgisi ham, telefon ham yo'q");
  assert.equal(looksLikeLoad("Bu guruhda yozish uchun @kanal ga obuna bo`ling"), false);
  assert.equal(looksLikeLoad(""), false);
});

test("quickLook (tezkor rejim): yuk e'lonimi va faqat chet el yo'nalishimi — bitta tahlil bilan", () => {
  assert.deepEqual(quickLook("Toshkentdan Samarqandga 20 tonna un bor, tent kerak +998 90 000 00 01", { scope: "qoshni" }), { load: true, outOfScope: false });
  // Faqat uzoq yo'nalish — tezkor rejim tashlaydi
  assert.deepEqual(quickLook("Москва Санкт-Петербург 20 тонна тент керак +998 90 000 00 01", { scope: "qoshni" }), { load: true, outOfScope: true });
  // Qo'shni davlat bilan — doirada
  assert.equal(quickLook("Toshkent Olmaota 20 tonna tent kerak +998 90 000 00 01", { scope: "qoshni" }).outOfScope, false);
  // Joy topilmasa — «tashqarida» emas (bilmaymiz)
  assert.deepEqual(quickLook("Assalomu alaykum hammaga", { scope: "qoshni" }), { load: false, outOfScope: false });
});
