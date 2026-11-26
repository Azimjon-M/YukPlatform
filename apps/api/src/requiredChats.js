// Majburiy a'zolik ro'yxati — boshqaruv markazidan (Azimjon, 2026-11-26: «men telegram link qo'shaman, botni unga admin
// qilaman (bot o'sha guruh/kanalda bo'lmasa ishlamasin) va u majburiy a'zolikka qo'shilsin. Dynamic qilsang»).
// Qo'shishda Telegram'dan tekshiriladi: chat topiladimi (getChat) va bot u yerda ADMINmi (getChatMember) — admin
// bo'lmasa Telegram boshqa odamlarning a'zoligini aytmaydi, tekshiruv ishlamaydi. Bot (apps/bot) ro'yxatni bazadan
// 20 soniyada bir o'qiydi, ilova serveri — har kod so'ralganda.
export const REQUIRED_MAX = 5;

// "https://t.me/Yuk_Ekspert", "t.me/Yuk_Ekspert", "@Yuk_Ekspert", "Yuk_Ekspert", "-1001234567890" → "@Yuk_Ekspert" | "-100…"
// Taklif havolasi (t.me/+…, joinchat) — null: bot uni chatga aylantira olmaydi
export function parseChatLink(raw) {
  const text = String(raw ?? "").trim();
  if (/^-100\d{5,}$/.test(text)) return text;
  const link = text.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t\.me|telegram\.me|telegram\.dog)\//i, "").replace(/^@/, "");
  if (/^(\+|joinchat\/)/i.test(link)) return { invite: true };
  const name = link.split(/[/?#]/)[0];
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? `@${name}` : null;
}

// token — BOT_TOKEN; → { ref, id, title, type, url } yoki throw Error (status 400, o'zbekcha matn)
export async function resolveRequiredChat(token, raw, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });
  if (!token) throw Object.assign(new Error(".env da BOT_TOKEN yo'q"), { status: 503 });
  const parsed = parseChatLink(raw);
  if (parsed?.invite) throw fail("Taklif havolasi (t.me/+…) ishlamaydi — kanal/guruhning @username'ini yoki -100… ID sini yozing");
  if (!parsed) throw fail("Havola tushunarsiz. Masalan: https://t.me/Yuk_Ekspert, @Yuk_Ekspert yoki -1001234567890");
  const call = async (method, body) => {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.json();
  };
  let chat;
  let me;
  try {
    chat = await call("getChat", { chat_id: parsed });
    me = await call("getMe", {});
  } catch {
    throw Object.assign(new Error("Telegram bilan aloqa yo'q — birozdan keyin qayta urinib ko'ring"), { status: 502 });
  }
  if (!chat?.ok) throw fail("Bot bu guruh/kanalni topa olmadi: bot u yerda yo'q yoki havola noto'g'ri. Avval botni qo'shib, admin qiling");
  const info = chat.result;
  if (info.type === "private") throw fail("Bu shaxsiy akkaunt — guruh yoki kanal havolasini bering");
  const member = me?.ok ? await call("getChatMember", { chat_id: info.id, user_id: me.result.id }).catch(() => null) : null;
  const status = member?.result?.status;
  if (status !== "administrator" && status !== "creator") {
    throw fail(`Bot «${info.title ?? parsed}» da admin emas — avval botni (@${me?.result?.username ?? "bot"}) admin qiling, keyin qo'shing`);
  }
  return {
    ref: info.username ? `@${info.username}` : String(info.id),
    id: info.id,
    title: info.title ?? parsed,
    type: info.type === "channel" ? "channel" : "group",
    url: info.username ? `https://t.me/${info.username}` : (info.invite_link ?? null),
  };
}
