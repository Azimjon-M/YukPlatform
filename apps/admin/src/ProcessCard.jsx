// Bitta jarayon (bot, collector, nginx, tunnel): holati, PID, qancha ishlayapti, Yoqish / O'chirish / Qayta ishga tushirish.
// Terminalda ishga tushirilgan bo'lsa (external) — bu yerdan boshqarib bo'lmaydi, API 409 qaytaradi.
import { useState } from "react";
import { post } from "./api.js";
import { uptimeText } from "./format.js";
import { useNow } from "./hooks.js";
import { ACTION_LABELS, processActions, processStatus } from "./status.js";
import { Badge, Button, useToast } from "./ui.jsx";

const DESCRIPTIONS = {
  bot: "Navbatdagi e'lonlarni AI bilan tahlil qiladi, kanalga va haydovchilarga yuboradi",
  collector: "Manba guruhlardan yangi e'lonlarni o'qib, navbatga yozadi",
  nginx: "Kompyuterning «old eshigi»: haydovchilar ilovasini beradi va /pub so'rovlarini serverga uzatadi (http://localhost)",
  tunnel: "Haydovchilar ilovasini internetga chiqaradi (Cloudflare, tekin). Manzil har yoqilganda yangi — bot o'zi oladi",
};

const DONE_TEXT = { start: "yoqildi", stop: "o'chirildi", restart: "qayta ishga tushirildi" };

export function ProcessCard({ proc, onChanged }) {
  const notify = useToast();
  const now = useNow(5000);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const meta = processStatus(proc.status);
  const can = processActions(proc.status);

  async function run(action) {
    setBusy(action);
    setError(null);
    try {
      await post(`/api/processes/${encodeURIComponent(proc.name)}/${action}`);
      notify(`${proc.title}: ${DONE_TEXT[action]}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
      onChanged?.();
    }
  }

  return (
    <article className="process-card">
      <div className="process-head">
        <div>
          <h3>{proc.title}</h3>
          <p className="muted small">{DESCRIPTIONS[proc.name]}</p>
        </div>
        <Badge tone={meta.tone} icon={meta.icon}>
          {meta.label}
        </Badge>
      </div>

      <dl className="process-meta">
        <div>
          <dt>PID</dt>
          <dd>{proc.pid ?? "—"}</dd>
        </div>
        <div>
          <dt>Ishlayapti</dt>
          <dd>{proc.status === "running" ? uptimeText(proc.startedAt, now) : "—"}</dd>
        </div>
        <div>
          <dt>To'xtashlar (10 daq)</dt>
          <dd>{proc.crashes ?? 0}</dd>
        </div>
      </dl>

      {proc.status === "external" && (
        <p className="process-note">
          Terminalda ishga tushirilgan — bu yerdan boshqarib bo'lmaydi. To'xtatish uchun o'sha oynada Ctrl+C bosing.
          {proc.autoRestart && " U yopilsa, shu yerdan o'zi yoqiladi."}
        </p>
      )}
      {proc.status === "crashed" && proc.autoRestart && <p className="process-note">10 soniyadan keyin o'zi qayta ishga tushadi.</p>}
      {proc.exitCode != null && proc.status !== "running" && proc.status !== "external" && (
        <p className="muted small">Oxirgi chiqish kodi: {proc.exitCode}</p>
      )}

      <div className="process-actions">
        {["start", "stop", "restart"].map((action) => (
          <Button
            key={action}
            variant={action === "start" ? "primary" : "secondary"}
            disabled={!can[action] || (busy && busy !== action)}
            busy={busy === action}
            onClick={() => run(action)}
          >
            {ACTION_LABELS[action]}
          </Button>
        ))}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
