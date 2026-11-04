# parser — AI parser

**Bosqich:** 0 ✅ haqiqiy e'lonlarda sinaldi: qo'lda tekshirilgan 32 ta e'londa aniqlik **99%** (Gemini bepul tarifi)

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
```

Natija `data/samples/natija.jsonl` fayliga yoziladi (gitga tushmaydi), terminalda esa qisqa hisobot chiqadi: qancha e'lon, qaysi maydonlar necha foiz to'ldirildi, token sarfi va taxminiy narx.

Qo'shimcha parametrlar: `--file <yo'l>`, `--out <yo'l>`, `--concurrency <son>`.

## Aniqlikni tekshirish

`data/samples/gold.jsonl` — qo'lda tekshirilgan "to'g'ri javoblar": 32 ta e'lon, 52 ta yuk. Faqat ishonchli maydonlar yozilgan, yozilmagan maydon tekshirilmaydi.

```bash
npm run parse -- --only gold --out data/samples/natija-v4.jsonl   # faqat gold e'lonlarni tahlil qilish
npm run parse:eval -- --results data/samples/natija-v3.jsonl --results data/samples/natija-v4.jsonl --details
```

`parse:eval` har bir maydon bo'yicha foizni yonma-yon chiqaradi va `--details` bilan xatolarni ko'rsatadi. Prompt'ni o'zgartirgandan keyin shu ikki buyruq bilan yaxshilandimi yoki yomonlashdimi, ko'rasiz.

| Versiya | Nima o'zgardi | Aniqlik |
|---|---|---|
| v1 | Birinchi prompt, bitta `vehicle` maydoni | 86% |
| v2 | Haydovchi suhbatidan keyin yangi sxema va qoidalar | 98% |
| v3 | Joy nomlari, og'irlik oralig'i, narx qoidalari aniqlandi | 98% |
| v3 + ro'yxat | Shahar ro'yxatda bo'lsa, viloyat ro'yxatdan olinadi | 99% |

## AI provayderlari

| Provayder | Narxi | Kalit | Standart model |
|---|---|---|---|
| `gemini` (standart) | **Bepul tarif** | aistudio.google.com → Get API key | `gemini-flash-lite-latest` |
| `claude` | Pullik | console.anthropic.com → API Keys | `claude-opus-5-5` |

**Gemini bepul tarifi haqida:**
- Daqiqalik va kunlik so'rovlar soni cheklangan, aniq limit modelga bog'liq. Gemini bir vaqtda faqat 2 ta so'rov yuboradi.
- Daqiqalik limitga urilsa (taxminan 16 ta so'rovdan keyin), dastur Google aytgan vaqtcha kutadi va o'sha e'londan davom etadi.
- Kunlik limit tugasa yoki model band bo'lsa (503), ish to'xtaydi, tayyor natijalar saqlanadi va qaysi `--skip` bilan davom etish kerakligi ko'rsatiladi.
- Google bepul tarifda yuborilgan matnlardan o'z mahsulotlarini yaxshilash uchun foydalanishi mumkin. Shuning uchun telefon raqamlari AI'ga yuborilmaydi: ular oldin `[telefon]` bilan almashtiriladi.

## Sozlamalar (`.env`)

| O'zgaruvchi | Standart | Izoh |
|---|---|---|
| `PARSER_PROVIDER` | `gemini` | `gemini` yoki `claude` |
| `GEMINI_API_KEY` | — | Gemini uchun |
| `ANTHROPIC_API_KEY` | — | Claude uchun |
| `PARSER_MODEL` | provayderga qarab | `--models` ro'yxatidan tanlanadi |
| `PARSER_EFFORT` | `low` | Faqat Claude: `low` / `medium` / `high` |

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
- Mashina ikki belgi bilan yoziladi: `truckClass` — o'lchami (fura, mini_fura, isuzu, kichik, labo), `bodyType` — kuzov turi (tent, ref, ploshatka...). E'londa yozilmagan bo'lsa `null`
- `weightT` — oraliq yozilsa ("20 22 ton"), kattasi olinadi: haydovchi "ko'p yozsa yozsin, kam yozmasin" degan
- `price` — `priceUnit` bo'yicha: butun reysga, kilosiga, tonnasiga yoki kubiga. "3800" so'm reys narxi = 3 800 000
- Viloyat, mashina, narx birligi va to'lov kodlari `packages/shared` dan olinadi; qoidalar manbai — [docs/haydovchi-suhbati.md](../../docs/haydovchi-suhbati.md)

## Qanday ishlaydi

| Fayl | Vazifasi |
|---|---|
| `src/phones.js` | Telefonlarni **regex** bilan ajratadi (AI emas: bepul, raqamni "o'ylab topmaydi") va AI uchun yashiradi |
| `src/posts.js` | `elonlar.txt` ni `---` bo'yicha bo'ladi |
| `src/prompt.js` | AI uchun ko'rsatma (o'zgarmas — shuning uchun keshlanadi) |
| `src/schema.js` | Javobning JSON sxemasi (ikkala provayder ham javobni majburan shu shaklda beradi) |
| `src/providers/` | Har bir AI uchun alohida fayl: `gemini.js`, `claude.js` |
| `src/parse.js` | Provayderni tanlaydi, telefonlarni biriktiradi, joylarni ro'yxat bo'yicha tekshiradi |
| `src/cli.js` | Fayldagi e'lonlarni tahlil qilib, hisobot chiqaradi |
| `src/eval.js` | Natijani `gold.jsonl` bilan solishtiradi |

## Keyingi qadam

1. Ko'proq e'lonni (100+) gold'ga qo'shish — ayniqsa `mashina_bor`, narxli va xalqaro e'lonlar
2. Collector'ni jonli rejimga o'tkazish: yangi xabar → parser → takrorni tashlash → mos haydovchilar (`packages/shared`: `dedupe.js`, `match.js`)
