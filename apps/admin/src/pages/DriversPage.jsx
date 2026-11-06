// Foydalanuvchilar: GET /api/drivers — kim (haydovchi / yuk beruvchi), qanday mashina, qaysi yo'nalish, faolmi.
// Faol — unga yuk (yuk beruvchiga — bo'sh mashina) yuboriladi. «Admin» — Mini App'dagi «🛠 Boshqaruv» huquqi:
// faqat shu yerdan (localhost) beriladi, internetdagi ilova orqali emas.
import { useState } from "react";
import { PLANS, ROLES } from "@yuk/shared";
import { get, patch, post } from "../api.js";
import { formatNumber, profileSummary } from "../format.js";
import { useApi, useNow } from "../hooks.js";
import { Async, Badge, Button, Empty, PageHeader, TimeAgo, Toggle, useTitle, useToast } from "../ui.jsx";

function ActiveToggle({ driver, onChanged }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(driver.active);
  if (!driver.profile) {
    return driver.registering ? (
      <Badge tone="warning" icon="◷">
        Ro'yxatdan o'tyapti
      </Badge>
    ) : (
      <Badge icon="–">Profil yo'q</Badge>
    );
  }
  async function change(active) {
    setBusy(true);
    setChecked(active);
    try {
      await patch(`/api/drivers/${driver.chatId}`, { active });
      notify(active ? "Faollashtirildi — yuklar yuboriladi" : "To'xtatildi — yuk yuborilmaydi");
      onChanged();
    } catch (e) {
      setChecked(!active);
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }
  return <Toggle checked={checked} onChange={change} busy={busy} label={checked ? "Faol" : "Pauza"} />;
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

function RoleBadge({ driver }) {
  const role = ROLES[driver.role];
  return (
    <>
      {role ? <Badge icon={role.icon}>{role.name}</Badge> : <Badge icon="–">Rol tanlanmagan</Badge>}
      <div className="muted small">{PLANS[driver.plan]?.name ?? driver.plan}</div>
    </>
  );
}

// Haydovchilar web'ini shu haydovchi nomidan ochadi (Telegram'siz sinash uchun; havola 12 soat amal qiladi)
function OpenWebButton({ driver }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  async function open() {
    // Oyna darhol ochiladi (brauzer keyinroq ochilgan oynani bloklaydi), manzil javob kelgach qo'yiladi
    const tab = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const { url } = await post(`/api/drivers/${driver.chatId}/web-link`);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.href = url;
    } catch (e) {
      tab?.close();
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button onClick={open} busy={busy} title={`Haydovchilar web'ini ${driver.name || "shu haydovchi"} nomidan ochish`}>
      Web'da ochish
    </Button>
  );
}

export function DriversPage() {
  useTitle("Haydovchilar");
  const now = useNow(30_000);
  const state = useApi(() => get("/api/drivers"), []);
  const items = state.data?.items ?? [];
  const registered = items.filter((d) => d.profile);
  const active = registered.filter((d) => d.active);
  const shippers = registered.filter((d) => d.role === "yuk_beruvchi");

  return (
    <>
      <PageHeader
        title="Haydovchilar"
        subtitle={
          state.data
            ? `${formatNumber(registered.length)} ta ro'yxatdan o'tgan (${formatNumber(registered.length - shippers.length)} haydovchi, ${formatNumber(shippers.length)} yuk beruvchi), ${formatNumber(active.length)} tasi faol`
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
            <div className="table-card">
              <table className="data-table drivers-table">
                <thead>
                  <tr>
                    <th scope="col">Foydalanuvchi</th>
                    <th scope="col">Rol</th>
                    <th scope="col">Mashina</th>
                    <th scope="col">Yo'nalish</th>
                    <th scope="col">Holat</th>
                    <th scope="col">Yangilangan</th>
                    <th scope="col">
                      <span className="sr-only">Web</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => {
                    const p = profileSummary(d.profile);
                    return (
                      <tr key={d.chatId}>
                        <td data-label="Foydalanuvchi">
                          <strong>{d.name || "Ismsiz"}</strong>
                          <div className="muted small">
                            {d.username ? (
                              <a href={`https://t.me/${encodeURIComponent(d.username)}`} target="_blank" rel="noopener noreferrer">
                                @{d.username}
                              </a>
                            ) : (
                              "username yo'q"
                            )}
                          </div>
                        </td>
                        <td data-label="Rol">
                          <RoleBadge driver={d} />
                        </td>
                        <td data-label="Mashina">
                          {p ? (
                            <>
                              {p.vehicle}
                              {p.size && <div className="muted small">{p.size}</div>}
                            </>
                          ) : (
                            <span className="muted">—</span>
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
                        <td data-label="Holat">
                          <ActiveToggle key={`${d.chatId}:${d.active}`} driver={d} onChanged={state.reload} />
                          <AdminToggle key={`${d.chatId}:admin:${d.isAdmin}`} driver={d} onChanged={state.reload} />
                        </td>
                        <td data-label="Yangilangan" className="nowrap">
                          <TimeAgo ts={d.updatedAt} now={now} />
                        </td>
                        <td data-label="Web">
                          <OpenWebButton driver={d} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
    </>
  );
}
