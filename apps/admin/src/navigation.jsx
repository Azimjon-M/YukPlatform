// Router'ning React qismi: hozirgi manzil, Link, navigate. Kutubxonasiz — History API (pushState + popstate).
import { useSyncExternalStore } from "react";
import { hrefFor, shouldIntercept } from "./router.js";

const listeners = new Set();

function subscribe(callback) {
  listeners.add(callback);
  window.addEventListener("popstate", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("popstate", callback);
  };
}

export function navigate(path) {
  const url = hrefFor(path);
  if (url !== window.location.pathname) {
    window.history.pushState(null, "", url);
    window.scrollTo(0, 0);
  }
  for (const listener of listeners) listener();
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function Link({ to, onClick, children, ...rest }) {
  return (
    <a
      href={hrefFor(to)}
      onClick={(event) => {
        onClick?.(event);
        if (!shouldIntercept(event)) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
