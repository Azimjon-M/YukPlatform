// Botga topshiriqlar (store: bot_notices jadvali; 2026-11-10). Server (apps/api) — alohida jarayon: u chatga bot kabi
// to'liq javob bera olmaydi (mos yuklar ro'yxati, tugmalar, menyu — bot kodida). Shuning uchun server bazaga yozib
// qo'yadi («bu odam xaritada yo'nalish tanladi»), bot esa har 2 soniyada navbatni olib, chatga javob beradi.
// handlers: { [kind]: async (chatId, notice) => ... } — masalan, route (bot.js routeFromWeb).
// Bitta topshiriqdagi xato boshqalariga xalaqit bermaydi (log va keyingisi). Telegram'ga bog'liq emas — testda runOnce().
export function createNoticeLoop({ store, handlers, log = console.log, everyMs = 2000 }) {
  let timer = null;
  let busy = false; // oldingi aylanish tugamaguncha keyingisi boshlanmaydi (Telegram sekin javob bersa)

  async function runOnce() {
    if (busy) return 0;
    busy = true;
    try {
      const notices = store.takeBotNotices?.() ?? [];
      for (const notice of notices) {
        const handle = handlers[notice.kind];
        if (!handle) {
          log(`Noma'lum topshiriq: ${notice.kind}`);
          continue;
        }
        try {
          await handle(notice.chatId, notice);
        } catch (error) {
          log(`Topshiriq bajarilmadi (${notice.kind}, ${notice.chatId}): ${error.description ?? error.message}`);
        }
      }
      return notices.length;
    } finally {
      busy = false;
    }
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => runOnce().catch((error) => log(`Topshiriqlar o'qilmadi: ${error.message}`)), everyMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
