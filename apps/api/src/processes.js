// Bot, collector, nginx va tunnelni boshqaruv markazidan yoqish / o'chirish. Har biri alohida Node jarayoni (fork), loglari xotirada.
// nginx va tunnel — tashqi dasturlar (.exe); ularni src/edge/ dagi kichik Node dasturi ishga tushiradi va to'xtatadi.
// To'xtatish: avval "stop" xabari (dastur o'zi yumshoq tugaydi), 8 s ichida tugamasa — majburan.
// Kutilmaganda to'xtasa — 10 s dan keyin o'zi qayta ishga tushadi (10 daqiqada 5 martagacha).
// ensure() (npm start dagi AUTOSTART): terminalda ishlayotgan nusxa bo'lsa — kutadi, u to'xtashi bilan o'zi yoqadi.
// Shunda bot hech qachon «hech kim yoqmagan» holatda qolib ketmaydi (2026-11-09: eski PID tufayli bot yoqilmay qoldi).
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CONFIG } from "@yuk/shared";
import { BEAT_MS, readRunLock, removeRunLock } from "@yuk/store";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const NODE_FLAGS = ["--env-file-if-exists=../../.env", "--disable-warning=ExperimentalWarning"];

export const PROCESSES = {
  bot: { title: "Bot", cwd: path.join(ROOT, "apps/bot"), module: "src/main.js", args: [] },
  collector: { title: "Collector", cwd: path.join(ROOT, "apps/collector"), module: "src/cli.js", args: ["live"] },
  nginx: { title: "nginx", cwd: path.join(ROOT, "apps/api"), module: "src/edge/nginx.js", args: [] },
  tunnel: { title: "Tunnel", cwd: path.join(ROOT, "apps/api"), module: "src/edge/tunnel.js", args: [] },
};

const MAX_LINES = 1000;
const CRASH_WINDOW_MS = 10 * 60 * 1000;
const MAX_CRASHES = 5;

export class ProcessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createProcessManager({
  definitions = PROCESSES,
  readLock = readRunLock,
  removeLock = removeRunLock,
  restartDelayMs = 10_000,
  stopTimeoutMs = 8_000,
  watchMs = 5_000,
  staleGraceMs = 2 * BEAT_MS,
  onLine = null,
} = {}) {
  const items = new Map(
    Object.entries(definitions).map(([name, def]) => [
      name,
      { name, def, child: null, status: "stopped", pid: null, startedAt: null, exitCode: null, crashes: [], lines: [], seq: 0, want: false, timer: null, partial: {}, staleSince: null },
    ]),
  );

  function get(name) {
    const item = items.get(name);
    if (!item) throw new ProcessError(404, `Bunday jarayon yo'q: ${name}`);
    return item;
  }

  function push(item, stream, text) {
    const line = { seq: ++item.seq, time: Date.now(), stream, text };
    item.lines.push(line);
    if (item.lines.length > MAX_LINES) item.lines.splice(0, item.lines.length - MAX_LINES);
    onLine?.(item.name, line);
  }

  // Ma'lumot bo'laklarga bo'linib keladi: qator oxirigacha yig'ib, keyin yozamiz
  function collect(item, stream, chunk) {
    const text = (item.partial[stream] ?? "") + chunk.toString("utf8");
    const lines = text.split(/\r?\n/);
    item.partial[stream] = lines.pop();
    for (const line of lines) if (line.trim()) push(item, stream, line);
  }

  function state(item) {
    let { status, pid } = item;
    // Bizning bolamiz emas, lekin PID fayli tirik — terminalda qo'lda ishga tushirilgan
    if (!item.child) {
      const lock = readLock(item.name);
      if (lock?.alive) {
        status = "external";
        pid = lock.pid;
      }
    }
    return {
      name: item.name,
      title: item.def.title,
      status,
      pid,
      startedAt: item.child ? item.startedAt : null,
      exitCode: item.exitCode,
      crashes: item.crashes.length,
      autoRestart: item.want,
    };
  }

  function scheduleRestart(item) {
    const time = Date.now();
    item.crashes = item.crashes.filter((t) => time - t < CRASH_WINDOW_MS);
    item.crashes.push(time);
    if (item.crashes.length > MAX_CRASHES) {
      item.want = false;
      push(item, "system", `${MAX_CRASHES} martadan ko'p to'xtadi — o'zi qayta ishga tushmaydi. Loglarni ko'rib, qo'lda yoqing.`);
      return;
    }
    push(item, "system", `${restartDelayMs / 1000} s dan keyin qayta ishga tushadi`);
    item.timer = setTimeout(() => {
      item.timer = null;
      if (!item.want || item.child) return;
      try {
        start(item.name);
      } catch (error) {
        push(item, "system", `qayta ishga tushmadi: ${error.message}`);
      }
    }, restartDelayMs);
  }

  function start(name) {
    const item = get(name);
    if (item.child) return state(item);
    const lock = readLock(name);
    if (lock?.alive) {
      throw new ProcessError(409, `${item.def.title} terminalda ishlayapti (PID ${lock.pid}). Avval o'sha oynada Ctrl+C bosing.`);
    }
    if (lock?.stale) {
      push(item, "system", `data/run/${name}.json eskirgan: PID ${lock.pid} endi boshqa jarayonniki (fayl yangilanmayapti) — e'tiborsiz`);
    }
    clearTimeout(item.timer);
    item.timer = null;
    item.staleSince = null;
    item.want = true;
    item.partial = {};
    const child = fork(item.def.module, item.def.args, {
      cwd: item.def.cwd,
      execArgv: item.def.execArgv ?? NODE_FLAGS,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    Object.assign(item, { child, status: "running", pid: child.pid, startedAt: Date.now(), exitCode: null });
    push(item, "system", `▶ ishga tushdi (PID ${child.pid})`);
    child.stdout.on("data", (chunk) => collect(item, "out", chunk));
    child.stderr.on("data", (chunk) => collect(item, "err", chunk));
    child.on("error", (error) => push(item, "system", `xato: ${error.message}`));
    child.on("exit", (code, signal) => {
      for (const stream of ["out", "err"]) if (item.partial[stream]?.trim()) push(item, stream, item.partial[stream]);
      // Majburan o'ldirilgan bola o'z PID faylini o'chira olmaydi — biz o'chiramiz (faqat u o'shaniki bo'lsa)
      removeLock(item.name, { pid: child.pid });
      const expected = item.status === "stopping" || !item.want;
      // EXIT_CONFIG (78) — dastur o'zi «.env ni tuzating» dedi (masalan, dasturlash rejimida prod bot tokeni):
      // qayta yoqish yordam bermaydi, faqat bir xil xatoni 5 marta takrorlaydi — to'xtab turadi
      const misconfigured = !expected && code === EXIT_CONFIG;
      if (misconfigured) item.want = false;
      Object.assign(item, { child: null, pid: null, exitCode: code, status: expected || misconfigured ? "stopped" : "crashed" });
      push(
        item,
        "system",
        expected
          ? "■ to'xtadi"
          : misconfigured
            ? "■ sozlama (.env) sababli ishlamadi — qayta yoqilmaydi. Yuqoridagi xabarni o'qing, .env ni tuzatib, qo'lda yoqing"
            : `✖ kutilmaganda to'xtadi (${code ?? signal})`,
      );
      if (!expected && !misconfigured) scheduleRestart(item);
    });
    return state(item);
  }

  // AUTOSTART uchun: yoqadi; terminalda ishlayotgan nusxa bo'lsa — xato emas, u to'xtashini kutadi (watch)
  function ensure(name) {
    const item = get(name);
    if (item.child) return state(item);
    const lock = readLock(name);
    if (lock?.alive) {
      item.want = true;
      push(item, "system", `terminalda ishlayotgan nusxa bor (PID ${lock.pid}) — u to'xtashi bilan shu yerdan yoqiladi`);
      return state(item);
    }
    return start(name);
  }

  // Har watchMs da: yoqilishi kerak (want), lekin bolamiz yo'q va qayta yoqish taymeri ham kutmayapti —
  // terminaldagi nusxa to'xtaganmi? To'xtagan bo'lsa — o'zimiz yoqamiz.
  // PID tirik, fayl esa eskirgan (stale) bo'lsa — yana staleGraceMs kutamiz: kompyuter uyqudan endi uyg'ongan
  // bo'lsa, ishlayotgan dastur faylni hali yangilashga ulgurmagan bo'lishi mumkin (ikki bot = 409 Conflict).
  function watch(now = Date.now()) {
    for (const item of items.values()) {
      if (!item.want || item.child || item.timer || item.status === "stopping") {
        item.staleSince = null;
        continue;
      }
      const lock = readLock(item.name);
      if (lock?.alive) {
        item.staleSince = null;
        continue;
      }
      if (lock?.stale) {
        item.staleSince ??= now;
        if (now - item.staleSince < staleGraceMs) continue;
      }
      push(item, "system", "terminaldagi nusxa to'xtadi — endi shu yerdan ishlaydi");
      try {
        start(item.name);
      } catch (error) {
        push(item, "system", `yoqilmadi: ${error.message}`);
      }
    }
  }
  const watcher = setInterval(watch, watchMs);
  watcher.unref();

  async function stop(name) {
    const item = get(name);
    item.want = false;
    clearTimeout(item.timer);
    item.timer = null;
    const child = item.child;
    if (!child) {
      if (item.status === "crashed") item.status = "stopped";
      return state(item);
    }
    item.status = "stopping";
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try {
      child.send("stop");
    } catch {
      child.kill();
    }
    const force = setTimeout(() => {
      push(item, "system", "yumshoq to'xtamadi — majburan to'xtatildi");
      child.kill();
    }, stopTimeoutMs);
    await exited;
    clearTimeout(force);
    return state(item);
  }

  return {
    list: () => [...items.values()].map(state),
    get: (name) => state(get(name)),
    start,
    ensure,
    watch,
    stop,
    async restart(name) {
      await stop(name);
      return start(name);
    },
    // after — oxirgi ko'rilgan qator raqami: faqat yangilari qaytadi
    logs(name, after = 0) {
      const item = get(name);
      return { lines: item.lines.filter((line) => line.seq > after), last: item.seq };
    },
    async shutdown() {
      clearInterval(watcher);
      await Promise.all([...items.keys()].map(stop));
    },
  };
}
