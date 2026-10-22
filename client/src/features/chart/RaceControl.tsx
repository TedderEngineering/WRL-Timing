/**
 * RaceTrace Live, under the track map: race control's messages as they come in (the server reads
 * the log every 15 s; this asks every 15 s while the page is open, through the edge). Newest
 * first: the latest few, or all of them. A message that arrived since the last look is lit for a
 * few seconds; one naming the focus car or a followed car is marked.
 */
import { useEffect, useRef, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { getPublic } from "../../hooks/useLiveChartData";
import { carKey } from "./car-number";
import { liveClassColor } from "./constants";

export interface RaceControlMessage {
  seq: number;
  at: string | null;
  cars: string[];
  corner: string | null;
  note: string;
  status: string | null;
  action: string | null;
}

const C = { line: "#1e1e38", text: "#e0e0e8", muted: "#9a9ab4", chip: "#2a2a48", focus: "#F48C34", fresh: "rgba(250,178,25,0.16)", penalty: "#f87171" };
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
  const shown = all ? messages : messages.slice(0, SHOWN);
  return (
    <section aria-label="Race control" aria-live="polite" className="flex flex-col gap-1 border-t px-3 py-2 text-xs sm:px-6" style={{ borderColor: C.line, color: C.muted }}>
      <div className="flex items-center gap-2">
        <span className="font-semibold" style={{ color: C.text }}>
          Race control
        </span>
        <span>({messages.length})</span>
        {messages.length > SHOWN && (
          <button type="button" onClick={() => setAll((v) => !v)} className="ml-auto underline hover:text-white">
            {all ? "Show latest" : "Show all"}
          </button>
        )}
      </div>
      <ol className={`custom-scroll m-0 flex list-none flex-col gap-0.5 p-0 ${all ? "max-h-60 overflow-y-auto" : ""}`}>
        {shown.map((m) => {
          const keys = m.cars.map((n) => carKey(data, n));
          const mine = keys.some((k) => k !== null && (k === focusNum || followed.has(k)));
          const lit = fresh.has(m.seq);
          return (
            <li
              key={m.seq}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded px-1.5 py-1"
              style={{ background: lit ? C.fresh : mine ? "rgba(244,140,52,0.08)" : undefined, transition: "background 1s" }}
            >
              <span className="tabular-nums" style={{ color: C.muted }}>
                {m.at ?? ""}
              </span>
              {m.cars.map((n, i) => {
                const k = keys[i];
                const cls = k !== null ? data.cars[String(k)]?.cls : undefined;
                const own = k !== null && (k === focusNum || followed.has(k));
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
                <span className="rounded px-1 text-[10px] font-bold" style={{ background: C.focus, color: "#0b0b18" }}>
                  {keys.includes(focusNum) ? "FOCUS CAR" : "FOLLOWING"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
