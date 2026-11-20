// Manbalar: collector kuzatadigan Telegram guruhlari. Qo'shish, yoqish/o'chirish, olib tashlash; 24 soatlik statistika.
// O'zgarish collector'ning keyingi aylanishida kuchga kiradi.
// Foydalanuvchilar ham qo'shadi (bot «➕ Guruh qo'shish», 2026-11-10): kim qo'shgani, tekshiruv va 24 soatlik sinov holati.
import { useState } from "react";
import { foldText } from "@yuk/shared";
import { del, get, patch, post } from "../api.js";
import { formatDateTime, formatNumber, sourceCheckView } from "../format.js";
import { useApi, useNow } from "../hooks.js";
import { Async, Avatar, Badge, Button, Card, Empty, ExpandRow, ExternalLink, Field, PageHeader, TimeAgo, Toggle, avatarUrl, useTitle, useToast } from "../ui.jsx";
import { PrivateGroupPicker, TgAccountsCard, useTgAccounts } from "./TgAccounts.jsx";

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
    <Card title="➕ Manba qo'shish" collapsible hint="ochiq guruh yoki kanal: @nomi yoki t.me havola">
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
      <p className="muted small">
        {NOTE} Bu yerda — ochiq guruhlar. Yopiq guruh taklif havolasi (t.me/+...) ishlamaydi: yopiq guruhni unga a'zo akkaunt o'qiydi — pastdagi «Yopiq
        guruh qo'shish» dan tanlang.
      </p>
    </Card>
  );
}

// account — shu manbani o'qiydigan qo'shimcha akkauntning holati (/api/tg-accounts; asosiy akkaunt manbalarida — null)
function SourceRow({ source, account, now, onChanged }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(source.enabled);
  const [voice, setVoice] = useState(Boolean(source.voice));
  const [confirming, setConfirming] = useState(false);
  const open = source.name.startsWith("@");
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

  // Ovozli xabarlar (2026-11-20): ochiq guruhda faqat shu yoqilgan bo'lsa matnga o'giriladi — AI limiti behuda ketmasin
  async function toggleVoice(value) {
    setBusy(true);
    setVoice(value);
    try {
      await patch(sourcePath(source.name), { voice: value });
      notify(value ? "🎤 Bu guruhning ovozli xabarlari ham tekshiriladi" : "Bu guruhning ovozli xabarlari endi tekshirilmaydi");
      onChanged();
    } catch (e) {
      setVoice(!value);
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
  // Yopiq guruhning manzili yo'q: nomi asosiy, raqami yonida
  const titled = !link && source.title;
  const accountDown = source.account && account?.status !== "ok";
  const sub = [
    titled ? source.name : source.title,
    `24 s: ${formatNumber(s.posts)} e'lon · ${formatNumber(s.loads)} yuk`,
    open && voice ? "🎤" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ExpandRow
      className={enabled ? "" : "is-off"}
      lead={<Avatar src={avatarUrl("source", source.name)} text={sourceInitials(source)} badge={link ? null : "🔒"} className="avatar-sm" />}
      title={titled ? source.title : source.name}
      sub={sub}
      side={
        <>
          {s.lastPostAt ? <TimeAgo ts={s.lastPostAt} now={now} /> : <span>e'lon yo'q</span>}
          {accountDown ? (
            <span className="mini-tag is-critical">akkaunt ishlamayapti</span>
          ) : check ? (
            <span className={`mini-tag ${check.tone === "good" ? "is-good" : check.tone === "critical" ? "is-critical" : "is-info"}`}>{check.label}</span>
          ) : (
            <span className={`mini-tag ${enabled ? "is-good" : ""}`}>{enabled ? "kuzatilyapti" : "o'chiq"}</span>
          )}
        </>
      }
    >
      <div className="source-main">
        <div className="source-name">
          {link ? <ExternalLink href={link}>{source.name}</ExternalLink> : <strong>{titled ? source.title : source.name}</strong>}
          {titled && <span className="muted small">{source.name}</span>}
          {source.account && (
            <Badge tone={accountDown ? "critical" : "info"} icon="👤" title="Bu guruhni shu qo'shimcha Telegram akkaunti o'qiydi (u guruhga a'zo)">
              {source.account}
            </Badge>
          )}
          {check && (
            <Badge tone={check.tone} icon={check.icon} title={check.title}>
              {check.label}
            </Badge>
          )}
          {enabled ? <ModeBadge joined={source.joined} live={s.live} watch={source.watch} pollMs={source.pollMs} /> : source.checkState !== "probe" && <Badge icon="■">O'chirilgan</Badge>}
          {enabled && source.joined && <span className="muted small">a'zo</span>}
        </div>
        {source.title && !titled && <p className="small">{source.title}{source.members ? <span className="muted"> · {formatNumber(source.members)} a'zo</span> : null}</p>}
        {accountDown && (
          <p className="inline-error small">
            «{source.account}» akkaunti {account ? "ishlamayapti" : "topilmadi"} — bu guruh o'qilmayapti{account?.error ? `: ${account.error}` : ""}
          </p>
        )}
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
        {open ? (
          <Toggle checked={voice} onChange={toggleVoice} busy={busy} label={voice ? "🎤 Ovozli xabarlar tekshiriladi" : "🎤 Ovozli xabarlar: o'chiq"} />
        ) : (
          <span className="muted small">🎤 Yopiq guruh — ovozli xabarlar doim tekshiriladi</span>
        )}
        {enabled && source.joinState !== undefined && !source.account && <JoinControl source={source} onChanged={onChanged} />}
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
    </ExpandRow>
  );
}

// Rasm bo'lmasa — nomining bosh harflari («@TutGruz» → «TU», «Кукон ISUZU» → «КI»)
const sourceInitials = (source) => {
  const words = String(source.title || source.name.replace(/^@/, "")).replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
};

// Ro'yxat filtrlari
const SOURCE_FILTERS = [
  { id: "all", label: "Hammasi", test: () => true },
  { id: "on", label: "Kuzatilyapti", test: (s) => s.enabled },
  { id: "off", label: "O'chiq", test: (s) => !s.enabled },
  { id: "private", label: "Yopiq", test: (s) => !s.name.startsWith("@") },
  { id: "voice", label: "🎤 Ovoz tekshiriladi", test: (s) => s.name.startsWith("@") && s.voice },
  { id: "users", label: "Foydalanuvchilarniki", test: (s) => s.addedBy != null },
  { id: "quiet", label: "24 soatda jim", test: (s) => s.enabled && !s.stats?.posts },
];

const sourceMatches = (source, query) => {
  const q = foldText(query.trim()); // kirill/lotin farqisiz: «кукон» → «Кукон ISUZU», «qoqon» ham
  return !q || foldText(source.name).includes(q) || foldText(source.title).includes(q);
};

export function SourcesPage() {
  useTitle("Manbalar");
  const notify = useToast();
  const now = useNow(30_000);
  const state = useApi(() => get("/api/sources"), [], { live: ["sources", "posts"], liveGapMs: 5000 });
  const tg = useTgAccounts();
  const accountsByName = new Map((tg.data?.accounts ?? []).map((a) => [a.name, a]));
  const items = state.data?.items ?? [];
  const [joining, setJoining] = useState(false);
  // «Hammasiga a'zo bo'lish»: kuzatilayotgan, a'zo bo'lmagan va hali navbatda / so'rovda bo'lmaganlar.
  // joinState kelmasa — server eski versiyada (a'zo bo'lish navbatini bilmaydi)
  // Sinovdagi foydalanuvchi manbasi kirmaydi (kunlik 15 talik a'zolik limiti sinovdan o'tmaganga ketmasin; server ham shunday)
  const joinable = items.filter(
    (s) =>
      s.enabled &&
      !s.account &&
      s.joined !== true &&
      s.joinState !== undefined &&
      !["wanted", "requested", "joined"].includes(s.joinState) &&
      !["probe", "trial"].includes(s.checkState),
  );
  const queued = items.filter((s) => s.joinState === "wanted").length;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const counts = Object.fromEntries(SOURCE_FILTERS.map((f) => [f.id, items.filter(f.test).length]));
  const currentFilter = SOURCE_FILTERS.find((f) => f.id === filter) ?? SOURCE_FILTERS[0];
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
            ? `${formatNumber(items.length)} ta guruh · ${formatNumber(items.filter((s) => s.enabled).length)} tasi kuzatilyapti · ${formatNumber(items.filter((s) => s.joined).length)} tasiga a'zo` +
              (queued ? ` · navbatda: ${formatNumber(queued)}` : "") +
              (checking ? ` · tekshiruvda: ${formatNumber(checking)}` : "")
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
        <details className="howto">
          <summary>ℹ️ Collector guruhlarni qanday o'qiydi</summary>
          <p>
            🔄 Har 25 s — collector guruhni o'z navbati bilan so'raydi: ko'p yozadigan guruh tez-tez (20 s gacha), jim guruh siyrak (10 daqiqagacha);
            so'rovlar soni bir xil qoladi, faqat kerakli joyga taqsimlanadi. 🔔 Yangisi bo'lsa darhol — collector akkaunti guruhga a'zo: hamma
            shunday guruhlarda yangi xabar bormi, har 15 soniyada bitta so'rov bilan tekshiriladi. ⚡ Jonli — Telegram yangi xabarni o'zi ham
            yuboryapti (~1 s). «A'zo bo'lish» — collector akkauntini guruhga qo'shadi: 5 daqiqada bittadan, kuniga ko'pi bilan 15 ta (birdaniga ko'p
            qo'shilish Telegram'ga spam-akkauntdek ko'rinadi), bildirishnomasi o'chiriladi; a'zolikni admin tasdiqlaydigan guruhga so'rov yuboriladi.
          </p>
          <p>
            👤 Foydalanuvchilar ham qo'shadi (raqamini ulashganlar, botdagi «➕ Guruh qo'shish»): 🔎 collector oxirgi 50 ta xabarini ko'radi —
            yuk e'loni kam bo'lsa, darhol rad etiladi; 🧪 keyin 24 soat sinov — kamida 5 ta yuk e'loni chiqsa, doimiy qoladi, chiqmasa — o'chiriladi.
            Natijani bot qo'shgan odamga o'zi yozadi.
          </p>
        </details>
        <AddSource onAdded={state.reload} />
        <TgAccountsCard state={tg} now={now} />
        <PrivateGroupPicker
          state={tg}
          onAdded={() => {
            state.reload();
            tg.reload();
          }}
        />
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
              <>
                <div className="list-toolbar">
                  <input
                    type="search"
                    className="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Guruh nomi yoki @manzil"
                    aria-label="Manbalardan qidirish"
                  />
                  <div className="chips" role="tablist" aria-label="Filtr">
                    {SOURCE_FILTERS.map((f) => (
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
                <ul className="rows">
                  {data.items
                    .filter((source) => currentFilter.test(source) && sourceMatches(source, query))
                    .map((source) => (
                      <SourceRow
                        key={`${source.name}:${source.enabled}`}
                        source={source}
                        account={source.account ? (accountsByName.get(source.account) ?? null) : null}
                        now={now}
                        onChanged={state.reload}
                      />
                    ))}
                </ul>
              </>
            )
          }
        </Async>
      </div>
    </>
  );
}
