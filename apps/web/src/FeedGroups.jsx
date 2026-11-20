// «📌 Mening guruhlarim» — qaysi guruh va kanallardagi yuk e'lonlari botga darhol (AI'siz, asl matn bilan) kelsin.
// Ro'yxat serverdan (GET /pub/me/feed-sources): 🌐 ochiq va 🔒 yopiq guruhlar alohida bo'limda (2026-11-16). Yopiq guruh
// e'lonlari faqat Pro'ga boradi — Pro bo'lmaganga ular «locked» (bosilsa — Pro haqida xabar, tanlanmaydi),
// eng faoli tepada; har birida oxirgi 24 soatdagi e'lonlar soni. Bot ham shu ro'yxatni ko'rsatadi (bot feed.js groupStep).
// Server bilan aloqa yo'q (botdan oflayn ochilgan) — faqat hozir tanlanganlari ko'rinadi.
import { useEffect, useMemo, useRef, useState } from "react";
import { foldText } from "@yuk/shared";
import { getFeedSources } from "./api.js";
import { CLOSED_PRO_HINT, groupOptions, pageOf } from "./feedGroups.js";
import { Chips, Section, Spinner } from "./ui.jsx";

export { CLOSED_PRO_HINT, GROUPS_PAGE_SIZE, groupOptions, pageOf, sourceNamer } from "./feedGroups.js";

// Ro'yxat uzun bo'lsa — qidiruv qatori
const SEARCH_FROM = 12;

// online — server bilan aloqa bormi; onList(list) — ro'yxat kelganda (SettingsPage sarlavhalarni oladi)
export function FeedGroups({ online, chosen, onToggle, error, onList, onAuthLost }) {
  const [state, setState] = useState({ list: [], loading: online, error: null, pro: false });
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("open"); // open — 🌐 ochiq, closed — 🔒 yopiq
  const [notice, setNotice] = useState(null);
  const [pageAt, setPageAt] = useState({ key: "", page: 0 }); // sahifa; qidiruv yoki bo'lim o'zgarsa — birinchisi
  const topRef = useRef(null);

  useEffect(() => {
    if (!online) return undefined;
    let alive = true;
    getFeedSources()
      .then((data) => {
        if (!alive) return;
        setState({ list: data.sources ?? [], loading: false, error: null, pro: Boolean(data.pro) });
        onList?.(data.sources ?? []);
      })
      .catch((e) => {
        if (!alive) return;
        if (e.code === "auth") onAuthLost?.();
        setState({ list: [], loading: false, error: e, pro: false });
      });
    return () => {
      alive = false;
    };
  }, [online, onList, onAuthLost]);

  const options = useMemo(() => groupOptions(state.list, chosen), [state.list, chosen]);
  const closedCount = options.filter((o) => o.closed).length;
  const tab = kind === "closed" && closedCount ? "closed" : "open";
  const inTab = options.filter((o) => (tab === "closed") === o.closed);
  const query = foldText(q.trim());
  const shown = query ? inTab.filter((o) => o.search.includes(query)) : inTab;
  const pageKey = `${tab}|${query}`;
  const paged = pageOf(shown, pageAt.key === pageKey ? pageAt.page : 0);
  const goPage = (page) => {
    setPageAt({ key: pageKey, page });
    topRef.current?.scrollIntoView({ block: "nearest" });
  };
  const picked = (id) => chosen.some((n) => n.toLowerCase() === id.toLowerCase());
  const pickedIn = (closed) => options.filter((o) => o.closed === closed && picked(o.id)).length;
  const pick = (id) => {
    const option = options.find((o) => o.id === id);
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
      {chosen.length > 0 && <p className="summary">Tanlangan: {chosen.length} ta</p>}
      {!online && <p className="hint">Guruhlar ro'yxati internet orqali ochiladi — hozir faqat tanlanganlari ko'rinadi.</p>}
      {state.error && <p className="hint">Ro'yxat ochilmadi: {state.error.message}</p>}
      {closedCount > 0 && (
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
      {tab === "closed" && <p className="hint">{state.pro ? "🔒 Pro sifatida yopiq guruhlardagi e'lonlar ham sizga keladi." : CLOSED_PRO_HINT}</p>}
      {notice && tab !== "closed" && <p className="hint">{notice}</p>}
      <span ref={topRef} />
      {inTab.length > SEARCH_FROM && (
        <input className="search" type="search" placeholder="🔍 Guruh nomi yoki @username" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {state.loading ? (
        <Spinner label="Guruhlar ochilyapti..." />
      ) : shown.length ? (
        <>
          <Chips layout="list" check options={paged.items} selected={picked} onPick={pick} />
          {paged.pages > 1 && (
            <nav className="pager" aria-label="Sahifalar">
              <button type="button" className="pill" disabled={paged.page === 0} onClick={() => goPage(paged.page - 1)}>
                ← Oldingi
              </button>
              <span className="pager-info">
                {paged.first}–{paged.last} / {paged.total}
              </span>
              <button type="button" className="pill" disabled={paged.page >= paged.pages - 1} onClick={() => goPage(paged.page + 1)}>
                Keyingi →
              </button>
            </nav>
          )}
        </>
      ) : (
        <p className="hint">{query ? "Bunday guruh topilmadi." : "Hozircha tanlasa bo'ladigan guruh yo'q."}</p>
      )}
    </Section>
  );
}
