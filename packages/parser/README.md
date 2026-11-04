# parser — AI parser

**Bosqich:** 0 ⏳ kod tayyor, haqiqiy e'lonlar bilan sinov kutilyapti

E'lon matnini (kirill/lotin aralash, ruscha, qisqartmalar bilan) tuzilgan JSON'ga aylantiradi.

## Ishga tushirish (YukPlatform papkasida)

```bash
npm install                        # bir marta
npm test                           # testlar (API kerak emas)
npm run parse -- --dry-run         # AI'siz: e'lonlarni sanash, telefonlarni ajratish
npm run parse -- --models          # kalitingiz bilan mavjud modellar
npm run parse -- --limit 10        # birinchi 10 ta e'lonni AI bilan tahlil qilish
npm run parse                      # hammasini
npm run parse -- --skip 120        # limit tugab qolsa, 121-e'londan davom etish
```

Natija `data/samples/natija.jsonl` fayliga yoziladi (gitga tushmaydi), terminalda esa qisqa hisobot chiqadi: qancha e'lon, qaysi maydonlar necha foiz to'ldirildi, token sarfi va taxminiy narx.

Qo'shimcha parametrlar: `--file <yo'l>`, `--out <yo'l>`, `--concurrency <son>`.

## AI provayderlari

| Provayder | Narxi | Kalit | Standart model |
|---|---|---|---|
| `gemini` (standart) | **Bepul tarif** | aistudio.google.com → Get API key | `gemini-flash-lite-latest` |
| `claude` | Pullik | console.anthropic.com → API Keys | `claude-opus-5-5` |

**Gemini bepul tarifi haqida:**
- Daqiqalik va kunlik so'rovlar soni cheklangan, aniq limit modelga bog'liq. Shuning uchun Gemini bir vaqtda faqat 2 ta so'rov yuboradi va limitga urilsa, kutib qayta urinadi.
- Kunlik limit tugasa (429) yoki model band bo'lsa (503), ish to'xtaydi, tayyor natijalar saqlanadi va qaysi `--skip` bilan davom etish kerakligi ko'rsatiladi.
- Google bepul tarifda yuborilgan matnlardan o'z mahsulotlarini yaxshilash uchun foydalanishi mumkin. E'lonlar ochiq guruhlardan olinadi, shuning uchun bu bizga muammo emas. Lekin bu yo'l bilan shaxsiy ma'lumot yubormang.

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
      "category": "fura",
      "fromCity": "Toshkent", "fromRegion": "toshkent_sh", "fromCountry": "O'zbekiston",
      "toCity": "Farg'ona", "toRegion": "fargona", "toCountry": "O'zbekiston",
      "cargo": "sement", "weightT": 20, "vehicle": "tent", "vehicleCount": null,
      "price": 3500000, "currency": "UZS", "when": null, "note": null,
      "phones": ["+998901234567"]
    }
  ]
}
```

- `postType`: `yuk_bor` (yuk bor, mashina kerak) / `mashina_bor` (bo'sh mashina yuk qidiryapti) / `boshqa`
- Bitta e'londa bir nechta yuk bo'lishi mumkin, shuning uchun `loads` — massiv
- Viloyat, mashina va tur kodlari `packages/shared` dan olinadi

## Qanday ishlaydi

| Fayl | Vazifasi |
|---|---|
| `src/phones.js` | Telefonlarni **regex** bilan ajratadi (AI emas: bepul, raqamni "o'ylab topmaydi") |
| `src/posts.js` | `elonlar.txt` ni `---` bo'yicha bo'ladi |
| `src/prompt.js` | AI uchun ko'rsatma (o'zgarmas — shuning uchun keshlanadi) |
| `src/schema.js` | Javobning JSON sxemasi (ikkala provayder ham javobni majburan shu shaklda beradi) |
| `src/providers/` | Har bir AI uchun alohida fayl: `gemini.js`, `claude.js` |
| `src/parse.js` | Provayderni tanlaydi, telefonlarni biriktiradi |
| `src/cli.js` | Fayldagi hamma e'lonlarni tahlil qilib, hisobot chiqaradi |

## Keyingi qadam

1. Haqiqiy e'lonlarda ishga tushirish
2. 30–50 ta natijani qo'lda tekshirish, xatolar bo'yicha prompt'ni tuzatish
3. Kerak bo'lsa, boshqa modellar bilan aniqlikni solishtirish
