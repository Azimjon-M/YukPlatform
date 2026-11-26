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

// Kanal va guruhga a'zolikni Telegram'dan HOZIR so'rash (Azimjon, 2026-11-26: «majburiy a'zo bo'lmagunigacha bot umuman
// yordam ko'rsatmasin» — ilovaga kod yuborishdan oldin). Bot (apps/bot members.js) bilan bir xil qoida; bazadagi sub_ok
// eskirgan bo'lishi mumkin (odam hozirgina chiqib ketgan). refs — .env REQUIRED_CHATS (@kanal, @guruh, -100…).
// → (userId) → { ok, missing: [{ ref, title, url }] } | null (tekshiruv o'chiq yoki Telegram javob bermadi — bilmaymiz)
const MEMBER = new Set(["creator", "administrator", "member"]);
export function readChats(value) {
  const raw = value?.trim() ?? "";
  if (!raw || /^(0|yo'q|yoq|no|false|off)$/i.test(raw)) return [];
  return [...new Set(raw.split(/[,\s]+/).filter((chat) => /^(@[A-Za-z]\w{3,}|-100\d+)$/.test(chat)))];
}
export function createMemberCheck(token, refs, { fetchImpl = fetch, timeoutMs = 8_000 } = {}) {
  if (!token || !refs.length) return null;
  const ask = async (chatId, userId) => {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/getChatMember`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.json();
  };
  return async (userId) => {
    const missing = [];
    try {
      for (const ref of refs) {
        const body = await ask(ref, userId);
        const member = body?.result;
        const inside = MEMBER.has(member?.status) || (member?.status === "restricted" && member.is_member === true);
        if (body?.ok && inside) continue;
        if (body?.ok || (body?.error_code === 400 && /user not found|participant_id_invalid|member not found/i.test(body.description ?? ""))) {
          const name = ref.startsWith("@") ? ref.slice(1) : null;
          missing.push({ ref, title: name ? `@${name}` : ref, url: name ? `https://t.me/${name}` : null });
          continue;
        }
        return null; // bot admin emas / boshqa xato — bilmaymiz
      }
    } catch {
      return null;
    }
    return { ok: missing.length === 0, missing };
  };
}
