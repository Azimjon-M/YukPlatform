// Telegram'ning «Menu» tugmasi — yozish qatorining chap tomonida, bosilsa buyruqlar ro'yxati (/start, /sozlamalar, ...)
// ochiladi. Azimjon (2026-11-10): rol tanlanmaguncha pastki menyu ham, bu tugma ham ko'rinmasin — adashib bosmasin.
//
// Telegram'da «tugmani yashirish» degan narsa yo'q: buyruqlar bo'lsa — tugma bor. Shuning uchun:
//   - umumiy (default) ro'yxat bo'sh (dropDefault) — rolsiz odamda tugma umuman yo'q;
//   - rol tanlagan har bir odamning chatiga o'z ro'yxati qo'yiladi (setMyCommands, scope chat);
//   - rolsiz bo'lib qolsa (hisobdan chiqdi, hisobini o'chirdi) — olib tashlanadi (deleteMyCommands, scope chat).
// Qaysi chatga qo'yilgani bazada (drivers.commands_on). Bot har xabardan keyin shu odamni darhol tekshiradi (sync);
// rol web'da yoki boshqaruv markazida o'zgargan bo'lsa — har daqiqadagi tekshiruv (sweep) farqni topib to'g'rilaydi.
import { GrammyError } from "grammy";

export const COMMANDS = [
  { command: "start", description: "Boshlash va menyu" },
  { command: "sozlamalar", description: "Sozlamalarni o'zgartirish" },
  { command: "rol", description: "Rolni almashtirish: haydovchi ↔ yuk beruvchi" },
  // Haydovchining yuk olish rejimi: saralangan / tezkor / guruhlarim (2026-11-14; bot.js feed.js)
  { command: "rejim", description: "Yuklarni olish rejimi (haydovchi)" },
  { command: "pauza", description: "Yuk yuborishni to'xtatib turish" },
  { command: "davom", description: "Yana yuborish" },
  { command: "raqam", description: "Telefon raqamni ulashish (ixtiyoriy)" },
  // = menyudagi «➕ Guruh qo'shish» (Azimjon, 2026-11-10: buyrug'i /guruh_qoshish). Raqamsiz odamga — avval raqam
  { command: "guruh_qoshish", description: "Yuk guruhi yoki kanali qo'shish" },
  // Sozlamalardagi «📡 Telegram akkauntlarim» — Mini App'ni shu bo'limga ochadi (Azimjon, 2026-11-13)
  { command: "account_qosh", description: "Telegram akkauntimni ulash (yopiq guruhlar uchun)" },
  { command: "ilovalar", description: "Telefon ilovalari" },
  { command: "ochirish", description: "Ma'lumotlarimni o'chirish" },
  { command: "yordam", description: "Yordam" },
];

export const COMMANDS_SYNC_MS = 60 * 1000;

// Chatlarga qaysi ro'yxat qo'yilgani (settings). Ro'yxat o'zgarsa (yangi buyruq) — ishga tushganda hammasiga qaytadan
// qo'yiladi; aks holda eski chatlarda eski ro'yxat qolardi (commands_on faqat «qo'yilgan / qo'yilmagan»ni biladi)
const LIST_KEY = "bot_commands_list";

// api — bot.api; store — @yuk/store; gapMs — Telegram'ga ketma-ket so'rovlar orasidagi tanaffus (ko'p odam bo'lsa ham
// cheklovga urilmasin); sleep — testda kutmaslik uchun. → { sync, sweep, dropDefault, start, stop }
export function createCommandSync({ api, store, log = console.log, gapMs = 100, everyMs = COMMANDS_SYNC_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let timer = null;
  let running = false;

  async function apply({ chatId, want }) {
    const scope = { type: "chat", chat_id: chatId };
    try {
      if (want) await api.setMyCommands(COMMANDS, { scope });
      else await api.deleteMyCommands({ scope });
    } catch (error) {
      // Aloqa yo'q — keyingi tekshiruvda qayta urinadi. Telegram rad etdi (masalan, chat topilmadi) — qayta-qayta
      // urinmaymiz: holat yozib qo'yiladi (rol yana o'zgarsa — yana urinadi)
      if (!(error instanceof GrammyError)) throw error;
      log(`Menu tugmasi (${chatId}) yangilanmadi: ${error.description}`);
    }
    store.setCommandsOn(chatId, want);
  }

  // Bitta odam (bot har shaxsiy xabar / tugmadan keyin): Telegram'dagi holat kerakligidan farq qilsa — to'g'rilaydi
  async function sync(chatId) {
    const [row] = store.commandsToSync({ chatId });
    if (row) await apply(row);
  }

  // Farqi bor hamma chat → nechtasi to'g'rilandi
  async function sweep() {
    let done = 0;
    for (;;) {
      const rows = store.commandsToSync({ limit: 50 });
      if (!rows.length) return done;
      for (const row of rows) {
        await apply(row);
        done++;
        await sleep(gapMs);
      }
    }
  }

  // Umumiy ro'yxatni olib tashlash (2026-11-10 gacha hamma uchun shu edi) — faqat bor bo'lsa
  async function dropDefault() {
    const list = await api.getMyCommands();
    if (Array.isArray(list) && list.length) {
      await api.deleteMyCommands();
      return true;
    }
    return false;
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const done = await sweep();
      if (done) log(`Menu tugmasi: ${done} ta chatda yangilandi`);
    } catch (error) {
      log(`Menu tugmasi tekshirilmadi: ${error.description ?? error.message}`);
    } finally {
      running = false;
    }
  }

  // Ro'yxat oxirgi marta qo'yilganidan farq qilsa — hamma chat «qo'yilmagan» deb belgilanadi. → nechta chat
  function renewIfChanged() {
    const list = JSON.stringify(COMMANDS);
    if (store.getSetting(LIST_KEY) === list) return 0;
    const count = store.resetCommandsOn();
    store.setSetting(LIST_KEY, list);
    return count;
  }

  // Ishga tushganda: avval rolli odamlarga o'z ro'yxati (tugmasi yo'qolib qolmasin), keyin umumiysi olib tashlanadi
  async function start() {
    const renewed = renewIfChanged();
    if (renewed) log(`Menu tugmasi: buyruqlar ro'yxati o'zgardi — ${renewed} ta chatga qaytadan qo'yiladi`);
    await tick();
    try {
      if (await dropDefault()) log("Menu tugmasi: umumiy buyruqlar olib tashlandi — endi faqat rol tanlaganlarda");
    } catch (error) {
      log(`Umumiy buyruqlar olib tashlanmadi: ${error.description ?? error.message}`);
    }
    timer ??= setInterval(tick, everyMs);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { sync, sweep, dropDefault, renewIfChanged, start, stop };
}
