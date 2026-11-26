// Kichik router: sahifalar ro'yxati va manzil ↔ sahifa. React qismi — router.jsx.
// Hamma sahifalar /admin ostida; server har qanday /admin/... uchun bitta index.html beradi.
export const BASE = "/admin";

export const ROUTES = [
  { path: "/", id: "overview", title: "Bosh sahifa" },
  { path: "/yuklar", id: "loads", title: "Yuklar" },
  { path: "/elonlar", id: "queue", title: "E'lonlar" }, // 2026-11-20 gacha «Navbat» (/navbat)
  { path: "/haydovchilar", id: "drivers", title: "Haydovchilar" },
  { path: "/manbalar", id: "sources", title: "Manbalar" },
  { path: "/azolik", id: "required", title: "A'zolik" },
  { path: "/jarayonlar", id: "processes", title: "Jarayonlar" },
  { path: "/ai", id: "ai", title: "AI" },
  { path: "/xatolar", id: "errors", title: "Xatolar" },
];

// "/admin/yuklar/" → "/yuklar"; "/admin" → "/"; boshqa joy → null
export function pathInApp(pathname, base = BASE) {
  let clean = pathname || "/";
  try {
    clean = decodeURI(clean);
  } catch {
    // buzilgan %-kod — o'zini qoldiramiz
  }
  clean = clean.replace(/\/{2,}/g, "/");
  if (clean !== base && !clean.startsWith(`${base}/`)) return null;
  const rest = clean.slice(base.length).replace(/\/+$/, "");
  return rest || "/";
}

// Eski manzillar (saqlab qo'yilgan havolalar ishlayversin)
const ALIASES = { "/navbat": "/elonlar" };

// Manzil → sahifa (topilmasa null)
export function routeFor(pathname, base = BASE) {
  const path = pathInApp(pathname, base);
  const real = ALIASES[path] ?? path;
  return ROUTES.find((r) => r.path === real) ?? null;
}

// "/yuklar" → "/admin/yuklar", "/" → "/admin/"
export function hrefFor(path, base = BASE) {
  return path === "/" ? `${base}/` : `${base}${path}`;
}

// Havolani o'zimiz ochamizmi (pushState) yoki brauzerga qo'yamizmi (yangi oyna, Ctrl+bosish)
export function shouldIntercept(event) {
  return !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}
