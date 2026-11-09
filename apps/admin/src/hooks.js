// React yordamchilari: API'dan ma'lumot olish (kerak bo'lsa har N soniyada yoki jonli), kechiktirilgan qiymat, "hozir" vaqti.
import { useCallback, useEffect, useRef, useState } from "react";
import { liveStatus, subscribeLive, subscribeLiveStatus } from "./live.js";

// fetcher — () => Promise. deps o'zgarsa qaytadan so'raladi; interval berilsa — har interval ms da,
// faqat sahifa ko'rinib turganda (boshqa oynaga o'tsangiz to'xtaydi, qaytsangiz darhol yangilanadi).
// live — jonli bo'limlar (live.js): ["drivers"] — bot bazaga yozishi bilan 1–2 soniyada o'zi yangilanadi.
// liveGapMs — jonli yangilanishlar orasidagi eng kam vaqt (og'ir so'rovlar uchun kattaroq: bosh sahifa 3 s).
// Qayta so'rashda eski ma'lumot qoladi (sahifa "sakramaydi"), loading: true bo'ladi; jonli yangilanishda — yo'q (miltillamasin).
export function useApi(fetcher, deps = [], { interval = null, enabled = true, live = null, liveGapMs = 1000 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled, updatedAt: null });
  const fetcherRef = useRef(fetcher);
  const runRef = useRef(() => {});
  fetcherRef.current = fetcher;
  const liveKey = live?.join(",") ?? "";

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let timer = null;
    let liveTimer = null;
    let startedAt = 0;
    let stale = false; // sahifa yashirin paytda o'zgarish keldi — qaytganda yangilanadi
    let seq = 0;

    const run = async ({ silent = false } = {}) => {
      clearTimeout(timer);
      clearTimeout(liveTimer);
      stale = false;
      startedAt = Date.now();
      const id = ++seq;
      if (!silent) setState((s) => (s.loading ? s : { ...s, loading: true }));
      try {
        const data = await fetcherRef.current();
        if (alive && id === seq) setState({ data, error: null, loading: false, updatedAt: Date.now() });
      } catch (error) {
        if (alive && id === seq) setState((s) => ({ ...s, error, loading: false }));
      }
      if (alive && id === seq && interval && !document.hidden) timer = setTimeout(run, interval);
    };
    const onVisibility = () => {
      if (document.hidden) return clearTimeout(timer);
      if (interval || stale) run();
    };
    // Jonli xabar: ketma-ket kelsa ham liveGapMs da bir martadan ko'p so'ramaymiz
    const onLive = () => {
      if (document.hidden) {
        stale = true;
        return;
      }
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => run({ silent: true }), Math.max(0, startedAt + liveGapMs - Date.now()));
    };

    runRef.current = run;
    run();
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = liveKey ? subscribeLive(liveKey.split(","), onLive) : () => {};
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(liveTimer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, interval, enabled, liveKey, liveGapMs]);

  const reload = useCallback(() => runRef.current(), []);
  return { ...state, reload };
}

// Jonli ulanish holati: "live" | "connecting" | "offline" (yon paneldagi belgi uchun)
export function useLiveStatus() {
  const [status, setStatus] = useState(liveStatus);
  useEffect(() => subscribeLiveStatus(setStatus), []);
  return status;
}

// Jonli xabar kelganda biror ishni qilish (masalan, loglarni darhol so'rash). fn har renderda yangi bo'lishi mumkin
export function useLive(topics, fn) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const key = topics.join(",");
  useEffect(() => subscribeLive(key.split(","), (changed) => fnRef.current(changed)), [key]);
}

// Qidiruv maydoni: yozib bo'lgach ms kutib, keyin so'raymiz
export function useDebounced(value, ms = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// "5 daq oldin" kabi yozuvlar o'z-o'zidan yangilanib tursin
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
