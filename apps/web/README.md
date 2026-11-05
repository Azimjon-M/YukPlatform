# web — Telegram Mini App (keyin sayt ham)

**Bosqich:** 1 ✅ sozlamalar formasi · 2 — yuklar ro'yxati (API kerak)

Bot ichida ochiladigan ilova. Hozir u bitta ish qiladi: haydovchi mashinasi va yo'nalishini **bitta formada** belgilaydi. Chatdagi 9 ta savol-javob o'rniga shu forma ishlatiladi.

- Botning pastki menyusidagi «🚚 Ro'yxatdan o'tish» / «⚙️ Sozlamalar» tugmasi formani ochadi.
- Bot hozirgi sozlamalarni manzilga qo'shib beradi (`?p=...`), shuning uchun forma to'ldirilgan holda ochiladi.
- «Saqlash» bosilganda ma'lumot botga qaytadi (`Telegram.WebApp.sendData`) va ilova yopiladi.
- Bot kelgan ma'lumotni qaytadan tekshiradi (`@yuk/shared` → `sanitizeProfile`). Formaga ishonmaydi.
- Ranglar Telegram mavzusidan olinadi: qorong'i va yorug' rejimda o'zi moslashadi.
- Server ham, baza ham kerak emas. Bu oddiy statik sayt, bepul joylanadi.

> `sendData` faqat **pastki menyudagi** tugmadan ochilganda ishlaydi. Bot profilidagi "Open" tugmasi yoki havola orqali ochilsa, forma "pastki menyudan oching" deb yozadi. Shuning uchun BotFather'da "Main Mini App"ni hozircha yoqmang.

## Buyruqlar (YukPlatform papkasida)

```bash
npm run web          # sinash: http://localhost:5173 (oddiy brauzerda «Saqlash» botga ketadigan ma'lumotni ko'rsatadi)
npm run web:build    # joylash uchun tayyor fayllar: apps/web/dist
```

Sinovda formani to'ldirilgan holda ochish uchun manzilga `?p=...` qo'shing. Uni bot tugmasidagi manzildan olish mumkin.

## Internetga joylash (bir marta, bepul)

Telegram Mini App'ni faqat **https** manzildan ochadi. Eng oson yo'l — Cloudflare Pages:

1. `npm run web:build`
2. <https://dash.cloudflare.com> da bepul akkaunt oching. Akkauntni **o'zingiz** ochasiz.
3. **Workers & Pages → Create → Pages → Upload assets** (direct upload) ni tanlang.
   - Loyiha nomi: `yuk-ekspert`.
   - `apps/web/dist` papkasini sudrab tashlang.
   - **Deploy** ni bosing.
4. Cloudflare bergan manzilni (masalan, `https://yuk-ekspert.pages.dev`) `.env` ga o'zingiz yozing:
   ```
   MINIAPP_URL=https://yuk-ekspert.pages.dev
   ```
5. Botni qayta ishga tushiring: eski oynada Ctrl+C, keyin `npm run bot`.
6. Tekshiring: `npm run bot:check` → `✅ Mini App: ...`.

Kod o'zgarsa: `npm run web:build`, keyin Cloudflare'da shu loyiha → **Create deployment** → `dist` ni qayta yuklang.

Boshqa bepul joylar ham bo'ladi: GitHub Pages, Netlify. Manzil https bo'lsa bas, papkaning qayerda turishi muhim emas (`base: "./"`).

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `src/App.jsx` | Forma: mashina turi, kuzov, sig'im, o'lcham (kub va palet hisobi bilan), yuklash tomoni, xalqaro, qayerdan/qayerga (xalqaroda davlatlar ham), rejim |
| `src/form.js` | Forma ↔ profil, xatoni qaysi bo'limga ko'rsatish kerakligi (React'siz, `npm test` bilan tekshiriladi) |
| `src/telegram.js` | Telegram bilan aloqa: pastdagi asosiy tugma, tebranish, "Yopilsinmi?" so'rovi, `sendData` |
| `src/styles.css` | Telegram mavzu ranglari (`--tg-theme-*`) |

## Keyingi qadam (2-bosqich)

Mini App ichida **yuklar ro'yxati**: ro'yxatni bazadan olish uchun internetdan ochiladigan API kerak (`apps/api`). Bu uchun ikki yo'l bor:
- Bot ishlayotgan kompyuterga tunnel ochish (Cloudflare Tunnel, bepul);
- arzon server.

Hozircha mos yuklar botdagi «📋 Mos yuklar» tugmasida ko'rinadi.

**Texnologiya:** React 19 + Vite. Profil qoidalari va ro'yxatlar `@yuk/shared` dan olinadi, ular bot bilan bir xil.
