// 🛠 Boshqaruv — faqat adminlarga (Azimjon: "botda telegram webi orqali ochib ishlaydigan bo'lsin").
// Ko'rsatkichlar, AI ulanishlari holati, foydalanuvchilar (yoqish / to'xtatish, rolni almashtirish).
// Server har bir so'rovda admin ekanini tekshiradi (apps/api public.js /pub/admin). Admin qilish va obuna —
// faqat kompyuterdagi boshqaruv markazidan (localhost:3000), bu yerdan emas.
import { useCallback, useEffect, useState } from "react";
import { ROLES, agoText } from "@yuk/shared";
import { getAdminOverview, getAdminUsers, updateAdminUser } from "./api.js";
import { confirmAction, haptic, showAlert } from "./telegram.js";
import { Notice, Segmented, Spinner } from "./ui.jsx";

const REFRESH_MS = 60_000;
const ROLE_FILTERS = [
  { id: "", label: "Hammasi" },
  { id: "haydovchi", label: "Haydovchi" },
  { id: "yuk_beruvchi", label: "Yuk beruvchi" },
  { id: "none", label: "Rolsiz" },
];
// AI ulanishi nega dam olyapti (parser pool.js pauseFor)
const REASONS = { minute: "daqiqalik limit", daily: "kunlik limit", busy: "Google band", key: "kalit xatosi", model: "model ishlamayapti" };

const num = (n) => String(Math.round(n ?? 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const clock = (ts) => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });

function Tile({ value, label, warn = false }) {
  return (
    <div className={`tile${warn ? " warn" : ""}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function Overview({ data }) {
  const { queue, lastHour, loads, trucks, drivers, shippers, ai } = data;
  return (
    <>
      <h2 className="group-title">Hozir</h2>
      <div className="tiles">
        <Tile value={num(queue.waiting)} label={queue.oldestWaitingMin != null ? `navbatda (eng eskisi ${queue.oldestWaitingMin} daq)` : "navbatda"} warn={queue.oldestWaitingMin > 30} />
        <Tile value={num(queue.failed)} label="xato bilan qolgan" warn={queue.failed > 0} />
        <Tile value={num(lastHour.processed)} label={`oxirgi soatda tahlil (${num(lastHour.posts)} keldi)`} />
        <Tile value={lastHour.medianDelayMin != null ? `${String(lastHour.medianDelayMin).replace(".", ",")} daq` : "—"} label="kechikish (mediana)" />
      </div>

      <h2 className="group-title">Oxirgi 24 soat</h2>
      <div className="tiles">
        <Tile value={num(loads.total)} label={`yangi yuk (${num(loads.delivered)} tasi yuborildi)`} />
        <Tile value={num(trucks.total)} label={`bo'sh mashina (${num(trucks.delivered)} tasi yuborildi)`} />
        <Tile value={`${num(drivers.active)} / ${num(drivers.total)}`} label="haydovchi: faol / jami" />
        <Tile value={`${num(shippers.active)} / ${num(shippers.total)}`} label="yuk beruvchi: faol / jami" />
      </div>

      <h2 className="group-title">AI ulanishlari</h2>
      {ai.length === 0 ? (
        <div className="notice">AI ulanishi yo'q — kompyuterdagi boshqaruv markazining «AI» bo'limida kalit qo'shing.</div>
      ) : (
        <div className="section ai-list">
          {ai.map((slot) => (
            <div key={`${slot.label}:${slot.model}`} className="ai-row">
              <div>
                <strong>{slot.model}</strong>
                <span className="muted small"> · {slot.label}</span>
              </div>
              <div className="muted small">
                {!slot.enabled
                  ? "o'chirilgan"
                  : slot.restingUntil
                    ? `⏳ ${clock(slot.restingUntil)} gacha dam (${REASONS[slot.reason] ?? slot.reason ?? "xato"})`
                    : `✅ bugun ${num(slot.requests)} so'rov, ${num(slot.posts)} e'lon${slot.errors ? `, ${num(slot.errors)} xato` : ""}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function UserRow({ user, now, onChanged }) {
  const [busy, setBusy] = useState(false);
  const role = ROLES[user.role];
  const otherRole = user.role === "haydovchi" ? "yuk_beruvchi" : user.role === "yuk_beruvchi" ? "haydovchi" : null;
  const status = user.hasProfile ? (user.active ? "faol" : "pauzada") : user.registering ? "ro'yxatdan o'tyapti" : "sozlamalar yo'q";

  async function change(body, done) {
    setBusy(true);
    try {
      onChanged(await updateAdminUser(user.chatId, body));
      haptic.success();
      if (done) showAlert(done);
    } catch (error) {
      haptic.error();
      showAlert(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function switchRole() {
    const ok = await confirmAction(
      `${user.name || "Foydalanuvchi"} — ${ROLES[otherRole].name.toLowerCase()} bo'lsinmi? Hozirgi sozlamalari saqlanib qoladi (qaytsa, tiklanadi). ` +
        `Yangi rolda avval to'ldirmagan bo'lsa, botda to'ldiradi.`,
    );
    if (ok) change({ role: otherRole });
  }

  return (
    <article className="user">
      <div className="user-head">
        <strong>{user.name || "Ismsiz"}</strong>
        {user.isAdmin && <span className="tag">admin</span>}
      </div>
      <p className="muted small">
        {user.username ? `@${user.username}` : `id ${user.chatId}`} · {role ? `${role.icon} ${role.name}` : "rol tanlanmagan"} · {status} ·{" "}
        {agoText(user.updatedAt, now)}
      </p>
      <div className="user-actions">
        {user.hasProfile && (
          <button type="button" className={`pill${user.active ? "" : " paused"}`} disabled={busy} onClick={() => change({ active: !user.active })}>
            {user.active ? "⏸ To'xtatish" : "▶️ Yoqish"}
          </button>
        )}
        {otherRole && (
          <button type="button" className="pill ghost" disabled={busy} onClick={switchRole}>
            {ROLES[otherRole].icon} {ROLES[otherRole].name} qilish
          </button>
        )}
      </div>
    </article>
  );
}

export function AdminPage({ onAuthLost }) {
  const [overview, setOverview] = useState({ data: null, error: null });
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [users, setUsers] = useState({ items: [], total: 0, loading: true, error: null });
  const [now, setNow] = useState(() => Date.now());

  const fail = useCallback(
    (error) => {
      if (error.code === "auth") onAuthLost();
      return error;
    },
    [onAuthLost],
  );

  const loadOverview = useCallback(async () => {
    try {
      setOverview({ data: await getAdminOverview(), error: null });
      setNow(Date.now());
    } catch (error) {
      setOverview((s) => ({ data: s.data, error: fail(error) }));
    }
  }, [fail]);

  useEffect(() => {
    loadOverview();
    const timer = setInterval(loadOverview, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadOverview]);

  // Qidiruv yozilayotganda har harfda so'rov ketmasin — 300 ms kutamiz
  useEffect(() => {
    let cancelled = false;
    setUsers((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const data = await getAdminUsers({ q, role });
        if (!cancelled) setUsers({ ...data, loading: false, error: null });
      } catch (error) {
        if (!cancelled) setUsers((s) => ({ ...s, loading: false, error: fail(error) }));
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, role, fail]);

  const onChanged = useCallback((updated) => {
    setUsers((s) => ({
      ...s,
      items: s.items.map((u) =>
        u.chatId === updated.chatId ? { ...u, role: updated.role, active: updated.active, hasProfile: Boolean(updated.profile), registering: false } : u,
      ),
    }));
  }, []);

  if (overview.error?.code === "forbidden") {
    return <Notice title="Faqat adminlar uchun">Admin huquqini kompyuterdagi boshqaruv markazida beriladi.</Notice>;
  }

  return (
    <>
      {overview.data ? (
        <Overview data={overview.data} />
      ) : overview.error ? (
        <Notice
          title="Ko'rsatkichlar ochilmadi"
          action={
            <button type="button" className="primary" onClick={loadOverview}>
              Qayta urinish
            </button>
          }
        >
          {overview.error.message}
        </Notice>
      ) : (
        <Spinner />
      )}

      <h2 className="group-title">Foydalanuvchilar</h2>
      <div className="toolbar">
        <input className="search" type="search" placeholder="🔍 Ism, @username yoki id" value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented label="Rol" options={ROLE_FILTERS} value={role} onChange={setRole} />
      </div>
      {users.error ? (
        <Notice title="Ro'yxat ochilmadi">{users.error.message}</Notice>
      ) : users.loading && !users.items.length ? (
        <Spinner />
      ) : !users.items.length ? (
        <Notice title="Hech kim topilmadi" />
      ) : (
        <>
          <p className="count">
            {users.total} ta{users.total > users.items.length && `, birinchi ${users.items.length} tasi`}
            {users.loading && " · yangilanyapti..."}
          </p>
          <div className="users">
            {users.items.map((u) => (
              <UserRow key={u.chatId} user={u} now={now} onChanged={onChanged} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
