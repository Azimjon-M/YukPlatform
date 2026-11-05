// Bosh sahifa: navbat, oxirgi soat, kechikish, haydovchilar, xatolar, 24 soatlik grafik, jarayonlar, sozlamalar.
// Ma'lumot: GET /api/overview (App har 10 s da yangilaydi).
import { useState } from "react";
import { post } from "../api.js";
import { durationMin, formatNumber, formatTime } from "../format.js";
import { HourlyChart } from "../HourlyChart.jsx";
import { configChecklist, throughput } from "../metrics.js";
import { Link } from "../navigation.jsx";
import { useOverview } from "../overview.js";
import { ProcessCard } from "../ProcessCard.jsx";
import { Async, Badge, Button, Card, PageHeader, useTitle, useToast } from "../ui.jsx";

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

function FailedTile({ failed, onDone }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  async function retryAll() {
    setBusy(true);
    try {
      const { retried } = await post("/api/posts/retry-failed");
      notify(`${formatNumber(retried)} ta e'lon navbatga qaytdi`);
      onDone();
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Tile label="Xato bo'lganlar" value={formatNumber(failed)} sub={failed ? "AI yoki tarmoq xatosi bilan tugagan" : "Xato yo'q"} tone={failed ? "critical" : null}>
      <div className="tile-actions">
        <Button onClick={retryAll} disabled={!failed} busy={busy}>
          Qayta navbatga
        </Button>
        {failed > 0 && <Link to="/navbat">Ko'rish</Link>}
      </div>
    </Tile>
  );
}

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

function ConfigList({ config }) {
  return (
    <ul className="checklist">
      {configChecklist(config).map((row) => (
        <li key={row.id}>
          <Badge tone={row.ok === true ? "good" : row.ok === false ? "critical" : "neutral"} icon={row.ok === true ? "✓" : row.ok === false ? "✗" : "–"}>
            {row.ok === true ? "Bor" : row.ok === false ? "Yo'q" : "Ixtiyoriy"}
          </Badge>
          <span className="check-label">{row.label}</span>
          <span className="check-value">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewPage() {
  useTitle("Bosh sahifa");
  const overview = useOverview();
  return (
    <>
      <PageHeader
        title="Bosh sahifa"
        subtitle={overview.updatedAt ? `Har 10 soniyada yangilanadi · oxirgisi ${formatTime(overview.updatedAt, { seconds: true })}` : "Tizim holati bir qarashda"}
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
              <Tile label="Navbatda" value={formatNumber(metrics.queue.waiting)} sub="e'lon tahlilni kutyapti" />
              <Tile
                label="Eng eski kutayotgan"
                value={metrics.queue.oldestWaitingMin == null ? "—" : durationMin(metrics.queue.oldestWaitingMin)}
                sub="navbatdagi eng eski e'lon yoshi"
              />
              <Tile
                label="Kechikish (median)"
                value={metrics.lastHour.medianDelayMin == null ? "—" : formatNumber(metrics.lastHour.medianDelayMin, 1)}
                unit={metrics.lastHour.medianDelayMin == null ? null : "daq"}
                sub="e'londan yuk bazaga tushguncha, oxirgi soat"
              />
              <Tile
                label="Haydovchilar"
                value={formatNumber(metrics.drivers.active)}
                unit={`/ ${formatNumber(metrics.drivers.total)}`}
                sub="faol / ro'yxatdan o'tgan"
              />
              <Tile
                label={`Yuklar (${metrics.hours} soat)`}
                value={formatNumber(metrics.loads.total)}
                sub={`${formatNumber(metrics.loads.delivered)} tasi haydovchiga yetdi · ${formatNumber(metrics.loads.messages)} xabar`}
              />
              <FailedTile failed={metrics.queue.failed} onDone={overview.reload} />
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
                  <span className="mini-label">Tahlil qilindi</span>
                  <strong>{formatNumber(metrics.lastHour.processed)}</strong>
                </div>
                <div>
                  <span className="mini-label">Yuklar</span>
                  <strong>{formatNumber(metrics.lastHour.loads)}</strong>
                </div>
              </div>
              <Throughput metrics={metrics} />
            </Card>

            <Card title={`Oxirgi ${metrics.hours} soat — soatma-soat`}>
              <p className="muted small chart-hint">Kelgan e'lonlar chizig'i tahlil chizig'idan yuqori bo'lsa — navbat o'syapti. Takrorlar hisobga olinmagan.</p>
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
                <ConfigList config={config} />
                <p className="muted small">Kalitlar bu yerda ko'rsatilmaydi — faqat yozilgan yoki yo'qligi. O'zgartirish: .env fayli, keyin jarayonni qayta ishga tushiring.</p>
              </Card>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
