// Bot nomidan bitta xabar (Telegram Bot API sendMessage). Web'dan hisob o'chirilganda chatga «o'chirildi» deb yozib,
// pastki menyuni olib tashlash uchun (botdagi /ochirish → «Hammasini o'chirish» bilan bir xil).
// Bot o'zi long polling bilan ishlaydi: sendMessage unga xalaqit bermaydi (409 Conflict faqat ikkita getUpdates'da bo'ladi).
// Xato (internet yo'q, foydalanuvchi botni bloklagan) — jim: o'chirish baribir bo'lgan. Manzilda bot tokeni bor —
// shuning uchun xato matni ham hech qayerga yozilmaydi.
export function createBotMessenger(token, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (!token) return null;
  return async (chatId, text, extra = {}) => {
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, ...extra }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json().catch(() => null);
      return body?.ok === true;
    } catch {
      return false;
    }
  };
}
