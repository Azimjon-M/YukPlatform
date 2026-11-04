// Guruh/kanal manzilini bir xil ko'rinishga keltiradi.
// Qabul qilinadi: @guruh, guruh, t.me/guruh, https://t.me/guruh/123, yoki raqamli id (-100123...)
export function normalizeSource(input) {
  const raw = String(input).trim();

  if (/^-?\d+$/.test(raw)) return { kind: "id", value: raw };

  const link = raw.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t\.me|telegram\.me)\//i, "");
  if (/^(\+|joinchat\/)/i.test(link)) {
    throw new Error(
      `"${raw}" — yopiq guruhga taklif havolasi. Avval Telegram'da shu guruhga qo'shiling, ` +
        `keyin "npm run tg:dialogs" dan uning id raqamini oling.`,
    );
  }

  const username = link.replace(/^@/, "").split(/[/?#]/)[0];
  if (!/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(username)) {
    throw new Error(`"${raw}" — guruh manzili tushunarsiz. Masalan: @guruh_nomi yoki https://t.me/guruh_nomi`);
  }
  return { kind: "username", value: username };
}
