// Kichik router: sahifalar ro'yxati va manzil ↔ sahifa. React qismi — router.jsx.
// Hamma sahifalar /admin ostida; server har qanday /admin/... uchun bitta index.html beradi.
export const BASE = "/admin";

export const ROUTES = [
  { path: "/", id: "overview", title: "Bosh sahifa" },
  { path: "/yuklar", id: "loads", title: "Yuklar" },
  { path: "/navbat", id: "queue", title: "Navbat" },
  { path: "/haydovchilar", id: "drivers", title: "Haydovchilar" },
  { path: "/manbalar", id: "sources", title: "Manbalar" },
  { path: "/jarayonlar", id: "processes", title: "Jarayonlar" },
  { path: "/ai", id: "ai", title: "AI" },
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

// Manzil → sahifa (topilmasa null)
export function routeFor(pathname, base = BASE) {
  const path = pathInApp(pathname, base);
  return ROUTES.find((r) => r.path === path) ?? null;
}

// "/yuklar" → "/admin/yuklar", "/" → "/admin/"
export function hrefFor(path, base = BASE) {
  return path === "/" ? `${base}/` : `${base}${path}`;
}

// Havolani o'zimiz ochamizmi (pushState) yoki brauzerga qo'yamizmi (yangi oyna, Ctrl+bosish)
export function shouldIntercept(event) {
  return !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}
