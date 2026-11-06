# web — haydovchilar ilovasi (Telegram Mini App + sayt)

**Bosqich:** 1 ✅ sozlamalar formasi · 2 ✅ yuklar lentasi, xarita, Telegram orqali kirish

Bitta kod ikki joyda ishlaydi:
- **Telegram Mini App** — botning pastki menyusidagi «⚙️ Sozlamalar» / «🚚 Ro'yxatdan o'tish» tugmasi;
- **oddiy sayt** — brauzerda, «Telegram bilan kirish» tugmasi orqali.

Ilovani `apps/api` dagi **haydovchilar serveri** (3001-port, `src/public.js`) ochadi va ma'lumot beradi; oldida
**nginx** turadi. `npm start` bilan hammasi o'zi ishga tushadi: **http://localhost** (nginx) yoki http://localhost:3001,
internetda — tunnel bergan `https://....trycloudflare.com`.

## Bo'limlar

| Bo'lim | Nima |
|---|---|
| 📋 Yuklar | «Menga mos» — bot shaxsiy xabarda yuboradigan yuklar; «Hammasi» — doiradagi barcha yuklar. Qayerdan bo'yicha filtr, 6 / 24 / 72 soat. Telefonni bosib qo'ng'iroq, «Asl e'lon» — guruhdagi xabar. Har daqiqada yangilanadi |
| 🗺 Xarita | Oxirgi 24 soat: har doira — bitta shahar, kattaligi — yuk soni. «Yuklash joyi» / «Tushirish joyi». Doira bosilsa — o'sha joydagi yuklar pastda va ular qayerga borishi chiziq bilan. Uzuq chiziqli doira — e'londa faqat viloyat yoki davlat yozilgan |
| ⚙️ Sozlamalar | Mashina va yo'nalish formasi (bot ham shu sozlamalar bo'yicha yuboradi). Saqlansa — botda yuk yuborish yoqiladi |

Yuqorida: ⏸ Pauza / ▶️ Yoqish (botdagi shaxsiy xabarlar) va saytda «Chiqish».
Profili yo'q haydovchi «Hammasi» ni ko'radi va ilova uni sozlamalarga olib boradi.

## Kirish

- **Telegram ichida** — o'zi: Telegram bergan `initData` serverga yuboriladi, server uni bot tokeni bilan tekshiradi.
- **Saytda** — «Telegram bilan kirish» vidjeti. U faqat @BotFather → `/setdomain` da ko'rsatilgan domenda ishlaydi;
  `localhost` da «Bot domain invalid» chiqadi — bu normal.
- **Sinash uchun** — boshqaruv markazi → Haydovchilar → «Web'da ochish» (havola `#token=...` bilan, 12 soat).

Server bergan token brauzerda saqlanadi (`localStorage`, 30 kun). Telefon raqamlari faqat kirgan haydovchiga ko'rinadi.

**Server bilan aloqa bo'lmasa:** saytda «Server bilan aloqa yo'q» va «Qayta urinish». Telegram ichida esa sozlamalar
baribir ishlaydi — eski usulda botga qaytariladi (`Telegram.WebApp.sendData`, faqat pastki menyu tugmasidan ochilganda).

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
| `src/App.jsx` | Ilova qobig'i: kirish holati, bo'limlar, pauza, xabarlar |
| `src/api.js` | Server bilan aloqa: token saqlash, `#token=` havolasi, kirish, yuklar, profil |
| `src/LoadsPage.jsx` · `src/LoadCard.jsx` | Yuklar lentasi va bitta yuk kartochkasi |
| `src/MapPage.jsx` · `src/mapData.js` | Xarita (Leaflet + OpenStreetMap); yuklarni joy bo'yicha guruhlash (testlangan) |
| `src/SettingsPage.jsx` · `src/form.js` | Sozlamalar formasi; forma ↔ profil, xatoni qaysi bo'limga ko'rsatish (testlangan) |
| `src/LoginPage.jsx` | «Telegram bilan kirish» vidjeti |
| `src/telegram.js` | Telegram bilan aloqa: asosiy tugma, tebranish, mavzu ranglari, havolalarni ochish, `sendData` |
| `src/ui.jsx` | Umumiy kichik qismlar: bo'lim, tanlov tugmalari, xabar, aylanuvchi belgi |
| `src/styles.css` · `src/app.css` | Forma ranglari (`--tg-theme-*`) · lenta, xarita, pastki bo'limlar |

Matn ko'rinishi (joy, narx, mashina, «5 daqiqa oldin») va xarita koordinatalari `@yuk/shared` da
(`loadText.js`, `geo.js`, `geoData.js`) — bot bilan bir xil.

Xarita rasmlari OpenStreetMap'dan (bepul, lekin katta oqim uchun mo'ljallanmagan). Haydovchilar ko'payganda boshqa
xizmatga o'tish kerak (MapTiler, Stadia — bepul limitli): `MapPage.jsx` dagi bitta `L.tileLayer` qatori.

**Texnologiya:** React 19 + Vite, Leaflet. Profil qoidalari va ro'yxatlar `@yuk/shared` dan olinadi, ular bot bilan bir xil.
