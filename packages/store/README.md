# store — Baza

Node'ning o'zidagi SQLite (`node:sqlite`): o'rnatish ham, server ham, pul ham kerak emas. Fayl: `data/yuk.db` (gitga tushmaydi, ichida haydovchilar va telefon raqamlari bor).

Collector va bot — alohida dasturlar, ikkalasi shu faylni ochadi. Collector e'lonni navbatga yozadi, bot olib tahlil qiladi.

| Jadval | Ichida |
|---|---|
| `posts` | E'lonlar navbati: manba guruh, xabar raqami, havola, matn, joylangan vaqti, holati (`new` / `done` / `duplicate` / `failed`) |
| `loads` | Tahlil qilingan yangi yuklar: takror kaliti, JSON, nechta haydovchiga ketgani, kanal xabari raqami |
| `drivers` | Haydovchilar: profil (`@yuk/shared` match.js formatida), ro'yxatdan o'tish qoralamasi, faol yoki pauza; hisobdan chiqqanda (`signOut`) `signed_out_at` / `signed_out_role` (qayta rol tanlasa — tozalanadi); oxirgi faollik `seen_at` / `seen_via` (`touchDriver`: bot har xabar/tugmadan keyin, web har so'rovda; 15 s da bir martadan tez yozilmaydi, `updated_at` ga tegmaydi). **Hisobni o'chirish yumshoq** (`deleteDriver(chatId, {via})`): rol, sozlamalar, raqam, admin belgisi tozalanadi, o'sha paytdagisi `deleted_snapshot` da; `deleted_at`/`deleted_via`/`deleted_count`. `comeBack(chatId, via)` — qaytdi (belgi va snapshot olinadi, `returned_at`, ma'lumot tiklanmaydi). `purgeDriver` — qator, tarix va yuborilganlar butunlay. Pauza: `paused_at` / `paused_by` (user | idle | blocked | admin — `saveDriver({active, why})`, holat o'zgarganda yoziladi, yoqilsa tozalanadi); `idle_warned_at` — «24 soat kirmadingiz» ogohlantirishi (`markIdleWarned`, tarixda `idle_warned`) |
| `deliveries` | Kimga qaysi yuk ketdi (2026-11-09 dan): `load_id`, `chat_id`, `ok`, xato matni, vaqti — bot har shaxsiy xabardan keyin yozadi (`addDelivery`); boshqaruv markazidagi «Olgan yuklari». Hisobini o'chirsa (`deleteDriver`) — qoladi; butunlay o'chirilsa (`purgeDriver`) — o'chadi |
| `user_events` | Foydalanuvchi tarixi (2026-11-09 dan): `chat_id`, `type`, `detail` (JSON), `at`. `saveDriver` oldingi/keyingi holatni `src/history.js` `userEvents` ga beradi: joined, role, registered, settings, route, paused/resumed (`why: "admin"`), blocked (`why: "blocked"`), phone, phone_removed, admin; alohida — signout, deleted (o'sha paytdagi rol/sozlamalar/raqam bilan), returned |
| `cursors` | Collector har bir guruhni qaysi xabargacha o'qigani |

- Boshqa fayl bilan sinash: `YUK_DB=data/sinov.db`.
- Keyin `apps/api` paydo bo'lganda PostgreSQL'ga o'tiladi: shu paketdagi funksiyalar (`addPost`, `takeNewPosts`, `saveDriver`...) o'sha yerga ko'chadi, bot va collector kodi deyarli o'zgarmaydi.
- Node 24 SQLite'ni hali "experimental" deb yozadi. Ishlashiga ta'sir qilmaydi, ogohlantirish `--disable-warning=ExperimentalWarning` bilan o'chirilgan.
