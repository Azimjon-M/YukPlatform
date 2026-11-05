// Oxirgi 24 soat, soatma-soat: kelgan e'lonlar, tahlil qilinganlar, yangi yuklar.
// "Kelgan" chizig'i "tahlil" chizig'idan doim yuqori bo'lsa — navbat o'syapti (tahlil oqimga yetmayapti).
// Oddiy SVG: bitta Y o'qi, ingichka chiziqlar, sichqoncha/klaviatura bilan har bir soat qiymati, jadval ko'rinishi.
import { useLayoutEffect, useRef, useState } from "react";
import { bucketRanges, labelEvery, labelsCollide, linePath, nearestIndex, yTicks } from "./chart.js";
import { formatNumber, formatTime } from "./format.js";

const SERIES = [
  { key: "posts", label: "Kelgan e'lonlar", color: "var(--series-1)" },
  { key: "processed", label: "Tahlil qilingan", color: "var(--series-2)" },
  { key: "loads", label: "Yangi yuklar", color: "var(--series-3)" },
];

const HEIGHT = 240;
const M = { top: 14, right: 44, bottom: 30, left: 40 };

const sum = (values) => values.reduce((a, b) => a + b, 0);

export function HourlyChart({ hourly, now }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = hourly?.posts?.length ?? 0;
  if (!n) return null;

  const ranges = bucketRanges(now, n);
  const values = Object.fromEntries(SERIES.map((s) => [s.key, hourly[s.key] ?? new Array(n).fill(0)]));
  const ticks = yTicks(Math.max(...SERIES.flatMap((s) => values[s.key])));
  const top = ticks.at(-1);
  const plotW = Math.max(40, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const spacing = n > 1 ? plotW / (n - 1) : 0;
  const x = (i) => M.left + i * spacing;
  const y = (v) => M.top + plotH - (v / top) * plotH;
  const every = labelEvery(spacing);
  const endYs = SERIES.map((s) => y(values[s.key][n - 1]));
  const showEndLabels = !labelsCollide(endYs, 13);
  const rangeText = (i) => `${formatTime(ranges[i].start)}–${formatTime(ranges[i].end)}`;

  const onPointer = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive(nearestIndex(event.clientX - box.left, M.left, spacing, n));
  };
  const onKey = (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in moves) {
      event.preventDefault();
      setActive((i) => Math.min(n - 1, Math.max(0, (i ?? n - 1) + moves[event.key])));
    } else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(n - 1);
  };

  const tipLeft = active != null && x(active) > width * 0.6;

  return (
    <figure className="chart">
      <ul className="legend" aria-label="Chiziqlar">
        {SERIES.map((s) => (
          <li key={s.key}>
            <span className="legend-key" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
            <span className="legend-total">{formatNumber(sum(values[s.key]))}</span>
          </li>
        ))}
      </ul>

      <div className="chart-plot" ref={wrapRef}>
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          tabIndex={0}
          role="img"
          aria-label={`Oxirgi ${n} soat: kelgan e'lonlar ${sum(values.posts)}, tahlil qilingan ${sum(values.processed)}, yangi yuklar ${sum(values.loads)}. Chap va o'ng strelka bilan soatlarni ko'ring.`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((i) => i ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "chart-baseline" : "chart-grid"} x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
              <text className="chart-tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {formatNumber(t)}
              </text>
            </g>
          ))}

          {ranges.map((r, i) =>
            (n - 1 - i) % every === 0 ? (
              <text key={r.end} className="chart-tick" x={x(i)} y={HEIGHT - 8} textAnchor={i === n - 1 ? "end" : "middle"}>
                {i === n - 1 ? "hozir" : formatTime(r.end)}
              </text>
            ) : null,
          )}

          {active != null && <line className="chart-crosshair" x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} />}

          {SERIES.map((s) => (
            <path
              key={s.key}
              d={linePath(values[s.key].map((v, i) => [x(i), y(v)]))}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {SERIES.map((s, k) => {
            const i = active ?? n - 1;
            return <circle key={s.key} className="chart-dot" cx={x(i)} cy={active != null ? y(values[s.key][i]) : endYs[k]} r="4" fill={s.color} />;
          })}

          {showEndLabels &&
            active == null &&
            SERIES.map((s, k) => (
              <text key={s.key} className="chart-end-label" x={x(n - 1) + 8} y={endYs[k]} dy="0.32em">
                {formatNumber(values[s.key][n - 1])}
              </text>
            ))}
        </svg>

        {active != null && (
          <div className={`chart-tooltip ${tipLeft ? "is-left" : ""}`} style={{ left: x(active) }} role="presentation">
            <div className="tooltip-title">{rangeText(active)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="tooltip-row">
                <span className="tooltip-key" style={{ background: s.color }} aria-hidden="true" />
                <strong>{formatNumber(values[s.key][active])}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="chart-table">
        <summary>Jadval ko'rinishi</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Vaqt</th>
                {SERIES.map((s) => (
                  <th key={s.key} scope="col" className="num">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranges.map((r, i) => (
                <tr key={r.end}>
                  <th scope="row">{rangeText(i)}</th>
                  {SERIES.map((s) => (
                    <td key={s.key} className="num">
                      {formatNumber(values[s.key][i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
