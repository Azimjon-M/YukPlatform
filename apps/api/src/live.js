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
export function createLive({ marks, intervalMs = 1000, heartbeatMs = 25_000, log = () => {} }) {
  const clients = new Set();
  let last = null;
  let timer = null;
  let ping = null;
  let failing = false;

  const send = (text) => {
    for (const res of clients) res.write(text);
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
    ping = setInterval(() => send(": ping\n\n"), heartbeatMs);
    timer.unref?.();
    ping.unref?.();
  }

  function stopIfIdle() {
    if (clients.size || !timer) return;
    clearInterval(timer);
    clearInterval(ping);
    timer = ping = null;
  }

  // Express marshruti: GET /api/live
  function handler(req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    // retry — uzilsa brauzer necha ms dan keyin qayta ulanadi; ready — sahifa «jonli» belgisini yoqadi
    res.write(`retry: 3000\n\n${frame("ready", { intervalMs })}`);
    clients.add(res);
    start();
    req.on("close", () => {
      clients.delete(res);
      stopIfIdle();
    });
  }

  // Server to'xtaganda: ochiq ulanishlarni yopamiz
  function close() {
    for (const res of clients) res.end();
    clients.clear();
    stopIfIdle();
  }

  return { handler, tick, close, clients: () => clients.size };
}
