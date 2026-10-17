import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchLiveListing } from "../../hooks/useLiveChartData";
import { bannerFor, type LiveListing } from "./banner";

/** Checked once a minute while the page is visible (the answer is cached at the edge for 30 s). */
const POLL_MS = 60_000;
const DISMISS_KEY = "rt.liveBanner.dismissed";

const C = { bg: "#12122a", border: "#2a2a48", text: "#e0e0e8", muted: "#9a9ab4", live: "#ef4444", accent: "#F48C34" };

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * The site banner for RaceTrace Live: a WRL session live now (race, qualifying or practice), the
 * next scheduled race from the day before, or a session that just finished. Not on /live pages
 * (they show it themselves). Closing it hides that session in that state on this device.
 */
export function LiveBanner() {
  const { pathname } = useLocation();
  const onLive = pathname === "/live" || pathname.startsWith("/live/");
  const [list, setList] = useState<LiveListing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  useEffect(() => {
    if (onLive) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetchLiveListing()
        .then((l) => alive && setList(l))
        .catch(() => undefined); // no banner rather than an error on every page
    };
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onLive]);

  const b = onLive ? null : bannerFor(list, now);
  if (!b || dismissed === b.key) return null;

  const close = () => {
    setDismissed(b.key);
    try {
      localStorage.setItem(DISMISS_KEY, b.key);
    } catch {
      /* private window: closed until the page reloads */
    }
  };

  return (
    <div role="region" aria-label="RaceTrace Live" className="shrink-0 border-b" style={{ background: C.bg, borderColor: C.border, color: C.text }}>
      <div className="container-page flex min-h-[40px] items-center gap-3 py-1.5 text-sm">
        <Link to={b.to} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 hover:brightness-125">
          <span
            className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wider"
            style={{ color: b.state === "live" ? C.live : b.state === "upcoming" ? C.accent : C.muted }}
          >
            {b.state === "live" && (
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: C.live }} />
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: C.live }} />
              </span>
            )}
            {b.when}
          </span>
          <span className="min-w-0 truncate font-medium">{b.what}</span>
          {b.detail && <span style={{ color: C.muted }}>{b.detail}</span>}
          {b.more > 0 && <span style={{ color: C.muted }}>+{b.more} more live</span>}
          <span className="font-semibold" style={{ color: C.accent }}>
            {b.action} ›
          </span>
        </Link>
        <button type="button" onClick={close} aria-label="Close" className="shrink-0 rounded px-2 py-1 text-base leading-none" style={{ color: C.muted }}>
          ×
        </button>
      </div>
    </div>
  );
}
