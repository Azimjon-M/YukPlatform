// Haydovchilar: GET /api/drivers — kim, qanday mashina, qaysi yo'nalish, faolmi. Faol — unga yuk yuboriladi.
import { useState } from "react";
import { get, patch } from "../api.js";
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

export function DriversPage() {
  useTitle("Haydovchilar");
  const now = useNow(30_000);
  const state = useApi(() => get("/api/drivers"), []);
  const items = state.data?.items ?? [];
  const registered = items.filter((d) => d.profile);
  const active = registered.filter((d) => d.active);

  return (
    <>
      <PageHeader
        title="Haydovchilar"
        subtitle={state.data ? `${formatNumber(registered.length)} ta ro'yxatdan o'tgan, ${formatNumber(active.length)} tasi faol` : "Botda ro'yxatdan o'tgan haydovchilar"}
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
                    <th scope="col">Haydovchi</th>
                    <th scope="col">Mashina</th>
                    <th scope="col">Yo'nalish</th>
                    <th scope="col">Holat</th>
                    <th scope="col">Yangilangan</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => {
                    const p = profileSummary(d.profile);
                    return (
                      <tr key={d.chatId}>
                        <td data-label="Haydovchi">
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
                        </td>
                        <td data-label="Yangilangan" className="nowrap">
                          <TimeAgo ts={d.updatedAt} now={now} />
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
