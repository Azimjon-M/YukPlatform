// Manbalar: collector kuzatadigan Telegram guruhlari. Qo'shish, yoqish/o'chirish, olib tashlash; 24 soatlik statistika.
// O'zgarish collector'ning keyingi aylanishida kuchga kiradi.
// Foydalanuvchilar ham qo'shadi (bot «➕ Guruh qo'shish», 2026-11-10): kim qo'shgani, tekshiruv va 24 soatlik sinov holati.
import { useState } from "react";
import { del, get, patch, post } from "../api.js";
import { formatDateTime, formatNumber, sourceCheckView } from "../format.js";
import { useApi, useNow } from "../hooks.js";
import { Async, Badge, Button, Card, Empty, ExternalLink, Field, PageHeader, TimeAgo, Toggle, useTitle, useToast } from "../ui.jsx";

const NOTE = "O'zgarish collector'da bir necha soniyada kuchga kiradi.";
// API manzili («@guruh» → /api/sources/%40guruh) va guruhning Telegram havolasi (raqamli id'da havola yo'q)
const sourcePath = (name) => `/api/sources/${encodeURIComponent(name)}`;
const sourceLink = (name) => (name.startsWith("@") ? `https://t.me/${name.slice(1)}` : null);
// 20000 → "20 s", 240000 → "4 daq" (collector live.js durationText bilan bir xil)
const durationText = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} daq`);

// Collector navbati (2026-11-09): har guruh faolligiga qarab so'raladi — ko'p yozadigani tez-tez (20 s gacha),
// jimi siyrak (10 daqiqagacha); collector oralig'ini bazaga yozadi (pollMs). watch "tops" — guruhning oxirgi xabar
// raqami boshqalari bilan birga bitta so'rovda har 15 s tekshiriladi va faqat yangisi bo'lsa o'qiladi (a'zo bo'lingan
// guruhlar). «Jonli» — Telegram yangi xabarni o'zi yuborgan (24 soatda kamida bitta); katta guruhlarda ko'pincha yubormaydi.
function ModeBadge({ joined, live, watch, pollMs }) {
  if (joined && live > 0) {
    return (
      <Badge tone="good" icon="⚡" title="Akkaunt guruhga a'zo va Telegram yangi xabarni o'zi yuboryapti (~1 s). Tushib qolgani bo'lsa, «yangisi bormi» tekshiruvi topadi">
        Jonli
      </Badge>
    );
  }
  if (watch === "tops") {
    return (
      <Badge tone="good" icon="🔔" title="Har 15 soniyada bitta umumiy so'rov bilan guruhda yangi xabar bormi — tekshiriladi va bo'lsa darhol o'qiladi">
        Yangisi bo'lsa darhol
      </Badge>
    );
  }
  if (pollMs) {
    return (
      <Badge icon="🔄" title="Collector bu guruhni o'z navbati bilan so'raydi: qancha ko'p yozsa, shuncha tez-tez (20 s … 10 daqiqa). Oraliq har 5 daqiqada qayta hisoblanadi">
        Har {durationText(pollMs)}
      </Badge>
    );
  }
  return null; // collector hali tekshirmagan (yoki eski versiyada)
}

// A'zo bo'lish: navbatga qo'yish va holati. Collector 5 daqiqada bittadan, 24 soatda ko'pi bilan 15 ta guruhga qo'shiladi
// (birdaniga ko'p qo'shilish Telegram'ga spam-akkauntdek ko'rinadi), qo'shilgach bildirishnomasini o'chiradi.
const JOIN_NOTE = "Collector 5 daqiqada bittadan, kuniga ko'pi bilan 15 ta guruhga qo'shiladi va bildirishnomasini o'chiradi.";

function JoinControl({ source, onChanged }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const { joined, joinState, joinError } = source;

  async function run(action) {
    setBusy(true);
    try {
      if (action === "join") {
        const { state } = await post(`${sourcePath(source.name)}/join`);
        notify(
          state === "wanted" ? `${source.name} navbatga qo'yildi. ${JOIN_NOTE}` : state === "joined" ? "Akkaunt bu guruhga allaqachon a'zo" : "Bu guruhga so'rov allaqachon yuborilgan",
          state === "wanted" ? "good" : "neutral",
        );
      } else {
        await del(`${sourcePath(source.name)}/join`);
        notify(`${source.name} navbatdan olindi`);
      }
      onChanged();
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }

  if (joined) return null; // a'zo — nomi yonida «a'zo» yozuvi bor
  if (joinState === "requested") {
    return (
      <Badge icon="📨" title="Guruhda a'zolikni admin tasdiqlaydi: so'rov yuborildi. Tasdiqlansa, 10 daqiqa ichida «a'zo» bo'lib ko'rinadi">
        So'rov yuborildi
      </Badge>
    );
  }
  if (joinState === "wanted") {
    return (
      <div className="confirm">
        <Badge icon="⏳" title={JOIN_NOTE}>
          A'zo bo'lish navbatida
        </Badge>
        <Button variant="ghost" onClick={() => run("cancel")} busy={busy}>
          Bekor qilish
        </Button>
      </div>
    );
  }
  return (
    <div className="confirm">
      {joinState === "error" && (
        <Badge tone="critical" icon="✖" title={joinError ?? undefined}>
          A'zo bo'lib bo'lmadi
        </Badge>
      )}
      <Button onClick={() => run("join")} busy={busy} title={JOIN_NOTE}>
        {joinState === "error" ? "Qayta urinish" : "A'zo bo'lish"}
      </Button>
    </div>
  );
}

// «👤 Qo'shgan: Ali (@ali) · 10.11 14:30» — bot orqali qo'shgan foydalanuvchi
function AddedBy({ source }) {
  const user = source.addedByUser;
  const who = [user.name, user.username ? `@${user.username}` : null].filter(Boolean).join(" ") || `id ${user.chatId}`;
  return (
    <p className="muted small">
      👤 Foydalanuvchi qo'shgan: {who} · {formatDateTime(source.createdAt)}
    </p>
  );
}

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
  const check = sourceCheckView(source);
  return (
    <li className={`source-row ${enabled ? "" : "is-off"}`}>
      <div className="source-main">
        <div className="source-name">
          {link ? <ExternalLink href={link}>{source.name}</ExternalLink> : <strong>{source.name}</strong>}
          {check && (
            <Badge tone={check.tone} icon={check.icon} title={check.title}>
              {check.label}
            </Badge>
          )}
          {enabled ? <ModeBadge joined={source.joined} live={s.live} watch={source.watch} pollMs={source.pollMs} /> : source.checkState !== "probe" && <Badge icon="■">O'chirilgan</Badge>}
          {enabled && source.joined && <span className="muted small">a'zo</span>}
        </div>
        {source.title && <p className="small">{source.title}{source.members ? <span className="muted"> · {formatNumber(source.members)} a'zo</span> : null}</p>}
        {source.addedByUser && <AddedBy source={source} />}
        {source.note && !source.addedBy && <p className="muted small">{source.note}</p>}
        {source.checkNote && <p className={`small ${source.checkState === "failed" ? "inline-error" : "muted"}`}>Tekshiruv: {source.checkNote}</p>}
        {source.joinState === "error" && source.joinError && !source.joined && <p className="inline-error small">A'zo bo'lib bo'lmadi: {source.joinError}</p>}
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
          <div>
            <dt title="Guruhga yozilganidan navbatga tushguncha, o'rtacha">Kechikish</dt>
            <dd>
              {s.delaySec == null ? "—" : `~${formatNumber(s.delaySec)} s`}
              {s.live > 0 && <span className="muted small"> (jonli: {formatNumber(s.live)})</span>}
            </dd>
          </div>
        </dl>
      </div>
      <div className="source-controls">
        <Toggle checked={enabled} onChange={toggle} busy={busy} label={enabled ? "Kuzatilyapti" : "O'chiq"} />
        {enabled && source.joinState !== undefined && <JoinControl source={source} onChanged={onChanged} />}
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
  const notify = useToast();
  const now = useNow(30_000);
  const state = useApi(() => get("/api/sources"), [], { live: ["sources", "posts"], liveGapMs: 5000 });
  const items = state.data?.items ?? [];
  const [joining, setJoining] = useState(false);
  // «Hammasiga a'zo bo'lish»: kuzatilayotgan, a'zo bo'lmagan va hali navbatda / so'rovda bo'lmaganlar.
  // joinState kelmasa — server eski versiyada (a'zo bo'lish navbatini bilmaydi)
  // Sinovdagi foydalanuvchi manbasi kirmaydi (kunlik 15 talik a'zolik limiti sinovdan o'tmaganga ketmasin; server ham shunday)
  const joinable = items.filter(
    (s) => s.enabled && s.joined !== true && s.joinState !== undefined && !["wanted", "requested", "joined"].includes(s.joinState) && !["probe", "trial"].includes(s.checkState),
  );
  const queued = items.filter((s) => s.joinState === "wanted").length;
  const byUsers = items.filter((s) => s.addedBy != null);
  const checking = byUsers.filter((s) => ["probe", "trial"].includes(s.checkState)).length;

  async function joinAll() {
    setJoining(true);
    try {
      const { queued: count } = await post("/api/sources/join-all");
      notify(`${formatNumber(count)} ta guruh navbatga qo'yildi. ${JOIN_NOTE}`, "good");
      state.reload();
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setJoining(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Manbalar"
        subtitle={
          state.data
            ? `${formatNumber(items.length)} ta guruh, ${formatNumber(items.filter((s) => s.enabled).length)} tasi kuzatilyapti, ${formatNumber(items.filter((s) => s.joined).length)} tasiga a'zo` +
              (queued ? ` · a'zo bo'lish navbatida: ${formatNumber(queued)}` : "") +
              (byUsers.length ? ` · foydalanuvchilar qo'shgan: ${formatNumber(byUsers.length)}${checking ? ` (tekshiruvda ${formatNumber(checking)})` : ""}` : "")
            : "Collector e'lon o'qiydigan Telegram guruhlari"
        }
        actions={
          <>
            {joinable.length > 0 && (
              <Button onClick={joinAll} busy={joining} title={JOIN_NOTE}>
                Hammasiga a'zo bo'lish ({formatNumber(joinable.length)})
              </Button>
            )}
            <Button onClick={state.reload} busy={state.loading && state.data != null}>
              Yangilash
            </Button>
          </>
        }
      />
      <div className="stack">
        <p className="muted small">
          🔄 Har 25 s — collector guruhni o'z navbati bilan so'raydi: ko'p yozadigan guruh tez-tez (20 s gacha), jim guruh siyrak (10 daqiqagacha);
          so'rovlar soni bir xil qoladi, faqat kerakli joyga taqsimlanadi. 🔔 Yangisi bo'lsa darhol — collector akkaunti guruhga a'zo: hamma
          shunday guruhlarda yangi xabar bormi, har 15 soniyada bitta so'rov bilan tekshiriladi. ⚡ Jonli — Telegram yangi xabarni o'zi ham
          yuboryapti (~1 s). «A'zo bo'lish» — collector akkauntini guruhga qo'shadi: 5 daqiqada bittadan, kuniga ko'pi bilan 15 ta (birdaniga ko'p
          qo'shilish Telegram'ga spam-akkauntdek ko'rinadi), bildirishnomasi o'chiriladi; a'zolikni admin tasdiqlaydigan guruhga so'rov yuboriladi.
        </p>
        <p className="muted small">
          👤 Foydalanuvchilar ham qo'shadi (raqamini ulashganlar, botdagi «➕ Guruh qo'shish»): 🔎 collector oxirgi 50 ta xabarini ko'radi —
          yuk e'loni kam bo'lsa, darhol rad etiladi; 🧪 keyin 24 soat sinov — kamida 5 ta yuk e'loni chiqsa, doimiy qoladi, chiqmasa — o'chiriladi.
          Natijani bot qo'shgan odamga o'zi yozadi.
        </p>
        <AddSource onAdded={state.reload} />
        <Async state={state}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty title="Manbalar hali yo'q">
                <p>
                  Manba — yuk e'lonlari yoziladigan ochiq Telegram guruhi yoki kanali (masalan, @yuk_markazi). Collector ularni muntazam o'qib, yangi
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
