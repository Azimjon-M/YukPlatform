// Bosh sahifa (2026-11-20 yangilandi: saralash o'chiq, guruh e'lonlari AI'siz — asl matni darhol haydovchilarga):
// kelgan e'lonlar, haydovchiga yetganlari, tezlik, e'lon / e'lon emas, haydovchilar, 24 soatlik grafik, jarayonlar, sozlamalar.
// Ma'lumot: GET /api/overview (App har 10 s da yangilaydi).
import { aiTotals } from "../aiStatus.js";
import { get } from "../api.js";
import { formatNumber, formatTime } from "../format.js";
import { useApi, useLiveStatus } from "../hooks.js";
import { HourlyChart } from "../HourlyChart.jsx";
import { configChecklist, throughput } from "../metrics.js";
import { Link } from "../navigation.jsx";
import { useOverview } from "../overview.js";
import { ProcessCard } from "../ProcessCard.jsx";
import { Async, Badge, Button, Card, PageHeader, useTitle } from "../ui.jsx";

const sum = (values = []) => values.reduce((a, b) => a + b, 0);

const TONE_ICON = { good: "✓", warning: "!", serious: "!", critical: "✖", neutral: "•" };

function Tile({ label, value, unit, sub, children, tone }) {
  return (
    <div className={`tile ${tone ? `tile-${tone}` : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">
        {value}
        {unit && <span className="tile-unit">{unit}</span>}
      </div>
      {sub && <div className="tile-sub">{sub}</div>}
      {children}
    </div>
  );
}

// Xatolar soni — faqat ko'rsatkich (2026-11-18: «Qayta navbatga» olib tashlandi; o'chirish — E'lonlar → Xato)
function FailedTile({ failed }) {
  return <Tile label="Xato bo'lganlar" value={formatNumber(failed)} sub={failed ? "xato bilan tugagan e'lonlar" : "Xato yo'q"} tone={failed ? "critical" : null} />;
}

// 42 → «42 s», 150 → «2,5 daq»
const secondsText = (sec) => (sec < 90 ? { value: formatNumber(sec), unit: "s" } : { value: formatNumber(sec / 60, 1), unit: "daq" });

const percent = (part, total) => (total > 0 ? `${Math.round((part / total) * 100)}%` : "—");

function Throughput({ metrics }) {
  const t = throughput(metrics.lastHour, metrics.queue);
  return (
    <div className={`verdict tone-${t.tone}`} role="status">
      <span className="verdict-icon" aria-hidden="true">
        {TONE_ICON[t.tone]}
      </span>
      <div>
        <strong>{t.title}</strong>
        <p>{t.text}</p>
      </div>
    </div>
  );
}

// AI ulanishlari soni GET /api/ai dan (kalitlar endi AI sahifasida); ololmasa — .env dagi belgilar
function ConfigList({ config, processes }) {
  const ai = useApi(() => get("/api/ai"), [], { interval: 30_000, live: ["ai"], liveGapMs: 3000 });
  const botRunning = processes.some((p) => p.name === "bot" && (p.status === "running" || p.status === "external"));
  const totals = ai.data ? aiTotals(ai.data.keys, { botRunning }) : null;
  return (
    <ul className="checklist">
      {configChecklist(config, totals).map((row) => (
        <li key={row.id}>
          <Badge tone={row.ok === true ? "good" : row.ok === false ? "critical" : "neutral"} icon={row.ok === true ? "✓" : row.ok === false ? "✗" : "–"}>
            {row.ok === true ? "Bor" : row.ok === false ? "Yo'q" : "Ixtiyoriy"}
          </Badge>
          <span className="check-label">{row.href ? <Link to={row.href}>{row.label}</Link> : row.label}</span>
          <span className="check-value">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewPage() {
  useTitle("Bosh sahifa");
  const overview = useOverview();
  const live = useLiveStatus() === "live";
  return (
    <>
      <PageHeader
        title="Bosh sahifa"
        subtitle={
          overview.updatedAt
            ? `${live ? "Jonli — o'zgarish bo'lishi bilan yangilanadi" : "Har 10 soniyada yangilanadi"} · oxirgisi ${formatTime(overview.updatedAt, { seconds: true })}`
            : "Tizim holati bir qarashda"
        }
        actions={
          <Button onClick={overview.reload} busy={overview.loading && overview.data != null}>
            Yangilash
          </Button>
        }
      />
      <Async state={overview}>
        {({ metrics, processes, config }) => (
          <div className="stack">
            <div className="tiles">
              <Tile
                label={`Kelgan e'lonlar (${metrics.hours} soat)`}
                value={formatNumber(sum(metrics.hourly.posts))}
                sub={`oxirgi soatda ${formatNumber(metrics.lastHour.posts)} · takrorlar ${formatNumber(metrics.lastHour.duplicates)}`}
              />
              <Tile
                label={`Haydovchiga yetdi (${metrics.hours} soat)`}
                value={formatNumber(metrics.feed?.posts ?? 0)}
                unit="e'lon"
                sub={`${formatNumber(metrics.feed?.sent ?? 0)} xabar · ${formatNumber(metrics.feed?.drivers ?? 0)} haydovchi${metrics.feed?.failed ? ` · ${formatNumber(metrics.feed.failed)} tasi yetmadi` : ""}`}
              />
              <Tile
                label="Tezlik (median)"
                {...(metrics.lastHour.feedDelaySec == null ? { value: "—" } : secondsText(metrics.lastHour.feedDelaySec))}
                sub="guruhda chiqqanidan haydovchiga yetguncha, oxirgi soat"
              />
              <Tile
                label="Haydovchilar"
                value={formatNumber(metrics.drivers.active)}
                unit={`/ ${formatNumber(metrics.drivers.total)}`}
                sub="faol / ro'yxatdan o'tgan"
              />
              <Tile
                label={`E'lon / e'lon emas (${metrics.hours} soat)`}
                value={formatNumber(metrics.verdict?.loads ?? 0)}
                unit={`/ ${formatNumber(metrics.verdict?.chatter ?? 0)}`}
                sub={`yuk e'loni ${percent(metrics.verdict?.loads ?? 0, (metrics.verdict?.loads ?? 0) + (metrics.verdict?.chatter ?? 0))} · AI ishlatilmadi`}
              />
              <FailedTile failed={metrics.queue.failed} />
            </div>

            <Card title="Oxirgi soat">
              <div className="mini-stats">
                <div>
                  <span className="mini-label">E'lonlar</span>
                  <strong>{formatNumber(metrics.lastHour.posts)}</strong>
                </div>
                <div>
                  <span className="mini-label">Takrorlar</span>
                  <strong>{formatNumber(metrics.lastHour.duplicates)}</strong>
                </div>
                <div>
                  <span className="mini-label">Haydovchiga yetdi</span>
                  <strong>{formatNumber(metrics.lastHour.feedPosts ?? 0)}</strong>
                </div>
                <div>
                  <span className="mini-label">Navbatda</span>
                  <strong>{formatNumber(metrics.queue.waiting)}</strong>
                </div>
              </div>
              {metrics.parsedBy && (
                <p className="muted small">
                  🧠 Oxirgi {metrics.hours} soatda {formatNumber(metrics.parsedBy.rules + (metrics.parsedBy.fast ?? 0))} ta e'lon o'zimizning algoritm bilan
                  ajratildi (AI'siz): {formatNumber(metrics.parsedBy.rules)} tasi to'liq tushunildi (yo'nalish, mashina — sayt va «Yuklar» uchun)
                  {metrics.parsedBy.ai > 0 && <>; AI'da {formatNumber(metrics.parsedBy.ai)} ta (guruh e'lonlari 20.11 10:39 gacha AI'da edi, endi AI faqat yuk beruvchilar uchun)</>}
                </p>
              )}
              {(metrics.media?.voice > 0 || metrics.media?.round > 0) && (
                <p className="muted small">
                  🎤 Oxirgi {metrics.hours} soatda {formatNumber(metrics.media.voice)} ta ovozli xabar va {formatNumber(metrics.media.round)} ta dumaloq
                  video matnga o'girildi
                </p>
              )}
              {metrics.parsedBy?.shipper > 0 && (
                <p className="muted small">
                  📦 Oxirgi {metrics.hours} soatda yuk beruvchilarning o'zi {formatNumber(metrics.parsedBy.shipper)} ta yuk yubordi («📦 Yuk berish»)
                </p>
              )}
              {metrics.parsedBy?.noContact > 0 && (
                <p className="muted small">
                  📵 Oxirgi {metrics.hours} soatda {formatNumber(metrics.parsedBy.noContact)} ta e'londa telefon raqami ham, lichkasi ham yo'q edi
                </p>
              )}
              {metrics.feed?.calls > 0 && (
                <p className="muted small">
                  📞 «Telefon qilish» tugmasi {formatNumber(metrics.feed.calls)} marta bosildi
                </p>
              )}
              <Throughput metrics={metrics} />
            </Card>

            <Card title={`Oxirgi ${metrics.hours} soat — soatma-soat`}>
              <p className="muted small chart-hint">Ikki chiziq orasidagi farq — e'lon emas (oddiy gap, reklama) yoki haydovchilar filtriga tushmagan e'lonlar. Takrorlar hisobga olinmagan.</p>
              <HourlyChart hourly={metrics.hourly} now={metrics.now} />
            </Card>

            <div className="grid-2">
              <Card title="Jarayonlar" actions={<Link to="/jarayonlar">Loglar</Link>}>
                <div className="process-list">
                  {processes.map((proc) => (
                    <ProcessCard key={proc.name} proc={proc} onChanged={overview.reload} />
                  ))}
                </div>
              </Card>
              <Card title="Sozlamalar (.env)">
                <ConfigList config={config} processes={processes} />
                <p className="muted small">Kalitlar bu yerda ko'rsatilmaydi — faqat yozilgan yoki yo'qligi. AI kalitlari — AI sahifasida; qolganlari .env faylida (o'zgartirgach jarayonni qayta ishga tushiring).</p>
              </Card>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
