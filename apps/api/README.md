# api — Boshqaruv markazi serveri

Bitta buyruq bilan hammasi: **`npm start`** (YukPlatform papkasida) →

1. boshqaruv markazi web'ini yig'adi (`apps/admin`),
2. shu serverni ochadi: **http://localhost:3000/admin**,
3. bot va collector'ni o'zi ishga tushiradi (alohida jarayonlar; loglari web'da va shu oynada `[bot] ...`).

To'xtatish: shu oynada `Ctrl+C` — bot va collector ham yumshoq to'xtaydi.

Server faqat shu kompyuterdan ochiladi (`127.0.0.1`): tarmoqdan va internetdan kirib bo'lmaydi.
Bot va collector bilan bitta baza (`data/yuk.db`) ishlatiladi.

## Buyruqlar

| Buyruq | Nima qiladi |
|---|---|
| `npm start` | web'ni yig'adi + server + bot + collector |
| `npm run api` | faqat server (bot va collector'ni yoqmaydi — web'dan yoqasiz) |
| `npm run api:dev` | server, `src/` o'zgarsa o'zi qayta yuklanadi (bot/collector yoqilmaydi) |
| `npm run admin` | web'ni dasturlash rejimida: http://localhost:5174/admin/ (API'ni `npm run api` bilan oching) |
| `npm test -w @yuk/api` | testlar |

## Sozlamalar (`.env`, ixtiyoriy)

| O'zgaruvchi | Standart | Ma'nosi |
|---|---|---|
| `API_PORT` | `3000` | port |
| `AUTOSTART` | `bot,collector` | `npm start` da nimalar o'zi yoqiladi; `AUTOSTART=none` — hech biri |
| `PARSER_PARALLEL` | `8` | bot bir vaqtda nechta AI so'rovi yuboradi |

## Bitta nusxa

Bot yoki collector ikki marta ishga tushsa, Telegram xato beradi (bot — 409, collector — bitta sessiya).
Shuning uchun har biri `data/run/<nom>.json` ga o'z PID'ini yozadi va ikkinchi nusxa ochilmaydi.
Terminalda `npm run bot` bilan ochilgan bot web'da **«terminalda»** deb ko'rinadi: uni web'dan
boshqarish uchun avval o'sha oynada `Ctrl+C` bosing.

Kutilmaganda to'xtagan jarayon 10 s dan keyin o'zi qayta ishga tushadi (10 daqiqada 5 martagacha;
undan ko'p bo'lsa — to'xtaydi va loglarni ko'rishni so'raydi).

## API

Hamma javob JSON. Xato: `{ "error": "o'zbekcha matn" }` va mos HTTP kodi.
O'zgartiruvchi so'rovlar (`POST`, `PATCH`, `DELETE`) `x-yuk-admin: 1` sarlavhasi bilan yuboriladi —
boshqa sayt brauzeringiz orqali so'rov yubora olmasligi uchun. `Host` faqat `localhost` / `127.0.0.1`.
Kalit va tokenlar javoblarda hech qachon bo'lmaydi — faqat «yozilganmi» (`true`/`false`).

| So'rov | Nima |
|---|---|
| `GET /api/overview` | ko'rsatkichlar (`metrics`), jarayonlar, sozlamalar holati |
| `GET /api/loads?from&to&truckClass&bodyType&q&hours&limit&offset` | yuklar (eng yangisi birinchi) → `{ total, items }` |
| `GET /api/posts?status&q&limit&offset` | navbatdagi e'lonlar (`new`, `done`, `failed`, `skipped`, `duplicate`) |
| `POST /api/posts/:id/retry` · `POST /api/posts/retry-failed` | xatolilarni qayta navbatga |
| `GET /api/drivers` · `PATCH /api/drivers/:chatId {active}` | haydovchilar, faol / pauza |
| `GET /api/sources` | collector kuzatadigan guruhlar + 24 soatlik statistika |
| `POST /api/sources {name, note?}` | guruh qo'shish: `@nom`, `nom`, `https://t.me/nom`, `-100…` |
| `PATCH /api/sources/:name {enabled}` · `DELETE /api/sources/:name` | o'chirib-yoqish, olib tashlash |
| `GET /api/processes` | bot va collector holati: `stopped`, `running`, `stopping`, `crashed`, `external` |
| `POST /api/processes/:name/start\|stop\|restart` | yoqish / o'chirish / qayta ishga tushirish |
| `GET /api/processes/:name/logs?after=<seq>` | oxirgi 1000 qator log; `after` — faqat yangilari |
| `GET /api/ai` | AI kalitlari (faqat `…a1B2` ko'rinishida), modellari va bugungi holati, provayderlar |
| `POST /api/ai/models {provider, key}` | kalitni tekshirish + modellar ro'yxati (bepul limitdan so'rov sarflamaydi) |
| `POST /api/ai/keys {provider, key, label?, models}` | kalit qo'shish (avval tekshiriladi; takror kalit — 409) |
| `PATCH /api/ai/keys/:id {label?, enabled?, models?}` · `DELETE /api/ai/keys/:id` | o'zgartirish, o'chirish |
| `GET /api/ai/keys/:id/models` | saqlangan kalit bilan modellar ro'yxati (model qo'shish uchun) |
| `POST /api/ai/keys/:id/test {model}` | sinov e'loni bilan bitta haqiqiy so'rov (limitdan 1 ta) → `{ ok, ms, loads, error }` |

Manbalar birinchi marta `.env` dagi `TG_SOURCES` dan olinadi, keyin bazada saqlanadi va web'dan boshqariladi.
O'zgarish collector'ning keyingi aylanishida (1–2 daqiqa) kuchga kiradi.

AI kalitlari bazada **shifrlangan** (AES-256-GCM) saqlanadi. Shifr kaliti `data/secret.key` — birinchi marta o'zi
yaratiladi, git'ga kirmaydi. Uni hech kimga bermang; o'chib ketsa, saqlangan AI kalitlarini qaytadan qo'shasiz.
`.env` dagi `GEMINI_API_KEY` ro'yxatga bir marta «.env kaliti» bo'lib qo'shiladi (kalitning o'zi bazaga yozilmaydi).
Bot ro'yxatni har 15 s da qayta o'qiydi — kalit qo'shgandan keyin botni qayta ishga tushirish shart emas.

## Fayllar

| Fayl | Nima |
|---|---|
| `src/server.js` | ishga tushirish, port, avtomatik yoqish, `Ctrl+C` |
| `src/app.js` | Express yo'llari, himoya, web fayllar |
| `src/processes.js` | bot va collector jarayonlari: yoqish, to'xtatish, loglar, qayta ishga tushirish |
| `src/ai.js` | «AI» bo'limi uchun: kalit bilan modellar ro'yxati, sinov so'rovi |

## Keyingi bosqichlar

- **Haydovchilar uchun ochiq web**: Telegram orqali kirish, yuklar lentasi.
- **Xarita** (Leaflet + OpenStreetMap, bepul): yuklar va yo'nalishlar xaritada.
- Serverga ko'chganda: PostgreSQL, parol bilan kirish, HTTPS.
