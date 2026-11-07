# parser — AI parser

**Bosqich:** 0 ✅ haqiqiy e'lonlarda sinaldi: qo'lda tekshirilgan 32 ta e'londa aniqlik **99%** (424 maydondan 421 tasi to'g'ri) (Gemini bepul tarifi)

E'lon matnini (kirill/lotin aralash, ruscha, turkcha so'zlar, qisqartmalar bilan) tuzilgan JSON'ga aylantiradi.

## Ishga tushirish (YukPlatform papkasida)

```bash
npm install                        # bir marta
npm test                           # testlar (API kerak emas)
npm run parse -- --dry-run         # AI'siz: e'lonlarni sanash, telefonlarni ajratish
npm run parse -- --models          # kalitingiz bilan mavjud modellar
npm run parse -- --limit 10        # birinchi 10 ta e'lonni AI bilan tahlil qilish
npm run parse                      # hammasini
npm run parse -- --skip 120        # limit tugab qolsa, 121-e'londan davom etish
npm run parse -- --only 3,27,38    # faqat shu raqamli e'lonlar
npm run parse -- --batch 1         # har e'lon alohida so'rov (standart: 10 ta e'lon bitta so'rovda)
npm run parse -- --provider onepro --only gold --out data/samples/natija-1pro.jsonl   # boshqa AI bilan (.env dagi PARSER_PROVIDER o'rniga)
```

Natija `data/samples/natija.jsonl` fayliga yoziladi (gitga tushmaydi), terminalda esa qisqa hisobot chiqadi: qancha e'lon, qaysi maydonlar necha foiz to'ldirildi, token sarfi va taxminiy narx.

Qo'shimcha parametrlar: `--file <yo'l>`, `--out <yo'l>`, `--concurrency <son>`, `--batch <son>`, `--provider gemini|onepro|claude`, `--model <nomi>`.

⚠️ `--out` fayli har safar **ustidan yoziladi**. Solishtirish uchun har bir yugurishga alohida nom bering (`natija-v6.jsonl`, `natija-v6-b10.jsonl`...).

## Aniqlikni tekshirish

`data/samples/gold.jsonl` — qo'lda tekshirilgan "to'g'ri javoblar": 32 ta e'lon, 52 ta yuk. Faqat ishonchli maydonlar yozilgan, yozilmagan maydon tekshirilmaydi.

```bash
npm run parse -- --only gold --out data/samples/natija-v4.jsonl   # faqat gold e'lonlarni tahlil qilish
npm run parse:eval -- --results data/samples/natija-v3.jsonl --results data/samples/natija-v4.jsonl --details
```

`parse:eval` har bir maydon bo'yicha foizni yonma-yon chiqaradi va `--details` bilan xatolarni ko'rsatadi. Prompt'ni o'zgartirgandan keyin shu ikki buyruq bilan yaxshilandimi yoki yomonlashdimi, ko'rasiz.

| Versiya | Nima o'zgardi | Aniqlik |
|---|---|---|
| v1 | Birinchi prompt, bitta `vehicle` maydoni | 85% (362/424) |
| v3 | Haydovchi suhbatidan keyin yangi sxema; joy, og'irlik oralig'i, narx qoidalari | 98% (417/424) |
| v4 + kod qoidalari | "tent kerak" o'lcham emas; viloyat ro'yxatdan, "Toshkent Nazarbek" → Nazarbek, toifa og'irlikdan | 99.3% (421/424) |
| v5 | "mega fura" kuzov emas | 99.3% (421/424) |
| 1pro, batch 10 | `qwen3.8-flash` (1pro.uz), 2026-11-06; bitta guruh 524 bo'lib bo'lindi | 98.3% (417/424) |
| 1pro, batch 6 | xuddi shu, standart guruh 6 ta, 6 so'rov, 118 s | 99.1% (420/424) |

Bir xil prompt ikki marta ishga tushirilsa ham natija 1–2 maydonga farq qilishi mumkin. Shuning uchun faqat jami foizga emas, har bir maydon jadvaliga qarang.

## Bir so'rovda bir nechta e'lon (batch)

Bepul Gemini kuniga **500 ta so'rov** beradi (2026-11-05 da 429 javobidan o'qildi: `gemini-3.5-flash-lite`, har bir model uchun alohida). Har e'longa bitta so'rov bo'lsa — kuniga 500 ta e'lon. Guruhlar esa daqiqasiga ~15 ta yangi e'lon tashlaydi. Shuning uchun bot e'lonlarni **10 tadan bitta so'rovda** yuboradi:

- E'lonlar matnda `=== POST 1 ===`, `=== POST 2 ===` sarlavhalari bilan ajratiladi, telefonlar har birida oldindan `[telefon]` qilinadi.
- AI har bir e'lon javobini o'sha raqam (`id`) bilan qaytaradi; kod javobni raqami bo'yicha e'loniga qaytaradi va telefonni o'sha e'londan biriktiradi.
- Javob ishonchsiz bo'lsa (JSON buzuq, e'lon tushib qolgan yoki ikki marta kelgan, noma'lum raqam, javob uzilgan, bloklangan) — guruh **ikkiga bo'linib** qayta yuboriladi (10 → 5 + 5 → ... → bittadan). Raqam adashsa bir e'londagi yo'nalish boshqa e'lon telefoniga yopishib qolishi mumkin, shuning uchun bunday javobning hech bir qismi ishlatilmaydi.
- Limit (429) yoki model band (503) bo'lsa — xato chaqiruvchiga qaytadi, bot kutadi, e'lonlar navbatda qoladi.
- Ko'rsatma (`BATCH_SYSTEM_PROMPT`) oddiy ko'rsatma + oxirida batch qoidasi; boshi bir xil bo'lgani uchun Gemini uni keshlaydi.

Aniqlik (gold, 32 e'lon / 424 maydon, 2026-11-05). Asosiy model limiti tugagani uchun taqqoslash alohida limitli `gemini-3.1-flash-lite` da qilindi:

| Bir so'rovda | So'rovlar | Aniqlik | Vaqt (ketma-ket) |
|---|---|---|---|
| 1 (eski usul) | 32 | 98.6% (418) | — |
| 10 (standart) | 4 | 97.9% (415, 415) | ~30 s |
| 16 | 2 | 97.4–98.3% (413, 417) | ~26 s |
| 32 | 1 | 96.2–97.6% (408, 414) | ~27 s |

- Batch'da AI eng yangi qoidalarni biroz yomonroq eslaydi: "tent kerak" → fura, faqat davlat yozilgan bo'lsa poytaxt ("Berlin"), ikki kuzov variantida "tent". 32 talikda bir marta 5 ta yukda narx ×1000 qilinmay qoldi — shuning uchun standart 10.
- Asosiy model (`gemini-3.5-flash-lite`) da limit tugaguncha 10 talik bitta guruh o'lchandi: 178/180, xuddi shu 10 e'londa v5 (bittadan) 180/180.
- Kiruvchi tokenlar e'lon boshiga ~5 600 → ~800 (ko'rsatma bir marta yuboriladi).

Bot navbatda 10 tadan kam e'lon bo'lsa, eng eski e'lon **navbatga tushganidan** 90 soniya o'tguncha ko'proq yig'ilishini kutadi (`PARSER_BATCH_WAIT`) — aks holda navbat bo'sh paytda har 1–2 e'lon uchun alohida so'rov ketardi.

Nega joylangan vaqtdan emas: collector guruhlarni har ~1 daqiqada o'qiydi, e'lon navbatga o'rtacha 40 s kechikib tushadi. 2026-11-05 da kutish joylangan vaqtdan 60 s edi — amalda ~20 s, so'rovga o'rtacha 4–5 ta e'lon ketdi va kunlik bepul limit 21:20 da tugadi. O'sha kungi haqiqiy oqim ustidagi simulyatsiya (5 062 ta noyob e'lon, batch 10):

| Kutish | So'rovlar | E'lon / so'rov | E'lonning qo'shimcha kutishi |
|---|---|---|---|
| joylangan vaqtdan 60 s (eski) | 1 134 | 4,5 | ~7 s |
| navbat vaqtidan 60 s | 809 | 6,3 | ~32 s |
| **navbat vaqtidan 90 s (standart)** | **580** | **8,7** | **~32 s** |
| navbat vaqtidan 180 s | 543 | 9,3 | ~40 s |
| navbat vaqtidan 180 s, batch 15 | 389 | 13,0 | ~53 s |

Limit yana yetmasa — `PARSER_BATCH=15` (aniqlik biroz pasayadi, jadval yuqorida) va `PARSER_BATCH_WAIT=180`.

## Bir nechta AI parallel (pool)

Bot bitta kalit bilan emas, **ulanishlar** bilan ishlaydi: ulanish = kalit + model. Ular boshqaruv markazining
**«AI»** bo'limida qo'shiladi (http://localhost:3000/admin/ai), kalitlar bazada shifrlangan holda saqlanadi.
`.env` dagi `GEMINI_API_KEY` va `ONEPRO_API_KEY` ro'yxatga o'zi qo'shiladi (har biri bir marta; o'chirilsa qayta qo'shilmaydi).

- Gemini'da kunlik limit **har bir model uchun alohida**: bitta kalitga 3 ta model qo'shilsa, kuniga 3 × 500 so'rov.
- Bot hamma yoqilgan ulanishni **parallel** ishlatadi: har biri navbatdan o'z 10 talik guruhini oladi (eng yangilari birinchi).
- Biri limitga tushsa, faqat o'sha **dam oladi**: daqiqalik limit — Google aytgan soniyacha; kunlik — 1pro'da
  `Retry-After` gacha, Gemini'da **har 30 daqiqada bitta so'rov bilan tekshiriladi** (2026-11-06: 21:21 da tugagan limit
  13:00 dan oldin qaytgan — rad etilgan so'rov limitdan sarflanmaydi); model band (502/503/504) — 5 daqiqa; internet
  uzildi — 30 s; kalit yoki model xato — 6 soat (yoki tuzatilguncha). Qolganlari ishlayveradi.
- **Xatoda e'lonlar darhol boshqa modelga o'tadi:** pool'dagi parser so'rov xatosida guruhni o'zida bo'lib qayta
  yubormaydi (`splitOnError: false`, SDK `attempts: 1`) — xato ishchiga qaytadi, guruhning e'lonlari navbatga qaytadi va
  bo'sh ulanish ularni oladi. Noma'lum xato (500, 400…) bergan ulanish 1 daqiqa dam oladi; bitta e'lon 3 ta ulanishda
  shunday xato bersa, «failed» bo'ladi (e'lonning o'zi sabab bo'lishi mumkin). Yolg'iz ulanishda eski usul: bittadan tahlil.
- **«Muammoli» belgisi (📌):** 24 soatda 4 ta yoki oxirgi 10 so'rovdan 3 tasi xato (band, kalit, model, noma'lum;
  limitlar va internet uzilishi sanalmaydi) → ulanish oxirgi navbatda beriladi va har xatodan keyin kamida 15 daqiqa dam
  oladi. 24 soat xatosiz o'tsa yoki «Belgini olib tashlash» bosilsa yechiladi (`HEALTH`, `PAUSES` — `src/pool.js`).
- Boshqaruv markazi buyruqlari `ai_slots.control` ustunida (`{ wakeAt, healthResetAt }`): muvaffaqiyatli «Sinash» dam
  olishni bekor qiladi, bot uni 15 s ichida o'qib bir marta bajaradi (`wakeSeen`/`healthSeen` state'da).
- Dam olish muddati bazada saqlanadi: bot qayta ishga tushsa ham kunlik limitga tushgan ulanish darhol qayta so'ralmaydi.
- Jonli sinov (2026-11-06, bazaning nusxasida, 6 ulanish, 60 e'lon): 6 ta so'rov bir vaqtda ketdi; soxta 500 bergan va
  kunlik limitdagi 3 ta modelning e'lonlari (30 ta) darhol qolgan uchtasiga o'tdi — 60/60 tahlil qilindi, ~90 s.
- Ro'yxat har 15 s da qayta o'qiladi — kalit qo'shish yoki o'chirish uchun botni qayta ishga tushirish shart emas.
- Kanal va haydovchilarga yuborish avvalgidek **ketma-ket** (Telegram limitlari). AI Telegram'dan tez ishlasa, bot
  ortiqcha tahlil qilmaydi: yuborish navbatida 30 tadan ko'p e'lon tursa, yangi guruh olmaydi.

**Diqqat:** limitni chetlab o'tish uchun boshqa-boshqa Google akkauntlaridan ko'p bepul kalit olish Google shartlariga
zid bo'lishi mumkin (akkaunt bloklanishi mumkin). Xavfsiz yo'l — bitta kalitda bir nechta model, kerak bo'lsa pullik tarif.

## AI provayderlari

| Provayder | Narxi | Kalit | Standart model |
|---|---|---|---|
| `gemini` (standart) | **Bepul tarif** | aistudio.google.com → Get API key | `gemini-flash-lite-latest` |
| `onepro` | Kunlik limit: **1 000 000 javob tokeni** | 1pro.uz kaliti (`sk-…`), `.env` da `ONEPRO_API_KEY` | `qwen3.8-flash` |
| `claude` | Pullik | console.anthropic.com → API Keys | `claude-opus-5-5` |

**Gemini bepul tarifi haqida:**
- Daqiqalik (~15) va kunlik (**500**, `gemini-3.5-flash-lite`) so'rovlar soni cheklangan; har bir modelning limiti alohida. Kunlik limit Toshkent vaqti bilan **13:00 da** yangilanadi (Tinch okeani vaqti yarim tunda). Gemini bir vaqtda faqat 2 ta so'rov yuboradi.
- Daqiqalik limitga urilsa (taxminan 16 ta so'rovdan keyin), dastur Google aytgan vaqtcha kutadi va o'sha e'londan davom etadi.
- Kunlik limit tugasa yoki model band bo'lsa (503), ish to'xtaydi, tayyor natijalar saqlanadi va qaysi `--skip` bilan davom etish kerakligi ko'rsatiladi.
- Google bepul tarifda yuborilgan matnlardan o'z mahsulotlarini yaxshilash uchun foydalanishi mumkin. Shuning uchun telefon raqamlari AI'ga yuborilmaydi: ular oldin `[telefon]` bilan almashtiriladi.

**1pro.uz haqida** (`src/providers/openaiCompat.js`, 2026-11-06 da sinaldi):
- OpenAI shaklidagi API (`POST https://1pro.uz/v1/chat/completions`, `Authorization: Bearer sk-…`). SDK kerak emas — oddiy `fetch`. Boshqa shunday xizmat qo'shish = `createOpenAICompatible({...})` bilan bitta qator.
- Model `qwen3.8-flash` o'z serverida (3-bitli GGUF), soniyasiga 38–110 token yozadi, ko'rsatma keshlanadi (5 800 tokendan ~5 800 tasi keshdan).
- **Sxemani majburlamaydi**: `response_format` ga JSON sxema yuboriladi, lekin model bo'sh maydonlarni tashlab yuboradi. Shuning uchun har bir javob `conformPost` (`src/schema.js`) dan o'tadi: yo'q maydon → `null`/`[]`/`false`, ro'yxatda yo'q qiymat → `null`, `"Tent"` → `"tent"`.
- Limit — so'rovlar soni emas, **javob tokenlari**: kuniga 1 000 000, Toshkent vaqti bilan 00:00 da yangilanadi; tugasa 429 "Kunlik limit tugadi" + `Retry-After` — ulanish shu vaqtgacha dam oladi. Gold'da e'lon boshiga ~400 javob tokeni → kuniga ~2 500 e'lon.
- Server oldida Cloudflare: javob 100 s dan uzoq yozilsa **524**. 10 talik guruh javobi 3 750 tokengacha chiqdi va sekin paytda uzildi, shuning uchun 1pro'ga guruh **6 tadan** (`maxBatch`) beriladi. 524 da xuddi shu so'rov qaytarilmaydi — guruh ikkiga bo'linadi.
- Server ishlamasa (502/503/504, aloqa yo'q) — 5 daqiqa dam, kalit xato — 6 soat.

## Sozlamalar (`.env`)

| O'zgaruvchi | Standart | Izoh |
|---|---|---|
| `PARSER_PROVIDER` | `gemini` | `gemini`, `onepro` yoki `claude` (`npm run parse` uchun; bot hamma ulanishni ishlatadi) |
| `GEMINI_API_KEY` | — | Gemini uchun |
| `ONEPRO_API_KEY` | — | 1pro.uz uchun |
| `ONEPRO_BASE_URL` | `https://1pro.uz/v1` | Faqat manzil o'zgarsa |
| `ANTHROPIC_API_KEY` | — | Claude uchun |
| `PARSER_MODEL` | provayderga qarab | `--models` ro'yxatidan tanlanadi |
| `PARSER_EFFORT` | `low` | Faqat Claude: `low` / `medium` / `high` |
| `PARSER_BATCH` | `10` | Bitta so'rovdagi e'lonlar soni (bot va `npm run parse`). `1` — har e'lon alohida. 1pro uchun 6 dan oshmaydi |
| `PARSER_BATCH_WAIT` | `90` | Soniya: navbatda batch'dan kam e'lon bo'lsa, bot eng eski e'lon navbatga tushganidan shuncha vaqt o'tguncha yig'ilishini kutadi. `0` — kutmaydi |
| `PARSER_PARALLEL` | `8` | Bot bir vaqtda nechta AI so'rovi yuboradi (ulanishlar sonidan ko'p bo'lmaydi) |

Bot uchun `PARSER_PROVIDER`, `PARSER_MODEL` va kalit faqat **birinchi marta** o'qiladi (ro'yxatga «.env kaliti» bo'lib qo'shiladi).
Keyin modellar boshqaruv markazida o'zgartiriladi. `npm run parse` esa avvalgidek `.env` dan ishlaydi.

## Natija ko'rinishi

```json
{
  "postType": "yuk_bor",
  "loads": [
    {
      "category": "yengil",
      "fromCity": "Toshkent", "fromPlace": "Chilonzor", "fromRegion": "toshkent_sh", "fromCountry": "O'zbekiston",
      "toCity": "Navoiy", "toPlace": null, "toRegion": "navoiy", "toCountry": "O'zbekiston",
      "cargo": "mebel", "weightT": 6, "volumeM3": null, "pallets": null,
      "truckClass": "isuzu", "bodyType": null, "vehicleCount": null, "loadingSides": ["ust"], "partial": false,
      "price": 3800000, "priceUnit": "reys", "currency": "UZS", "payment": "naqd", "negotiable": false,
      "when": "ertaga", "note": null,
      "phones": ["+998901234567"]
    }
  ]
}
```

- `postType`: `yuk_bor` (yuk bor, mashina kerak) / `mashina_bor` (bo'sh mashina yuk qidiryapti) / `boshqa`
- Bitta e'londa bir nechta yuk bo'lishi mumkin, shuning uchun `loads` — massiv
- Mashina ikki belgi bilan yoziladi: `truckClass` — o'lchami (kamaz, fura, mini_fura, isuzu, kichik, labo, yengil_avto; «katta fura» → fura, «katta isuzu» → isuzu), `bodyType` — kuzov turi (tent, ref, ploshatka, skotovoz, izoterm, konteyner...). E'londa yozilmagan bo'lsa `null`
- `weightT` — oraliq yozilsa ("20 22 ton"), kattasi olinadi: haydovchi "ko'p yozsa yozsin, kam yozmasin" degan
- `price` — `priceUnit` bo'yicha: butun reysga, kilosiga, tonnasiga yoki kubiga. "3800" so'm reys narxi = 3 800 000
- Viloyat, mashina, narx birligi va to'lov kodlari `packages/shared` dan olinadi; qoidalar manbai — [docs/haydovchi-suhbati.md](../../docs/haydovchi-suhbati.md)

## Qanday ishlaydi

| Fayl | Vazifasi |
|---|---|
| `src/phones.js` | Telefonlarni **regex** bilan ajratadi (AI emas: bepul, raqamni "o'ylab topmaydi") va AI uchun yashiradi |
| `src/posts.js` | `elonlar.txt` ni `---` bo'yicha bo'ladi |
| `src/prompt.js` | AI uchun ko'rsatma (o'zgarmas — shuning uchun keshlanadi) |
| `src/schema.js` | Javobning JSON sxemasi (Gemini va Claude uni majburlaydi) va `conformPost` — sxemani majburlamaydigan API (1pro) javobini shu shaklga keltiradi |
| `src/providers/` | Har bir AI uchun alohida fayl: `gemini.js`, `claude.js`, `openaiCompat.js` (1pro.uz va boshqa OpenAI shaklidagi API'lar) |
| `src/parse.js` | Provayderni tanlaydi, telefonlarni biriktiradi, joylarni ro'yxat bo'yicha tekshiradi; `parseBatch` — bir nechta e'lon bitta so'rovda |
| `src/batch.js` | Batch so'rov matnini tuzadi (`=== POST n ===`) va javobni e'lonlarga raqami bo'yicha qaytaradi |
| `src/pool.js` | Bir nechta ulanish (kalit + model): navbat bilan berish, limitga tushganini dam oldirish, bugungi so'rovlarni sanash |
| `src/cli.js` | Fayldagi e'lonlarni tahlil qilib, hisobot chiqaradi |
| `src/eval.js` | Natijani `gold.jsonl` bilan solishtiradi |

## Keyingi qadam

1. Ko'proq e'lonni (100+) gold'ga qo'shish — ayniqsa `mashina_bor`, narxli va xalqaro e'lonlar
2. Collector'ni jonli rejimga o'tkazish: yangi xabar → parser → takrorni tashlash → mos haydovchilar (`packages/shared`: `dedupe.js`, `match.js`)
