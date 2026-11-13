// Boshqaruv markazining jonli yangilanishi: GET /api/live — Server-Sent Events (SSE, oddiy HTTP ulanish ochiq turadi,
// server unga qator yozib turadi; brauzerda EventSource o'zi qayta ulanadi). WebSocket shart emas: ma'lumot faqat
// serverdan brauzerga boradi.
//
// Bot va collector — boshqa jarayonlar, bazaga o'zlari yozadi; server buni bilishi uchun har soniyada bazadan qisqa
// «belgilar» so'raydi (@yuk/store changeMarks: MAX(id), MAX(updated_at) ...). Belgi o'zgarsa — ochiq sahifalarga
// `event: change` + `{"topics":["drivers"]}` yuboriladi, sahifa o'sha bo'limni REST orqali qayta so'raydi.
// Ma'lumotning o'zi oqimda yo'q — faqat «nima o'zgardi»; shuning uchun xavfsizlik oddiy GET so'rovlardek.
//
// Bo'limlar: drivers, posts, loads, ai, sources (bazadan); processes (holat), logs (yangi log qatori) — jarayonlar
// boshqaruvchisidan (processes.js, xotirada).

// Oldingi va hozirgi belgilar → o'zgargan bo'limlar. Birinchi o'lchovda (prev yo'q) — hech narsa
export function changedTopics(prev, next) {
  if (!prev) return [];
  return Object.keys(next).filter((topic) => prev[topic] !== next[topic]);
}

// Jarayonlar belgilari: holat (ishlayapti / to'xtadi / qayta yoqildi) va har birining oxirgi log qatori raqami
export function processMarks(processes) {
  const list = processes.list();
  return {
    processes: list.map((p) => `${p.name}:${p.status}:${p.pid ?? ""}:${p.startedAt ?? ""}:${p.crashes ?? ""}`).join(","),
    logs: list.map((p) => `${p.name}:${processes.logs?.(p.name, Number.MAX_SAFE_INTEGER)?.last ?? ""}`).join(","),
  };
}

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// marks() → { topic: belgi }. Taymer faqat kamida bitta sahifa ulanib turganda ishlaydi.
// intervalMs — bazani qanchalik tez-tez tekshirish; heartbeatMs — ulanish uzilmasligi uchun bo'sh «ping»
// tunnelPadBytes — yuqoridagi izohning hajmi (0 — o'chiriladi)
export function createLive({ marks, intervalMs = 1000, now = Date.now, heartbeatMs = 10_000, log = () => {}, tunnelPadBytes = 70_000 }) {
  const clients = new Map(); // res → { padded }
  let last = null;
  let timer = null;
  let ping = null;
  let failing = false;

  // Izoh (SSE «comment»): EventSource uni o'qimaydi, lekin bayt hisoblanadi. Cloudflare quick-tunnel
  // (bizning «internetga chiqarish»imiz) kichik kadrlarni o'zida saqlab qoladi — resmiiy hujjatda ham
  // «Quick Tunnels do not support Server-Sent Events» deyilgan; ~30-40 KB yig'ilsagina chiqaradi.
  // Shuning uchun tunnel orqali kelgan ulanishga har kadrdan oldin uzun izoh yuboriladi (2026-11-11
  // o'lchov: ~100 baytli kadr 60 s dan ko'p kechikadi, ~50-70 KB izohli kadr bir necha soniyada yetib boradi).
  const pad = tunnelPadBytes > 0 ? `: ${"x".repeat(tunnelPadBytes)}\n` : "";

  // Har mijozga o'z matnini yuboramiz: tunnel orqali kelganlarga kattalashtirilgan, lokalga — oddiy
  const send = (text) => {
    for (const [res, meta] of clients) res.write(meta.padded ? `${pad}${text}` : text);
  };

  function tick() {
    let next;
    try {
      next = marks();
      failing = false;
    } catch (error) {
      // Baza bir zum band bo'lishi mumkin (bot yozayapti) — keyingi soniyada yana
      if (!failing) log(`Jonli yangilanish: bazadan o'qilmadi — ${error.message}`);
      failing = true;
      return [];
    }
    const topics = changedTopics(last, next);
    last = next;
    if (topics.length) send(frame("change", { topics }));
    return topics;
  }

  function start() {
    if (timer) return;
    last = null;
    tick(); // boshlang'ich belgilar
    timer = setInterval(tick, intervalMs);
    // «ping» — nomli hodisa: izoh (`: ping`) brauzerga ko'rinmaydi, nomli kadr esa ko'rinadi.
    // Brauzer shu orqali «oqim tirik, faqat ma'lumot o'zgarmadi» dey oladi (apps/admin/src/live.js) —
    // aks holda jim o'tirgan panelda tunnel kechkirtdimi-yo'qmi bilib bo'lmaydi. intervalMs dan kichik
    // bo'lishi shart emas: u faqat o'lik ulanishni payqash uchun (heartbeatMs).
    ping = setInterval(() => send(frame("ping", { at: now() })), heartbeatMs);
    // (Alohida «flush» taymeri shart emas: tunnel mijoziga ketgan HAR bir kadr allaqachon pad bilan katta,
    // shuning uchun Cloudflare buferi yig'ilmaydi — kadr darhol chiqib ketadi.)
    timer.unref?.();
    ping.unref?.();
  }

  function stopIfIdle() {
    if (clients.size || !timer) return;
    clearInterval(timer);
    clearInterval(ping);
    timer = ping = null;
  }

  // Cloudflare («cf-ray») yoki Tailscale Funnel orqali kelgan ulanish — kadrlar yo'lda saqlanib qoladi
  const viaTunnel = (req) => typeof req.get === "function" && Boolean(req.get("cf-ray") ?? req.get("tailscale-funnel-request"));

  // Express marshruti: GET /api/live
  function handler(req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    // retry — uzilsa brauzer necha ms dan keyin qayta ulanadi; ready — sahifa «jonli» belgisini yoqadi
    const padded = pad && viaTunnel(req);
    res.write(`retry: 3000\n\n${padded ? pad : ""}${frame("ready", { intervalMs })}`);
    clients.set(res, { padded });
    start();
    req.on("close", () => {
      clients.delete(res);
      stopIfIdle();
    });
  }

  // Server to'xtaganda: ochiq ulanishlarni yopamiz
  function close() {
    for (const [res] of clients) res.end();
    clients.clear();
    stopIfIdle();
  }

  return { handler, tick, close, clients: () => clients.size };
}
