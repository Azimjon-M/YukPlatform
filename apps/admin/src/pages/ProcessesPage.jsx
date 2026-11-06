// Jarayonlar: bot, collector, nginx va tunnel loglari jonli (har 2 s), holati va boshqarish tugmalari.
// Loglar API xotirasida (oxirgi 1000 qator) — faqat shu server ishga tushirgan jarayonlarniki.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { get } from "../api.js";
import { formatNumber, formatTime } from "../format.js";
import { useApi } from "../hooks.js";
import { emptyLog, isNearBottom, mergeLogs } from "../logs.js";
import { ProcessCard } from "../ProcessCard.jsx";
import { Async, Button, ErrorBox, PageHeader, Tabs, useTitle } from "../ui.jsx";

const POLL_MS = 2000;

function LogViewer({ name, status }) {
  const [log, setLog] = useState(emptyLog);
  const [error, setError] = useState(null);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const boxRef = useRef(null);
  const logRef = useRef(log);
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    let alive = true;
    let timer = null;
    async function tick() {
      clearTimeout(timer);
      try {
        const response = await get(`/api/processes/${encodeURIComponent(name)}/logs`, { after: logRef.current.last });
        if (!alive) return;
        const merged = mergeLogs(logRef.current, response);
        if (merged.reset) {
          // Server qayta ishga tushgan — boshidan o'qiymiz
          logRef.current = emptyLog();
          setLog(logRef.current);
          return tick();
        }
        logRef.current = merged;
        if (merged.added) {
          setLog(merged);
          if (!followRef.current) setUnseen((n) => n + merged.added);
        }
        setError(null);
      } catch (e) {
        if (alive) setError(e);
      }
      if (alive && !document.hidden) timer = setTimeout(tick, POLL_MS);
    }
    const onVisibility = () => (document.hidden ? clearTimeout(timer) : tick());
    tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [name]);

  // Pastga yopishib turish (foydalanuvchi yuqoriga aylantirmagan bo'lsa)
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && follow) box.scrollTop = box.scrollHeight;
  }, [log, follow, onlyErrors]);

  const onScroll = () => {
    const near = isNearBottom(boxRef.current);
    if (near !== followRef.current) setFollow(near);
    if (near) setUnseen(0);
  };

  const jumpDown = () => {
    setFollow(true);
    setUnseen(0);
  };

  const lines = onlyErrors ? log.lines.filter((l) => l.stream !== "out") : log.lines;

  return (
    <div className="log-panel">
      <div className="log-toolbar">
        <label className="check">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
          Faqat xato va tizim xabarlari
        </label>
        <span className="muted small">
          {formatNumber(log.lines.length)} qator · har 2 s yangilanadi{follow ? "" : " · aylantirish to'xtatilgan"}
        </span>
      </div>
      {error && <ErrorBox error={error} />}
      <div className="log-box" ref={boxRef} onScroll={onScroll} role="log" aria-label={`${name} loglari`} tabIndex={0}>
        {lines.length === 0 ? (
          <p className="log-empty">
            {status === "external"
              ? "Bu jarayon terminalda ishga tushirilgan — uning loglari o'sha terminal oynasida chiqadi."
              : log.lines.length
                ? "Xato yoki tizim xabari yo'q."
                : "Hali log yo'q. Jarayon shu server orqali ishga tushirilganda loglar shu yerda chiqadi."}
          </p>
        ) : (
          lines.map((line) => (
            <div key={line.seq} className={`log-line log-${line.stream}`}>
              <span className="log-time">{formatTime(line.time, { seconds: true })}</span>
              <span className="log-text">{line.text}</span>
            </div>
          ))
        )}
      </div>
      {!follow && (
        <Button className="log-jump" variant="primary" onClick={jumpDown}>
          ↓ Pastga{unseen > 0 ? ` (${formatNumber(unseen)} yangi)` : ""}
        </Button>
      )}
    </div>
  );
}

export function ProcessesPage() {
  useTitle("Jarayonlar");
  const state = useApi(() => get("/api/processes"), [], { interval: POLL_MS });
  const [selected, setSelected] = useState("bot");

  return (
    <>
      <PageHeader title="Jarayonlar" subtitle="Bot, collector, nginx va tunnel: holati, boshqarish va jonli loglar" />
      <Async state={state}>
        {({ items }) => {
          const current = items.find((p) => p.name === selected) ?? items[0];
          if (!current) return <ErrorBox error={new Error("Jarayonlar ro'yxati bo'sh")} />;
          return (
            <div className="stack">
              <Tabs tabs={items.map((p) => ({ id: p.name, label: p.title }))} value={current.name} onChange={setSelected} label="Jarayon" />
              <ProcessCard proc={current} onChanged={state.reload} />
              <LogViewer key={current.name} name={current.name} status={current.status} />
            </div>
          );
        }}
      </Async>
    </>
  );
}
