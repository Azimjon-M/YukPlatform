// AI kalitlari: ulanishlar (kalit + model), ularning holati, qo'shish, sinash, o'chirish.
// Ma'lumot: GET /api/ai (har 10 s). Bot ro'yxatni har 15 s da qayta o'qiydi — qayta ishga tushirish shart emas.
// Kalitning o'zi brauzerga hech qachon kelmaydi (faqat "…a1B2"); yangi kalit faqat forma ichida turadi va saqlangach o'chiriladi.
import { useEffect, useState } from "react";
import { aiTotals, healthBadge, newModels, providerOptionLabel, slotStatus, sortSlots, testResultText, todayStats, todayText } from "../aiStatus.js";
import { del, get, patch, post } from "../api.js";
import { formatNumber, formatTime } from "../format.js";
import { useApi, useNow } from "../hooks.js";
import { useOverview } from "../overview.js";
import { processStatus } from "../status.js";
import { Async, Badge, Button, Card, Empty, ErrorBox, ExternalLink, Field, PageHeader, TimeAgo, Toggle, useTitle, useToast } from "../ui.jsx";

const TEST_HINT = "Bitta haqiqiy so'rov yuboriladi: kunlik bepul limitdan 1 tasi sarflanadi";
// GET /api/ai → 404: server bu bo'limdan oldingi kod bilan ishga tushirilgan
const OLD_SERVER = "Server eski versiyada ishlayapti — unda AI kalitlari bo'limi yo'q. Terminalda npm start ni to'xtatib (Ctrl+C), qayta ishga tushiring.";

// --- Bitta model (ulanish) qatori ---
function ModelRow({ apiKey, slot, now, botRunning, onRemove, removing, canRemove, reload }) {
  const notify = useToast();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [clearing, setClearing] = useState(false);
  const { state } = slot;
  const status = slotStatus(apiKey, state, { now, botRunning });
  const health = healthBadge(state, now);
  const stats = todayStats(state, now);

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const answer = await post(`/api/ai/keys/${apiKey.id}/test`, { model: slot.model });
      setResult(testResultText(answer));
      // Ishladi — server «dam olyapti»ni bekor qildi; holat darhol yangilansin
      if (answer.woke) reload();
    } catch (e) {
      setResult(testResultText({ ok: false, error: e.message }));
      if (e.offline) notify(e.message, "critical");
    } finally {
      setTesting(false);
    }
  }

  async function clearProblem() {
    setClearing(true);
    try {
      await post(`/api/ai/keys/${apiKey.id}/reset`, { model: slot.model });
      notify("Belgi olib tashlandi — bot modelni 15 soniya ichida yana oddiy navbatda ishlatadi");
      reload();
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setClearing(false);
    }
  }

  return (
    <li className={`model-row ${health ? "is-problem" : ""}`}>
      <div className="model-line">
        <code className="model-name">{slot.model}</code>
        <Badge tone={status.tone} icon={status.icon}>
          {status.label}
        </Badge>
        {health && (
          <Badge tone="critical" icon="📌" title={health.error ? `Belgilangan paytdagi xato: ${health.error}` : undefined}>
            {health.label}
          </Badge>
        )}
        {status.detail && status.kind !== "problem" && <span className="model-detail">{status.detail}</span>}
      </div>
      {health && (
        <p className="model-problem small">
          {health.detail}
          {health.since ? ` · belgilangan: ${formatTime(health.since)}` : ""}. 24 soat xatosiz ishlasa, belgi o'zi yo'qoladi.
        </p>
      )}
      <div className="model-stats">
        <span>{todayText(stats)}</span>
        {state?.lastUsedAt && (
          <span>
            oxirgi so'rov <TimeAgo ts={state.lastUsedAt} now={now} />
          </span>
        )}
      </div>
      {state?.lastError && (
        <details className="last-error">
          <summary title={state.lastError}>
            Oxirgi xato{state.lastErrorAt ? ` (${formatTime(state.lastErrorAt)})` : ""}: {state.lastError}
          </summary>
        </details>
      )}
      <div className="model-actions">
        <Button onClick={test} busy={testing} title={TEST_HINT}>
          {testing ? "Sinalmoqda…" : "Sinash"}
        </Button>
        {health && (
          <Button onClick={clearProblem} busy={clearing} title="Xatolar hisobi noldan boshlanadi, model yana oddiy navbatda ishlatiladi">
            Belgini olib tashlash
          </Button>
        )}
        <Button
          variant="ghost"
          className="danger-text"
          onClick={onRemove}
          busy={removing}
          disabled={!canRemove}
          title={canRemove ? "Bu modelni kalitdan olib tashlash" : "Oxirgi model — uni emas, kalitni o'chiring"}
        >
          Olib tashlash
        </Button>
      </div>
      {result && (
        <p className={`test-result ${result.ok ? "is-ok" : "is-fail"}`} role="status">
          <strong>{result.title}</strong> {result.text}
        </p>
      )}
    </li>
  );
}

// --- Kalitga yana model qo'shish: saqlangan kalit bilan ro'yxat (so'rov limitidan sarflanmaydi) ---
function ModelPicker({ apiKey, onDone, onCancel }) {
  const notify = useToast();
  const existing = apiKey.models.map((m) => m.model);
  const list = useApi(() => get(`/api/ai/keys/${apiKey.id}/models`), [apiKey.id]);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const available = list.data ? newModels(list.data.models, existing) : [];

  async function save() {
    setSaving(true);
    try {
      await patch(`/api/ai/keys/${apiKey.id}`, { models: [...existing, ...selected] });
      notify(`${selected.length} ta model qo'shildi — «Sinash» bilan tekshirib ko'ring`);
      onDone();
    } catch (e) {
      notify(e.message, "critical");
      setSaving(false);
    }
  }

  return (
    <div className="model-picker">
      <Async state={list} loadingText="Modellar ro'yxati olinmoqda…">
        {() =>
          available.length === 0 ? (
            <p className="muted small">Yangi model yo'q — bu kalitdagi hamma matn modellari qo'shilgan.</p>
          ) : (
            <>
              <p className="small">Qo'shiladigan modellarni tanlang (eng foydalisi birinchi):</p>
              <ModelChecklist models={available} selected={selected} onChange={setSelected} />
            </>
          )
        }
      </Async>
      <div className="form-actions">
        <Button variant="primary" onClick={save} busy={saving} disabled={!selected.length}>
          {selected.length ? `Qo'shish (${selected.length})` : "Qo'shish"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Bekor qilish
        </Button>
      </div>
    </div>
  );
}

function ModelChecklist({ models, selected, onChange }) {
  const toggle = (model) => onChange(selected.includes(model) ? selected.filter((m) => m !== model) : [...selected, model]);
  return (
    <ul className="model-checklist">
      {models.map((model, i) => (
        <li key={model}>
          <label className="check">
            <input type="checkbox" checked={selected.includes(model)} onChange={() => toggle(model)} />
            <code>{model}</code>
            {i === 0 && <span className="muted small">tavsiya</span>}
          </label>
        </li>
      ))}
    </ul>
  );
}

// --- Bitta kalit kartochkasi ---
function KeyCard({ apiKey, provider, now, botRunning, reload }) {
  const notify = useToast();
  const [enabled, setEnabled] = useState(apiKey.enabled);
  const [toggling, setToggling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(apiKey.label ?? "");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const providerTitle = provider?.title ?? apiKey.provider;

  useEffect(() => setEnabled(apiKey.enabled), [apiKey.enabled]);
  const models = apiKey.models.map((m) => m.model);
  const view = { ...apiKey, enabled };

  async function run(action, fail) {
    try {
      await action();
      reload();
      return true;
    } catch (e) {
      notify(e.message, "critical");
      fail?.();
      return false;
    }
  }

  async function toggle(value) {
    setToggling(true);
    setEnabled(value);
    await run(() => patch(`/api/ai/keys/${apiKey.id}`, { enabled: value }), () => setEnabled(!value));
    setToggling(false);
  }

  async function saveLabel(event) {
    event.preventDefault();
    setSaving(true);
    if (await run(() => patch(`/api/ai/keys/${apiKey.id}`, { label: label.trim() || null }))) {
      notify("Saqlandi");
      setEditing(false);
    }
    setSaving(false);
  }

  async function removeModel(model) {
    setRemoving(model);
    await run(() => patch(`/api/ai/keys/${apiKey.id}`, { models: models.filter((m) => m !== model) }));
    setRemoving(null);
  }

  async function remove() {
    setDeleting(true);
    if (await run(() => del(`/api/ai/keys/${apiKey.id}`))) notify(apiKey.fromEnv ? "Ro'yxatdan olib tashlandi" : "Kalit o'chirildi");
    else {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <article className={`key-card ${enabled ? "" : "is-off"}`}>
      <div className="key-head">
        <div className="key-title">
          {/* Sarlavha — provayder (ikkala .env kaliti ham «.env kaliti» deb atalgani uchun nomi ostida, kichikroq) */}
          <h3>{providerTitle}</h3>
          {editing ? (
            <form className="label-edit" onSubmit={saveLabel}>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                aria-label="Kalit nomi"
                placeholder="Masalan: Asosiy kalit"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setLabel(apiKey.label ?? "");
                    setEditing(false);
                  }
                }}
              />
              <Button type="submit" variant="primary" busy={saving}>
                Saqlash
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setLabel(apiKey.label ?? "");
                  setEditing(false);
                }}
              >
                Bekor
              </Button>
            </form>
          ) : (
            <div className="key-label">
              <span>{apiKey.label || "Nomsiz kalit"}</span>
              <button type="button" className="link-button" onClick={() => setEditing(true)}>
                nomini o'zgartirish
              </button>
            </div>
          )}
          <div className="key-meta">
            <code title="Kalitning faqat oxirgi 4 belgisi">{apiKey.keyHint}</code>
            {apiKey.fromEnv && (
              <Badge tone="info" icon="⚙" title="Kalit .env faylidan olinadi (GEMINI_API_KEY / ONEPRO_API_KEY / ANTHROPIC_API_KEY)">
                .env dan
              </Badge>
            )}
            {provider?.free === false && <Badge tone="warning">pullik</Badge>}
            {provider?.limitNote && <Badge tone="info">{provider.limitNote}</Badge>}
          </div>
        </div>
        <Toggle
          checked={enabled}
          onChange={toggle}
          busy={toggling}
          label={enabled ? "Yoqilgan" : "O'chirilgan"}
          ariaLabel={`Kalitni ishlatish: ${providerTitle}, ${apiKey.label || "Nomsiz kalit"} ${apiKey.keyHint ?? ""}`.trim()}
        />
      </div>

      {apiKey.problem && (
        <div className="notice tone-critical" role="alert">
          <span aria-hidden="true">!</span> {apiKey.problem}
        </div>
      )}

      <ul className="model-list" aria-label="Modellar">
        {sortSlots(apiKey.models, now).map((slot) => (
          <ModelRow
            key={slot.model}
            apiKey={view}
            slot={slot}
            now={now}
            botRunning={botRunning}
            canRemove={models.length > 1}
            removing={removing === slot.model}
            onRemove={() => removeModel(slot.model)}
            reload={reload}
          />
        ))}
      </ul>
      {models.length === 1 && <p className="muted small">Bitta model qolgan: kalit kerak bo'lmasa, uni butunlay o'chiring.</p>}

      {picking ? (
        <ModelPicker
          apiKey={apiKey}
          onCancel={() => setPicking(false)}
          onDone={() => {
            setPicking(false);
            reload();
          }}
        />
      ) : (
        <div className="key-foot">
          <Button onClick={() => setPicking(true)} disabled={Boolean(apiKey.problem)}>
            + Model qo'shish
          </Button>
          {confirming ? (
            <div className="confirm" role="group" aria-label="O'chirishni tasdiqlash">
              <span className="small">
                {apiKey.fromEnv
                  ? "Ro'yxatdan olib tashlansinmi? .env dagi kalit o'zi qoladi, lekin ro'yxatga qayta qo'shilmaydi."
                  : "Kalit o'chirilsinmi? Keyin ishlatish uchun uni qaytadan qo'shish kerak bo'ladi."}
              </span>
              <Button variant="danger" onClick={remove} busy={deleting}>
                {apiKey.fromEnv ? "Ha, olib tashlash" : "Ha, o'chirish"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
                Yo'q
              </Button>
            </div>
          ) : (
            <Button variant="ghost" className="danger-text" onClick={() => setConfirming(true)}>
              {apiKey.fromEnv ? "Ro'yxatdan olib tashlash" : "Kalitni o'chirish"}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

// --- Yangi kalit: tekshirish → modellarni tanlash → saqlash ---
function AddKeyForm({ providers, onAdded }) {
  const notify = useToast();
  const [provider, setProvider] = useState(providers[0]?.id ?? "gemini");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [models, setModels] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const info = providers.find((p) => p.id === provider);

  // Kalit faqat shu forma holatida; saqlangach yoki bekor qilinganda o'chiriladi
  const reset = () => {
    setKey("");
    setLabel("");
    setModels(null);
    setSelected([]);
    setError(null);
  };

  async function check() {
    setBusy("check");
    setError(null);
    try {
      const { models: list } = await post("/api/ai/models", { provider, key: key.trim() });
      if (!list.length) setError("Kalit ishlayapti, lekin unda e'lon tahlili uchun mos model topilmadi.");
      setModels(list);
      setSelected(list.slice(0, 1));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await post("/api/ai/keys", { provider, key: key.trim(), label: label.trim() || null, models: selected });
      notify("Kalit qo'shildi — bot uni 15 soniya ichida ishlata boshlaydi");
      reset();
      onAdded();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!key.trim() || busy) return;
    if (models?.length) {
      if (selected.length) save();
    } else check();
  }

  return (
    <form className="add-key" onSubmit={submit} autoComplete="off">
      <div className="add-key-row">
        <Field label="Provayder">
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModels(null);
              setSelected([]);
              setError(null);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {providerOptionLabel(p)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="API kalit" className="field-grow">
          <input
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setModels(null);
              setSelected([]);
              setError(null);
            }}
            autoComplete="off"
            spellCheck="false"
            autoCapitalize="off"
            placeholder={info?.keyPlaceholder ?? "API kalit"}
            aria-invalid={error ? true : undefined}
            aria-describedby="add-key-help"
          />
        </Field>
        {info?.keyUrl && (
          <ExternalLink href={info.keyUrl} className="key-link">
            Kalit olish
          </ExternalLink>
        )}
      </div>
      <p className="muted small" id="add-key-help">
        {info?.keyHelp ?? "Kalitni to'liq nusxalab qo'ying. «Tekshirish» limitdan so'rov sarflamaydi."}
      </p>

      {models?.length > 0 && (
        <div className="add-key-models">
          <p className="small">
            Kalit ishlayapti. Ishlatiladigan modellarni tanlang — har bir model alohida ulanish, o'z limiti bilan:
          </p>
          <ModelChecklist models={models} selected={selected} onChange={setSelected} />
          <Field label="Nomi (ixtiyoriy)" className="field-grow">
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Masalan: Asosiy kalit" />
          </Field>
        </div>
      )}

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        {models?.length ? (
          <Button type="submit" variant="primary" busy={busy === "save"} disabled={!selected.length}>
            Saqlash
          </Button>
        ) : (
          <Button type="submit" variant="primary" busy={busy === "check"} disabled={!key.trim()}>
            Tekshirish
          </Button>
        )}
        {(key || models) && (
          <Button variant="ghost" onClick={reset} disabled={Boolean(busy)}>
            Bekor qilish
          </Button>
        )}
      </div>
    </form>
  );
}

function Summary({ totals, bot, parallel }) {
  const botMeta = bot ? processStatus(bot.status) : null;
  return (
    <div className="tiles tiles-4">
      <div className="tile">
        <div className="tile-label">Faol ulanishlar</div>
        <div className="tile-value">
          {formatNumber(totals.active)}
          <span className="tile-unit">/ {formatNumber(totals.connections)}</span>
        </div>
        <div className="tile-sub">{totals.working ? `${formatNumber(totals.working)} tasi hozir ishlayapti` : "yoqilgan kalit × model"}</div>
      </div>
      <div className="tile">
        <div className="tile-label">Dam olyapti</div>
        <div className="tile-value">{formatNumber(totals.resting)}</div>
        <div className="tile-sub">
          {totals.soonest ? `eng yaqini ${formatTime(totals.soonest)} gacha` : "hech biri limitda emas"}
          {totals.failing ? ` · ${formatNumber(totals.failing)} tasi xato` : ""}
          {totals.problems ? ` · 📌 ${formatNumber(totals.problems)} tasi muammoli` : ""}
        </div>
      </div>
      <div className="tile">
        <div className="tile-label">Bugun</div>
        <div className="tile-value">
          {formatNumber(totals.requests)}
          <span className="tile-unit">so'rov</span>
        </div>
        <div className="tile-sub">
          {formatNumber(totals.posts)} e'lon tahlil qilindi{totals.errors ? ` · ${formatNumber(totals.errors)} xato` : ""}
        </div>
      </div>
      <div className="tile">
        <div className="tile-label">Bot</div>
        <div className="tile-value tile-badge">
          {botMeta ? (
            <Badge tone={botMeta.tone} icon={botMeta.icon}>
              {botMeta.label}
            </Badge>
          ) : (
            "—"
          )}
        </div>
        <div className="tile-sub">bir vaqtda ko'pi bilan {formatNumber(parallel)} ta so'rov</div>
      </div>
    </div>
  );
}

// «Qanday ishlaydi» — standart yopiq (kalitlar tepaga chiqadi). Ochiq/yopiqligi shu brauzerda eslab qolinadi.
const HELP_KEY = "yuk-admin:ai-help-open";
function readHelpOpen() {
  try {
    return localStorage.getItem(HELP_KEY) === "1";
  } catch {
    return false; // maxfiy oyna yoki saqlash taqiqlangan — shunchaki yopiq
  }
}

function HowItWorks({ children }) {
  const [open, setOpen] = useState(readHelpOpen);
  function toggle(event) {
    const next = event.currentTarget.open;
    setOpen(next);
    try {
      localStorage.setItem(HELP_KEY, next ? "1" : "0");
    } catch {
      // eslab qolinmasa ham sahifa ishlayveradi
    }
  }
  return (
    <details className="card help-card" open={open} onToggle={toggle}>
      <summary>
        <h2>Qanday ishlaydi</h2>
        <span className="muted small help-hint">ochish uchun bosing</span>
      </summary>
      {children}
    </details>
  );
}

export function AiPage() {
  useTitle("AI kalitlari");
  const now = useNow(10_000);
  const overview = useOverview();
  const state = useApi(() => get("/api/ai"), [], { interval: 10_000 });
  const bot = overview.data?.processes?.find((p) => p.name === "bot") ?? null;
  const botRunning = bot?.status === "running" || bot?.status === "external";

  return (
    <>
      <PageHeader
        title="AI kalitlari"
        subtitle="E'lonlarni tahlil qiladigan AI ulanishlari: kalit + model"
        actions={
          <Button onClick={state.reload} busy={state.loading && state.data != null}>
            Yangilash
          </Button>
        }
      />
      {state.data == null && state.error?.status === 404 ? (
        <ErrorBox error={{ message: OLD_SERVER }} onRetry={state.reload} />
      ) : (
        <Async state={state}>
          {(data) => {
            const providers = data.providers ?? [];
            const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
            const totals = aiTotals(data.keys, { now, botRunning });
            return (
              <div className="stack">
                <Summary totals={totals} bot={bot} parallel={data.parallel} />
                {bot && !botRunning && (
                  <div className="notice tone-warning" role="status">
                    <span aria-hidden="true">!</span> Bot ishlamayapti — ulanishlar hozir hech narsa tahlil qilmaydi. Jarayonlar sahifasidan yoqing.
                  </div>
                )}

                <HowItWorks>
                  <ul className="plain-list">
                    <li>
                      <strong>Ulanish = API kalit + model.</strong> Gemini'da har bir modelning o'z kunlik bepul limiti bor, shuning uchun bitta kalitga 2–3 model
                      qo'shsangiz, kuniga 2–3 barobar ko'p e'lon tahlil qilinadi.
                    </li>
                    <li>
                      Bot yoqilgan hamma ulanishni <strong>parallel</strong> ishlatadi: har biri o'z e'lonlar guruhini oladi. Biri limitga tushsa (429), faqat
                      o'sha dam oladi; qolganlari ishlashda davom etadi. Kunlik limitda bot har 30 daqiqada bitta so'rov bilan tekshiradi — limit qaytishi
                      bilan yana ishlata boshlaydi (1pro'da limit 00:00 da yangilanadi).
                    </li>
                    <li>
                      Model <strong>xato qaytarsa</strong>, unga berilgan e'lonlar darhol navbatga qaytadi va ishlayotgan boshqa model ularni oladi. Bitta e'lon
                      3 ta ulanishda xato bersa, «xato» deb yopiladi (Navbat sahifasidan qayta yuborish mumkin).
                    </li>
                    <li>
                      Tez-tez xato beradigan model (24 soatda 4 ta yoki oxirgi 10 so'rovdan 3 tasi) avtomatik <strong>📌 Muammoli</strong> deb belgilanadi:
                      oxirgi navbatda ishlatiladi va har xatodan keyin kamida 15 daqiqa dam oladi. «Sinash» muvaffaqiyatli bo'lsa, dam olish darhol bekor
                      bo'ladi.
                    </li>
                    <li>Bot ro'yxatni har 15 soniyada qayta o'qiydi — o'zgarishdan keyin qayta ishga tushirish shart emas. Telegram'ga yuborish esa ketma-ket qoladi.</li>
                    <li>Har xil model har xil aniqlikda ishlaydi — yangi modelni qo'shgach «Sinash» bilan tekshiring.</li>
                  </ul>
                </HowItWorks>

                {data.keys.length === 0 ? (
                  <Empty title="Hali AI ulanishi yo'q">Pastdagi formadan Gemini kalitini qo'shing — u bepul. Bot kalitsiz e'lonlarni tahlil qila olmaydi.</Empty>
                ) : (
                  <div className="key-list">
                    {data.keys.map((apiKey) => (
                      <KeyCard key={apiKey.id} apiKey={apiKey} provider={byId[apiKey.provider]} now={now} botRunning={botRunning} reload={state.reload} />
                    ))}
                  </div>
                )}
                <p className="muted small">«Sinash» — bitta haqiqiy so'rov (kunlik bepul limitdan 1 tasi sarflanadi). «Model qo'shish» va «Tekshirish» limit sarflamaydi.</p>

                <Card title="Kalit qo'shish">
                  <AddKeyForm providers={providers} onAdded={state.reload} />
                  <div className="notice tone-warning">
                    <span aria-hidden="true">!</span>
                    <span>
                      Limitni chetlab o'tish uchun boshqa-boshqa Google akkauntlaridan ko'p bepul kalit olish Google shartlariga zid bo'lishi mumkin — akkaunt
                      bloklanishi mumkin. Xavfsiz yo'l: bitta kalitda bir nechta model; kerak bo'lsa pullik tarif.
                    </span>
                  </div>
                  <p className="muted small">
                    Kalitlar bazada shifrlangan (data/secret.key). Ekranda faqat oxirgi 4 belgi ko'rinadi. secret.key o'chsa, kalitlarni qayta qo'shish kerak.
                  </p>
                </Card>
              </div>
            );
          }}
        </Async>
      )}
    </>
  );
}
