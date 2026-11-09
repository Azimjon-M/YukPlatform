// Yuklar: GET /api/loads — filtrlar (qayerdan, qayerga, mashina, kuzov, qidiruv, oxirgi N soat), 50 tadan sahifalab.
import { useState } from "react";
import { BODY_TYPES, REGIONS, TRUCK_CLASSES } from "@yuk/shared";
import { get } from "../api.js";
import { formatNumber, loadView } from "../format.js";
import { useApi, useDebounced, useNow } from "../hooks.js";
import { Async, Badge, Button, Empty, ExternalLink, Field, PageHeader, Pager, TimeAgo, useTitle } from "../ui.jsx";

const LIMIT = 50;
const HOURS = [
  { value: "6", label: "Oxirgi 6 soat" },
  { value: "24", label: "Oxirgi 24 soat" },
  { value: "72", label: "Oxirgi 3 kun" },
  { value: "168", label: "Oxirgi 7 kun" },
  { value: "", label: "Hammasi" },
];
const EMPTY_FILTERS = { from: "", to: "", truckClass: "", bodyType: "", hours: "" };

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const regionOptions = REGIONS.map((r) => ({ value: r.id, label: r.name }));
const truckOptions = TRUCK_CLASSES.map((t) => ({ value: t.id, label: t.name }));
const bodyOptions = BODY_TYPES.map((b) => ({ value: b.id, label: b.name }));

function LoadCard({ item, now }) {
  const v = loadView(item.load ?? {});
  const source = item.post?.source;
  return (
    <article className="load-card">
      <div className="load-head">
        <h3 className="load-route">
          {v.from} <span className="arrow" aria-hidden="true">→</span>
          <span className="sr-only">dan</span> {v.to}
        </h3>
        <span className="muted small nowrap">
          <TimeAgo ts={item.createdAt} now={now} />
        </span>
      </div>

      <dl className="load-facts">
        {v.cargo && (
          <div>
            <dt>Yuk</dt>
            <dd>{v.cargo}</dd>
          </div>
        )}
        {v.vehicle && (
          <div>
            <dt>Mashina</dt>
            <dd>{v.vehicle}</dd>
          </div>
        )}
        <div>
          <dt>Narx</dt>
          <dd>{v.price}</dd>
        </div>
        {v.when && (
          <div>
            <dt>Qachon</dt>
            <dd>{v.when}</dd>
          </div>
        )}
        {v.note && (
          <div>
            <dt>Izoh</dt>
            <dd>{v.note}</dd>
          </div>
        )}
        <div>
          <dt>Telefon</dt>
          <dd>
            {v.phones.length ? (
              v.phones.map((p, i) => (
                <span key={p.href}>
                  {i > 0 && ", "}
                  <a href={p.href} className="phone">
                    {p.text}
                  </a>
                </span>
              ))
            ) : (
              <span className="muted">yozilmagan — asl e'lonni oching</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="load-foot">
        {v.category && <Badge>{v.category}</Badge>}
        <Badge tone={item.sentTo > 0 ? "good" : "neutral"} icon={item.sentTo > 0 ? "✓" : "–"}>
          {item.sentTo > 0 ? `${formatNumber(item.sentTo)} haydovchiga yuborildi` : "Haydovchiga yuborilmagan"}
        </Badge>
        <Badge tone={item.channelMessageId ? "info" : "neutral"} icon={item.channelMessageId ? "✓" : "–"}>
          {item.channelMessageId ? "Kanalda" : "Kanalga chiqmagan"}
        </Badge>
        <span className="load-source">
          {source && <span className="muted">{source}</span>}
          {item.post?.postedAt && (
            <span className="muted">
              {" · e'lon "}
              <TimeAgo ts={item.post.postedAt} now={now} />
            </span>
          )}
          {item.post?.link && (
            <>
              {" · "}
              <ExternalLink href={item.post.link}>Asl e'lon</ExternalLink>
            </>
          )}
        </span>
      </div>
    </article>
  );
}

export function LoadsPage() {
  useTitle("Yuklar");
  const now = useNow(30_000);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 400);
  // Filtr o'zgarsa — birinchi sahifaga qaytamiz (offset shu filtrlar kaliti bilan saqlanadi)
  const key = JSON.stringify({ ...filters, q: query });
  const [page, setPage] = useState({ key, offset: 0 });
  const offset = page.key === key ? page.offset : 0;

  const state = useApi(() => get("/api/loads", { ...filters, q: query, limit: LIMIT, offset }), [key, offset], {
    // Jonli — faqat birinchi sahifada (keyingisida yangi yuk qo'shilsa ro'yxat siljib ketardi)
    live: offset === 0 ? ["loads"] : null,
    liveGapMs: 2000,
  });
  const set = (name) => (value) => setFilters((f) => ({ ...f, [name]: value }));
  const dirty = q || Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Yuklar"
        subtitle={state.data ? `${formatNumber(state.data.total)} ta yuk topildi` : "AI e'lonlardan ajratib olgan yuklar"}
        actions={
          <Button onClick={state.reload} busy={state.loading && state.data != null}>
            Yangilash
          </Button>
        }
      />

      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <Select label="Qayerdan" value={filters.from} onChange={set("from")} options={regionOptions} placeholder="Hamma joy" />
        <Select label="Qayerga" value={filters.to} onChange={set("to")} options={regionOptions} placeholder="Hamma joy" />
        <Select label="Mashina turi" value={filters.truckClass} onChange={set("truckClass")} options={truckOptions} placeholder="Hammasi" />
        <Select label="Kuzov" value={filters.bodyType} onChange={set("bodyType")} options={bodyOptions} placeholder="Hammasi" />
        <Select label="Vaqt" value={filters.hours} onChange={set("hours")} options={HOURS} />
        <Field label="Qidiruv" className="field-grow">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Yuk, shahar, izoh…" />
        </Field>
        {dirty && (
          <Button
            variant="ghost"
            className="filters-reset"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setQ("");
            }}
          >
            Tozalash
          </Button>
        )}
      </form>

      <Async state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty title="Yuklar topilmadi">
              {dirty ? "Filtrlarni o'zgartirib ko'ring yoki tozalang." : "Bot e'lonlarni tahlil qilib, yuk topganda shu yerda paydo bo'ladi."}
            </Empty>
          ) : (
            <>
              <div className="load-list">
                {data.items.map((item) => (
                  <LoadCard key={item.id} item={item} now={now} />
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
