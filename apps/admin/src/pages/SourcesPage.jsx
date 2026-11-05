// Manbalar: collector kuzatadigan Telegram guruhlari. Qo'shish, yoqish/o'chirish, olib tashlash; 24 soatlik statistika.
// O'zgarish collector'ning keyingi aylanishida kuchga kiradi.
import { useState } from "react";
import { del, get, patch, post } from "../api.js";
import { formatNumber } from "../format.js";
import { useApi, useNow } from "../hooks.js";
import { Async, Badge, Button, Card, Empty, ExternalLink, Field, PageHeader, TimeAgo, Toggle, useTitle, useToast } from "../ui.jsx";

const NOTE = "O'zgarish collector'ning keyingi aylanishida kuchga kiradi (1–2 daqiqa).";
const sourcePath = (name) => `/api/sources/${encodeURIComponent(name)}`;
const sourceLink = (name) => (name.startsWith("@") ? `https://t.me/${name.slice(1)}` : null);

function AddSource({ onAdded }) {
  const notify = useToast();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await post("/api/sources", { name: name.trim(), note: note.trim() || null });
      notify(result.added ? `${result.name} qo'shildi` : `${result.name} ro'yxatda allaqachon bor`, result.added ? "good" : "neutral");
      setName("");
      setNote("");
      onAdded();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Manba qo'shish">
      <form className="add-source" onSubmit={submit}>
        <Field label="Guruh yoki kanal" className="field-grow">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="@guruh_nomi yoki https://t.me/guruh_nomi"
            autoComplete="off"
            spellCheck="false"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "add-source-error" : undefined}
            required
          />
        </Field>
        <Field label="Izoh (ixtiyoriy)" className="field-grow">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Masalan: fura yuklari, Farg'ona" />
        </Field>
        <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
          Qo'shish
        </Button>
      </form>
      {error && (
        <p className="inline-error" id="add-source-error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small">{NOTE} Faqat ochiq guruhlar: yopiq guruh taklif havolasi (t.me/+...) ishlamaydi.</p>
    </Card>
  );
}

function SourceRow({ source, now, onChanged }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(source.enabled);
  const [confirming, setConfirming] = useState(false);
  const s = source.stats;

  async function toggle(value) {
    setBusy(true);
    setEnabled(value);
    try {
      await patch(sourcePath(source.name), { enabled: value });
      notify(`Saqlandi. ${NOTE}`);
      onChanged();
    } catch (e) {
      setEnabled(!value);
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await del(sourcePath(source.name));
      notify(`${source.name} ro'yxatdan olib tashlandi`);
      onChanged();
    } catch (e) {
      notify(e.message, "critical");
      setBusy(false);
      setConfirming(false);
    }
  }

  const link = sourceLink(source.name);
  return (
    <li className={`source-row ${enabled ? "" : "is-off"}`}>
      <div className="source-main">
        <div className="source-name">
          {link ? <ExternalLink href={link}>{source.name}</ExternalLink> : <strong>{source.name}</strong>}
          {!enabled && <Badge icon="■">O'chirilgan</Badge>}
        </div>
        {source.note && <p className="muted small">{source.note}</p>}
        <dl className="source-stats">
          <div>
            <dt>E'lonlar (24 s)</dt>
            <dd>{formatNumber(s.posts)}</dd>
          </div>
          <div>
            <dt>Takrorlar</dt>
            <dd>
              {formatNumber(s.duplicates)}
              {s.posts > 0 && <span className="muted small"> ({Math.round((s.duplicates / s.posts) * 100)}%)</span>}
            </dd>
          </div>
          <div>
            <dt>Yuklar</dt>
            <dd>{formatNumber(s.loads)}</dd>
          </div>
          <div>
            <dt>Oxirgi e'lon</dt>
            <dd>{s.lastPostAt ? <TimeAgo ts={s.lastPostAt} now={now} /> : "—"}</dd>
          </div>
        </dl>
      </div>
      <div className="source-controls">
        <Toggle checked={enabled} onChange={toggle} busy={busy} label={enabled ? "Kuzatilyapti" : "O'chiq"} />
        {confirming ? (
          <div className="confirm" role="group" aria-label="Olib tashlashni tasdiqlash">
            <span className="small">Olib tashlansinmi?</span>
            <Button variant="danger" onClick={remove} busy={busy}>
              Ha
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Yo'q
            </Button>
          </div>
        ) : (
          <Button variant="ghost" className="danger-text" onClick={() => setConfirming(true)} disabled={busy}>
            Olib tashlash
          </Button>
        )}
      </div>
    </li>
  );
}

export function SourcesPage() {
  useTitle("Manbalar");
  const now = useNow(30_000);
  const state = useApi(() => get("/api/sources"), []);
  const items = state.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Manbalar"
        subtitle={state.data ? `${formatNumber(items.length)} ta guruh, ${formatNumber(items.filter((s) => s.enabled).length)} tasi kuzatilyapti` : "Collector e'lon o'qiydigan Telegram guruhlari"}
        actions={
          <Button onClick={state.reload} busy={state.loading && state.data != null}>
            Yangilash
          </Button>
        }
      />
      <div className="stack">
        <AddSource onAdded={state.reload} />
        <Async state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty title="Manbalar hali yo'q">
                <p>
                  Manba — yuk e'lonlari yoziladigan ochiq Telegram guruhi yoki kanali (masalan, @yuk_markazi). Collector ularni har daqiqada o'qib, yangi
                  e'lonlarni navbatga yozadi; bot esa ularni AI bilan tahlil qilib, haydovchilarga yuboradi.
                </p>
                <p>
                  Ro'yxat bo'sh bo'lsa, collector birinchi ishga tushganda .env dagi TG_SOURCES guruhlarini shu yerga o'zi yozadi. Agar hozir qo'lda qo'shsangiz,
                  TG_SOURCES o'qilmaydi — kerakli guruhlarning hammasini shu formadan qo'shing. Guruhga a'zo bo'lish shart emas.
                </p>
              </Empty>
            ) : (
              <ul className="source-list">
                {data.items.map((source) => (
                  <SourceRow key={`${source.name}:${source.enabled}`} source={source} now={now} onChanged={state.reload} />
                ))}
              </ul>
            )
          }
        </Async>
      </div>
    </>
  );
}
