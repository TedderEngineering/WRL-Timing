/**
 * RaceTrace Live, under the track map: race control's messages as they come in (the server reads
 * the log every 15 s; this asks every 15 s while the page is open, through the edge). Newest
 * first: the latest few, or all of them. A message that arrived since the last look is lit for a
 * few seconds. One naming a car the viewer follows (the focus car, a car followed on the map, or
 * one of the cars on their account) is highlighted and tagged, and "Your cars" lists only those.
 */
import { useEffect, useRef, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { getPublic } from "../../hooks/useLiveChartData";
import { carKey } from "./car-number";
import { liveClassColor } from "./constants";
import { useAuth } from "../auth/AuthContext";
import { followedCar, useMyCarsList } from "../my-cars/CarSearch";

export interface RaceControlMessage {
  seq: number;
  at: string | null;
  cars: string[];
  corner: string | null;
  note: string;
  status: string | null;
  action: string | null;
}

const C = { line: "#1e1e38", text: "#e0e0e8", muted: "#9a9ab4", chip: "#2a2a48", focus: "#F48C34", fresh: "rgba(250,178,25,0.16)", mine: "rgba(244,140,52,0.16)", penalty: "#f87171" };

/** Why a car is the viewer's: the focus car, followed on the map, or one of their cars. */
export type Mine = "focus" | "following" | "my car";

/** The viewer's cars in this race, by chart key: the focus car first, then followed, then their account's. */
export function viewerCars(data: RaceChartData, focusNum: number, followed: Set<number>, myCars: Parameters<typeof followedCar>[0]): Map<number, Mine> {
  const out = new Map<number, Mine>();
  if (myCars) {
    for (const [k, c] of Object.entries(data.cars)) {
      if (followedCar(myCars, { series: "wrl", number: String(c.label ?? k), team: c.team, carClass: c.cls, races: [] })) out.set(Number(k), "my car");
    }
  }
  for (const k of followed) out.set(k, "following");
  if (focusNum) out.set(focusNum, "focus");
  return out;
}
export const CONTROL_POLL_MS = 15_000;
/** A new message stays lit this long. */
const FRESH_MS = 12_000;
/** Messages shown before "Show all". */
const SHOWN = 3;

/** An action that is a penalty (not "No action", "No penalty", "Continue"). */
export function isPenalty(action: string | null): boolean {
  return !!action && !/^(no\s*(action|penalty)|none|continue|warning)/i.test(action.trim());
}

export function RaceControl({ slug, data, focusNum, followed }: { slug: string; data: RaceChartData; focusNum: number; followed: Set<number> }) {
  const [messages, setMessages] = useState<RaceControlMessage[] | null>(null);
  const [fresh, setFresh] = useState<Map<number, number>>(() => new Map());
  const [all, setAll] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const { user } = useAuth();
  const myCars = useMyCarsList(user?.id ?? null);
  const lastSeq = useRef<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    lastSeq.current = null;
    const load = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      getPublic<{ messages: RaceControlMessage[] }>(`/live/${encodeURIComponent(slug)}/control`)
        .then(({ body }) => {
          if (!alive) return;
          const list = body.messages ?? [];
          const top = list.length ? Math.max(...list.map((m) => m.seq)) : 0;
          // Lit: what arrived since the last look (nothing on the first one).
          if (lastSeq.current !== null && top > lastSeq.current) {
            const now = Date.now();
            setFresh((prev) => {
              const next = new Map(prev);
              for (const m of list) if (m.seq > lastSeq.current!) next.set(m.seq, now);
              return next;
            });
          }
          lastSeq.current = top;
          setMessages(list);
        })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, CONTROL_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug]);

  // Let the light fade.
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => {
      const now = Date.now();
      setFresh((prev) => new Map([...prev].filter(([, at]) => now - at < FRESH_MS)));
      tick((n) => n + 1);
    }, 1_000);
    return () => clearTimeout(t);
  }, [fresh]);

  if (!messages?.length) return null;
  const mineBy = viewerCars(data, focusNum, followed, myCars);
  const whose = (m: RaceControlMessage): Mine | null => {
    const kinds = m.cars.map((n) => carKey(data, n)).map((k) => (k !== null ? mineBy.get(k) ?? null : null));
    return kinds.includes("focus") ? "focus" : kinds.includes("following") ? "following" : kinds.includes("my car") ? "my car" : null;
  };
  const mineCount = messages.filter((m) => whose(m) !== null).length;
  const list = onlyMine ? messages.filter((m) => whose(m) !== null) : messages;
  const shown = all ? list : list.slice(0, SHOWN);
  return (
    <section aria-label="Race control" aria-live="polite" className="flex flex-col gap-1 border-t px-3 py-2 text-xs sm:px-6" style={{ borderColor: C.line, color: C.muted }}>
      <div className="flex items-center gap-2">
        <span className="font-semibold" style={{ color: C.text }}>
          Race control
        </span>
        <span>({messages.length})</span>
        {mineCount > 0 && (
          <button
            type="button"
            aria-pressed={onlyMine}
            onClick={() => setOnlyMine((v) => !v)}
            className="rounded px-1.5 py-0.5 font-semibold"
            style={{ background: onlyMine ? C.focus : C.mine, color: onlyMine ? "#0b0b18" : C.focus }}
            title="Only the messages about the focus car, the cars you follow on the map, and your cars"
          >
            Your cars ({mineCount})
          </button>
        )}
        {list.length > SHOWN && (
          <button type="button" onClick={() => setAll((v) => !v)} className="ml-auto underline hover:text-white">
            {all ? "Show latest" : "Show all"}
          </button>
        )}
      </div>
      <ol className={`custom-scroll m-0 flex list-none flex-col gap-0.5 p-0 ${all ? "max-h-60 overflow-y-auto" : ""}`}>
        {shown.map((m) => {
          const keys = m.cars.map((n) => carKey(data, n));
          const mine = whose(m);
          const lit = fresh.has(m.seq);
          return (
            <li
              key={m.seq}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded px-1.5 py-1"
              style={{
                background: lit ? C.fresh : mine ? C.mine : undefined,
                boxShadow: mine ? `inset 3px 0 0 ${C.focus}` : undefined,
                transition: "background 1s",
              }}
            >
              <span className="tabular-nums" style={{ color: C.muted }}>
                {m.at ?? ""}
              </span>
              {m.cars.map((n, i) => {
                const k = keys[i];
                const cls = k !== null ? data.cars[String(k)]?.cls : undefined;
                const own = k !== null && mineBy.has(k);
                return (
                  <span
                    key={`${n}-${i}`}
                    className="rounded-md border px-1 font-bold tabular-nums"
                    style={{ borderColor: own ? (k === focusNum ? C.focus : "#ffffff") : C.chip, borderLeft: `3px solid ${liveClassColor(cls)}`, color: C.text }}
                  >
                    #{n}
                  </span>
                );
              })}
              <span className="font-semibold" style={{ color: C.text }}>
                {m.note}
              </span>
              {m.corner && <span>T{m.corner.replace(/^t(urn)?\s*/i, "")}</span>}
              {m.status && <span>· {m.status}</span>}
              {m.action && (
                <span className="font-semibold" style={{ color: isPenalty(m.action) ? C.penalty : C.muted }}>
                  · {m.action}
                </span>
              )}
              {mine && (
                <span className="rounded px-1 text-[10px] font-bold uppercase" style={{ background: C.focus, color: "#0b0b18" }}>
                  {mine === "focus" ? "Focus car" : mine === "following" ? "Following" : "My car"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
