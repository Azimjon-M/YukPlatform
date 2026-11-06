# api — Boshqaruv markazi serveri

Bitta buyruq bilan hammasi: **`npm start`** (YukPlatform papkasida) →

1. boshqaruv markazi web'ini (`apps/admin`) va haydovchilar ilovasini (`apps/web`) yig'adi,
2. ikkita server ochadi:
   - **http://localhost:3000/admin** — boshqaruv markazi (siz uchun),
   - **http://localhost:3001** — haydovchilar ilovasi: yuklar lentasi, xarita, sozlamalar (Telegram Mini App ham shu),
3. to'rtta jarayonni o'zi ishga tushiradi (loglari web'da «Jarayonlar» bo'limida va shu oynada `[bot] ...`):
   - **nginx** — kompyuterning «old eshigi»: **http://localhost** → haydovchilar ilovasi,
   - **tunnel** — nginx'ni internetga chiqaradi: `[tunnel] 🌐 Manzil: https://....trycloudflare.com`,
   - **bot** va **collector**.

To'xtatish: shu oynada `Ctrl+C` — hammasi yumshoq to'xtaydi.

Serverlar faqat shu kompyuterdan ochiladi (`127.0.0.1`). Internetdan faqat tunnel orqali, faqat haydovchilar
ilovasiga kiriladi. Boshqaruv markaziga (3000) internetdan yo'l yo'q.
Bot va collector bilan bitta baza (`data/yuk.db`) ishlatiladi.

## Buyruqlar

| Buyruq | Nima qiladi |
|---|---|
| `npm start` | web'ni yig'adi + serverlar + nginx + tunnel + bot + collector |
| `npm run nginx` · `npm run tunnel` | faqat nginx / faqat tunnel (alohida oynada; odatda `npm start` o'zi yoqadi) |
| `npm run api` | faqat server (bot va collector'ni yoqmaydi — web'dan yoqasiz) |
| `npm run api:dev` | server, `src/` o'zgarsa o'zi qayta yuklanadi (bot/collector yoqilmaydi) |
| `npm run admin` | web'ni dasturlash rejimida: http://localhost:5174/admin/ (API'ni `npm run api` bilan oching) |
| `npm test -w @yuk/api` | testlar |

## Sozlamalar (`.env`, ixtiyoriy)

| O'zgaruvchi | Standart | Ma'nosi |
|---|---|---|
| `API_PORT` | `3000` | boshqaruv markazi porti |
| `PUBLIC_PORT` | `3001` | haydovchilar ilovasi serveri porti (nginx `/pub` ni shunga uzatadi) |
| `NGINX_PORT` | `80` | nginx porti (80 band bo'lsa — masalan `8080`) |
| `AUTOSTART` | o'rnatilganlari hammasi | `npm start` da nimalar o'zi yoqiladi: `nginx,tunnel,bot,collector`; `AUTOSTART=none` — hech biri |
| `MINIAPP_URL` | — | doimiy https manzil (o'z domeningiz bo'lsa). Yozilmasa — bot ishlab turgan tunnel manzilini oladi |
| `PUBLIC_URL` | — | doimiy manzil, faqat ko'rsatish uchun (tunnel ishlasa, uning manzili ko'rsatiladi) |
| `TUNNEL_TARGET` | nginx | tunnel qayerga ulanadi (nginx yo'q bo'lsa — `http://127.0.0.1:3001`). 3000 ga ruxsat yo'q |
| `NGINX_EXE` · `CLOUDFLARED_EXE` | o'zi topadi | dastur boshqa joyda bo'lsa, `.exe` ning to'liq yo'li |
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
| `POST /api/drivers/:chatId/web-link` | haydovchilar ilovasini shu haydovchi nomidan ochish havolasi (12 soat; Telegram'siz sinash uchun) |
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
| `src/public.js` | haydovchilar ilovasi serveri (3001): kirish, profil, yuklar lentasi, web fayllari |
| `src/telegramAuth.js` | Telegram imzosini tekshirish (Mini App `initData`, saytdagi vidjet) va sessiya tokeni |

## Haydovchilar ilovasi (3001-port)

Bitta kod ikki joyda ishlaydi: **Telegram Mini App** (bot menyusidagi tugma) va **oddiy sayt** (brauzerda).
Bo'limlari: 📋 Yuklar (menga mos / hammasi, bosib qo'ng'iroq), 🗺 Xarita, ⚙️ Sozlamalar. Kod: `apps/web`.

**Kirish — faqat Telegram orqali, parolsiz.** Telegram foydalanuvchi ma'lumotini bot tokeni bilan imzolaydi;
server imzoni tekshiradi (`telegramAuth.js`), shuning uchun hech kim boshqa odam nomidan kira olmaydi.
- Telegram ichida: kirish o'zi bo'ladi (`initData`).
- Saytda: «Telegram bilan kirish» tugmasi. U faqat BotFather'da ko'rsatilgan domenda ishlaydi:
  @BotFather → `/setdomain` → botingiz → ilovaning internetdagi domeni (masalan `abc-def.trycloudflare.com`).
  `localhost` da tugma o'rnida «Bot domain invalid» chiqadi — bu normal.
- Sinash uchun (Telegram'siz): boshqaruv markazi → **Haydovchilar** → **Web'da ochish** — ilova o'sha haydovchi
  nomidan ochiladi.

Kirgandan keyin server o'z tokenini beradi (30 kun). Ilova uni har so'rovda `Authorization: Bearer ...` bilan yuboradi.

| So'rov | Nima |
|---|---|
| `GET /pub/config` | bot username (vidjet uchun), yo'nalish doirasi |
| `POST /pub/auth {initData}` yoki `{widget}` | kirish → `{ token, me }` |
| `GET /pub/me` | haydovchi: ism, profil, faolmi |
| `PUT /pub/me/profile {profile}` | sozlamalarni saqlash (bot bilan bir xil tekshiruv) — yuk yuborish yoqiladi |
| `PATCH /pub/me {active}` | pauza / davom |
| `GET /pub/loads?view=mine\|all&from&to&hours&limit&offset` | yuklar, e'lon vaqti bo'yicha eng yangisi birinchi; `mine` — bot yuboradigan mos yuklar |

Kirmagan odamga `config` va `auth` dan boshqa hech narsa berilmaydi (401). Bir manzildan daqiqasiga 240 ta so'rov,
kirishga 20 ta urinish. Telefon raqamlari faqat kirgan haydovchiga ko'rinadi.

## Internetga chiqarish: nginx + tunnel

```
haydovchi telefoni → https://....trycloudflare.com → Cloudflare → cloudflared (tunnel) → nginx :80 → ilova fayllari
                                                                                              └─ /pub → :3001 (API)
bot, collector → Telegram'ga o'zlari ulanadi (nginx'dan o'tmaydi)      boshqaruv markazi :3000 — faqat shu kompyuter
```

- **nginx** (`src/edge/nginx.js`) — ilova fayllarini o'zi beradi (gzip, kesh), `/pub` ni 3001 ga uzatadi, `/admin` va
  `/api` ga 404. Sozlamasi `src/edge/nginxConfig.js` da; ish papkasi `data/nginx/` (`nginx.conf`, `logs/access.log`).
  Xatolari «Jarayonlar → nginx» da. Serverga (VPS) ko'chganda xuddi shu sozlama ishlatiladi.
- **tunnel** (`src/edge/tunnel.js`) — Cloudflare'ning tekin «quick tunnel»i: akkaunt va routerda port ochish shart emas.
  Olgan manzilini bazaga yozadi; bot Mini App tugmasini shu manzil bilan beradi, boshqaruv markazi bosh sahifada ko'rsatadi.

**O'rnatish (bir marta):**

1. nginx: <https://nginx.org/en/download.html> → **Stable version** → `nginx/Windows-...` zip →
   `YukPlatform/tools/` ichiga oching (`tools/nginx-1.30.6/nginx.exe` bo'ladi). `tools/` gitga tushmaydi.
2. cloudflared: `winget install --id Cloudflare.cloudflared`
3. `npm start` — ikkalasi o'zi yoqiladi.

**Tekin tunnelning kamchiligi — manzil har yoqilganda yangi.** Buni bot o'zi hal qiladi: haydovchiga keyingi yuk
xabari bilan pastki menyu yangi manzilga yangilanadi (tunnel o'chiq bo'lsa — sozlamalar chatda savol-javob).
Faqat saytdagi «Telegram bilan kirish» tugmasi uchun @BotFather → `/setdomain` ga yangi domenni qo'lda yozish kerak
(Telegram ichidagi Mini App bunga muhtoj emas).

**Doimiy manzil:** o'z domeningiz (masalan `yukekspert.uz`) + Cloudflare'ning nomli tunneli (bepul) →
`https://app.yukekspert.uz` o'zgarmaydi, `.env` ga `MINIAPP_URL` yoziladi. Domen pullik (yiliga bir necha dollar),
shuning uchun haydovchilar ko'paygach qilinadi.

> Tunnel faqat nginx'ga (yoki 3001 ga) ulanadi. 3000 (boshqaruv markazi) — sizning panelingiz, u internetga chiqmaydi.
> Kompyuter o'chsa yoki uxlasa — bot ham, ilova ham to'xtaydi.

Xarita OpenStreetMap rasmlarini ishlatadi (bepul, ko'p foydalanuvchi uchun mo'ljallanmagan). Haydovchilar
ko'paysa — boshqa xarita xizmatiga o'tish kerak (MapTiler, Stadia — bepul limitli).

## Keyingi bosqichlar

- ✅ Haydovchilar uchun web: Telegram orqali kirish, yuklar lentasi, xarita (yuqorida).
- ✅ nginx + tunnel: `npm start` bilan internetga chiqadi (manzil o'zgaruvchan).
- Doimiy internet manzil (domen + nomli tunnel) yoki server.
- Serverga ko'chganda: PostgreSQL, parol bilan kirish, HTTPS.
