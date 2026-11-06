// Bosh sahifa hisoblari: tahlil oqimga yetib boryaptimi, sozlamalar ro'yxati.
import { aiSummaryText } from "./aiStatus.js";
import { formatNumber } from "./format.js";

// lastHour: { posts, processed } — oxirgi soatda kelgan (takrorsiz) va tahlil qilingan e'lonlar.
// → { inPerMin, outPerMin, behind, growthPerHour, tone, title, text }
export function throughput(lastHour = {}, queue = {}) {
  const incoming = lastHour.posts ?? 0;
  const processed = lastHour.processed ?? 0;
  const inPerMin = incoming / 60;
  const outPerMin = processed / 60;
  const growthPerHour = incoming - processed;
  const rates = `Daqiqasiga ${formatNumber(inPerMin, 1)} ta e'lon kelyapti, ${formatNumber(outPerMin, 1)} tasi tahlil qilinyapti.`;

  // Yuk chiqyapti-yu, tahlil soni 0 — demak done_at yozilmayapti (bot eski kod bilan ishlayapti), tezlikni o'lchab bo'lmaydi
  if (processed === 0 && (lastHour.loads ?? 0) > 0) {
    return {
      inPerMin, outPerMin, behind: null, growthPerHour: null,
      tone: "warning",
      title: "Tahlil tezligi o'lchanmayapti",
      text: `Oxirgi soatda ${formatNumber(lastHour.loads)} ta yuk chiqdi, lekin e'lonlarning tahlil vaqti yozilmagan. Bot eski versiyada ishlayotgan bo'lishi mumkin — uni qayta ishga tushiring. Daqiqasiga ${formatNumber(inPerMin, 1)} ta e'lon kelyapti.`,
    };
  }
  if (incoming === 0 && processed === 0) {
    const waiting = queue.waiting ?? 0;
    return {
      inPerMin, outPerMin, behind: waiting > 0, growthPerHour: 0,
      tone: waiting > 0 ? "warning" : "neutral",
      title: waiting > 0 ? "Navbat turibdi" : "Oxirgi soatda e'lon kelmadi",
      text: waiting > 0 ? `Navbatda ${formatNumber(waiting)} ta e'lon bor, lekin oxirgi soatda birortasi tahlil qilinmadi. Bot ishlayaptimi?` : "Collector ishlayaptimi va manbalar yoqilganmi — tekshiring.",
    };
  }
  // 5% gacha farq — me'yorda (soat chegarasidagi tasodif)
  if (processed >= incoming * 0.95) {
    return { inPerMin, outPerMin, behind: false, growthPerHour, tone: "good", title: "Tahlil oqimga yetib boryapti", text: rates };
  }
  const ratio = processed > 0 ? incoming / processed : null;
  return {
    inPerMin, outPerMin, behind: true, growthPerHour,
    tone: processed < incoming * 0.5 ? "critical" : "serious",
    title: ratio ? `Tahlil oqimdan ${formatNumber(ratio, 1)} barobar sekin` : "E'lonlar tahlil qilinmayapti",
    text: `${rates} Navbat soatiga ~${formatNumber(growthPerHour)} taga o'syapti.`,
  };
}

// .env holati — API faqat true/false va maxfiy bo'lmagan qiymatlarni yuboradi
// → [{ id, label, ok, value, href? }] ; ok: true | false | null (null — majburiy emas, ma'lumot uchun)
// aiTotals (aiStatus.js) berilsa — .env dagi AI kalitlari o'rniga bitta "AI ulanishlari" qatori (kalitlar endi AI sahifasida)
export function configChecklist(config, aiTotals = null) {
  if (!config) return [];
  const parser = config.parser ?? {};
  const provider = parser.provider ?? "gemini";
  const keyOk = provider === "claude" ? parser.keys?.claude : parser.keys?.gemini;
  const aiRows = aiTotals
    ? [{ id: "ai", label: "AI ulanishlari", ok: aiTotals.active > 0, value: aiSummaryText(aiTotals), href: "/ai" }]
    : [
        { id: "ai", label: "AI provayder", ok: Boolean(keyOk), value: `${provider}${parser.model ? ` · ${parser.model}` : " · standart model"}` },
        { id: "gemini", label: "Gemini kaliti", ok: provider === "gemini" ? Boolean(parser.keys?.gemini) : parser.keys?.gemini ? true : null, value: parser.keys?.gemini ? "yozilgan" : "yo'q" },
        { id: "claude", label: "Claude kaliti", ok: provider === "claude" ? Boolean(parser.keys?.claude) : parser.keys?.claude ? true : null, value: parser.keys?.claude ? "yozilgan" : "yo'q" },
      ];
  return [
    { id: "bot", label: "Bot token", ok: Boolean(config.botToken), value: config.botToken ? "yozilgan" : "BOT_TOKEN yo'q" },
    {
      id: "channel",
      label: "Kanal",
      // Kanal endi majburiy emas: yuklar haydovchilarga shaxsiy xabarda boradi (CHANNEL_LOADS=1 — kanalga ham)
      ok: config.channel ? true : null,
      value: config.channel
        ? `${config.channel} — ${config.channelLoads ? "yuklar kanalga ham chiqadi" : "yuklar chiqmaydi (faqat haydovchilarga)"}`
        : "CHANNEL_ID yo'q",
    },
    { id: "tg", label: "Telegram API (collector)", ok: Boolean(config.telegramApi), value: config.telegramApi ? "yozilgan" : "TG_API_ID / TG_API_HASH yo'q" },
    ...aiRows,
    {
      id: "miniapp",
      label: "Mini App manzili",
      ok: config.miniappUrl ? true : null,
      value: config.miniappUrl ? `${config.miniappUrl}${config.miniappFromTunnel ? " (tunneldan, qayta yoqilsa o'zgaradi)" : ""}` : "yo'q (botda oddiy savol-javob; tunnelni yoqing)",
    },
    ...(config.publicUrl
      ? [
          {
            id: "web",
            label: "Haydovchilar web'i",
            ok: config.publicTunnel ? true : null,
            value: config.publicTunnel ? `${config.publicTunnel} (shu kompyuterda: ${config.publicUrl})` : `${config.publicUrl} — hozircha faqat shu kompyuterda (Jarayonlar → Tunnel)`,
          },
        ]
      : []),
  ];
}
