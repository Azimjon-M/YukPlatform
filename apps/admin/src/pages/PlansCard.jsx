// «💳 Obuna va to'lovlar» (2026-11-27): narx / muddat / to'lov rekvizitlari (sayt, Mini App va yordamchi akkaunt shundan o'qiydi)
// va foydalanuvchilar yuborgan to'lov cheklari. Chekni yordamchi akkaunt qabul qiladi: ishonchli ko'rinsa obunani darhol
// yoqadi (⏳ tasdiq kutilmoqda), bo'lmasa — so'raydi. Qaror shu yerda yoki Telegram'da (/tolov N ha|yoq) beriladi.
import { useState } from "react";
import { PLANS } from "@yuk/shared";
import { get, post, put } from "../api.js";
import { formatDateTime, formatNumber } from "../format.js";
import { useApi } from "../hooks.js";
import { Badge, Button, Card, Field, useToast } from "../ui.jsx";

const STATUS = {
  held: { tone: "info", icon: "⏳", label: "Yoqilgan — tasdiq kutilmoqda" },
  asked: { tone: "info", icon: "❓", label: "Berilmagan — tasdiq kutilmoqda" },
  confirmed: { tone: "good", icon: "✓", label: "Tasdiqlangan" },
  rejected: { tone: "critical", icon: "✖", label: "Rad etilgan" },
  lapsed: { tone: "critical", icon: "⌛", label: "Muddatida tasdiqlanmadi — qaytarilgan" },
};
const planName = (plan) => [PLANS[plan]?.icon, PLANS[plan]?.name ?? plan].filter(Boolean).join(" ");
const who = (p) => [p.name, p.username ? `@${p.username}` : null].filter(Boolean).join(" ") || `id ${p.chatId}`;

function SettingsForm({ initial, onSaved }) {
  const notify = useToast();
  const [form, setForm] = useState({ pro: initial.prices.pro || "", max: initial.prices.max || "", days: initial.days, holdHours: initial.holdHours, payInfo: initial.payInfo });
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await put("/api/plan-settings", { prices: { pro: Number(form.pro) || 0, max: Number(form.max) || 0 }, days: Number(form.days), holdHours: Number(form.holdHours), payInfo: form.payInfo });
      notify("Saqlandi — sayt, Mini App va yordamchi shu narxlarni ko'rsatadi", "good");
      onSaved(saved);
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="plan-settings" onSubmit={save}>
      <Field label="⭐ Pro narxi, so'm">
        <input type="number" min="0" step="1000" value={form.pro} onChange={set("pro")} placeholder="masalan 50000" />
      </Field>
      <Field label="💎 Max narxi, so'm">
        <input type="number" min="0" step="1000" value={form.max} onChange={set("max")} placeholder="masalan 120000" />
      </Field>
      <Field label="Muddat, kun">
        <input type="number" min="1" max="366" value={form.days} onChange={set("days")} />
      </Field>
      <Field label="Tasdiq kutish, soat">
        <input type="number" min="1" max="336" value={form.holdHours} onChange={set("holdHours")} title="Chek ishonchli ko'rinsa obuna darhol yoqiladi; shuncha soat ichida tasdiqlamasangiz — bekor bo'ladi" />
      </Field>
      <Field label="To'lov rekvizitlari (foydalanuvchiga shu matn ko'rsatiladi)" className="field-wide">
        <textarea rows="2" maxLength={500} value={form.payInfo} onChange={set("payInfo")} placeholder="Masalan: Click yoki Payme orqali 8600 **** **** 1234 kartaga (F. I.)" />
      </Field>
      <Button type="submit" variant="primary" busy={busy}>
        Saqlash
      </Button>
    </form>
  );
}

function PaymentRow({ payment, onChanged }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const open = payment.status === "held" || payment.status === "asked" || payment.status === "lapsed";
  const status = STATUS[payment.status] ?? { tone: "neutral", label: payment.status };
  async function decide(ok) {
    const reason = ok ? null : window.prompt("Rad etish sababi (foydalanuvchiga yoziladi, ixtiyoriy):", "");
    if (!ok && reason === null) return;
    setBusy(true);
    try {
      await post(`/api/payments/${payment.id}/decide`, { ok, reason: reason || null });
      notify(ok ? "Tasdiqlandi — yordamchi foydalanuvchiga 1 daqiqa ichida yozadi" : "Rad etildi — obuna qaytarildi", ok ? "good" : "neutral");
      onChanged();
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="payment-row">
      <div className="payment-main">
        <strong>
          #{payment.id} · {planName(payment.plan)} · {who(payment)}
        </strong>
        <span className="muted small">
          {payment.amount != null ? `${formatNumber(payment.amount)} so'm` : "summa o'qilmadi"}
          {payment.price ? ` (narx ${formatNumber(payment.price)})` : ""} · {payment.days} kun · {formatDateTime(payment.createdAt)}
          {payment.status === "held" && payment.holdUntil ? ` · ${formatDateTime(payment.holdUntil)} gacha tasdiqlash kerak` : ""}
        </span>
        {payment.note && <span className="muted small">Yordamchi: {payment.note}</span>}
        {payment.reason && <span className="small text-critical">Sabab: {payment.reason}</span>}
      </div>
      <div className="payment-side">
        <Badge tone={status.tone} icon={status.icon}>
          {status.label}
        </Badge>
        {payment.receipt && (
          <a className="small" href={`/api/payments/${payment.id}/receipt`} target="_blank" rel="noreferrer">
            🧾 Chekni ko'rish
          </a>
        )}
        {open && (
          <div className="confirm">
            <Button variant="primary" onClick={() => decide(true)} busy={busy}>
              Tasdiqlash
            </Button>
            {payment.status !== "lapsed" && (
              <Button variant="ghost" className="danger-text" onClick={() => decide(false)} disabled={busy}>
                Rad etish
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function PlansCard({ onChanged }) {
  const settings = useApi(() => get("/api/plan-settings"), []);
  const payments = useApi(() => get("/api/payments"), [], { live: ["drivers"] });
  const items = payments.data?.items ?? [];
  const waiting = items.filter((p) => p.status === "held" || p.status === "asked").length;
  const unset = settings.data && (!settings.data.prices.pro || !settings.data.prices.max || !settings.data.payInfo);
  const reload = () => {
    payments.reload();
    onChanged?.();
  };
  return (
    <Card
      title="💳 Obuna va to'lovlar"
      collapsible
      defaultOpen={waiting > 0 || Boolean(unset)}
      hint={waiting ? `${waiting} ta to'lov tasdiq kutmoqda` : unset ? "narx va rekvizitlarni kiriting" : `${formatNumber(items.length)} ta to'lov`}
    >
      <p className="muted small">
        Foydalanuvchi yordamchi akkauntga (Sarvar) yozib, obunani tanlaydi, to'laydi va chek rasmini yuboradi. Chek ishonchli ko'rinsa — obuna darhol
        yoqiladi va sizga xabar keladi; belgilangan vaqt ichida tasdiqlamasangiz yoki rad etsangiz — obuna qaytarib olinadi. Shubhali chekda obuna
        faqat siz tasdiqlagandan keyin yoqiladi. Narx 0 bo'lsa — hech bir chek o'zi yoqilmaydi.
      </p>
      {settings.data && <SettingsForm key={JSON.stringify(settings.data)} initial={settings.data} onSaved={() => settings.reload()} />}
      {items.length > 0 ? (
        <ul className="payments">
          {items.map((p) => (
            <PaymentRow key={`${p.id}:${p.status}`} payment={p} onChanged={reload} />
          ))}
        </ul>
      ) : (
        <p className="muted small">Hali to'lov yo'q.</p>
      )}
    </Card>
  );
}
