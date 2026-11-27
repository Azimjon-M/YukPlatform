// yuk.gtpro.uz bosh sahifasi (2026-11-27, Azimjon: «loyihamiz haqida batafsil va Free, Pro, Max obunalari haqida … Sarvarga
// yozadigan, obunani tanlab pulni Click qilib chek tashlasa…»). Oddiy brauzerdan parametrsiz kelgan odamga ko'rsatiladi;
// Telegram Mini App (manzilida ?t=, ?v=… yoki #tgWebAppData) — ilovaning o'zi (public.js).
// Bitta HTML, tashqi fayllarsiz. Narx / muddat / rekvizit — boshqaruv markazidagi sozlamadan (store.planSettings),
// obuna imkoniyatlari — @yuk/shared PLANS dan: qoida o'zgarsa sahifa ham o'zgaradi.
import { PLANS } from "@yuk/shared";

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sum = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const short = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}`.replace(".", ",") + " ming" : String(n));

const FEATURES = {
  free: ["Ochiq guruhlardagi yuk e'lonlari — darhol", "Filtr: transport turi va viloyatlar", `${PLANS.free.maxSources} tagacha guruh tanlash`, "Mini App, xarita va Android ilova", "Yordamchiga kuniga 3 ta savol"],
  pro: ["Free'dagi hammasi", "Ovozli e'lonlar (matnga o'girilgan)", "O'z Telegram akkauntingizdagi yopiq guruhlar", `${PLANS.pro.maxSources} tagacha guruh tanlash`, "Yordamchi 24/7: kuniga 20 ta xabar, muammoingiz egasiga yetkaziladi"],
  max: ["Pro'dagi hammasi", "Hamma yopiq guruhlardagi e'lonlar", `${PLANS.max.maxSources} tagacha guruh tanlash`, "E'lon birinchi bo'lib sizga yuboriladi", "Yordamchi navbatsiz: kuniga 50 ta xabar"],
};

// settings — store.planSettings(); stats — { sources, posts, sent } | null; bot / support — username'lar (@ siz); apk — ilova bormi
export function landingPage({ settings, stats = null, bot = null, support = null, owner = null, apk = false } = {}) {
  const days = settings?.days ?? 30;
  const price = (plan) => (plan === "free" ? "Bepul" : settings?.prices?.[plan] ? `${sum(settings.prices[plan])} so'm` : "Narxi tez orada");
  const per = (plan) => (plan !== "free" && settings?.prices?.[plan] ? `${days} kunga` : plan === "free" ? "doim" : "");
  // Haftalik narx (bo'lsa): «yoki haftasiga 15 000 so'm»; oylik yo'q bo'lsa — asosiy narx shu
  const weekly = (plan) => (plan !== "free" && settings?.week?.[plan] ? `${sum(settings.week[plan])} so'm` : null);
  const botUrl = bot ? `https://t.me/${esc(bot)}` : null;
  const askUrl = (plan) => (support ? `https://t.me/${esc(support)}?text=${encodeURIComponent(`Assalomu alaykum! ${PLANS[plan].name} obunasini olmoqchiman.`)}` : null);
  const card = (plan) => `
      <article class="plan ${plan === "pro" ? "is-main" : ""}">
        ${plan === "pro" ? '<span class="tag">Ko\'pchilik tanlaydi</span>' : ""}
        <h3>${esc([PLANS[plan].icon, PLANS[plan].name].filter(Boolean).join(" "))}</h3>
        <p class="price">${esc(price(plan))} <small>${esc(per(plan))}</small></p>
        ${weekly(plan) ? `<p class="alt">yoki 7 kunga — <b>${esc(weekly(plan))}</b></p>` : ""}
        <ul>${FEATURES[plan].map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        ${plan === "free" ? (botUrl ? `<a class="btn ghost" href="${botUrl}">Botni ochish</a>` : "") : askUrl(plan) ? `<a class="btn ${plan === "pro" ? "" : "ghost"}" href="${askUrl(plan)}">${esc(PLANS[plan].name)} olish</a>` : ""}
      </article>`;
  const numbers = stats
    ? `<div class="nums">
        <div><b>${esc(String(stats.sources))}</b><span>yuk guruhi kuzatiladi</span></div>
        <div><b>${esc(short(stats.posts))}</b><span>yangi e'lon bir kunda</span></div>
        <div><b>24/7</b><span>to'xtovsiz kuzatuv, e'lon soniyalarda yetadi</span></div>
      </div>`
    : "";
  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yuk Ekspert — yuk e'lonlari bir joyda, darhol</title>
<meta name="description" content="Yuk Ekspert — O'zbekistondagi yuzdan ortiq Telegram yuk guruhidagi e'lonlarni bitta botga yig'ib, haydovchiga darhol yetkazadi. Free, Pro va Max obunalari.">
<meta name="color-scheme" content="light dark">
<script>if(location.hash.indexOf("tgWebAppData")>=0)location.replace("/?app=1"+location.hash)</script>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#14181f;--muted:#5d6877;--line:#e3e7ee;--accent:#2a78d6;--accent-2:#1c5cab;--warm:#eb8a1c;--good:#1f9d57}
@media(prefers-color-scheme:dark){:root{--bg:#10151c;--card:#19212c;--text:#eef2f6;--muted:#9aa6b5;--line:#2a3442;--accent:#4b93ea;--accent-2:#7db2f2;--warm:#f3a544;--good:#43c07c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--accent)}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 0}
.logo{font-weight:750;font-size:18px;letter-spacing:-.01em;text-decoration:none;color:var(--text)}
.top nav{display:flex;gap:16px;font-size:14.5px}
.top nav a{color:var(--muted);text-decoration:none}
.top nav a:hover{color:var(--text)}
.hero{padding:44px 0 34px}
.hero h1{font-size:clamp(30px,5.4vw,50px);line-height:1.12;letter-spacing:-.025em;margin:0 0 16px;max-width:17ch;text-wrap:balance}
.hero p{font-size:clamp(16px,2.2vw,19px);color:var(--muted);max-width:60ch;margin:0 0 26px}
.cta{display:flex;flex-wrap:wrap;gap:10px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 20px;border-radius:12px;background:var(--accent);color:#fff;font-weight:650;text-decoration:none;border:1px solid var(--accent)}
.btn:hover{background:var(--accent-2);border-color:var(--accent-2)}
.btn.ghost{background:transparent;color:var(--text);border-color:var(--line)}
.btn.ghost:hover{border-color:var(--accent);color:var(--accent)}
.nums{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:34px 0 0}
.nums div{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.nums b{display:block;font-size:clamp(22px,3.4vw,30px);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.nums span{color:var(--muted);font-size:14px}
section{padding:38px 0}
h2{font-size:clamp(23px,3.2vw,30px);letter-spacing:-.02em;margin:0 0 6px}
.lead{color:var(--muted);margin:0 0 22px;max-width:62ch}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.box h3{margin:0 0 6px;font-size:17px}
.box p{margin:0;color:var(--muted);font-size:15px}
.step{counter-increment:s}
.steps{counter-reset:s}
.step h3::before{content:counter(s);display:inline-grid;place-items:center;width:26px;height:26px;margin-right:8px;border-radius:50%;background:var(--accent);color:#fff;font-size:14px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;align-items:stretch}
.plan{position:relative;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
.plan.is-main{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.plan .tag{position:absolute;top:-11px;left:20px;background:var(--accent);color:#fff;font-size:12px;font-weight:650;padding:2px 10px;border-radius:999px}
.plan h3{margin:0;font-size:20px}
.price{margin:8px 0 14px;font-size:27px;font-weight:750;letter-spacing:-.02em}
.price small{font-size:14px;font-weight:450;color:var(--muted)}
.price{margin-bottom:4px}
.alt{margin:0 0 14px;color:var(--muted);font-size:14.5px}
.alt b{color:var(--text)}
.plan .price + ul{margin-top:10px}
.plan ul{margin:0 0 20px;padding:0;list-style:none;flex:1}
.plan li{position:relative;padding:5px 0 5px 24px;font-size:15px}
.plan li::before{content:"✓";position:absolute;left:0;color:var(--good);font-weight:700}
.pay{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:18px 0 0}
.pay b{display:block;margin-bottom:2px}
.note{color:var(--muted);font-size:14.5px;margin:14px 0 0}
details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 10px}
summary{cursor:pointer;font-weight:600}
details p{margin:10px 0 0;color:var(--muted)}
footer{border-top:1px solid var(--line);margin-top:26px;padding:22px 0 40px;color:var(--muted);font-size:14px;display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between}
footer a{color:var(--muted)}
@media(max-width:560px){.nums{grid-template-columns:1fr}.top nav a.hide{display:none}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="logo" href="/">🚛 Yuk Ekspert</a>
    <nav><a class="hide" href="#qanday">Qanday ishlaydi</a><a href="#obunalar">Obunalar</a><a href="/?web=1">Kirish</a></nav>
  </header>

  <main>
    <div class="hero">
      <h1>Yuk e'lonlari bir joyda — guruhda chiqishi bilan sizda</h1>
      <p>Yuk Ekspert O'zbekistondagi yuk tashish guruhlarini kechayu kunduz kuzatadi va e'lonni bir necha soniyada Telegram botingizga yetkazadi. O'nlab guruhni varaqlash shart emas: kerakli transport va viloyatni belgilang — qolganini bot qiladi.</p>
      <div class="cta">
        ${botUrl ? `<a class="btn" href="${botUrl}">Telegram botni ochish</a>` : ""}
        ${apk ? '<a class="btn ghost" href="/pub/app/android">Android ilovani yuklab olish</a>' : ""}
        <a class="btn ghost" href="#obunalar">Obunalarni ko'rish</a>
      </div>
      ${numbers}
    </div>

    <section id="qanday">
      <h2>Qanday ishlaydi</h2>
      <p class="lead">Ro'yxatdan o'tish bir daqiqa. Yuk beruvchi ham shu botda e'lon bera oladi — matn yozib yoki ovozli xabar qilib.</p>
      <div class="grid steps">
        <div class="box step"><h3>Botni oching</h3><p>Telegram'da botga /start bosing va «Men haydovchiman» ni tanlang.</p></div>
        <div class="box step"><h3>Filtrni sozlang</h3><p>Qaysi transport (fura, isuzu, labo…), qaysi viloyatlar va xohlasangiz — aynan qaysi guruhlar.</p></div>
        <div class="box step"><h3>Yukni oling</h3><p>Mos e'lon guruhda chiqishi bilan botga keladi. «Telefon qilish» tugmasi bilan darhol bog'lanasiz.</p></div>
      </div>
    </section>

    <section>
      <h2>Nimalar bor</h2>
      <p class="lead">Bitta hisob — botda, Telegram ichidagi Mini App'da va Android ilovada.</p>
      <div class="grid">
        <div class="box"><h3>Tez</h3><p>E'lon guruhga yozilgan zahoti, saralash navbatisiz yuboriladi. Takror e'lonlar bir marta keladi.</p></div>
        <div class="box"><h3>Faqat keragi</h3><p>Transport turi, yuklash viloyati va tanlangan guruhlar bo'yicha filtr. Quruq gap va reklama tashlanadi.</p></div>
        <div class="box"><h3>Xarita va ro'yxat</h3><p>Yuklarni xaritada ko'ring, yo'nalish bo'yicha saralang, tarixni oching.</p></div>
        <div class="box"><h3>Sizning guruhlaringiz</h3><p>O'z Telegram akkauntingizni ulang — siz a'zo bo'lgan yuk guruhlari ham bitta oqimga qo'shiladi.</p></div>
        <div class="box"><h3>Ovozli e'lonlar</h3><p>Guruhdagi ovozli xabar va dumaloq videolar matnga o'girilib, e'lon sifatida keladi (Pro va Max).</p></div>
        <div class="box"><h3>Yordamchi 24/7</h3><p>Bot yoki ilovada qiynalsangiz — yordamchimizga yozing: tushuntiradi, holatingizni tekshiradi, muammoni egasiga yetkazadi.</p></div>
      </div>
    </section>

    <section id="obunalar">
      <h2>Obunalar</h2>
      <p class="lead">Free bilan boshlang — ochiq guruhlardagi e'lonlar bepul. Ko'proq kerak bo'lsa, Pro yoki Max'ga o'ting.</p>
      <div class="plans">${["free", "pro", "max"].map(card).join("")}
      </div>

      <h2 style="margin-top:36px">Obunani qanday olaman</h2>
      <div class="grid steps" style="margin-top:14px">
        <div class="box step"><h3>Yordamchiga yozing</h3><p>${support ? `Telegram'da <a href="${askUrl("pro")}">@${esc(support)}</a> ga` : "Yordamchimizga"} qaysi obuna kerakligini ayting.</p></div>
        <div class="box step"><h3>To'lang</h3><p>Click, Payme yoki bank ilovasi orqali — yordamchi rekvizitlarni yuboradi.</p></div>
        <div class="box step"><h3>Chekni yuboring</h3><p>To'lov cheki rasmini (skrinshot) o'sha chatga tashlang.</p></div>
        <div class="box step"><h3>Obuna yoqiladi</h3><p>Chek tekshirilgach obuna yoqiladi: haftalik to'lov — 7 kun, oylik — ${esc(String(days))} kun.</p></div>
      </div>
      ${settings?.payInfo ? `<div class="pay"><b>To'lov rekvizitlari</b>${esc(settings.payInfo)}</div>` : ""}
      <p class="note">Obuna Telegram hisobingizga bog'lanadi: bot, Mini App va ilovada birdek ishlaydi. To'lovni admin bank hisobi bo'yicha qo'shimcha tekshiradi: pul tushmagan bo'lsa obuna bekor qilinadi, soxta chek yuborgan hisob esa bloklanadi.${owner ? ` Yordamchi javob bermasa — <a href="https://t.me/${esc(owner)}">@${esc(owner)}</a> ga yozing.` : ""}</p>
    </section>

    <section>
      <h2>Savollar</h2>
      <details><summary>Free'da nimalar cheklangan?</summary><p>Yopiq guruhlardagi va ovozli e'lonlar kelmaydi, ${PLANS.free.maxSources} tadan ko'p guruh tanlab bo'lmaydi. Ochiq guruhlardagi matnli e'lonlar esa to'liq va kechiktirmasdan keladi.</p></details>
      <details><summary>Pro va Max farqi nima?</summary><p>Pro'da faqat o'z Telegram akkauntingiz a'zo bo'lgan yopiq guruhlar o'qiladi. Max'da tizimga ulangan hamma yopiq guruhlar ochiladi, guruh tanlash limiti ${PLANS.max.maxSources} ta va e'lon sizga birinchi yuboriladi.</p></details>
      <details><summary>Telegram akkauntni ulash xavfsizmi?</summary><p>Akkaunt faqat siz a'zo bo'lgan yuk guruhlaridagi e'lonlarni o'qish uchun ishlatiladi, nomingizdan hech narsa yozilmaydi. Istalgan payt Sozlamalardan uzib qo'yasiz. Ulash bepul.</p></details>
      <details><summary>Yuk beruvchilar uchun ham bormi?</summary><p>Ha. Botda «Menda yuk bor» ni tanlang va yukni oddiy matn yoki ovozli xabar bilan yuboring — e'lon mos haydovchilarga boradi. Bu bepul.</p></details>
    </section>
  </main>

  <footer>
    <span>© ${new Date().getFullYear()} Yuk Ekspert</span>
    <span>${botUrl ? `<a href="${botUrl}">Bot</a> · ` : ""}${support ? `<a href="https://t.me/${esc(support)}">Yordamchi</a> · ` : ""}${owner ? `<a href="https://t.me/${esc(owner)}">Loyiha egasi</a> · ` : ""}<a href="/?web=1">Web ilova</a> · <a href="/admin/">Boshqaruv</a></span>
  </footer>
</div>
</body>
</html>`;
}
