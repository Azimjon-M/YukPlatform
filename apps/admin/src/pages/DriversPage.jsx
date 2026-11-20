// Foydalanuvchilar: GET /api/drivers — kim (haydovchi / yuk beruvchi), qanday mashina, qaysi yo'nalish, faolmi,
// o'zi ulashgan telefon raqami (ixtiyoriy; faqat shu sahifada), olgan yuklari va oxirgi faolligi.
// Jonli (live.js): bot kimgadir yuk yuborsa, kimdir botga yozsa yoki web'ni ochsa — 1–2 soniyada o'zi yangilanadi.
// Faol — unga yuk (yuk beruvchiga — bo'sh mashina) yuboriladi; buni faqat foydalanuvchining o'zi o'zgartiradi (bu yerda
// faqat ko'rinadi), 48 soat kirmasa bot o'zi pauza qiladi. «Admin» — Mini App'dagi «🛠 Boshqaruv» huquqi:
// faqat shu yerdan (localhost) beriladi, internetdagi ilova orqali emas.
// Hisobdan chiqqan (web «🚪 Chiqish»): bot yubormaydi, lekin oxirgi roli, mashinasi va yo'nalishi ko'rinib turadi.
// Hisobini o'chirgan (bot /ochirish yoki web «🗑 Hisobni o'chirish»): qator qoladi — o'chirgan paytdagi rol, sozlamalar,
// raqam va «N marta o'chirgan». Hammasi sig'maydi — har qatorda «Batafsil» (akkordeon, DriverDetails.jsx).
import { useState } from "react";
import { BLOCKED_TEXT, formatContactPhone } from "@yuk/shared";
import { get, patch } from "../api.js";
import {
  DRIVER_FILTERS,
  activityView,
  deliveriesView,
  driverLine,
  driverMatches,
  driverPill,
  driverShown,
  formatNumber,
  initials,
  isProDriver,
} from "../format.js";
import { useApi, useNow, usePaged } from "../hooks.js";
import { Async, Avatar, Badge, Button, ConfirmDialog, Empty, PageHeader, PagedPager, TimeAgo, Toggle, avatarUrl, useTitle, useToast } from "../ui.jsx";
import { DriverDetails } from "./DriverDetails.jsx";


// Kanal va guruhga a'zo emas (bot tekshiradi, .env REQUIRED_CHATS): bot ishlamaydi, yuk yuborilmaydi
function SubBadge({ driver }) {
  if (driver.subOk !== false) return null;
  return (
    <div>
      <Badge tone="critical" icon="🔒" title="Bot faqat kanal va guruh a'zolariga ishlaydi: yuk yuborilmaydi, botga yozsa — «a'zo bo'ling» chiqadi">
        A'zo emas
      </Badge>
      {driver.subMissing?.length > 0 && <div className="muted small">{driver.subMissing.join(", ")}</div>}
    </div>
  );
}

// Boshqaruv markazidan bloklangan (store bans): qachon va nimasi bo'yicha — o'zi bloklangan bo'lsa ID, boshqa akkauntning
// username / raqami mos kelgan bo'lsa — o'sha
const BAN_BY = { id: "Telegram ID", username: "username", phone: "telefon raqami" };
function BanBadge({ driver, now }) {
  const ban = driver.banned;
  if (!ban) return null;
  const other = ban.chatId != null && ban.chatId !== driver.chatId;
  const value = ban.by === "username" ? `@${ban.value}` : ban.by === "phone" ? formatContactPhone(ban.value) : null;
  return (
    <div>
      <Badge tone="critical" icon="🚫" title={`Botga yozsa — «${BLOCKED_TEXT}», yuk yuborilmaydi, Mini App ochilmaydi`}>
        Bloklangan
      </Badge>
      <div className="muted small">
        <TimeAgo ts={ban.at} now={now} />
        {other && value && ` · ${BAN_BY[ban.by]} bo'yicha: ${value}`}
      </div>
    </div>
  );
}

// Bloklash / blokdan chiqarish — admin toggle kabi, lekin avval «Ishonchingiz komilmi?» oynasi (Azimjon, 2026-11-09).
// Blok shu odamning Telegram ID, username va raqamiga qo'yiladi (store.banDriver). Adminni bloklab bo'lmaydi
function BlockToggle({ driver, onChanged }) {
  const notify = useToast();
  const [asking, setAsking] = useState(null); // true — bloklash so'ralyapti, false — blokdan chiqarish, null — oyna yopiq
  const [busy, setBusy] = useState(false);
  const blocked = driver.banned != null;
  const name = driver.name || (driver.username ? `@${driver.username}` : String(driver.chatId));
  const keys = [
    `Telegram ID ${driver.chatId}`,
    driver.username ? `@${driver.username}` : null,
    driver.phone ? formatContactPhone(driver.phone) : null,
  ].filter(Boolean);
  async function confirm() {
    setBusy(true);
    try {
      await patch(`/api/drivers/${driver.chatId}`, { blocked: asking });
      notify(asking ? `${name} bloklandi` : `${name} blokdan chiqarildi — botdan yana foydalana oladi`);
      setAsking(null);
      onChanged();
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Toggle
        checked={blocked}
        onChange={setAsking}
        disabled={driver.isAdmin && !blocked}
        label={driver.isAdmin && !blocked ? "Blok (admin — avval huquqini oling)" : "Bloklangan"}
      />
      <ConfirmDialog
        open={asking != null}
        busy={busy}
        tone={asking ? "danger" : "primary"}
        title={asking ? "Foydalanuvchini bloklaysizmi?" : "Blokdan chiqarasizmi?"}
        confirmLabel={asking ? "Ha, bloklash" : "Ha, blokdan chiqarish"}
        onConfirm={confirm}
        onCancel={() => setAsking(null)}
      >
        {asking ? (
          <>
            <p>
              Ishonchingiz komilmi? <b>{name}</b> bloklanadi:
            </p>
            <ul>
              <li>
                botga nima yozsa ham «{BLOCKED_TEXT}» javobini oladi, Mini App va sayt ham shuni ko'rsatadi;
              </li>
              <li>yuk va bo'sh mashina xabarlari yuborilmaydi.</li>
            </ul>
            <p>
              Blok qo'yiladi: <b>{keys.join(", ")}</b>. Boshqa akkaunt shu username{driver.phone ? " yoki raqam" : ""} bilan kelsa ham
              bloklangan bo'ladi.
              {!driver.phone && " Raqamini ulashmagan — raqam bo'yicha blok yo'q."}
            </p>
          </>
        ) : (
          <p>
            <b>{name}</b> botdan va ilovadan yana foydalana oladi, mos yuklar yana boradi (agar pauzada bo'lmasa).
          </p>
        )}
      </ConfirmDialog>
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

// Pro obuna: yopiq guruhlardagi e'lonlar faqat Pro'larga boradi (@yuk/shared roles.js planAllows)
function ProToggle({ driver, onChanged }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(driver.plan === "pro");
  async function change(pro) {
    setBusy(true);
    setChecked(pro);
    try {
      await patch(`/api/drivers/${driver.chatId}`, { plan: pro ? "pro" : "free" });
      notify(pro ? "Pro berildi — endi yopiq guruhlardagi e'lonlar ham boradi" : "Pro olindi — faqat ochiq guruhlardagi e'lonlar");
      onChanged();
    } catch (e) {
      setChecked(!pro);
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Toggle checked={checked} onChange={change} busy={busy} label="Pro" />
      {driver.autoPro && !checked && <div className="muted small">⭐ Pro avtomatik: raqam ulashgan + akkaunt bog'lagan</div>}
    </>
  );
}

// Olgan yuklari: bugun / jami, oxirgisi (yo'nalishi bilan), yetmagan bo'lsa — sababi
function Deliveries({ driver, now }) {
  const d = deliveriesView(driver);
  if (!d.total && !d.failed && !d.raw.total) return <span className="muted">Hali {d.noun} olmagan</span>;
  return (
    <>
      {(d.total > 0 || d.failed > 0) && (
        <div>
          Bugun <strong>{formatNumber(d.today)}</strong> · jami {formatNumber(d.total)}
          {d.called > 0 && (
            <span className="muted" title="Shuncha yukda «📞 Telefon qilish» tugmasini bosgan (2026-11-09 dan)">
              {" "}
              · 📞 {formatNumber(d.called)}
            </span>
          )}
        </div>
      )}
      {d.raw.total > 0 && (
        <div title="«⚡ Tezkor» / «📌 Mening guruhlarim»: AI'siz, e'lonning asl matni bilan darhol yuborilganlar">
          ⚡ Asl matn: bugun <strong>{formatNumber(d.raw.today)}</strong> · jami {formatNumber(d.raw.total)}
          {d.raw.called > 0 && <span className="muted"> · 📞 {formatNumber(d.raw.called)}</span>}
        </div>
      )}
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

// Bitta foydalanuvchi — akkordeon. Yopiq: avatar, ism, rol va mashina bir satrda, holat va faollik o'ngda.
// Ochiq: boshqaruv (Admin / Pro / Blok), holat, yo'nalish, olgan yuklari va to'liq «Batafsil» (DriverDetails.jsx)
function DriverRow({ driver, open, onToggle, now, reload, idleSince }) {
  const shown = driverShown(driver);
  const pill = driverPill(driver, idleSince, now);
  const activity = activityView(driver, now);
  const detailsId = `driver-details-${driver.chatId}`;
  return (
    <li className={["person", open ? "is-open" : "", shown.deleted ? "is-deleted" : ""].filter(Boolean).join(" ")}>
      <button type="button" className="person-head" onClick={onToggle} aria-expanded={open} aria-controls={detailsId}>
        <Avatar src={avatarUrl("user", driver.chatId)} text={initials(driver)} online={activity.online} />
        <span className="person-main">
          <span className="person-name">
            <strong>{driver.name || "Ismsiz"}</strong>
            {isProDriver(driver) && (
              <span className="pro-mark" title={driver.plan === "pro" ? "Pro (qo'lda berilgan)" : "Pro (avtomatik: raqam + akkaunt)"}>
                PRO
              </span>
            )}
            {driver.isAdmin && <span className="admin-mark">admin</span>}
          </span>
          <span className="person-sub">{driverLine(driver)}</span>
        </span>
        <span className="person-side">
          <Badge tone={pill.tone} icon={pill.icon}>
            {pill.label}
          </Badge>
          <span className="person-time">{activity.online ? "hozir onlayn" : <TimeAgo ts={activity.at} now={now} />}</span>
        </span>
        <span className="chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="person-body" id={detailsId}>
          <div className="person-controls">
            {!shown.deleted && <AdminToggle key={`${driver.chatId}:admin:${driver.isAdmin}`} driver={driver} onChanged={reload} />}
            {!shown.deleted && <ProToggle key={`${driver.chatId}:plan:${driver.plan}`} driver={driver} onChanged={reload} />}
            <BlockToggle driver={driver} onChanged={reload} />
          </div>
          {(driver.banned || driver.subOk === false) && (
            <div className="person-alerts">
              <BanBadge driver={driver} now={now} />
              <SubBadge driver={driver} />
            </div>
          )}
          <div className="person-delivered">
            <h4>Olgan yuklari</h4>
            <Deliveries driver={driver} now={now} />
          </div>
          <DriverDetails driver={driver} now={now} onPurged={reload} idleSince={idleSince} />
        </div>
      )}
    </li>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <span className="stat-value">{formatNumber(value)}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function DriversPage() {
  useTitle("Haydovchilar");
  // «Hozir» 2 daqiqadan keyin o'chishi uchun tez-tez (ma'lumotning o'zi jonli — bot bazaga yozishi bilan)
  const now = useNow(15_000);
  const state = useApi(() => get("/api/drivers"), [], { live: ["drivers"] });
  // Ochiq qatorlar (bir nechtasi birdan ochiq tursa bo'ladi)
  const [openIds, setOpenIds] = useState(() => new Set());
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const toggle = (chatId) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });

  const items = state.data?.items ?? [];
  const registered = items.filter((d) => d.profile);
  const shippers = registered.filter((d) => d.role === "yuk_beruvchi");
  const sentToday = items.reduce((sum, d) => sum + (d.deliveries?.today ?? 0) + (d.deliveries?.raw?.today ?? 0), 0);
  const counts = Object.fromEntries(DRIVER_FILTERS.map((f) => [f.id, items.filter((d) => f.test(d, now)).length]));
  const current = DRIVER_FILTERS.find((f) => f.id === filter) ?? DRIVER_FILTERS[0];
  const shown = items.filter((d) => current.test(d, now) && driverMatches(d, query));
  const paged = usePaged(shown, `${filter}|${query}`, 30);

  return (
    <>
      <PageHeader
        title="Haydovchilar"
        subtitle={
          state.data
            ? `${formatNumber(registered.length - shippers.length)} haydovchi · ${formatNumber(shippers.length)} yuk beruvchi · ${formatNumber(items.length - registered.length)} ro'yxatsiz`
            : "Botdagi haydovchilar va yuk beruvchilar"
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
            <div className="stack">
              <div className="stats">
                <Stat label="jami" value={items.length} />
                <Stat label="faol" value={counts.active} tone={counts.active ? "good" : null} />
                <Stat label="onlayn" value={counts.online} tone={counts.online ? "good" : null} />
                <Stat label="bugun yuk" value={sentToday} />
              </div>
              <div className="list-toolbar">
                <input
                  type="search"
                  className="search"
                  placeholder="Ism, @username, raqam yoki ID"
                  aria-label="Foydalanuvchini qidirish"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="chips" role="tablist" aria-label="Filtr">
                  {DRIVER_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="tab"
                      aria-selected={f.id === filter}
                      className={`chip ${f.id === filter ? "is-active" : ""}`}
                      onClick={() => setFilter(f.id)}
                    >
                      {f.label}
                      <span className="chip-count">{formatNumber(counts[f.id])}</span>
                    </button>
                  ))}
                </div>
              </div>
              {shown.length === 0 ? (
                <Empty title="Hech kim topilmadi">Boshqa filtrni tanlang yoki qidiruvni o'zgartiring.</Empty>
              ) : (
                <>
                <p className="muted small list-count" ref={paged.ref}>
                  {formatNumber(shown.length)} ta foydalanuvchi
                </p>
                <ul className="people">
                  {paged.items.map((d) => (
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
                </ul>
                <PagedPager paged={paged} />
                </>
              )}
            </div>
          )
        }
      </Async>
    </>
  );
}
