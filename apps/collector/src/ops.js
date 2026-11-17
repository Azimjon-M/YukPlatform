// Yordamchi (operator) Telegram akkaunti (2026-11-17, Azimjon: «menda yangi Telegram account bor … uni loyihamizga
// qo'shamiz … U accountdan sen foydalan masalan menga nmadur jo'natishing guruh va kanallarni rivojlantirishing real
// testlar o'tkazib ko'rishing mumkin bo'ladi. Terminal orqali no'mer va ko'd (ikki bosqichli parolham) so'rattirsang bo'ladi»).
//
// Collector'dan ALOHIDA: sessiya apps/collector/ops/<nom>.session (sessions/ da emas — collector uni o'zi olib ishlatmasin:
// bitta sessiya ikki joyda bir vaqtda ishlasa, Telegram uni AUTH_KEY_DUPLICATED bilan bekor qiladi). Har buyruq ulanadi,
// ishini qiladi va uziladi; bir vaqtda faqat bittasi (lock). Har bir yuborilgan narsa data/ops.log ga yoziladi.
//
//   npm run ops -- login                 raqam → kod → (bo'lsa) 2FA parol, terminalda (parol ko'rinmaydi)
//   npm run ops -- whoami
//   npm run ops -- chats                 guruh/kanallar, qayerda admin ekani bilan
//   npm run ops -- send <kimga> <matn>   kimga: @username, me (Saqlanganlar), -100… (guruh/kanal id)
//   npm run ops -- read <kimga> [n]      oxirgi n ta xabar (standart 10) — tugmalari bilan (bot sinovi uchun)
//   npm run ops -- press <kimga> <xabar id> <tugma matni>   inline tugmani bosish (bot sinovi)
//   npm run ops -- logout
//   npm run ops -- listen                doimiy ulanib turadi (2026-11-17, Azimjon: «men yozishim bilan o'qiy oladigan va javob
//                                        beradigan bo'l»): shaxsiy xabar kelishi bilan «o'qildi» qiladi va ops/<nom>.inbox.jsonl
//                                        ga yozadi (Claude uni kuzatadi); u ishlab turganda send/read/press o'zi ulanmaydi —
//                                        buyruqni ops/<nom>.outbox/ orqali shu ulanishga topshiradi (bitta sessiya — bitta ulanish)
// --name <nom> — boshqa operator akkaunt (standart: operator)
import { existsSync } from "node:fs";
import { appendFile, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readdir } from "node:fs/promises";
import { Api } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { authErrorAction } from "./authErrors.js";
import { ask } from "./prompt.js";
import { createResponder } from "./opsResponder.js";
import { createClient, sendLoginCode, signInWithCode, signInWithPassword } from "./telegram.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OPS_DIR = path.resolve(HERE, "../ops");
const ROOT = path.resolve(HERE, "../../..");
export const OPS_LOG = path.join(ROOT, "data", "ops.log");
const NAME = /^[a-z][a-z0-9_-]{1,19}$/;

export const opsSessionFile = (name) => path.join(OPS_DIR, `${name}.session`);
const pidFile = (name) => path.join(OPS_DIR, `${name}.listen.pid`);
const inboxFile = (name) => path.join(OPS_DIR, `${name}.inbox.jsonl`);
const outboxDir = (name) => path.join(OPS_DIR, `${name}.outbox`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tinglovchi (listen) ishlayaptimi — pid fayli bor va jarayon tirik
async function listenerAlive(name) {
  try {
    const pid = Number((await readFile(pidFile(name), "utf8")).trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

// Tinglovchi ishlab turganda buyruq unga topshiriladi (outbox) va javobi kutiladi (60 s)
async function viaListener(name, command, args) {
  const id = `${Date.now()}-${process.pid}`;
  await mkdir(outboxDir(name), { recursive: true, mode: 0o700 });
  await writeFile(path.join(outboxDir(name), `${id}.json`), JSON.stringify({ command, args }), { mode: 0o600 });
  const answer = path.join(outboxDir(name), `${id}.out.json`);
  for (let waited = 0; waited < 60_000; waited += 300) {
    if (existsSync(answer)) {
      const result = JSON.parse(await readFile(answer, "utf8"));
      await unlink(answer).catch(() => {});
      if (!result.ok) throw new Error(result.error);
      return result.output;
    }
    await pause(300);
  }
  throw new Error("Tinglovchi 60 s ichida javob bermadi");
}

// Yuborilgan har bir narsa — kim, kimga, qisqa matn (keyin «nima qilindi?» ni ko'rish uchun)
async function audit(line) {
  await mkdir(path.dirname(OPS_LOG), { recursive: true });
  await appendFile(OPS_LOG, `${new Date().toISOString()} ${line}\n`);
}

// Bir vaqtda bitta buyruq: ikki ulanish bitta sessiya bilan — Telegram uchun shubhali
async function withLock(name, fn) {
  await mkdir(OPS_DIR, { recursive: true, mode: 0o700 });
  const lock = path.join(OPS_DIR, `${name}.lock`);
  let handle;
  // Lock ichida egasining PID'i; egasi o'lgan bo'lsa (kill -9, server o'chdi) — eski lock olib tashlanadi,
  // aks holda supervisor ostidagi listen hech qachon qayta ko'tarilmasdi
  const take = async () => {
    handle = await open(lock, "wx");
    await handle.write(String(process.pid));
  };
  try {
    await take();
  } catch {
    const owner = Number((await readFile(lock, "utf8").catch(() => "")).trim());
    let alive = false;
    try {
      if (owner) alive = Boolean(process.kill(owner, 0));
    } catch {}
    if (owner && !alive) {
      await unlink(lock).catch(() => {});
      return withLock(name, fn);
    }
    throw new Error(`«${name}» akkaunti hozir boshqa buyruqda band (${lock}). Tugashini kuting yoki, osilib qolgan bo'lsa, faylni o'chiring.`);
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(lock).catch(() => {});
  }
}

async function connect(name) {
  const file = opsSessionFile(name);
  if (!existsSync(file)) throw new Error(`Avval kiring: npm run ops -- login${name === "operator" ? "" : ` --name ${name}`}`);
  return createClient((await readFile(file, "utf8")).trim());
}

const titleOf = (user) => [user.firstName, user.lastName].filter(Boolean).join(" ") + (user.username ? ` (@${user.username})` : "");

// Terminalda: raqam → kod → 2FA. Kod va parolni faqat akkaunt egasi o'zi yozadi
async function cmdLogin(name) {
  const client = await createClient("");
  try {
    const phoneNumber = await ask("Telefon raqam (+998...): ");
    let sent;
    try {
      sent = await sendLoginCode(client, phoneNumber);
    } catch (error) {
      throw new Error(authErrorAction(error).message);
    }
    const where = { app: "Telegram ilovasidagi «Telegram» chatiga", sms: "SMS bilan", call: "qo'ng'iroq bilan" }[sent.via] ?? sent.via;
    console.log(`Kod yuborildi: ${where}.`);
    let result = null;
    for (let i = 0; i < 3 && !result; i++) {
      const code = await ask("Telegram yuborgan kod: ");
      try {
        result = await signInWithCode(client, { phoneNumber, phoneCodeHash: sent.phoneCodeHash, code });
      } catch (error) {
        const action = authErrorAction(error, i);
        if (!action.retry) throw new Error(action.message);
        console.error(action.message);
      }
    }
    if (!result) throw new Error("Kod uch marta noto'g'ri — qaytadan boshlang");
    for (let i = 0; result.password && i < 3; i++) {
      const password = await ask(`2FA parol${result.hint ? ` (eslatma: ${result.hint})` : ""}: `, { hidden: true });
      try {
        result = await signInWithPassword(client, password);
      } catch (error) {
        const action = authErrorAction(error, i);
        if (!action.retry) throw new Error(action.message);
        console.error(action.message);
      }
    }
    if (!result.user) throw new Error("Parol uch marta noto'g'ri — qaytadan boshlang");
    await mkdir(OPS_DIR, { recursive: true, mode: 0o700 });
    await writeFile(opsSessionFile(name), client.session.save(), { encoding: "utf8", mode: 0o600 });
    console.log(`\nKirildi: ${titleOf(result.user)}${result.user.premium ? " ⭐ Premium" : ""}`);
    console.log(`Sessiya: ${path.relative(ROOT, opsSessionFile(name))} (gitga tushmaydi; collector uni ishlatmaydi)`);
    await audit(`[${name}] login ${result.user.id}`);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

// «me», «@username», «-100…» yoki raqamli id → Telegram obyekti
async function peerOf(client, to) {
  const value = String(to ?? "").trim();
  if (!value) throw new Error("Kimga? Masalan: @Yuk_Ekspert_agent, me yoki -100…");
  if (value === "me") return "me";
  if (/^-?\d+$/.test(value)) {
    for await (const dialog of client.iterDialogs({})) if (String(dialog.id) === value) return dialog.entity;
    throw new Error(`id ${value} topilmadi: akkaunt bu chatda yo'q`);
  }
  return client.getEntity(value);
}

// Xabar → bitta qator (+ tugmalari): «#123 15:04 Ism: matn [tugma1] [tugma2]»
function messageLine(m) {
  const time = new Date(m.date * 1000).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
  const who = m.out ? "men" : m.sender?.username ? `@${m.sender.username}` : (m.sender?.firstName ?? m.sender?.title ?? "?");
  const media = m.media && !m.message ? `[${m.media.className.replace("MessageMedia", "")}]` : "";
  const buttons = (m.replyMarkup?.rows ?? []).flatMap((r) => r.buttons.map((b) => `[${b.text}]`)).join(" ");
  return `#${m.id} ${time} ${who}: ${(m.message ?? "").replace(/\s+/g, " ").slice(0, 300)}${media}${buttons ? `  ${buttons}` : ""}`;
}

// Bitta buyruq (to'g'ridan-to'g'ri ulanishda ham, tinglovchi ichida ham) → chiqadigan matn
async function runCommand(client, name, command, rest) {
  const out = [];
  if (command === "whoami") {
    const me = await client.getMe();
    out.push(`${titleOf(me)} · id ${me.id}${me.premium ? " · ⭐ Premium" : ""}`);
  } else if (command === "chats") {
    for await (const d of client.iterDialogs({})) {
      if (!d.isGroup && !d.isChannel) continue;
      const e = d.entity;
      const role = e.creator ? "egasi" : e.adminRights ? "admin" : "a'zo";
      out.push(`${d.isChannel && !d.isGroup ? "kanal" : "guruh"} | ${role.padEnd(5)} | ${e.username ? `@${e.username}` : d.id} | ${d.title}`);
    }
  } else if (command === "send") {
    const [to, ...words] = rest;
    const text = words.join(" ").trim();
    if (!text) throw new Error("Matn yo'q: npm run ops -- send @kimga Salom");
    const sent = await client.sendMessage(await peerOf(client, to), { message: text });
    out.push(`Yuborildi: #${sent.id} → ${to}`);
    await audit(`[${name}] send ${to} #${sent.id}: ${text.slice(0, 200).replace(/\s+/g, " ")}`);
  } else if (command === "read") {
    const [to, n = "10"] = rest;
    const peer = await peerOf(client, to);
    const messages = await client.getMessages(peer, { limit: Math.min(Number(n) || 10, 100) });
    for (const m of [...messages].reverse()) out.push(messageLine(m));
    await client.markAsRead(peer).catch(() => {}); // yozgan odamga «o'qildi» ko'rinsin
  } else if (command === "press") {
    const [to, id, ...words] = rest;
    const wanted = words.join(" ").trim();
    const peer = await peerOf(client, to);
    const [message] = await client.getMessages(peer, { ids: [Number(id)] });
    const button = (message?.replyMarkup?.rows ?? []).flatMap((r) => r.buttons).find((b) => b.text === wanted || b.text.includes(wanted));
    if (!button) throw new Error(`#${id} xabarda «${wanted}» tugmasi yo'q`);
    if (button instanceof Api.KeyboardButtonCallback) {
      const answer = await client.invoke(new Api.messages.GetBotCallbackAnswer({ peer, msgId: message.id, data: button.data }));
      out.push(`Bosildi: [${button.text}]${answer.message ? ` → «${answer.message}»` : ""}`);
    } else if (button.url) {
      out.push(`Bu havola tugmasi: ${button.url}`);
    } else {
      // Oddiy (reply) klaviatura tugmasi — uning matni xabar bo'lib yuboriladi
      await client.sendMessage(peer, { message: button.text });
      out.push(`Yuborildi: «${button.text}»`);
    }
    await audit(`[${name}] press ${to} #${id} [${button.text}]`);
  } else if (command === "logout") {
    await client.invoke(new Api.auth.LogOut());
    await unlink(opsSessionFile(name)).catch(() => {});
    out.push("Chiqildi, sessiya o'chirildi");
    await audit(`[${name}] logout`);
  } else {
    throw new Error(`Noma'lum buyruq: ${command}`);
  }
  return out.join("\n");
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { name: { type: "string", default: "operator" } } });
  const name = values.name.trim().toLowerCase();
  if (!NAME.test(name)) throw new Error(`Nom yaroqsiz: ${values.name}`);
  const [command, ...rest] = positionals;
  if (command === "login") return withLock(name, () => cmdLogin(name));
  if (!command) {
    console.log("Buyruqlar: login | listen | whoami | chats | send <kimga> <matn> | read <kimga> [n] | press <kimga> <xabar id> <tugma> | logout");
    return;
  }
  if (command === "listen") return withLock(name, () => listen(name));
  // Telegram'ga ulanmaydi — faqat bazadan, faqat SHU foydalanuvchining o'z ma'lumoti (operator qabulxonasi uchun)
  if (command === "userinfo") return console.log(await userInfo(rest[0]));
  // Tinglovchi ishlab turibdi — o'sha ulanish orqali (ikkinchi ulanish ochilmaydi)
  if (command !== "logout" && (await listenerAlive(name))) {
    console.log(await viaListener(name, command, rest));
    return;
  }
  return withLock(name, async () => {
    const client = await connect(name);
    try {
      console.log(await runCommand(client, name, command, rest));
    } finally {
      await client.disconnect().catch(() => {});
    }
  });
}

// Bitta foydalanuvchi haqida qisqa ma'lumot (botdagi holati, oxirgi yuborilgan yuklar, tarix). Boshqa odamlarning
// ma'lumoti chiqmaydi: yuklarning telefon raqamlari ham, ularni yuborganlarning ismi ham yo'q.
async function userInfo(raw) {
  const chatId = Number(raw);
  if (!Number.isSafeInteger(chatId) || chatId <= 0) throw new Error("userinfo <telegram id>");
  const { openStore } = await import("@yuk/store");
  const store = openStore();
  const d = store.getDriver(chatId);
  if (!d) return `Foydalanuvchi ${chatId} botda yo'q (botga hali /start bosmagan).`;
  const time = (ms) => (ms ? new Date(ms).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" }) : "—");
  const details = store.driverDetails(chatId, { events: 15, sent: 10 }) ?? {};
  const strip = (load) => {
    if (!load) return null;
    const { phones, ...rest } = load; // yukdagi telefonlar — uchinchi shaxslarniki
    return rest;
  };
  return JSON.stringify(
    {
      chatId,
      username: d.username,
      role: d.role,
      profile: d.profile,
      active: d.active,
      pausedAt: time(d.pausedAt),
      pausedBy: d.pausedBy,
      plan: d.plan,
      autoPro: d.autoPro,
      phoneShared: Boolean(d.phone),
      registered: time(d.createdAt),
      lastSeen: `${time(d.seenAt)} (${d.seenVia ?? "?"})`,
      deletedAt: time(d.deletedAt),
      subscription: { ok: d.subOk, missing: d.subMissing, checked: time(d.subCheckedAt) },
      events: (details.events ?? []).map((e) => ({ type: e.type, at: time(e.at), detail: e.detail })),
      deliveries: (details.deliveries ?? []).map((x) => ({ ok: x.ok, error: x.error, at: time(x.at), kind: x.kind, load: strip(x.load) })),
      rawDeliveries: (details.rawDeliveries ?? []).map((x) => ({ ok: x.ok, error: x.error, at: time(x.at) })),
    },
    null,
    1,
  );
}

// Doimiy ulanish: shaxsiy xabar kelishi bilan — «o'qildi» + inbox (Claude kuzatadi) + stdout; outbox buyruqlarini bajaradi
async function listen(name) {
  const client = await connect(name);
  await writeFile(pidFile(name), String(process.pid), { mode: 0o600 });
  const stop = async () => {
    await unlink(pidFile(name)).catch(() => {});
    // process.exit withLock'ning finally'sini o'tkazib yuboradi — lockni shu yerda bo'shatamiz
    await unlink(path.join(OPS_DIR, `${name}.lock`)).catch(() => {});
    await client.disconnect().catch(() => {});
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  // Egasi yozsa — Claude o'zi javob beradi (opsResponder.js). OPS_OWNER_ID bo'lmasa — faqat inbox
  const responder = process.env.OPS_OWNER_ID
    ? createResponder({ client, name, ownerId: process.env.OPS_OWNER_ID.trim(), opsDir: OPS_DIR, root: ROOT, audit })
    : null;
  client.addEventHandler(async (event) => {
    const m = event.message;
    if (!event.isPrivate || m.out) return;
    try {
      const sender = await m.getSender();
      const entry = {
        at: new Date(m.date * 1000).toISOString(),
        fromId: String(m.senderId),
        from: sender?.username ? `@${sender.username}` : [sender?.firstName, sender?.lastName].filter(Boolean).join(" ") || String(m.senderId),
        bot: Boolean(sender?.bot),
        id: m.id,
        text: m.message ?? "",
        media: m.media && !m.message ? m.media.className.replace("MessageMedia", "") : null,
      };
      const inputChat = await m.getInputChat();
      await client.markAsRead(inputChat).catch(() => {});
      await appendFile(inboxFile(name), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      console.log(JSON.stringify(entry));
      await responder?.handle(entry, inputChat);
    } catch (error) {
      console.error(`Xabarni yozib bo'lmadi: ${error.message}`);
    }
  }, new NewMessage({ incoming: true }));
  console.log(JSON.stringify({ listening: true, pid: process.pid, autoReplyTo: responder?.ownerId ?? null }));
  await audit(`[${name}] listen start`);
  // Outbox: boshqa jarayon (npm run ops -- send …) yozgan buyruqlar
  await mkdir(outboxDir(name), { recursive: true, mode: 0o700 });
  for (;;) {
    const files = (await readdir(outboxDir(name)).catch(() => [])).filter((f) => f.endsWith(".json") && !f.endsWith(".out.json")).sort();
    for (const file of files) {
      const full = path.join(outboxDir(name), file);
      let result;
      try {
        const { command, args } = JSON.parse(await readFile(full, "utf8"));
        if (command === "listen" || command === "login") throw new Error(`${command} — tinglovchi orqali emas`);
        result = { ok: true, output: await runCommand(client, name, command, args ?? []) };
      } catch (error) {
        result = { ok: false, error: error.message };
      }
      await unlink(full).catch(() => {});
      await writeFile(full.replace(/\.json$/, ".out.json"), JSON.stringify(result), { mode: 0o600 });
    }
    await pause(300);
  }
}

// GramJS uzilgandan keyin ham taymerlar qoladi — jarayon o'zi tugamasligi mumkin
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(`Xato: ${error.message}`);
    process.exit(1);
  });
