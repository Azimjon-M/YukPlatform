# YukPlatform

Telegramdagi katta yuk guruhlari va kanallaridan e'lonlarni yig'ib, AI bilan tahlil qiladigan va har bir haydovchiga **faqat o'ziga mos yukni** shaxsiy xabar qilib yuboradigan platforma.

## Tuzilma

```
YukPlatform/
├── apps/               ← ishga tushadigan dasturlar (har biri alohida)
│   ├── api/            Yadro: API, baza, takrorlarni olib tashlash, filtr moslash
│   ├── bot/            Telegram bot: filtr sozlash, shaxsiy xabarlar
│   ├── collector/      Userbot: guruh va kanallardan e'lon yig'adi
│   ├── web/            React sayt + Telegram Mini App
│   └── mobile/         Android / iOS ilova (Expo)
├── packages/           ← bir nechta dastur birga ishlatadigan kod
│   ├── parser/         AI parser: e'lon matni → JSON
│   └── shared/         Viloyatlar, mashina turlari, e'lon modeli
├── data/samples/       Namunaviy e'lonlar (gitga tushmaydi)
├── .env.example        Kerakli kalitlar ro'yxati (qiymatsiz)
└── CLAUDE.md           Claude uchun loyiha konteksti
```

## Qanday ishlaydi

```
KIRISH                          YADRO (apps/api)                      CHIQISH
collector (ochiq guruhlar) ─┐                                       ┌─ bot (shaxsiy xabar)
bot (hamkor guruhda admin) ─┼─► parser ─► takrorni ─► baza ─► filtr ─┼─ web / Mini App
web / bot orqali e'lon     ─┘  (matn→JSON)  olib tashlash      moslash └─ mobile (push)
```

Bitta yuk 20 ta guruhga tashlanadi, shuning uchun takrorlar (telefon + yo'nalish + vaqt oralig'i bo'yicha) albatta olib tashlanadi.

## Bosqichlar

| # | Bosqich | Nima qilinadi | Holati |
|---|---|---|---|
| 0 | Tadqiqot | 100–200 ta haqiqiy e'lon, AI parser prototipi, aniqlikni o'lchash | ⏳ hozir |
| 1 | MVP | collector → parser → baza → bot (filtr + shaxsiy xabar + qo'ng'iroq). 10–20 ta haydovchida sinov | — |
| 2 | Mini App | React: e'lonlar ro'yxati, filtrlar, yuk egasi o'zi e'lon joylaydi | — |
| 3 | Daromad | Guruh adminlari bilan hamkorlik, obuna (bepulda kechikish, pullida darhol) | — |
| 4 | Kengayish | Web sayt, mobil ilova, pochta / yo'lovchi taksi | — |

Turlar boshidan umumiy qilinadi (**fura / yengil / pochta / yo'lovchi**), lekin ish faqat furalar bilan boshlanadi.

## Texnologiyalar

| Qism | Texnologiya |
|---|---|
| api | Node.js, Express, PostgreSQL + Prisma |
| bot | Node.js + grammY |
| collector | Node.js + GramJS (`telegram` paketi) |
| parser | Gemini API (bepul tarif), ixtiyoriy: Claude API |
| web | React + Vite + Tailwind |
| mobile | Expo (React Native) |

## Sozlash

1. `npm install` — barcha paketlarni o'rnatadi (npm workspaces: `apps/*` va `packages/*` bitta buyruq bilan).
2. `.env.example` faylidan nusxa olib, `.env` deb nomlang.
3. Kalitlarni **o'zingiz** yozing. `.env` faylni hech qachon gitga yoki chatga yubormang.

## Buyruqlar

| Buyruq | Nima qiladi |
|---|---|
| `npm test` | Barcha testlar |
| `npm run tg:login` | Telegram'ga kirish (bir marta, o'z terminalingizda) |
| `npm run tg:dialogs` | Akkaunt a'zo bo'lgan guruh/kanallar |
| `npm run tg:search -- yuk "yuk markazi"` | Ochiq yuk guruhlarini Telegram qidiruvidan topadi |
| `npm run tg:export -- @guruh1 @guruh2` | Guruhlardagi oxirgi xabarlarni `data/samples/elonlar.txt` ga qo'shadi |
| `npm run parse -- --dry-run` | E'lonlarni sanaydi va telefonlarni ajratadi (AI'siz, bepul) |
| `npm run parse -- --limit 10` | Birinchi 10 ta e'lonni AI bilan tahlil qiladi |

Batafsil: [apps/collector/README.md](apps/collector/README.md), [packages/parser/README.md](packages/parser/README.md)
