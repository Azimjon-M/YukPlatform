// React yordamchilari: API'dan ma'lumot olish (kerak bo'lsa har N soniyada), kechiktirilgan qiymat, "hozir" vaqti.
import { useCallback, useEffect, useRef, useState } from "react";

// fetcher — () => Promise. deps o'zgarsa qaytadan so'raladi; interval berilsa — har interval ms da,
// faqat sahifa ko'rinib turganda (boshqa oynaga o'tsangiz to'xtaydi, qaytsangiz darhol yangilanadi).
// Qayta so'rashda eski ma'lumot qoladi (sahifa "sakramaydi"), loading: true bo'ladi.
export function useApi(fetcher, deps = [], { interval = null, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled, updatedAt: null });
  const fetcherRef = useRef(fetcher);
  const runRef = useRef(() => {});
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let timer = null;
    let seq = 0;

    const run = async () => {
      clearTimeout(timer);
      const id = ++seq;
      setState((s) => (s.loading ? s : { ...s, loading: true }));
      try {
        const data = await fetcherRef.current();
        if (alive && id === seq) setState({ data, error: null, loading: false, updatedAt: Date.now() });
      } catch (error) {
        if (alive && id === seq) setState((s) => ({ ...s, error, loading: false }));
      }
      if (alive && id === seq && interval && !document.hidden) timer = setTimeout(run, interval);
    };
    const onVisibility = () => {
      if (!interval) return;
      if (document.hidden) clearTimeout(timer);
      else run();
    };

    runRef.current = run;
    run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, interval, enabled]);

  const reload = useCallback(() => runRef.current(), []);
  return { ...state, reload };
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
