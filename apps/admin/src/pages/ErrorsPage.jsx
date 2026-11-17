// «Xatolar»: hamma xato bir joyda — server tomonida (bot, collector, nginx, tunnel, API: /api/errors, apps/api errorLog.js)
// va shu brauzerda (sahifa yiqilishi, server javob bermagani / aloqa yo'qligi, bajarilmagan amallar: errors.js).
// Bir xil xato bitta qator: necha marta va oxirgi marta qachon. Ochilganda hammasi «ko'rilgan» bo'ladi (menyudagi son 0).
// Har kartada (Azimjon, 2026-11-10): «🗑 O'chirish» — shu yozuv o'chadi, xato yana chiqsa qaytadi; «🙈 E'tiborsiz
// qoldirish» — bu xato boshqa ko'rsatilmaydi (yana chiqsa ham, faqat sanaladi), «🙈 E'tiborsiz» bo'limidan qaytariladi.
import { useEffect, useMemo, useState } from "react";
import { del, get, post } from "../api.js";
import { CopyButton } from "../ErrorScreen.jsx";
import { kindInfo, mergeIgnored, mergeJournals, reportText, sourceLabel } from "../errorInfo.js";
import {
  clearLocalErrors,
  ignoreLocalError,
  markErrorsSeen,
  removeLocalError,
  unignoreLocalError,
  useErrorsSeenAt,
  useIgnoredLocal,
  useLocalErrors,
} from "../errors.js";
import { formatDateTime, formatNumber } from "../format.js";
import { useApi, useNow } from "../hooks.js";
import { Badge, Button, Empty, ErrorBox, Field, Loading, PageHeader, Tabs, TimeAgo, useTitle, useToast } from "../ui.jsx";

const REMOVE_HINT = "Faqat shu yozuv o'chadi. Xato yana chiqsa — ro'yxatda qaytadi.";
const IGNORE_HINT = "Bu xato boshqa ko'rsatilmaydi — yana chiqsa ham. «🙈 E'tiborsiz» bo'limidan qaytarasiz.";

function LevelBadges({ entry }) {
  const kind = kindInfo(entry.kind, entry.source);
  const error = entry.level === "error";
  return (
    <>
      <Badge tone={error ? "critical" : "warning"} icon={error ? "✖" : "⚠"}>
        {error ? "Xato" : "Ogohlantirish"}
      </Badge>
      <Badge>{sourceLabel(entry.source)}</Badge>
      <span className="muted small">
        <span aria-hidden="true">{kind.icon}</span> {kind.label}
      </span>
    </>
  );
}

// actions — false: eski server (o'chirish so'rovlarini bilmaydi) — tugmalar yo'q
function ErrorItem({ entry, isNew, now, actions, busy, onRemove, onIgnore }) {
  return (
    <li className={`error-item level-${entry.level}`}>
      <details>
        <summary>
          <span className="error-item-head">
            <LevelBadges entry={entry} />
            {isNew && (
              <Badge tone="info" icon="●">
                yangi
              </Badge>
            )}
          </span>
          <span className="error-item-text">{entry.text}</span>
          <span className="muted small">
            {entry.count > 1 && <strong>{formatNumber(entry.count)} marta · </strong>}
            oxirgi: <TimeAgo ts={entry.last} now={now} />
            {entry.where && ` · ${entry.where}`}
          </span>
        </summary>
        <div className="error-item-body">
          <dl className="error-rows">
            <div>
              <dt>Birinchi marta</dt>
              <dd>{formatDateTime(entry.first)}</dd>
            </div>
            <div>
              <dt>Oxirgi marta</dt>
              <dd>{formatDateTime(entry.last)}</dd>
            </div>
            {entry.where && (
              <div>
                <dt>Qayerda</dt>
                <dd>{entry.where}</dd>
              </div>
            )}
          </dl>
          {entry.details && <pre className="error-stack">{entry.details}</pre>}
          <CopyButton text={() => reportText([entry])} />
        </div>
      </details>
      {actions && (
        <div className="error-item-actions">
          <Button className="btn-compact" busy={busy === "ignore"} disabled={Boolean(busy)} title={IGNORE_HINT} onClick={onIgnore}>
            🙈 E'tiborsiz qoldirish
          </Button>
          <Button className="btn-compact btn-ghost" busy={busy === "remove"} disabled={Boolean(busy)} title={REMOVE_HINT} onClick={onRemove}>
            🗑 O'chirish
          </Button>
        </div>
      )}
    </li>
  );
}

function IgnoredItem({ rule, now, busy, onRestore }) {
  return (
    <li className={`error-item level-${rule.level} is-ignored`}>
      <div className="error-item-plain">
        <span className="error-item-head">
          <LevelBadges entry={rule} />
          <Badge icon="🙈">e'tiborsiz</Badge>
        </span>
        <span className="error-item-text">{rule.text}</span>
        <span className="muted small">
          e'tiborsiz qoldirilgan: <TimeAgo ts={rule.at} now={now} />
          {rule.where && ` · ${rule.where}`}
          {" · "}
          {rule.hits > 0 ? (
            <>
              keyin yana <strong>{formatNumber(rule.hits)} marta</strong> chiqdi (ko'rsatilmadi), oxirgi: <TimeAgo ts={rule.lastHit} now={now} />
            </>
          ) : (
            "keyin chiqmadi"
          )}
        </span>
      </div>
      <div className="error-item-actions">
        <Button className="btn-compact" busy={busy} title="Bu xato yana chiqsa — ro'yxatda ko'rinadi" onClick={onRestore}>
          ↩ Qaytarish
        </Button>
      </div>
    </li>
  );
}

export function ErrorsPage() {
  useTitle("Xatolar");
  const notify = useToast();
  const now = useNow(15_000);
  const server = useApi(() => get("/api/errors"), [], { live: ["errors"], interval: 30_000 });
  const local = useLocalErrors();
  const localIgnored = useIgnoredLocal();
  const seenAt = useErrorsSeenAt();
  // Sahifa ochilgandagi «ko'rilgan» vaqt — undan keyingilari «yangi» belgisi bilan
  const [seenBefore] = useState(seenAt);
  const [level, setLevel] = useState("all");
  const [source, setSource] = useState("all");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(null); // { id, action } — qaysi kartada so'rov ketyapti
  // Serverda o'chirilgan yozuvlar — javob kelishi bilan yashiriladi (ro'yxat qayta olinguncha kutmasdan)
  const [hidden, setHidden] = useState(() => new Set());
  useEffect(() => setHidden((ids) => (ids.size ? new Set() : ids)), [server.data]);

  // Eski server (npm start qayta yoqilmagan) bitta xatoni o'chirishni bilmaydi — u javobida «ignored» yo'q
  const serverActs = Array.isArray(server.data?.ignored);
  const all = useMemo(() => mergeJournals(local, server.data?.items ?? []).filter((e) => !hidden.has(e.id)), [local, server.data, hidden]);
  const ignoredAll = useMemo(() => mergeIgnored(localIgnored, server.data?.ignored ?? []), [localIgnored, server.data]);
  // Sahifa ochiq turganda kelganlari ham ko'rilgan hisoblanadi (menyudagi son o'smasin)
  useEffect(() => markErrorsSeen(), [all]);

  const sources = [...new Set([...all, ...ignoredAll].map((e) => e.source))];
  // Tanlangan manbadan yozuv qolmasa (tozalandi) — «Hammasi»: yashirin filtr yangi xatolarni yashirmasin
  const from = sources.includes(source) ? source : "all";
  const bySource = (e) => from === "all" || e.source === from;
  const ignoredView = level === "ignored";
  const shown = ignoredView ? [] : all.filter((e) => (level === "all" || e.level === level) && bySource(e));
  const ignoredShown = ignoredAll.filter(bySource);
  const count = (lvl) => all.filter((e) => e.level === lvl && bySource(e)).length;
  // Eski server (npm start qayta yoqilmagan) /api/errors ni bilmaydi
  const oldServer = server.error?.status === 404;

  async function clear() {
    setBusy(true);
    try {
      if (!oldServer && !server.error) await del("/api/errors");
      clearLocalErrors();
      notify("Xatolar ro'yxati tozalandi");
      server.reload();
    } catch (error) {
      notify(`Tozalanmadi: ${error.message}`, "critical");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  // «O'chirish» / «E'tiborsiz qoldirish»: brauzer yozuvi — shu yerda, server yozuvi — so'rov bilan
  async function act(entry, action) {
    setActing({ id: entry.id, action });
    try {
      if (entry.serverId == null) {
        (action === "remove" ? removeLocalError : ignoreLocalError)(entry.id);
      } else {
        if (action === "remove") await del(`/api/errors/${entry.serverId}`);
        else await post(`/api/errors/${entry.serverId}/ignore`);
        setHidden((ids) => new Set(ids).add(entry.id));
        server.reload();
      }
      notify(action === "remove" ? "Xato o'chirildi. Yana chiqsa — qaytadi." : "Xato e'tiborsiz qoldirildi — endi ko'rsatilmaydi. Qaytarish: «🙈 E'tiborsiz».");
    } catch (error) {
      notify(`Bajarilmadi: ${error.message}`, "critical");
    } finally {
      setActing(null);
    }
  }

  async function restore(rule) {
    setActing({ id: rule.key, action: "restore" });
    try {
      if (rule.fromServer) {
        await post("/api/errors/unignore", { key: rule.key });
        server.reload();
      } else {
        unignoreLocalError(rule.key);
      }
      notify("Qaytarildi: bu xato yana chiqsa, ro'yxatda ko'rinadi");
    } catch (error) {
      notify(`Qaytarilmadi: ${error.message}`, "critical");
    } finally {
      setActing(null);
    }
  }

  const busyFor = (id) => (acting?.id === id ? acting.action : null);
  const levelTabs = [
    { id: "all", label: "Hammasi", count: count("error") + count("warning") },
    { id: "error", label: "Xatolar", count: count("error") },
    { id: "warning", label: "Ogohlantirishlar", count: count("warning") },
  ];
  if (ignoredAll.length > 0 || ignoredView) levelTabs.push({ id: "ignored", label: "🙈 E'tiborsiz", count: ignoredShown.length });

  return (
    <>
      <PageHeader
        title="Xatolar"
        subtitle={`Server: ${formatNumber(server.data?.items?.length ?? 0)} · brauzer: ${formatNumber(local.length)} — bir xil xato bitta qatorda`}
        actions={
          <>
            {shown.length > 0 && <CopyButton text={() => reportText(shown)} label="Hammasidan nusxa" />}
            {confirming ? (
              <>
                <Button variant="danger" busy={busy} onClick={clear}>
                  Ha, tozalansin
                </Button>
                <Button onClick={() => setConfirming(false)}>Yo'q</Button>
              </>
            ) : (
              all.length > 0 && <Button onClick={() => setConfirming(true)}>Tozalash</Button>
            )}
            <Button onClick={server.reload} busy={server.loading}>
              Yangilash
            </Button>
          </>
        }
      />
      <details className="howto page-note">
        <summary>ℹ️ Bu sahifa nimani ko'rsatadi</summary>
        Server xatolari — bot, collector, nginx, tunnel loglaridan va serverning o'zidan (server qayta yoqilsa bo'shaydi). Brauzer xatolari —
        shu boshqaruv markazi sahifalarida chiqqanlar (shu brauzerda saqlanadi). Qatorni bosing — to'liq matn va «Nusxa olish».
        «🗑 O'chirish» — shu yozuv o'chadi, xato yana chiqsa qaytadi. «🙈 E'tiborsiz qoldirish» — bu xato boshqa ko'rsatilmaydi (yana
        chiqsa ham), «🙈 E'tiborsiz» bo'limidan qaytarasiz.
      </details>

      {oldServer ? (
        <ErrorBox error={{ kind: "client", message: "Server eski versiyada — server xatolari ishga-tushirish.bat (npm start) qayta yoqilgandan keyin ko'rinadi. Hozir faqat brauzer xatolari." }} />
      ) : (
        <ErrorBox error={server.error} onRetry={server.reload} updatedAt={server.updatedAt} />
      )}
      {server.data && !serverActs && (
        <p className="muted small page-note">
          Server xatolarini o'chirish va e'tiborsiz qoldirish — ishga-tushirish.bat (npm start) qayta yoqilgandan keyin. Hozir faqat brauzer
          xatolarida.
        </p>
      )}

      <div className="filters">
        <Tabs label="Daraja" value={level} onChange={setLevel} tabs={levelTabs} />
        {sources.length > 1 && (
          <Field label="Qayerdan">
            <select value={from} onChange={(e) => setSource(e.target.value)}>
              <option value="all">Hammasi</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {ignoredView ? (
        ignoredShown.length === 0 ? (
          <Empty title="E'tiborsiz qoldirilgan xato yo'q">Kartadagi «🙈 E'tiborsiz qoldirish» bosilsa — o'sha xato shu yerga o'tadi.</Empty>
        ) : (
          <ul className="error-list">
            {ignoredShown.map((rule) => (
              <IgnoredItem key={`${rule.fromServer ? "s" : "b"}:${rule.key}`} rule={rule} now={now} busy={busyFor(rule.key) != null} onRestore={() => restore(rule)} />
            ))}
          </ul>
        )
      ) : server.data == null && server.loading && local.length === 0 ? (
        <Loading text="Xatolar olinmoqda…" />
      ) : shown.length === 0 ? (
        <Empty title={all.length ? "Bu filtr bo'yicha yo'q" : "Xato yo'q"}>
          {all.length ? "Boshqa daraja yoki manbani tanlang." : "Hozircha hech qanday xato yozilmagan. Yangisi chiqishi bilan shu yerda ko'rinadi."}
        </Empty>
      ) : (
        <ul className="error-list">
          {shown.map((entry) => (
            <ErrorItem
              key={entry.id}
              entry={entry}
              isNew={entry.last > seenBefore}
              now={now}
              actions={entry.serverId == null || serverActs}
              busy={busyFor(entry.id)}
              onRemove={() => act(entry, "remove")}
              onIgnore={() => act(entry, "ignore")}
            />
          ))}
        </ul>
      )}
    </>
  );
}
