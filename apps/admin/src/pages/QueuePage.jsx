// Navbat: GET /api/posts — collector yozgan e'lonlar va ularning holati. Xato bo'lganini qayta navbatga qo'yish mumkin.
import { useState } from "react";
import { post as apiPost, get } from "../api.js";
import { formatNumber } from "../format.js";
import { useApi, useDebounced, useNow } from "../hooks.js";
import { useOverview } from "../overview.js";
import { POST_TABS, postNote, postStatus, tabCounts } from "../status.js";
import { Async, Badge, Button, Empty, ExternalLink, Field, PageHeader, Pager, Tabs, TimeAgo, useTitle, useToast } from "../ui.jsx";

const LIMIT = 50;
const LONG_TEXT = 220;

const EMPTY_TEXT = {
  "": "Collector hali birorta e'lon yozmagan. Jarayonlar sahifasida collector ishlayotganini tekshiring.",
  new: "Navbat bo'sh — hamma e'lonlar tahlil qilingan.",
  done: "Hali tahlil qilingan e'lon yo'q.",
  failed: "Xato bilan tugagan e'lon yo'q.",
  skipped: "O'tkazib yuborilgan e'lon yo'q.",
  duplicate: "Takror e'lon yo'q.",
};

function PostCard({ item, now, onChanged }) {
  const notify = useToast();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const meta = postStatus(item.status);
  const note = postNote(item);
  const long = item.text.length > LONG_TEXT || item.text.split("\n").length > 3;

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
    <article className="post-card">
      <div className="post-head">
        <Badge tone={meta.tone} icon={meta.icon}>
          {meta.label}
        </Badge>
        <span className="post-source">{item.source}</span>
        {item.parsedBy === "rules" && (
          <Badge tone="info" icon="⚡">
            AI'siz
          </Badge>
        )}
        <span className="muted small">#{item.id}</span>
        <span className="muted small post-time">
          <TimeAgo ts={item.postedAt} now={now} />
        </span>
      </div>

      <p className={`post-text ${expanded ? "" : "is-clamped"}`} id={`post-text-${item.id}`}>
        {item.text}
      </p>
      {long && (
        <button type="button" className="link-button" aria-expanded={expanded} aria-controls={`post-text-${item.id}`} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Yig'ish" : "To'liq ko'rsatish"}
        </button>
      )}

      {note && <p className={note.tone === "critical" ? "inline-error" : "post-note"}>{note.text}</p>}

      <div className="post-foot">
        <ExternalLink href={item.link}>Asl e'lon</ExternalLink>
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
    </article>
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

      <Tabs tabs={tabs} value={status} onChange={setStatus} label="E'lon holati" />

      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <Field label="Qidiruv" className="field-grow">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="E'lon matnidan qidirish…" />
        </Field>
        {status === "failed" && counts.failed > 0 && (
          <Button className="filters-reset" onClick={retryAll} busy={retrying}>
            Hammasini qayta navbatga
          </Button>
        )}
      </form>

      <Async state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty title={query ? "Hech narsa topilmadi" : "E'lonlar yo'q"}>{query ? "Boshqa so'z bilan qidirib ko'ring." : EMPTY_TEXT[status]}</Empty>
          ) : (
            <>
              <p className="muted small list-count">{formatNumber(data.total)} ta e'lon</p>
              <div className="post-list">
                {data.items.map((item) => (
                  <PostCard key={item.id} item={item} now={now} onChanged={refresh} />
                ))}
              </div>
              <Pager offset={offset} limit={LIMIT} total={data.total} onChange={(o) => setPage({ key, offset: o })} />
            </>
          )
        }
      </Async>
    </>
  );
}
