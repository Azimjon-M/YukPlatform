// Boshqaruv markazi: chapda menyu (tor ekranda — yuqorida), o'ngda tanlangan sahifa.
import { useEffect, useState } from "react";
import { get } from "./api.js";
import { formatNumber, formatTime } from "./format.js";
import { useApi, useLiveStatus } from "./hooks.js";
import { Icon } from "./icons.jsx";
import { Link, usePathname } from "./navigation.jsx";
import { OVERVIEW_INTERVAL_MS, OverviewContext } from "./overview.js";
import { AiPage } from "./pages/AiPage.jsx";
import { DriversPage } from "./pages/DriversPage.jsx";
import { LoadsPage } from "./pages/LoadsPage.jsx";
import { OverviewPage } from "./pages/OverviewPage.jsx";
import { ProcessesPage } from "./pages/ProcessesPage.jsx";
import { QueuePage } from "./pages/QueuePage.jsx";
import { SourcesPage } from "./pages/SourcesPage.jsx";
import { ROUTES, routeFor } from "./router.js";
import { Empty, PageHeader, ToastProvider, useTitle } from "./ui.jsx";

const PAGES = {
  overview: OverviewPage,
  loads: LoadsPage,
  queue: QueuePage,
  drivers: DriversPage,
  sources: SourcesPage,
  processes: ProcessesPage,
  ai: AiPage,
};

function NotFound() {
  useTitle("Sahifa topilmadi");
  return (
    <>
      <PageHeader title="Sahifa topilmadi" />
      <Empty title="Bunday sahifa yo'q">
        <Link to="/">Bosh sahifaga qaytish</Link>
      </Empty>
    </>
  );
}

function Sidebar({ current, overview }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [current]);
  const waiting = overview.data?.metrics?.queue?.waiting;
  const failed = overview.data?.metrics?.queue?.failed ?? 0;
  const online = overview.data && !overview.error;
  const live = useLiveStatus();

  return (
    <aside className={`sidebar ${open ? "is-open" : ""}`}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="loads" size={18} />
        </span>
        <span className="brand-text">
          <strong>Yuk Ekspert</strong>
          <small>Boshqaruv markazi</small>
        </span>
        <button
          type="button"
          className="menu-button"
          aria-expanded={open}
          aria-controls="main-nav"
          aria-label={open ? "Menyuni yopish" : "Menyuni ochish"}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "close" : "menu"} />
        </button>
      </div>
      <nav id="main-nav" className="nav" aria-label="Asosiy menyu">
        {ROUTES.map((route) => (
          <Link key={route.id} to={route.path} className={`nav-link ${current?.id === route.id ? "is-active" : ""}`} aria-current={current?.id === route.id ? "page" : undefined}>
            <Icon name={route.id} />
            <span>{route.title}</span>
            {route.id === "queue" && waiting != null && (
              <span className={`nav-count ${failed ? "has-failed" : ""}`} title={failed ? `${failed} ta xato` : undefined}>
                {formatNumber(waiting)}
              </span>
            )}
          </Link>
        ))}
      </nav>
      {/* Jonli — bot bazaga yozishi bilan sahifa o'zi yangilanadi (live.js); bo'lmasa — eskicha, har 10 s */}
      <div className="sidebar-foot" title={online && live !== "live" ? "Jonli ulanish yo'q — sahifalar har bir necha soniyada yangilanadi" : undefined}>
        <span
          className={`dot ${online ? "dot-good" : overview.error ? "dot-critical" : "dot-neutral"}${online && live === "live" ? " is-live" : ""}`}
          aria-hidden="true"
        />
        {online
          ? `${live === "live" ? "Jonli" : "Server ulangan"} · ${formatTime(overview.updatedAt, { seconds: true })}`
          : overview.error
            ? "Server bilan aloqa yo'q"
            : "Ulanmoqda…"}
      </div>
    </aside>
  );
}

export function App() {
  const pathname = usePathname();
  const route = routeFor(pathname);
  const overview = useApi(() => get("/api/overview"), [], {
    interval: OVERVIEW_INTERVAL_MS,
    // Bosh sahifa va yon panel: hamma narsa shu so'rovda (og'irroq) — jonli, lekin 3 s da bir martadan ko'p emas
    live: ["posts", "loads", "drivers", "ai", "processes"],
    liveGapMs: 3000,
  });
  const Page = route ? PAGES[route.id] : NotFound;

  return (
    <OverviewContext.Provider value={overview}>
      <ToastProvider>
        <div className="app">
          <a className="skip-link" href="#main">
            Asosiy qismga o'tish
          </a>
          <Sidebar current={route} overview={overview} />
          <main id="main" className="main" tabIndex={-1}>
            <Page key={route?.id ?? "404"} />
          </main>
        </div>
      </ToastProvider>
    </OverviewContext.Provider>
  );
}
