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

// Narx maydoni: raqam + «so'm», ostida o'qilishi («49 000 so'm» — nol adashmasin; Azimjon, 2026-11-27: «49000 — 49 ming degani bo'ladimi?»)
function Money({ label, value, onChange, placeholder }) {
  const n = Number(value) || 0;
  return (
    <Field label={label}>
      <span className="with-unit">
        <input type="number" min="0" step="1000" inputMode="numeric" value={value} onChange={onChange} placeholder={placeholder} />
        <span className="unit">so'm</span>
      </span>
      <span className="muted small">{n ? `${formatNumber(n)} so'm` : "belgilanmagan (0) — sotilmaydi"}</span>
    </Field>
  );
}

function SettingsForm({ initial, onSaved }) {
  const notify = useToast();
  const [form, setForm] = useState({ pro: initial.prices.pro || "", max: initial.prices.max || "", weekPro: initial.week?.pro || "", weekMax: initial.week?.max || "", days: initial.days, holdHours: initial.holdHours, payInfo: initial.payInfo, autoGrant: initial.autoGrant !== false });
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await put("/api/plan-settings", { prices: { pro: Number(form.pro) || 0, max: Number(form.max) || 0 }, week: { pro: Number(form.weekPro) || 0, max: Number(form.weekMax) || 0 }, days: Number(form.days), holdHours: Number(form.holdHours), payInfo: form.payInfo, autoGrant: form.autoGrant });
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
      <Money label="⭐ Pro — oylik" value={form.pro} onChange={set("pro")} placeholder="49000" />
      <Money label="💎 Max — oylik" value={form.max} onChange={set("max")} placeholder="149000" />
      <Money label="⭐ Pro — haftalik (7 kun)" value={form.weekPro} onChange={set("weekPro")} placeholder="15000" />
      <Money label="💎 Max — haftalik (7 kun)" value={form.weekMax} onChange={set("weekMax")} placeholder="49000" />
      <Field label="Oylik muddat">
        <span className="with-unit">
          <input type="number" min="1" max="366" value={form.days} onChange={set("days")} />
          <span className="unit">kun</span>
        </span>
      </Field>
      <Field label="Tasdiq kutish">
        <span className="with-unit">
          <input type="number" min="1" max="336" value={form.holdHours} onChange={set("holdHours")} title="Chek ishonchli ko'rinsa obuna darhol yoqiladi; shuncha soat ichida tasdiqlamasangiz — bekor bo'ladi" />
          <span className="unit">soat</span>
        </span>
      </Field>
      <Field label="To'lov rekvizitlari (foydalanuvchiga shu matn ko'rsatiladi)" className="field-wide">
        <textarea rows="2" maxLength={500} value={form.payInfo} onChange={set("payInfo")} placeholder="Masalan: Click yoki Payme orqali 8600 **** **** 1234 kartaga (F. I.)" />
      </Field>
      <label className="field-wide plan-auto">
        <input type="checkbox" checked={form.autoGrant} onChange={(e) => setForm((f) => ({ ...f, autoGrant: e.target.checked }))} />{" "}
        Ishonchli ko'ringan chekda obunani darhol yoqish (o'chirilsa — har bir to'lovda obuna faqat siz tasdiqlagandan keyin yoqiladi)
      </label>
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
  async function decide(ok, ban = false) {
    const reason = ok
      ? null
      : window.prompt(ban ? "Pul tushmagan: obuna bekor qilinadi va akkaunt BLOKLANADI. Sabab (foydalanuvchiga yoziladi):" : "Rad etish sababi (foydalanuvchiga yoziladi, ixtiyoriy):", ban ? "to'lov tushmagan" : "");
    if (!ok && reason === null) return;
    setBusy(true);
    try {
      const result = await post(`/api/payments/${payment.id}/decide`, { ok, ban, reason: reason || null });
      notify(
        ok ? "Tasdiqlandi — yordamchi foydalanuvchiga 1 daqiqa ichida yozadi" : ban ? (result.banned ? "Obuna bekor qilindi, akkaunt bloklandi" : "Obuna bekor qilindi (admin — bloklanmadi)") : "Rad etildi — obuna qaytarildi",
        ok ? "good" : "neutral",
      );
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
        {(payment.paidAt || payment.txn) && (
          <span className="small">
            {payment.paidAt ? `Chekdagi vaqt: ${payment.paidAt}` : ""}
            {payment.paidAt && payment.txn ? " · " : ""}
            {payment.txn ? `Tranzaksiya: ${payment.txn}` : ""}
          </span>
        )}
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
        {payment.status !== "rejected" && (
          <Button variant="ghost" className="danger-text" onClick={() => decide(false, true)} disabled={busy} title="Bank hisobingizda bu to'lov yo'q: obuna bekor qilinadi va akkaunt loyihadan bloklanadi">
            ⛔ Pul tushmagan — bloklash
          </Button>
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
  const priceLine = settings.data
    ? ["pro", "max"].map((plan) => `${planName(plan)}: ${[settings.data.week?.[plan] ? `${formatNumber(settings.data.week[plan])} so'm / 7 kun` : null, settings.data.prices[plan] ? `${formatNumber(settings.data.prices[plan])} so'm / ${settings.data.days} kun` : null].filter(Boolean).join(", ") || "narx yo'q"}`).join(" · ")
    : null;
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
        faqat siz tasdiqlagandan keyin yoqiladi. Chekdagi vaqt va summani bank hisobingiz bilan solishtiring: pul tushmagan bo'lsa —
        «⛔ Pul tushmagan — bloklash» (Telegram'da /tolov N ban). Narx 0 bo'lsa — hech bir chek o'zi yoqilmaydi.
      </p>
      {priceLine && <p className="small">Hozirgi narxlar — {priceLine}</p>}
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
