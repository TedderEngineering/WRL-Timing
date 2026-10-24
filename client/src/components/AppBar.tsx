/**
 * The phone's bottom bar (mobile redesign, PR 2; plan decision M1): Home, Events, Live (only
 * while a session is live) and Me, in the thumb's reach. Below 640 px only; from 640 px up the
 * top bar's links and menus carry the same places. Race screens hide it: they open over it,
 * with their own back arrow.
 *
 * Look: the site bar's surface and border, the RaceTrace accent for the current place (the
 * laptop's tab underline colour), 56 px tall plus the home-bar safe area.
 */
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { useLiveNow } from "../features/live/useLiveNow";

const ACCENT = "var(--rt-accent)";

type Place = { key: string; label: string; to: string; icon: ReactNode; active: (path: string) => boolean; dot?: boolean };

const icon = (d: string) => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const HOME = icon("M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5");
const EVENTS = icon("M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 7h3v3H8z");
const LIVE = icon("M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z");
const ME = icon("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0");

export function AppBar() {
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuth();
  const live = useLiveNow(isAuthenticated);

  const places: Place[] = [
    {
      key: "home",
      label: "Home",
      to: isAuthenticated ? "/dashboard" : "/",
      icon: HOME,
      active: (p) => p === "/" || p === "/dashboard",
    },
    {
      key: "events",
      label: "Events",
      to: "/races",
      icon: EVENTS,
      active: (p) => p === "/races" || p.startsWith("/races/") || p === "/chart" || p.startsWith("/qualifying"),
    },
    ...(live
      ? [{ key: "live", label: "Live", to: "/live", icon: LIVE, active: (p: string) => p === "/live" || p.startsWith("/live/"), dot: true }]
      : []),
    {
      key: "me",
      label: "Me",
      to: "/me",
      icon: ME,
      active: (p) => p === "/me" || p.startsWith("/settings") || p.startsWith("/admin"),
    },
  ];

  return (
    <nav
      aria-label="App"
      data-phone-shell="app-bar"
      className="sticky bottom-0 z-40 shrink-0 border-t border-gray-200 bg-white/95 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-950/95 sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="m-0 flex list-none p-0">
        {places.map((p) => {
          const on = p.active(pathname);
          return (
            <li key={p.key} className="flex-1">
              <Link
                to={p.to}
                aria-current={on ? "page" : undefined}
                className={`relative flex h-14 flex-col items-center justify-center gap-0.5 text-[12px] ${on ? "font-semibold" : "text-gray-500 dark:text-gray-400"}`}
                style={on ? { color: ACCENT } : undefined}
              >
                {p.icon}
                {p.label}
                {p.dot && <span className="absolute right-[calc(50%-16px)] top-2 h-2 w-2 rounded-full bg-red-500" aria-label="live now" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
