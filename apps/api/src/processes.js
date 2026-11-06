// Bot, collector, nginx va tunnelni boshqaruv markazidan yoqish / o'chirish. Har biri alohida Node jarayoni (fork), loglari xotirada.
// nginx va tunnel — tashqi dasturlar (.exe); ularni src/edge/ dagi kichik Node dasturi ishga tushiradi va to'xtatadi.
// To'xtatish: avval "stop" xabari (dastur o'zi yumshoq tugaydi), 8 s ichida tugamasa — majburan.
// Kutilmaganda to'xtasa — 10 s dan keyin o'zi qayta ishga tushadi (10 daqiqada 5 martagacha).
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRunLock } from "@yuk/store";

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
  restartDelayMs = 10_000,
  stopTimeoutMs = 8_000,
  onLine = null,
} = {}) {
  const items = new Map(
    Object.entries(definitions).map(([name, def]) => [
      name,
      { name, def, child: null, status: "stopped", pid: null, startedAt: null, exitCode: null, crashes: [], lines: [], seq: 0, want: false, timer: null, partial: {} },
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
    clearTimeout(item.timer);
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
      const expected = item.status === "stopping" || !item.want;
      Object.assign(item, { child: null, pid: null, exitCode: code, status: expected ? "stopped" : "crashed" });
      push(item, "system", expected ? "■ to'xtadi" : `✖ kutilmaganda to'xtadi (${code ?? signal})`);
      if (!expected) scheduleRestart(item);
    });
    return state(item);
  }

  async function stop(name) {
    const item = get(name);
    item.want = false;
    clearTimeout(item.timer);
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
      await Promise.all([...items.keys()].map(stop));
    },
  };
}
