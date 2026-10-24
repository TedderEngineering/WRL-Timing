import { useEffect, useState } from "react";
import { fetchLiveListing } from "../../hooks/useLiveChartData";

/** Checked once a minute while the page is visible, as the live banner does (cached at the edge for 30 s). */
const POLL_MS = 60_000;

/**
 * Whether a RaceTrace Live session is running now, for the phone bar's Live place (mobile
 * redesign, PR 2). False until known, and on any error: the place simply stays hidden.
 */
export function useLiveNow(enabled = true): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetchLiveListing()
        .then((l) => alive && setLive((l.sessions ?? []).length > 0))
        .catch(() => undefined);
    };
    load();
    const poll = setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
  return live;
}
