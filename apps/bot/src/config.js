// .env dagi bot sozlamalari. Qiymatlar ekranga chiqarilmaydi — faqat bor-yo'qligi va ko'rinishi tekshiriladi.

export function readConfig(env = process.env) {
  const token = env.BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("BOT_TOKEN topilmadi. @BotFather → /newbot, keyin tokenni .env ga BOT_TOKEN=... deb yozing.");
  }
  if (!/^\d+:[\w-]{30,}$/.test(token)) {
    throw new Error("BOT_TOKEN ko'rinishi noto'g'ri. U 123456789:ABC... ko'rinishida bo'ladi (bo'sh joy va qo'shtirnoqsiz).");
  }
  // Kanal: @Yuk_Ekspert yoki -100... raqami. Bo'lmasa, yuklar faqat haydovchilarga ketadi.
  const channel = env.CHANNEL_ID?.trim() || null;
  if (channel && !/^(@[A-Za-z]\w{3,}|-100\d+)$/.test(channel)) {
    throw new Error("CHANNEL_ID @kanal_nomi yoki -100... raqami bo'lishi kerak.");
  }
  // Adminlar (/holat buyrug'i uchun): Telegram id raqamlari, vergul bilan. O'z id'ingizni botga /id yozib bilasiz.
  const admins = (env.ADMIN_IDS ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isSafeInteger);
  return { token, channel, admins };
}
