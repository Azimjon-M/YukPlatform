// «Batafsil» — Haydovchilar jadvalidagi qator ostida ochiladigan qism (akkordeon): foydalanuvchi haqida hamma narsa.
// Azimjon (2026-11-09): «foydalanuvchilar haqida to'liq ma'lumot kerak, hatto hisobini o'chirsa ham; qayta ochsa —
// necha marta o'chirib qaytgani». Qatordagi asosiy ma'lumot — /api/drivers; bu yerdagisi — GET /api/drivers/:chatId:
// ikkala rolning saqlangan sozlamalari, tarix (user_events) va oxirgi yuborilgan yuklar. Jonli: ochiq turganda o'zi yangilanadi.
import { useState } from "react";
import { PLANS, ROLES, formatContactPhone } from "@yuk/shared";
import { del, get, post } from "../api.js";
import {
  activeView,
  activityView,
  driverShown,
  eventView,
  formatDateTime,
  formatNumber,
  pauseInText,
  placeText,
  profileSummary,
  registrationText,
  snapshotProfiles,
  timeAgo,
} from "../format.js";
import { useApi } from "../hooks.js";
import { Async, Button, ExternalLink, useToast } from "../ui.jsx";
import { AutoScan } from "./TgAccounts.jsx";

// "09.11.2026, 08:41 (5 daq oldin)"
function When({ ts, now }) {
  if (ts == null) return <span className="muted">—</span>;
  return (
    <time dateTime={new Date(ts).toISOString()}>
      {formatDateTime(ts)} <span className="muted">({timeAgo(ts, now)})</span>
    </time>
  );
}

function Item({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

// Bitta rolning sozlamalari (hozirgi, saqlangan yoki o'chirishdan oldingi)
function ProfileBlock({ role, note, profile, now }) {
  const p = profileSummary(profile);
  if (!p) return null;
  const r = ROLES[role];
  return (
    <div className="detail-block">
      <h4>
        {r ? `${r.icon} ${r.name}` : "Sozlamalar"} <span className="muted small">— {note}</span>
      </h4>
      <dl className="detail-list">
        <Item label={role === "yuk_beruvchi" ? "Kerakli mashina" : "Mashina"}>
          {p.vehicle}
          {p.size && <div className="muted small">{p.size}</div>}
        </Item>
        {p.mode && <Item label="Rejim">{p.mode}</Item>}
        {p.groups && <Item label="Guruhlari">{p.groups}</Item>}
        <Item label="Qayerdan">{p.from}</Item>
        <Item label="Qayerga">{p.to}</Item>
        {p.intl && <Item label="Ishlaydi">{p.intl}</Item>}
        {profile.routeAt != null && (
          <Item label="Yo'nalish tanlangan">
            <When ts={profile.routeAt} now={now} />
          </Item>
        )}
      </dl>
    </div>
  );
}

// Haydovchilar web'ini shu foydalanuvchi nomidan ochish (Telegram'siz sinash uchun; havola 12 soat)
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
    <Button onClick={open} busy={busy} title={`Haydovchilar web'ini ${driver.name || "shu foydalanuvchi"} nomidan ochish`}>
      Web'da ochish
    </Button>
  );
}

// Butunlay o'chirish — faqat odam o'zi shaxsiy ma'lumotini o'chirishni so'rasa (o'zi botda o'chirsa ham ma'lumot qoladi)
function PurgeButton({ driver, onPurged }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  async function purge() {
    const who = driver.name || `id ${driver.chatId}`;
    const ok = window.confirm(
      `«${who}» haqidagi HAMMA ma'lumot butunlay o'chirilsinmi?\n\nSozlamalar, telefon raqami, tarix va unga yuborilgan yuklar ro'yxati o'chadi. Buni qaytarib bo'lmaydi.\n\nFaqat odamning o'zi ma'lumotini o'chirishni so'ragan bo'lsa qiling.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await del(`/api/drivers/${driver.chatId}`);
      notify(`«${who}» butunlay o'chirildi`);
      onPurged();
    } catch (e) {
      notify(e.message, "critical");
      setBusy(false);
    }
  }
  return (
    <Button variant="danger" onClick={purge} busy={busy}>
      🗑 Butunlay o'chirish
    </Button>
  );
}

// Oxirgi yuborilgan yuklar va tarix (eng yangisi tepada). Tarix 2026-11-09 dan yoziladi: undan oldin kelganlarda
// «Botga birinchi marta kirdi» qatori yo'q — uni createdAt dan qo'shamiz (eng pastda)
function Feeds({ data, driver }) {
  const events = data.events.some((e) => e.type === "joined") ? data.events : [...data.events, { type: "joined", detail: null, at: driver.createdAt }];
  const gap = !data.events.some((e) => e.type === "joined");
  return (
    <div className="detail-grid">
      <div className="detail-block">
        <h4>📦 Olgan yuklari {data.deliveries.length > 0 && <span className="muted small">— oxirgi {data.deliveries.length} ta</span>}</h4>
        {data.deliveries.length === 0 ? (
          <p className="muted small">Hali hech narsa yuborilmagan (yozish 2026-11-09 dan boshlangan).</p>
        ) : (
          <ul className="detail-feed">
            {data.deliveries.map((d, i) => (
              <li key={i}>
                <span className="nowrap muted small">{formatDateTime(d.at)}</span>
                <span>
                  {d.load ? `${placeText(d.load, "from")} → ${placeText(d.load, "to")}` : "yuk o'chirilgan"}
                  {d.kind === "mashina" && <span className="muted small"> · bo'sh mashina</span>}
                  {d.calledAt != null && <div className="small">📞 raqamni ochgan · {formatDateTime(d.calledAt)}</div>}
                  {!d.ok && <div className="text-critical small">⚠ yetmadi{d.error ? `: ${d.error}` : ""}</div>}
                </span>
                {d.link && <ExternalLink href={d.link}>E'lon</ExternalLink>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {data.rawDeliveries?.length > 0 && (
        <div className="detail-block">
          <h4>
            ⚡ Asl matn bilan <span className="muted small">— AI'siz, darhol; oxirgi {data.rawDeliveries.length} ta</span>
          </h4>
          <ul className="detail-feed">
            {data.rawDeliveries.map((d, i) => (
              <li key={i}>
                <span className="nowrap muted small">{formatDateTime(d.at)}</span>
                <span>
                  {d.text ?? "e'lon o'chirilgan"}
                  {d.source && <div className="muted small">{d.source}</div>}
                  {d.calledAt != null && <div className="small">📞 raqamni ochgan · {formatDateTime(d.calledAt)}</div>}
                  {!d.ok && <div className="text-critical small">⚠ yetmadi{d.error ? `: ${d.error}` : ""}</div>}
                </span>
                {d.link && <ExternalLink href={d.link}>E'lon</ExternalLink>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="detail-block">
        <h4>🕓 Tarix</h4>
        <ul className="detail-feed">
          {events.map((e, i) => {
            const v = eventView(e);
            return (
              <li key={i}>
                <span className="nowrap muted small">{formatDateTime(e.at)}</span>
                <span>
                  <span aria-hidden="true">{v.icon}</span> {v.text}
                </span>
              </li>
            );
          })}
        </ul>
        {gap && <p className="muted small detail-note">Batafsil tarix 2026-11-09 dan yoziladi — undan oldingi o'zgarishlar yo'q.</p>}
      </div>
    </div>
  );
}

export function DriverDetails({ driver, now, onPurged, idleSince = null }) {
  // sources — «🔎 Auto scan» jarayoni (dialog_scans, tg_accounts) ham jonli ko'rinsin
  const state = useApi(() => get(`/api/drivers/${driver.chatId}`), [driver.chatId], { live: ["drivers", "sources"], liveGapMs: 2000 });
  const shown = driverShown(driver);
  const activity = activityView(driver, now);
  // Yuborish holati — faqat ko'rsatiladi (o'zgartirish foydalanuvchining o'zida); faolda — avtomatik pauza qachon
  const status = driver.profile && !shown.deleted ? activeView(driver, idleSince, now) : null;
  // Qaytgan bo'lsa: oxirgi o'chirishdagi holat (rol, sozlamalar, raqam) — tarixdagi «deleted» voqeasida saqlangan
  const lastDeleted = shown.deleted ? null : (state.data?.events.find((e) => e.type === "deleted") ?? null);

  return (
    <div className="driver-details">
      <div className="detail-grid">
        <div className="detail-block">
          <h4>👤 Ma'lumot</h4>
          <dl className="detail-list">
            <Item label="Telegram ID">
              <code>{driver.chatId}</code>
            </Item>
            <Item label="Ism">{driver.name || <span className="muted">yo'q</span>}</Item>
            <Item label="Username">
              {driver.username ? (
                <ExternalLink href={`https://t.me/${encodeURIComponent(driver.username)}`}>@{driver.username}</ExternalLink>
              ) : (
                <span className="muted">yo'q</span>
              )}
            </Item>
            <Item label="Telefon">
              {shown.phone ? (
                <>
                  <a href={`tel:${shown.phone}`}>{formatContactPhone(shown.phone)}</a>
                  {shown.deleted ? (
                    <div className="muted small">hisobini o'chirishdan oldin ulashgan</div>
                  ) : (
                    driver.phoneAt && <div className="muted small">ulashgan: {formatDateTime(driver.phoneAt)}</div>
                  )}
                </>
              ) : (
                <>
                  <span className="muted">
                    ulashmagan
                    {state.data?.phoneAskedAt ? ` (bot so'ragan: ${formatDateTime(state.data.phoneAskedAt)})` : ""}
                  </span>
                  {lastDeleted?.detail?.phone && (
                    <div className="small">
                      o'chirishdan oldin: <a href={`tel:${lastDeleted.detail.phone}`}>{formatContactPhone(lastDeleted.detail.phone)}</a>
                    </div>
                  )}
                </>
              )}
            </Item>
            <Item label="Holat">{registrationText(driver)}</Item>
            {status && (
              <Item label="Yuborish">
                {status.icon} {status.active ? "yoqilgan" : `to'xtatilgan — ${status.note ?? "pauza"}`}
                {!status.active && status.at != null && <span className="muted small"> · {formatDateTime(status.at)}</span>}
                {status.warned && <div className="small">⚠ 24 soat kirmagan — ogohlantirilgan: {formatDateTime(status.at)}</div>}
                {status.active && status.pauseAt != null && (
                  <div className="muted small">
                    {pauseInText(status.pauseAt, now)} ({formatDateTime(status.pauseAt)})
                  </div>
                )}
                <div className="muted small">O'zgartirish — faqat foydalanuvchining o'zi: botda ⏸ Pauza / ▶️ Davom ettirish</div>
              </Item>
            )}
            <Item label="Botga kelgan">
              <When ts={driver.createdAt} now={now} />
            </Item>
            <Item label="Oxirgi faollik">
              <When ts={activity.at} now={now} />
              {activity.via && <span className="muted small"> · {activity.via}</span>}
              {!activity.exact && activity.at != null && <div className="muted small">taxminan (aniq kuzatuv 2026-11-09 dan)</div>}
            </Item>
            <Item label="Oxirgi o'zgarish">
              <When ts={driver.updatedAt} now={now} />
            </Item>
            <Item label="Obuna">
              {[PLANS[driver.plan]?.icon, PLANS[driver.plan]?.name ?? driver.plan].filter(Boolean).join(" ")}
              {driver.autoPro && <span className="muted small"> · 📡 Telegram akkaunt ulagan</span>}
            </Item>
            {(driver.deletedCount > 0 || shown.deleted) && (
              <Item label="Hisobini o'chirgan">
                {formatNumber(driver.deletedCount)} marta
                {shown.deleted ? (
                  <div className="text-critical small">
                    Hozir o'chirilgan: <When ts={driver.deletedAt} now={now} />
                    {driver.deletedVia && ` · ${driver.deletedVia === "web" ? "web'da" : "botda"}`}
                  </div>
                ) : (
                  driver.returnedAt && (
                    <div className="muted small">
                      Qaytgan: <When ts={driver.returnedAt} now={now} />
                    </div>
                  )
                )}
              </Item>
            )}
            {shown.signedOut && (
              <Item label="Hisobdan chiqqan">
                <When ts={driver.signedOutAt} now={now} />
              </Item>
            )}
          </dl>
          <div className="detail-actions">
            {!shown.deleted && <OpenWebButton driver={driver} />}
            <PurgeButton driver={driver} onPurged={onPurged} />
          </div>
        </div>

        <Async state={state}>
          {(data) => {
            // Hozirgi rol (yoki chiqish / o'chirishdan oldingi) + boshqa rolning saqlangan sozlamalari
            const stash = shown.deleted ? (driver.deletedSnapshot?.profiles ?? {}) : (data.profiles ?? {});
            const note = shown.deleted ? "o'chirishdan oldin" : shown.signedOut ? "chiqishdan oldin" : "hozirgi";
            const others = Object.entries(stash).filter(([role, profile]) => role !== shown.role && profile);
            const before = lastDeleted ? snapshotProfiles(lastDeleted.detail) : [];
            return (
              <div className="detail-block">
                <h4>⚙️ Sozlamalar</h4>
                {shown.profile ? (
                  <ProfileBlock role={shown.role} note={note} profile={shown.profile} now={now} />
                ) : (
                  <p className="muted small">{registrationText(driver)}</p>
                )}
                {others.map(([role, profile]) => (
                  <ProfileBlock key={role} role={role} note="saqlangan — shu rolga o'tsa tiklanadi" profile={profile} now={now} />
                ))}
                {before.map(({ role, profile }) => (
                  <ProfileBlock
                    key={`old:${role}`}
                    role={role}
                    note={`hisobini o'chirishdan oldin (${formatDateTime(lastDeleted.at)}) — tiklanmaydi`}
                    profile={profile}
                    now={now}
                  />
                ))}
              </div>
            );
          }}
        </Async>
      </div>

      {/* Mini App'dan ulagan Telegram akkauntlari — «🔎 Auto scan» (2026-11-13). Akkaunt egasiga xabar yuborilmaydi */}
      {state.data?.tgAccounts?.length > 0 && (
        <div className="detail-block">
          <h4>📡 Telegram akkauntlari</h4>
          <ul className="tg-account-list">
            {state.data.tgAccounts.map((account) => (
              <li key={account.name} className="tg-account">
                <div className="source-name">
                  <strong>{[account.firstName, account.username ? `@${account.username}` : null].filter(Boolean).join(" ") || account.name}</strong>
                  <span className="muted small">
                    {account.name} · {account.status === "ok" ? "✅ ishlayapti" : `⚠ ${account.status ?? "noma'lum"}`} · {formatNumber(account.dialogs)} ta guruh/kanalga a'zo
                  </span>
                </div>
                <AutoScan account={account} onDone={state.reload} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Yuklanish / xato yuqoridagi Async'da bir marta ko'rsatiladi */}
      {state.data && <Feeds data={state.data} driver={driver} />}
    </div>
  );
}
