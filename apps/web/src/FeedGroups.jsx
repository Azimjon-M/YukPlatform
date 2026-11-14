// «📌 Mening guruhlarim» — qaysi guruh va kanallardagi yuk e'lonlari botga darhol (AI'siz, asl matn bilan) kelsin.
// Ro'yxat serverdan (GET /pub/me/feed-sources): ochiq guruhlar + o'zi «➕ Guruh qo'shish» bilan qo'shgan yopiqlari,
// eng faoli tepada; har birida oxirgi 24 soatdagi e'lonlar soni. Bot ham shu ro'yxatni ko'rsatadi (bot feed.js groupStep).
// Server bilan aloqa yo'q (botdan oflayn ochilgan) — faqat hozir tanlanganlari ko'rinadi.
import { useEffect, useMemo, useState } from "react";
import { getFeedSources } from "./api.js";
import { Chips, Section, Spinner } from "./ui.jsx";

// Ro'yxat uzun bo'lsa — qidiruv qatori
const SEARCH_FROM = 12;

const perDayText = (n) => (n > 0 ? `${n} ta/kun` : "kam");

// list — serverdan kelgan ro'yxat; chosen — tanlanganlar (ro'yxatda bo'lmasa ham ko'rinsin: masalan, oflayn)
export function groupOptions(list, chosen) {
  const known = new Set(list.map((s) => s.name.toLowerCase()));
  const extra = chosen.filter((name) => !known.has(name.toLowerCase())).map((name) => ({ name, title: null, perDay: null, mine: false }));
  return [...extra, ...list].map((s) => ({
    id: s.name,
    label: s.title ?? s.name,
    note: [s.title ? s.name : null, s.mine ? "siz qo'shgansiz" : null].filter(Boolean).join(" · ") || null,
    sub: s.perDay == null ? null : perDayText(s.perDay),
    search: `${s.title ?? ""} ${s.name}`.toLowerCase(),
  }));
}

// sources — [{ name, title }] → nom bo'yicha sarlavha («Tekshiring» ro'yxati uchun)
export const sourceNamer = (list) => {
  const titles = new Map(list.map((s) => [s.name.toLowerCase(), s.title]));
  return (name) => titles.get(name.toLowerCase()) ?? name;
};

// online — server bilan aloqa bormi; onList(list) — ro'yxat kelganda (SettingsPage sarlavhalarni oladi)
export function FeedGroups({ online, chosen, onToggle, error, onList, onAuthLost }) {
  const [state, setState] = useState({ list: [], loading: online, error: null });
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!online) return undefined;
    let alive = true;
    getFeedSources()
      .then((data) => {
        if (!alive) return;
        setState({ list: data.sources ?? [], loading: false, error: null });
        onList?.(data.sources ?? []);
      })
      .catch((e) => {
        if (!alive) return;
        if (e.code === "auth") onAuthLost?.();
        setState({ list: [], loading: false, error: e });
      });
    return () => {
      alive = false;
    };
  }, [online, onList, onAuthLost]);

  const options = useMemo(() => groupOptions(state.list, chosen), [state.list, chosen]);
  const query = q.trim().toLowerCase();
  const shown = query ? options.filter((o) => o.search.includes(query)) : options;
  const picked = (id) => chosen.some((n) => n.toLowerCase() === id.toLowerCase());

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
      {options.length > SEARCH_FROM && (
        <input className="search" type="search" placeholder="🔍 Guruh nomi yoki @username" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {state.loading ? (
        <Spinner label="Guruhlar ochilyapti..." />
      ) : shown.length ? (
        <Chips layout="list" check options={shown} selected={picked} onPick={onToggle} />
      ) : (
        <p className="hint">{query ? "Bunday guruh topilmadi." : "Hozircha tanlasa bo'ladigan guruh yo'q."}</p>
      )}
    </Section>
  );
}
