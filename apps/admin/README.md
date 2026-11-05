# admin — Boshqaruv markazi (web)

**Ochish:** YukPlatform papkasida `npm start` → http://localhost:3000/admin

Faqat shu kompyuterda ishlaydi, internetga joylanmaydi (Mini App — `apps/web` — alohida).
Ma'lumotlarni `apps/api` serveridan oladi; API ro'yxati: [apps/api/README.md](../api/README.md).

| Sahifa | Nima |
|---|---|
| Bosh sahifa | navbat, kechikish, oxirgi soat, 24 soatlik grafik (kelgan ↔ tahlil qilingan), bot va collector'ni yoqish/o'chirish, `.env` holati (faqat «bor/yo'q») |
| Yuklar | viloyat, mashina, kuzov, vaqt bo'yicha filtr va qidiruv; asl e'longa havola |
| Navbat | e'lonlar holati bo'yicha; xatolilarni qayta navbatga qo'yish |
| Haydovchilar | profil qisqacha, faol / pauza |
| Manbalar | collector kuzatadigan guruhlar: qo'shish, o'chirib-yoqish, 24 soatlik statistika |
| Jarayonlar | bot va collector loglari jonli |
| AI | kalitlar va modellar (ulanishlar): bugungi so'rovlar, dam olayotganlari, «Sinash», model qo'shish, yangi kalit qo'shish |

## Dasturlash

| Buyruq | Nima |
|---|---|
| `npm run api` | server (bot/collector'ni yoqmaydi) |
| `npm run admin` | web, o'zgarishlar darhol ko'rinadi: http://localhost:5174/admin/ (`/api` → 3000-port) |
| `npm run admin:build` | `apps/admin/dist` ga yig'adi (`npm start` buni o'zi qiladi) |
| `npm test -w @yuk/admin` | testlar (brauzersiz: formatlash, so'rovlar, holatlar) |

React 19 + Vite, boshqa kutubxonasiz (grafik — oddiy SVG). Sahifalar: `src/pages/`, mantiq: `src/*.js` (testlangan).
