# web — Yuk Ekspert ilovasi: haydovchi va yuk beruvchi (Telegram Mini App + sayt)

**Bosqich:** 1 ✅ sozlamalar formasi · 2 ✅ yuklar lentasi, xarita, Telegram orqali kirish · 3 ✅ rollar (2026-11-06)

Bitta kod ikki joyda ishlaydi:
- **Telegram Mini App** — botning pastki menyusidagi «⚙️ Sozlamalar» / «🚚 Ro'yxatdan o'tish» tugmasi;
- **oddiy sayt** — brauzerda, «Telegram bilan kirish» tugmasi orqali.

Ilovani `apps/api` dagi **haydovchilar serveri** (3001-port, `src/public.js`) ochadi va ma'lumot beradi; oldida
**nginx** turadi. `npm start` bilan hammasi o'zi ishga tushadi: **http://localhost** (nginx) yoki http://localhost:3001,
internetda — tunnel bergan `https://....trycloudflare.com`.

## Rollar

Birinchi ochilganda — «Siz kimsiz?»: 🚚 haydovchi yoki 📦 yuk beruvchi (botdagi `/rol` bilan bir xil, rol serverda saqlanadi).
Sozlamalar ostida «Rolni almashtirish»: har rolning sozlamalari alohida saqlanadi — avval to'ldirilgan rolga qaytilsa, sozlamalari tiklanadi va ilova darhol ro'yxatni ochadi.
Bot Mini App tugmasida rolni `?r=` bilan beradi — server bilan aloqa bo'lmasa ham to'g'ri forma ochiladi.

## Bo'limlar

Haydovchi: 📋 Yuklar · 🗺 Xarita · ⚙️ Sozlamalar. Yuk beruvchi: 🚚 Mashinalar · ⚙️ Sozlamalar.
Adminlarga qo'shimcha 🛠 Boshqaruv (botdagi «🛠 Boshqaruv» tugmasi `?v=admin` bilan ochadi).

| Bo'lim | Nima |
|---|---|
| 📋 Yuklar | «Menga mos» — bot shaxsiy xabarda yuboradigan yuklar: tanlangan yo'nalish bo'yicha (tepada «🧭 Andijon vil. → istalgan joy», «O'zgartirish»). Yo'nalish hali tanlanmagan bo'lsa, ro'yxat o'rniga avval «📍 Qayerdan?» → «🏁 Qayerga?» tugmalari (`src/RoutePicker.jsx`, botdagi «📋 Mos yuklar» bilan bir xil: joylar «Qayerda ishlaysiz?» ga qarab, har tugmada tanlangan muddatdagi mos yuklar soni; saqlansa bot ham shu bo'yicha yuboradi). «Hammasi» — doiradagi barcha yuklar, qayerdan bo'yicha filtr. 6 / 24 / 72 soat. Telefonni bosib qo'ng'iroq, «Asl e'lon» — guruhdagi xabar. Har daqiqada yangilanadi |
| 🗺 Xarita | Oxirgi 24 soat: har doira — bitta shahar, kattaligi — yuk soni. «Yuklash joyi» / «Tushirish joyi». Doira bosilsa — o'sha joydagi yuklar pastda va ular qayerga borishi chiziq bilan. Uzuq chiziqli doira — e'londa faqat viloyat yoki davlat yozilgan |
| 🚚 Mashinalar | Yuk beruvchiga: «Menga mos» — bot yuboradigan bo'sh mashinalar (yuk qayerda yuklanadi, qanday mashina kerak); «Hammasi» — doiradagi barcha bo'sh mashinalar. Lenta yuklarnikidek |
| 🛠 Boshqaruv | Faqat adminlar: navbat va kechikish, 24 soatdagi yuklar va bo'sh mashinalar, faol foydalanuvchilar, AI ulanishlari (bugungi so'rovlar, dam olayotgani), foydalanuvchilar ro'yxati — qidirish, to'xtatish / yoqish, rolni almashtirish. Server har so'rovda tekshiradi (boshqalarga 403). Admin qilish — faqat kompyuterdagi boshqaruv markazida |
| ⚙️ Sozlamalar | Haydovchi — transport turi, kuzov, qancha yuk ko'taradi (Labo va yengil mashinada kg), kuzov o'lchami («Standart» / «O'zim yozaman» / «Bilmayman» — odatdagi o'lcham), yuklash tomoni, qayerda ishlaydi. Yo'nalish bu yerda yo'q — u botdagi «📋 Mos yuklar» da tanlanadi, saqlaganda server eskisini qoldiradi. Yuk beruvchi — yuk qayerdan qayerga, transport turlari, kuzovlar (hech biri tanlanmasa — istalgani). Bot ham shu sozlamalar bo'yicha yuboradi. Saqlansa — botda yuborish yoqiladi |

Yuqorida: ⏸ Pauza / ▶️ Yoqish (botdagi shaxsiy xabarlar). Sozlamalar ostida «👤 Hisob» (`src/AccountCard.jsx`):
«🚪 Chiqish» — «Ha / Yo'q» so'ralgach `POST /pub/me/logout`: serverda hisobdan chiqiladi (bot yuk yubormaydi, menyusi
olib tashlanadi, qayta kirganda «Siz kimsiz?» dan boshlanadi, rolni tanlasa sozlamalari tiklanadi), keyin «🚪 Hisobdan
chiqdingiz» ekrani; saytda token ham o'chadi. Faqat tokenni o'chirish yetmaydi — Telegram'da kirish o'zi bo'ladi. Va
«🗑 Hisobni o'chirish» — «Ha / Yo'q» so'ralgach `DELETE /pub/me`, keyin «✅ Hisobingiz o'chirildi» ekrani (qayta kirmaydi —
kirish yangi, bo'sh hisob ochardi). Saytda rol tanlash va ro'yxatdan o'tish paytida (Hisob bo'limi ko'rinmaydi) «Chiqish»
tepada ham bor.
Profili yo'q haydovchi «Hammasi» ni ko'radi va ilova uni sozlamalarga olib boradi.

## Kirish

- **Botning pastki menyu tugmasidan** («🚚 Ro'yxatdan o'tish», «⚙️ Sozlamalar», «🛠 Boshqaruv») — Telegram bu yerda
  `initData` ni **bo'sh** beradi (core.telegram.org/bots/webapps: keyboard button). Shuning uchun bot tugma manziliga
  shu odamning kirish tokenini qo'yadi (`?t=`, `@yuk/store` `sessions.link`: bir hafta bir xil, 4–5 hafta amal qiladi);
  ilova uni oladi, manzildan o'chiradi va server bilan ishlaydi. Saqlaganda sozlamalar serverga ham, `sendData` bilan
  botga ham ketadi: bot chatda «✅ Saqlandi» deb javob beradi, menyuni yangilaydi, Mini App yopiladi.
- **Inline / chap pastdagi menyu tugmasidan, t.me havolasidan** — o'zi: Telegram bergan `initData` serverga yuboriladi,
  server uni bot tokeni bilan tekshiradi.
- **Saytda** — avval «📲 Telegram'da ochish» (botga), keyin «Telegram bilan kirish» vidjeti. Vidjet faqat
  @BotFather → `/setdomain` da ko'rsatilgan domenda ishlaydi; boshqa joyda «Bot domain invalid» chiqadi.
  **Telegram ichida kirish sahifasi va vidjet hech qachon chiqmaydi.**
- **Sinash uchun** — boshqaruv markazi → Haydovchilar → «Web'da ochish» (havola `#token=...` bilan, 12 soat).

Server bergan token brauzerda saqlanadi (`localStorage`, 30 kun). Telefon raqamlari faqat kirgan haydovchiga ko'rinadi.

**Ro'yxatdan o'tish** (profil hali yo'q) — qadamma-qadam (`src/Steps.jsx`): haydovchi Transport → O'lcham → Tasdiqlash
(o'lcham qadami yengil mashina, tyagach va sisternada yo'q), yuk beruvchi Yo'nalish → Transport → Tasdiqlash. Telegram'da
pastdagi katta tugma «Keyingi» / «✅ Saqlash» va tepadagi «← Orqaga», saytda sahifa pastidagi tugmalar. Oxirgi qadamda
tanlanganlar ro'yxati (`@yuk/shared profileRows`, bot «✅ Saqlandi» xabarida ham shular) — qatorni bosib o'sha qadamga
o'tiladi va tugma «✅ Tayyor» bo'ladi: bosilsa yana «Tasdiqlash» ga qaytadi (`useSteps` `edit` / `returnTo`). Profil
saqlangach, sozlamalar bitta sahifa.

**Server bilan aloqa bo'lmasa (yoki menyu tugmasi eski, tokensiz):** saytda «Server bilan aloqa yo'q» va «Qayta urinish».
Telegram ichida esa faqat sozlamalar ochiladi va botga qaytariladi (`Telegram.WebApp.sendData`, pastki menyu tugmasidan).

## Buyruqlar (YukPlatform papkasida)

```bash
npm start            # hammasi: http://localhost:3001 — yig'ilgan ilova (apps/web/dist)
npm run web          # dasturlash rejimi: http://localhost:5173, o'zgarish darhol ko'rinadi
npm run web:build    # yig'ish: apps/web/dist
```

`npm run web` da `/pub` so'rovlari haydovchilar serveriga (3001) uzatiladi — server ishlab turishi kerak
(`npm start` yoki `npm run api`). Kirish uchun boshqaruv markazidagi «Web'da ochish» havolasidagi `#token=...`
qismini 5173 manziliga qo'shing.

## Internetga chiqarish

`npm start` buni o'zi qiladi: nginx + tekin Cloudflare tunnel, ilova ham, API ham bitta https manzilda.
Bot Mini App tugmasini tunnel manzili bilan beradi (manzil o'zgarsa — o'zi yangilaydi).
O'rnatish: [apps/api/README.md → «Internetga chiqarish: nginx + tunnel»](../api/README.md#internetga-chiqarish-nginx--tunnel).

Ilovani alohida joylash ham mumkin (Cloudflare Pages, GitHub Pages — `base: "./"`, istalgan papkadan ochiladi).
Unda API manzilini yig'ishda bering: `VITE_API_URL=https://...` (`apps/web/.env` yoki buyruq oldidan).
Tunnel manzili o'zgarsa — qayta yig'ish kerak, shuning uchun hozircha birinchi yo'l qulayroq.

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `src/App.jsx` | Ilova qobig'i: kirish holati, rolga qarab bo'limlar, pauza, xabarlar |
| `src/RolePage.jsx` | «Siz kimsiz?» / «Rolni almashtirish» |
| `src/AdminPage.jsx` | 🛠 Boshqaruv (adminlar) |
| `src/api.js` | Server bilan aloqa: token saqlash, `#token=` havolasi, kirish, yuklar, profil |
| `src/LoadsPage.jsx` · `src/LoadCard.jsx` | Lenta (yuklar yoki bo'sh mashinalar) va kartochkalar (`LoadCard`, `TruckCard`) |
| `src/MapPage.jsx` · `src/mapData.js` | Xarita (Leaflet + OpenStreetMap); yuklarni joy bo'yicha guruhlash (testlangan) |
| `src/SettingsPage.jsx` · `src/ShipperSettings.jsx` · `src/form.js` | Haydovchi va yuk beruvchi sozlamalari; forma ↔ profil, xatoni qaysi bo'limga ko'rsatish (testlangan) |
| `src/settingsParts.jsx` | Ikkala forma uchun: joy tanlash, doiradagi davlatlar, saqlash (server yoki `sendData`) |
| `src/LoginPage.jsx` | «Telegram bilan kirish» vidjeti |
| `src/telegram.js` | Telegram bilan aloqa: asosiy tugma, tebranish, mavzu ranglari, havolalarni ochish, `sendData` |
| `src/ui.jsx` | Umumiy kichik qismlar: bo'lim, tanlov tugmalari, xabar, aylanuvchi belgi |
| `src/styles.css` · `src/app.css` | Forma ranglari (`--tg-theme-*`) · lenta, xarita, pastki bo'limlar |

Matn ko'rinishi (joy, narx, mashina, «5 daqiqa oldin») va xarita koordinatalari `@yuk/shared` da
(`loadText.js`, `geo.js`, `geoData.js`) — bot bilan bir xil.

Xarita rasmlari OpenStreetMap'dan (bepul, lekin katta oqim uchun mo'ljallanmagan). Haydovchilar ko'payganda boshqa
xizmatga o'tish kerak (MapTiler, Stadia — bepul limitli): `MapPage.jsx` dagi bitta `L.tileLayer` qatori.

**Texnologiya:** React 19 + Vite, Leaflet. Profil qoidalari va ro'yxatlar `@yuk/shared` dan olinadi, ular bot bilan bir xil.
