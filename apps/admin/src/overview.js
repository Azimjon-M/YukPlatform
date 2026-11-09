// Umumiy holat (GET /api/overview) — butun ilova uchun bitta: jonli (App.jsx, live.js), zaxira — har 10 soniyada.
// Bosh sahifa, navbat tablari, menyudagi raqam va AI sahifasi shundan oladi.
import { createContext, useContext } from "react";

export const OVERVIEW_INTERVAL_MS = 10_000;
export const OverviewContext = createContext({ data: null, error: null, loading: true, reload: () => {} });
export const useOverview = () => useContext(OverviewContext);
