/**
 * The live demo (a finished race replayed on a live page, server live/replay.ts), offered where
 * the live race sits when none is on: the dashboard, beside the next round. Hidden while a session
 * is live (the live banner has it) or when the server offers no demo.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchLiveListing } from "../../hooks/useLiveChartData";
import { shortEvent, type LiveListing } from "./banner";

export function LiveDemoCard() {
  const [list, setList] = useState<LiveListing | null>(null);
  useEffect(() => {
    let alive = true;
    fetchLiveListing()
      .then((l) => alive && setList(l))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const demo = list?.demo;
  if (!demo || list.sessions.length > 0) return null;
  return (
    <Link
      to={`/live/${demo.slug}`}
      className="flex items-center gap-3 rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] px-4 py-3 hover:brightness-110"
    >
      <span aria-hidden className="inline-block h-0 w-0 shrink-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-[var(--rt-accent)]" />
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--rt-accent)]">Live timing demo</span>
        <span className="text-[15px] font-semibold">
          WRL {shortEvent(demo.eventName, "")} · {demo.sessionName}
        </span>
        <span className="text-xs text-[var(--rt-text-muted)]">Replayed as it ran live: the track map, running order, pit stops and race control.</span>
      </span>
    </Link>
  );
}
