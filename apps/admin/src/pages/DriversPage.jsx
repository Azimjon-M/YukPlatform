// Foydalanuvchilar: GET /api/drivers — kim (haydovchi / yuk beruvchi), qanday mashina, qaysi yo'nalish, faolmi,
// o'zi ulashgan telefon raqami (ixtiyoriy; faqat shu sahifada), olgan yuklari va oxirgi faolligi.
// Jonli (live.js): bot kimgadir yuk yuborsa, kimdir botga yozsa yoki web'ni ochsa — 1–2 soniyada o'zi yangilanadi.
// Faol — unga yuk (yuk beruvchiga — bo'sh mashina) yuboriladi; buni faqat foydalanuvchining o'zi o'zgartiradi (bu yerda
// faqat ko'rinadi), 48 soat kirmasa bot o'zi pauza qiladi. «Admin» — Mini App'dagi «🛠 Boshqaruv» huquqi:
// faqat shu yerdan (localhost) beriladi, internetdagi ilova orqali emas.
// Hisobdan chiqqan (web «🚪 Chiqish»): bot yubormaydi, lekin oxirgi roli, mashinasi va yo'nalishi ko'rinib turadi.
// Hisobini o'chirgan (bot /ochirish yoki web «🗑 Hisobni o'chirish»): qator qoladi — o'chirgan paytdagi rol, sozlamalar,
// raqam va «N marta o'chirgan». Hammasi sig'maydi — har qatorda «Batafsil» (akkordeon, DriverDetails.jsx).
import { Fragment, useState } from "react";
import { PLANS, ROLES, formatContactPhone } from "@yuk/shared";
import { get, patch } from "../api.js";
import {
  activeView,
  activityView,
  deliveriesView,
  driverShown,
  formatDateTime,
  formatNumber,
  pauseInText,
  profileSummary,
  registrationText,
} from "../format.js";
import { useApi, useNow } from "../hooks.js";
import { Async, Badge, Button, Empty, PageHeader, TimeAgo, Toggle, useTitle, useToast } from "../ui.jsx";
import { DriverDetails } from "./DriverDetails.jsx";

const COLUMNS = 8;
const VIA = { bot: "botda", web: "web'da" };

// Holat — faqat ko'rsatiladi: yoqish / to'xtatishni foydalanuvchining o'zi qiladi (botda ⏸ / ▶️; Azimjon, 2026-11-09).
// Bot o'zi: 24 soat kirmasa — ogohlantiradi, 48 soatda — pauza (apps/bot idle.js). Faolda — pauzagacha qancha qolgani
function StatusCell({ driver, idleSince, now }) {
  const shown = driverShown(driver);
  if (shown.deleted) {
    // Qator o'chmaydi: botga qayta /start yozsa yoki web'ga kirsa — boshidan ro'yxatdan o'tadi
    return (
      <>
        <Badge tone="critical" icon="🗑" title="Yuk yuborilmaydi. Qayta /start yozsa — boshidan ro'yxatdan o'tadi">
          Hisobini o'chirgan
        </Badge>
        <div className="muted small">
          <TimeAgo ts={driver.deletedAt} now={now} />
          {VIA[driver.deletedVia] && ` · ${VIA[driver.deletedVia]}`}
        </div>
      </>
    );
  }
  if (shown.signedOut) {
    // Qayta kirib rolni tanlasa (botda /start yoki web) — sozlamalari tiklanadi va yana yuk oladi
    return (
      <>
        <Badge tone="warning" icon="🚪" title="Yuk yuborilmaydi. Qayta kirib rolni tanlasa — sozlamalari va yo'nalishi tiklanadi">
          Hisobdan chiqqan
        </Badge>
        <div className="muted small">
          <TimeAgo ts={driver.signedOutAt} now={now} />
        </div>
      </>
    );
  }
  if (!driver.profile) {
    return driver.registering ? (
      <Badge tone="warning" icon="◷">
        Ro'yxatdan o'tyapti
      </Badge>
    ) : (
      <Badge icon="–">Profil yo'q</Badge>
    );
  }
  const v = activeView(driver, idleSince, now);
  const hint = v.active
    ? "Yuk yuboriladi. 24 soat botga kirmasa — ogohlantiriladi, 48 soatda — avtomatik pauza"
    : "Yuk yuborilmaydi. Qayta yoqish — foydalanuvchining o'zi: botda «▶️ Davom ettirish»";
  return (
    <>
      <Badge tone={v.tone} icon={v.icon} title={hint}>
        {v.label}
      </Badge>
      {v.note && <div className={`small ${v.tone === "critical" ? "text-critical" : "muted"}`}>{v.note}</div>}
      {!v.active && v.at != null && (
        <div className="muted small">
          <TimeAgo ts={v.at} now={now} />
        </div>
      )}
      {v.active && v.pauseAt != null && <div className="muted small">{pauseInText(v.pauseAt, now)}</div>}
    </>
  );
}

// Admin huquqi: botda «🛠 Boshqaruv» tugmasi va Mini App'dagi boshqaruv bo'limi. .env dagi ADMIN_IDS ham admin qiladi
function AdminToggle({ driver, onChanged }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(driver.isAdmin);
  async function change(isAdmin) {
    setBusy(true);
    setChecked(isAdmin);
    try {
      await patch(`/api/drivers/${driver.chatId}`, { isAdmin });
      notify(isAdmin ? "Admin qilindi — botda /start bossa, «🛠 Boshqaruv» tugmasi chiqadi" : "Admin huquqi olindi");
      onChanged();
    } catch (e) {
      setChecked(!isAdmin);
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }
  return <Toggle checked={checked} onChange={change} busy={busy} label="Admin" />;
}

// Oxirgi faollik: «● Hozir botda» (2 daqiqa ichida) yoki «12 daq oldin · web'da»
function Activity({ driver, now }) {
  const a = activityView(driver, now);
  if (a.online) {
    return (
      <Badge tone="good" icon="●" title={formatDateTime(a.at)}>
        Hozir {a.via ?? ""}
      </Badge>
    );
  }
  return (
    <>
      <TimeAgo ts={a.at} now={now} />
      <div className="muted small">{a.exact ? a.via : a.at != null ? "taxminan, botda" : null}</div>
    </>
  );
}

// Olgan yuklari: bugun / jami, oxirgisi (yo'nalishi bilan), yetmagan bo'lsa — sababi
function Deliveries({ driver, now }) {
  const d = deliveriesView(driver);
  if (!d.total && !d.failed) return <span className="muted">Hali {d.noun} olmagan</span>;
  return (
    <>
      <div>
        Bugun <strong>{formatNumber(d.today)}</strong> · jami {formatNumber(d.total)}
      </div>
      {d.lastAt != null && (
        <div className="muted small">
          Oxirgisi <TimeAgo ts={d.lastAt} now={now} />
          {d.lastRoute && `: ${d.lastRoute}`}
        </div>
      )}
      {d.failed > 0 && (
        <div className={`small ${d.failing ? "text-critical" : "muted"}`} title={driver.deliveries?.lastError ?? undefined}>
          ⚠ {formatNumber(d.failed)} tasi yetmadi{d.error && ` — ${d.error}`}
          {d.failing && d.errorAt != null && (
            <>
              {" "}
              (<TimeAgo ts={d.errorAt} now={now} />)
            </>
          )}
        </div>
      )}
    </>
  );
}

function RoleBadge({ driver }) {
  const role = ROLES[driverShown(driver).role];
  return (
    <>
      {role ? <Badge icon={role.icon}>{role.name}</Badge> : <Badge icon="–">Rol tanlanmagan</Badge>}
      <div className="muted small">{PLANS[driver.plan]?.name ?? driver.plan}</div>
    </>
  );
}

function UserCell({ driver }) {
  const shown = driverShown(driver);
  // Qaytgan bo'lsa ham ko'rinsin: «↩️ 1 marta o'chirib, qaytgan» (hozir o'chirilgan bo'lsa — Holat'da)
  const returned = !shown.deleted && driver.deletedCount > 0;
  return (
    <>
      <strong>{driver.name || "Ismsiz"}</strong>
      <div className="muted small">
        {driver.username ? (
          <a href={`https://t.me/${encodeURIComponent(driver.username)}`} target="_blank" rel="noopener noreferrer">
            @{driver.username}
          </a>
        ) : (
          "username yo'q"
        )}
      </div>
      {/* O'zi botga ulashgan raqami (ixtiyoriy) — faqat shu yerda, Mini App'dagi ro'yxatda yo'q. O'chirgan bo'lsa — o'chirishgacha bo'lgani */}
      {shown.phone && (
        <div className="small">
          <a
            href={`tel:${shown.phone}`}
            title={shown.deleted ? "Hisobini o'chirishdan oldin ulashgan" : driver.phoneAt ? `Ulashgan: ${formatDateTime(driver.phoneAt)}` : undefined}
          >
            📱 {formatContactPhone(shown.phone)}
          </a>
        </div>
      )}
      {returned && (
        <div className="small">
          <Badge tone="info" icon="↩️" title={driver.returnedAt ? `Oxirgi marta qaytgan: ${formatDateTime(driver.returnedAt)}` : undefined}>
            {formatNumber(driver.deletedCount)} marta o'chirib, qaytgan
          </Badge>
        </div>
      )}
      {shown.deleted && driver.deletedCount > 1 && <div className="muted small">{formatNumber(driver.deletedCount)} marta o'chirgan</div>}
    </>
  );
}

function DriverRow({ driver, open, onToggle, now, reload, idleSince }) {
  const shown = driverShown(driver);
  const p = profileSummary(shown.profile);
  const detailsId = `driver-details-${driver.chatId}`;
  return (
    <Fragment>
      <tr className={[shown.deleted ? "is-deleted" : "", open ? "is-open" : ""].join(" ").trim() || undefined}>
        <td data-label="Foydalanuvchi">
          <UserCell driver={driver} />
        </td>
        <td data-label="Rol">
          <RoleBadge driver={driver} />
        </td>
        <td data-label="Mashina">
          {p ? (
            <>
              {p.vehicle}
              {p.size && <div className="muted small">{p.size}</div>}
              {(shown.deleted || shown.signedOut) && <div className="muted small">{shown.deleted ? "o'chirishdan oldin" : "chiqishdan oldin"}</div>}
            </>
          ) : (
            // «—» o'rniga: qayergacha yetgan (rol tanlab, formani to'ldirmagan va h.k.)
            <span className="muted small">{registrationText(driver)}</span>
          )}
        </td>
        <td data-label="Yo'nalish">
          {p ? (
            <div className="route-lines">
              <div>
                <span className="muted">Qayerdan:</span> {p.from}
              </div>
              <div>
                <span className="muted">Qayerga:</span> {p.to}
              </div>
              <div className="muted small">
                {p.intl}
                {p.mode && ` · ${p.mode}`}
              </div>
            </div>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td data-label="Olgan yuklari">
          <Deliveries driver={driver} now={now} />
        </td>
        <td data-label="Holat">
          <StatusCell driver={driver} idleSince={idleSince} now={now} />
          {!shown.deleted && <AdminToggle key={`${driver.chatId}:admin:${driver.isAdmin}`} driver={driver} onChanged={reload} />}
        </td>
        <td data-label="Faollik" className="nowrap">
          <Activity driver={driver} now={now} />
        </td>
        <td data-label="Batafsil">
          <Button onClick={onToggle} aria-expanded={open} aria-controls={detailsId} className="details-toggle">
            <span aria-hidden="true">{open ? "▾" : "▸"}</span> Batafsil
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="details-row" id={detailsId}>
          <td colSpan={COLUMNS}>
            <DriverDetails driver={driver} now={now} onPurged={reload} idleSince={idleSince} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function DriversPage() {
  useTitle("Haydovchilar");
  // «Hozir» 2 daqiqadan keyin o'chishi uchun tez-tez (ma'lumotning o'zi jonli — bot bazaga yozishi bilan)
  const now = useNow(15_000);
  const state = useApi(() => get("/api/drivers"), [], { live: ["drivers"] });
  // Ochiq «Batafsil» lar (bir nechtasi birdan ochiq tursa bo'ladi)
  const [openIds, setOpenIds] = useState(() => new Set());
  const toggle = (chatId) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });

  const items = state.data?.items ?? [];
  const registered = items.filter((d) => d.profile);
  const active = registered.filter((d) => d.active);
  const idlePaused = registered.filter((d) => !d.active && d.pausedBy === "idle");
  const shippers = registered.filter((d) => d.role === "yuk_beruvchi");
  const signedOut = items.filter((d) => driverShown(d).signedOut);
  const deleted = items.filter((d) => driverShown(d).deleted);
  const online = items.filter((d) => activityView(d, now).online);
  const sentToday = items.reduce((sum, d) => sum + (d.deliveries?.today ?? 0), 0);
  const extra = [
    signedOut.length ? `${formatNumber(signedOut.length)} tasi hisobdan chiqqan` : null,
    idlePaused.length ? `${formatNumber(idlePaused.length)} tasi 48 soat kirmagani uchun avto-pauzada` : null,
    deleted.length ? `${formatNumber(deleted.length)} tasi hisobini o'chirgan` : null,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Haydovchilar"
        subtitle={
          state.data
            ? `Jami ${formatNumber(items.length)} kishi: ${formatNumber(registered.length)} tasi ro'yxatdan o'tgan (${formatNumber(registered.length - shippers.length)} haydovchi, ${formatNumber(shippers.length)} yuk beruvchi), ${formatNumber(active.length)} tasi faol${extra.length ? `, ${extra.join(", ")}` : ""}. Hozir onlayn: ${formatNumber(online.length)}, bugun yuborildi: ${formatNumber(sentToday)} ta`
            : "Botda ro'yxatdan o'tgan haydovchilar va yuk beruvchilar"
        }
        actions={
          <Button onClick={state.reload} busy={state.loading && state.data != null}>
            Yangilash
          </Button>
        }
      />
      <Async state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty title="Haydovchilar yo'q">Haydovchi botga /start yozib, mashinasi va yo'nalishini tanlaganda shu yerda paydo bo'ladi.</Empty>
          ) : (
            <div className="table-card drivers-table-card">
              <table className="data-table drivers-table">
                <thead>
                  <tr>
                    <th scope="col">Foydalanuvchi</th>
                    <th scope="col">Rol</th>
                    <th scope="col">Mashina</th>
                    <th scope="col">Yo'nalish</th>
                    <th scope="col">Olgan yuklari</th>
                    <th scope="col">Holat</th>
                    <th scope="col">Faollik</th>
                    <th scope="col">
                      <span className="sr-only">Batafsil</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => (
                    <DriverRow
                      key={d.chatId}
                      driver={d}
                      open={openIds.has(d.chatId)}
                      onToggle={() => toggle(d.chatId)}
                      now={now}
                      reload={state.reload}
                      idleSince={data.idleSince}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
    </>
  );
}
