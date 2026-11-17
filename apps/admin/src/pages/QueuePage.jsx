// Navbat: GET /api/posts — collector yozgan e'lonlar va ularning holati. Xato bo'lganini qayta navbatga qo'yish mumkin.
import { useState } from "react";
import { post as apiPost, get } from "../api.js";
import { formatNumber } from "../format.js";
import { useApi, useDebounced, useNow } from "../hooks.js";
import { useOverview } from "../overview.js";
import { POST_TABS, postNote, postStatus, tabCounts } from "../status.js";
import { Async, Badge, Button, Empty, ExpandRow, ExternalLink, PageHeader, Pager, TimeAgo, useTitle, useToast } from "../ui.jsx";

const LIMIT = 50;

const EMPTY_TEXT = {
  "": "Collector hali birorta e'lon yozmagan. Jarayonlar sahifasida collector ishlayotganini tekshiring.",
  new: "Navbat bo'sh — hamma e'lonlar tahlil qilingan.",
  done: "Hali tahlil qilingan e'lon yo'q.",
  failed: "Xato bilan tugagan e'lon yo'q.",
  skipped: "O'tkazib yuborilgan e'lon yo'q.",
  duplicate: "Takror e'lon yo'q.",
};

const TAG_TONE = { good: "is-good", critical: "is-critical", serious: "is-critical", info: "is-info" };

// Yopiq: holat belgisi, e'lon matnining boshi, manba · #id, o'ngda — qachon. Ochiq: to'liq matn, izoh, havola
function PostRow({ item, now, onChanged }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const meta = postStatus(item.status);
  const note = postNote(item);
  const source = item.fromShipper ? `📦 Yuk beruvchi · ${item.source.slice(8)}` : item.source;

  async function retry() {
    setBusy(true);
    try {
      const { retried } = await apiPost(`/api/posts/${item.id}/retry`);
      notify(retried ? "Navbatga qaytdi" : "E'lon allaqachon navbatda yoki xato emas");
      onChanged();
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ExpandRow
      lead={<span title={meta.label}>{meta.icon}</span>}
      title={
        <span className="post-title">
          {item.media ? (item.media === "voice" ? "🎤 " : "📹 ") : ""}
          {item.text.replace(/\s+/g, " ").trim() || "—"}
        </span>
      }
      sub={`${source} · #${item.id}`}
      side={
        <>
          <TimeAgo ts={item.postedAt} now={now} />
          <span className={`mini-tag ${TAG_TONE[meta.tone] ?? ""}`}>{meta.label}</span>
        </>
      }
    >
      <div className="row-tags">
        <Badge tone={meta.tone} icon={meta.icon}>
          {meta.label}
        </Badge>
        {/* «📦 Yuk berish»: guruhdan emas — yuk beruvchining o'zi (botga yozdi yoki formadan). source = shipper:<chat id> */}
        {item.fromShipper && (
          <Badge tone="good" icon="✅" title="Yuk egasining o'zi yubordi — AI'ga bormaydi, darhol mos haydovchilarga">
            {item.via === "web" ? "Formadan" : "Botga yozdi"}
          </Badge>
        )}
        {item.media && (
          <Badge tone="info" icon={item.media === "voice" ? "🎤" : "📹"} title="Collector matnga o'girdi (Telegram Premium yoki Gemini)">
            {item.media === "voice" ? "Ovozli xabar" : "Dumaloq video"}
          </Badge>
        )}
        {item.parsedBy === "rules" && (
          <Badge tone="info" icon="⚡">
            AI'siz
          </Badge>
        )}
        {/* Telefon ham, lichka ham yo'q — bot yopdi, hech kimga yubormadi (apps/bot pipeline.js NO_CONTACT) */}
        {item.error?.startsWith("Aloqasiz") && (
          <Badge tone="neutral" icon="📵" title={item.error}>
            Aloqasiz
          </Badge>
        )}
      </div>
      <p className="post-text">{item.text}</p>
      {note && <p className={note.tone === "critical" ? "inline-error" : "post-note"}>{note.text}</p>}
      <div className="post-foot">
        {item.link && <ExternalLink href={item.link}>Asl e'lon</ExternalLink>}
        <span className="muted small">{source}</span>
        {item.doneAt && (
          <span className="muted small">
            Tahlil: <TimeAgo ts={item.doneAt} now={now} />
          </span>
        )}
        {item.status === "failed" && (
          <Button onClick={retry} busy={busy} className="post-retry">
            Qayta urinish
          </Button>
        )}
      </div>
    </ExpandRow>
  );
}

export function QueuePage() {
  useTitle("Navbat");
  const now = useNow(30_000);
  const overview = useOverview();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 400);
  const key = JSON.stringify({ status, q: query });
  const [page, setPage] = useState({ key, offset: 0 });
  const offset = page.key === key ? page.offset : 0;

  const state = useApi(() => get("/api/posts", { status, q: query, limit: LIMIT, offset }), [key, offset], {
    live: offset === 0 ? ["posts"] : null, // faqat birinchi sahifada — keyingisi siljimasin
    liveGapMs: 2000,
  });
  const counts = tabCounts(overview.data?.metrics?.posts);
  const tabs = POST_TABS.map((t) => ({ ...t, count: overview.data ? counts[t.id] : null }));

  const notify = useToast();
  const [retrying, setRetrying] = useState(false);

  const refresh = () => {
    state.reload();
    overview.reload();
  };

  async function retryAll() {
    setRetrying(true);
    try {
      const { retried } = await apiPost("/api/posts/retry-failed");
      notify(`${formatNumber(retried)} ta e'lon navbatga qaytdi`);
      refresh();
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Navbat"
        subtitle="Collector guruhlardan yozgan e'lonlar va ularning tahlil holati"
        actions={
          <Button onClick={refresh} busy={state.loading && state.data != null}>
            Yangilash
          </Button>
        }
      />

      <div className="list-toolbar queue-toolbar">
        <input type="search" className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="E'lon matnidan qidirish…" aria-label="E'lonlardan qidirish" />
        <div className="chips" role="tablist" aria-label="E'lon holati">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === status}
              className={`chip ${t.id === status ? "is-active" : ""}`}
              onClick={() => setStatus(t.id)}
            >
              {t.label}
              {t.count != null && <span className="chip-count">{formatNumber(t.count)}</span>}
            </button>
          ))}
        </div>
        {status === "failed" && counts.failed > 0 && (
          <Button className="filters-reset" onClick={retryAll} busy={retrying}>
            Hammasini qayta navbatga
          </Button>
        )}
      </div>

      <Async state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty title={query ? "Hech narsa topilmadi" : "E'lonlar yo'q"}>{query ? "Boshqa so'z bilan qidirib ko'ring." : EMPTY_TEXT[status]}</Empty>
          ) : (
            <>
              <p className="muted small list-count">{formatNumber(data.total)} ta e'lon</p>
              <ul className="rows">
                {data.items.map((item) => (
                  <PostRow key={item.id} item={item} now={now} onChanged={refresh} />
                ))}
              </ul>
              <Pager offset={offset} limit={LIMIT} total={data.total} onChange={(o) => setPage({ key, offset: o })} />
            </>
          )
        }
      </Async>
    </>
  );
}
