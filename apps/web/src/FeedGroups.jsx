// «📌 Mening guruhlarim» — qaysi guruh va kanallardagi yuk e'lonlari botga darhol (AI'siz, asl matn bilan) kelsin.
// Ro'yxat serverdan (GET /pub/me/feed-sources): 🌐 ochiq va 🔒 yopiq guruhlar alohida bo'limda (2026-11-16). Yopiq guruh
// e'lonlari faqat Pro'ga boradi — Pro bo'lmaganga ular «locked» (bosilsa — Pro haqida xabar, tanlanmaydi),
// eng faoli tepada; har birida oxirgi 24 soatdagi e'lonlar soni. Bot ham shu ro'yxatni ko'rsatadi (bot feed.js groupStep).
// Server bilan aloqa yo'q (botdan oflayn ochilgan) — faqat hozir tanlanganlari ko'rinadi.
import { useEffect, useMemo, useRef, useState } from "react";
import { foldText } from "@yuk/shared";
import { getFeedSources } from "./api.js";
import { CLOSED_PRO_HINT, closedHint, GROUP_SCOPES, OWN_CLOSED_EMPTY_HINT, OWN_EMPTY_HINT, groupOptions, pageButtons, pageOf, scopeOptions } from "./feedGroups.js";
import { haptic } from "./telegram.js";
import { Chips, Section, SourceAvatar, Spinner } from "./ui.jsx";

export { CLOSED_PRO_HINT, GROUPS_PAGE_SIZE, groupOptions, pageOf, sourceNamer } from "./feedGroups.js";

// Ro'yxat uzun bo'lsa — qidiruv qatori
const SEARCH_FROM = 12;

// Raqamli sahifalash (2026-11-27, Azimjon: «Mukammal tushunarli Pagination bo'lsin»): ‹ 1 2 3 4 5 … 26 ›.
// Birinchi sahifada «‹», oxirgisida «›» — o'chiq; joriy sahifa — to'ldirilgan; ostida «21–40 / 512»
function Pager({ page, pages, onPage, info }) {
  const go = (to) => {
    if (to === page || to < 0 || to >= pages) return;
    haptic.select();
    onPage(to);
  };
  return (
    <nav className="pager" aria-label="Sahifalar">
      <div className="pager-row">
        <button type="button" className="pager-btn pager-arrow" disabled={page === 0} onClick={() => go(page - 1)} aria-label="Oldingi sahifa">
          ‹
        </button>
        {pageButtons(page, pages).map((item, i) =>
          item === "gap" ? (
            <span key={`gap${i}`} className="pager-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={`pager-btn${item === page ? " on" : ""}`}
              aria-current={item === page ? "page" : undefined}
              aria-label={`${item + 1}-sahifa`}
              onClick={() => go(item)}
            >
              {item + 1}
            </button>
          ),
        )}
        <button type="button" className="pager-btn pager-arrow" disabled={page >= pages - 1} onClick={() => go(page + 1)} aria-label="Keyingi sahifa">
          ›
        </button>
      </div>
      <span className="pager-info">{info}</span>
    </nav>
  );
}

// online — server bilan aloqa bormi; onList(list) — ro'yxat kelganda (SettingsPage sarlavhalarni oladi)
export function FeedGroups({ online, chosen, onToggle, error, onList, onAuthLost }) {
  const [state, setState] = useState({ list: [], loading: online, error: null, plan: "free", max: null, hidden: 0 });
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("open"); // open — 🌐 ochiq, closed — 🔒 yopiq
  const [scope, setScope] = useState("all"); // all — 🌍 Global, own — 👤 Akkauntimdagi
  const [notice, setNotice] = useState(null);
  const [pageAt, setPageAt] = useState({ key: "", page: 0 }); // sahifa; qidiruv yoki bo'lim o'zgarsa — birinchisi
  const topRef = useRef(null);

  useEffect(() => {
    if (!online) return undefined;
    let alive = true;
    getFeedSources()
      .then((data) => {
        if (!alive) return;
        // plan — obuna (free | pro | max); eski server faqat pro: true/false beradi
        const plan = data.plan ?? (data.pro ? "pro" : "free");
        setState({ list: data.sources ?? [], loading: false, error: null, plan, max: data.max ?? null, hidden: data.hiddenClosed ?? 0 });
        onList?.(data.sources ?? []);
      })
      .catch((e) => {
        if (!alive) return;
        if (e.code === "auth") onAuthLost?.();
        setState({ list: [], loading: false, error: e, plan: "free", max: null, hidden: 0 });
      });
    return () => {
      alive = false;
    };
  }, [online, onList, onAuthLost]);

  const allOptions = useMemo(() => groupOptions(state.list, chosen), [state.list, chosen]);
  const options = scopeOptions(allOptions, scope);
  const closedCount = options.filter((o) => o.closed).length;
  // «👤 Akkauntimdagi» da Ochiq/Yopiq doim ko'rinadi (yopig'i 0 bo'lsa ham — nega yo'qligi yoziladi); Global'da — yopiq bo'lsa
  const showKinds = closedCount > 0 || (scope === "own" && online && !state.loading && !state.error);
  const tab = kind === "closed" && showKinds ? "closed" : "open";
  const inTab = options.filter((o) => (tab === "closed") === o.closed);
  const query = foldText(q.trim());
  const shown = query ? inTab.filter((o) => o.search.includes(query)) : inTab;
  const pageKey = `${scope}|${tab}|${query}`;
  const paged = pageOf(shown, pageAt.key === pageKey ? pageAt.page : 0);
  const goPage = (page) => {
    setPageAt({ key: pageKey, page });
    topRef.current?.scrollIntoView({ block: "nearest" });
  };
  const picked = (id) => chosen.some((n) => n.toLowerCase() === id.toLowerCase());
  const pickedIn = (closed) => options.filter((o) => o.closed === closed && picked(o.id)).length;
  const pickedScope = (id) => scopeOptions(allOptions, id).filter((o) => picked(o.id)).length;
  const pick = (id) => {
    const option = allOptions.find((o) => o.id === id);
    if (option?.disabled) return setNotice(CLOSED_PRO_HINT);
    setNotice(null);
    onToggle(id);
  };

  return (
    <Section
      id="groups"
      title="📌 Qaysi guruh va kanallardan?"
      hint="Belgilaganlaringizdagi yuk e'lonlari botga darhol, saralanmasdan keladi. Ro'yxatda yo'q guruhni botdagi «➕ Guruh qo'shish» bilan qo'shing."
      error={error}
    >
      {chosen.length > 0 && (
        <p className="summary">
          Tanlangan: {chosen.length}
          {state.max ? ` / ${state.max}` : ""} ta
        </p>
      )}
      {!online && <p className="hint">Guruhlar ro'yxati internet orqali ochiladi — hozir faqat tanlanganlari ko'rinadi.</p>}
      {state.error && <p className="hint">Ro'yxat ochilmadi: {state.error.message}</p>}
      {online && !state.loading && !state.error && (
        <div className="seg" role="tablist" aria-label="Qaysi ro'yxatdan">
          {GROUP_SCOPES.map(({ id, label }) => {
            const n = pickedScope(id);
            return (
              <button key={id} type="button" role="tab" aria-selected={scope === id} className={scope === id ? "on" : ""} onClick={() => setScope(id)}>
                {label} · {scopeOptions(allOptions, id).length}
                {n > 0 && <span className="seg-count">✓{n}</span>}
              </button>
            );
          })}
        </div>
      )}
      {showKinds && (
        <div className="seg" role="tablist" aria-label="Guruh turi">
          {[
            ["open", `🌐 Ochiq · ${options.length - closedCount}`, pickedIn(false)],
            ["closed", `🔒 Yopiq · ${closedCount}`, pickedIn(true)],
          ].map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setKind(id)}>
              {label}
              {n > 0 && <span className="seg-count">✓{n}</span>}
            </button>
          ))}
        </div>
      )}
      {tab === "closed" && <p className="hint">{closedHint(state.plan, state.hidden)}</p>}
      {notice && tab !== "closed" && <p className="hint">{notice}</p>}
      <span ref={topRef} />
      {inTab.length > SEARCH_FROM && (
        <input className="search" type="search" placeholder="🔍 Guruh nomi yoki @username" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {state.loading ? (
        <Spinner label="Guruhlar ochilyapti..." />
      ) : shown.length ? (
        <>
          <Chips
            layout="list"
            check
            options={paged.items.map((o) => ({ ...o, icon: <SourceAvatar name={o.id} label={o.label} closed={o.closed} /> }))}
            selected={picked}
            onPick={pick}
          />
          {paged.pages > 1 && <Pager page={paged.page} pages={paged.pages} onPage={goPage} info={`${paged.first}–${paged.last} / ${paged.total}`} />}
        </>
      ) : (
        <p className="hint">
          {query
            ? "Bunday guruh topilmadi."
            : scope === "own"
              ? tab === "closed" && options.length
                ? OWN_CLOSED_EMPTY_HINT
                : OWN_EMPTY_HINT
              : "Hozircha tanlasa bo'ladigan guruh yo'q."}
        </p>
      )}
    </Section>
  );
}
