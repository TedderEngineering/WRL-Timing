/**
 * Control bar of the race charts (Position Trace and Lap Times; mockups F1 / F6): focus car,
 * class, make and the compare cars, the same on both tabs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { getCompColor } from "./chart-renderer";
import { TRACE } from "./constants";
import { makeGroupsOf } from "./makes";
import type { TraceView } from "./trace-view";

const T = {
  card: "#12122a",
  border: "#3a3a5c",
  line: "#1e1e38",
  text: "#e0e0e8",
  soft: "#cbd5e1",
  muted: "#9a9ab4",
  accent: TRACE.focus,
};

const labelCls = "text-[11px] uppercase tracking-[0.06em]";

export interface TraceControlsProps {
  data: RaceChartData;
  focusNum: number;
  onFocus: (n: number) => void;
  classView: string;
  compSet: Set<number>;
  /** Class, makes and compare, shared by both charts (trace-view.ts). */
  view: TraceView;
  /** Position Trace only: the x axis (shown in the phone Filters panel). */
  xAxisMode?: "laps" | "hours" | "both";
  setXAxisMode?: (m: "laps" | "hours" | "both") => void;
}

/** The small pills and car chips of the compare row (the Lap Times look, used on both tabs). */
const pill = (on: boolean) => ({
  background: on ? "rgba(244,140,52,0.14)" : T.card,
  borderColor: on ? T.accent : T.line,
  color: on ? T.text : T.muted,
});

function carLabel(data: RaceChartData, n: number) {
  const c = data.cars[String(n)];
  return c ? `${c.team}` : "";
}

/** Searchable list of cars, grouped by class in finishing order. */
function CarMenu({
  data,
  exclude,
  onPick,
  onClose,
  title,
}: {
  data: RaceChartData;
  exclude: Set<number>;
  onPick: (n: number) => void;
  onClose: () => void;
  title: string;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const byCls = new Map<
      string,
      Array<{ n: number; team: string; pos: number; make?: string; dns: boolean }>
    >();
    for (const [k, c] of Object.entries(data.cars)) {
      const n = Number(k);
      if (exclude.has(n)) continue;
      if (
        needle &&
        !String(n).includes(needle) &&
        !c.team.toLowerCase().includes(needle) &&
        !(c.make ?? "").toLowerCase().includes(needle)
      )
        continue;
      const list = byCls.get(c.cls) ?? [];
      list.push({
        n,
        team: c.team,
        pos: c.finishPosClass || 999,
        make: c.make,
        dns: c.laps.length === 0,
      });
      byCls.set(c.cls, list);
    }
    return [...byCls.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cls, cars]) => ({ cls, cars: cars.sort((a, b) => a.pos - b.pos) }));
  }, [data, exclude, q]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className="absolute left-0 top-full z-30 mt-1 flex max-h-[60vh] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border shadow-2xl"
      style={{ background: T.card, borderColor: T.border }}
    >
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Car number, team or make"
        className="m-2 rounded-md border px-3 py-2 text-sm outline-none"
        style={{ background: "#0b0b18", borderColor: T.border, color: T.text }}
      />
      <div className="overflow-y-auto pb-2">
        {groups.map((g) => (
          <div key={g.cls}>
            <div className={`${labelCls} px-3 pb-1 pt-2`} style={{ color: T.muted }}>
              {g.cls}
            </div>
            {g.cars.map((c) => (
              <button
                key={c.n}
                type="button"
                disabled={c.dns}
                onClick={() => onPick(c.n)}
                className="flex min-h-[40px] w-full items-center gap-3 px-3 text-left text-sm hover:bg-white/5 disabled:opacity-40"
                style={{ color: T.text }}
              >
                <span className="w-12 font-mono font-semibold">#{c.n}</span>
                <span className="min-w-0 flex-1 truncate" style={{ color: T.soft }}>
                  {c.team}
                </span>
                <span className="font-mono text-xs" style={{ color: T.muted }}>
                  {c.dns ? "DNS" : `P${c.pos}`}
                </span>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-3 py-4 text-sm" style={{ color: T.muted }}>
            No car matches.
          </p>
        )}
      </div>
    </div>
  );
}

function useCompact() {
  const q = "(max-width: 639px)";
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(q).matches
  );
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setCompact(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return compact;
}

export function TraceControls(p: TraceControlsProps) {
  const { data, focusNum, classView, compSet, view } = p;
  const [menu, setMenu] = useState<"focus" | null>(null);
  // Phone (mockup F6): the focus car and a Filters button; the rest opens below.
  const compact = useCompact();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showFilters = !compact || filtersOpen;
  const focus = data.cars[String(focusNum)];
  const classes = Object.entries(data.classGroups).sort(([a], [b]) => a.localeCompare(b));
  const makeGroups = useMemo(() => makeGroupsOf(data), [data]);
  const makes = useMemo(() => {
    if (!makeGroups) return [];
    const inView = new Set(
      classView ? (data.classGroups[classView] ?? []) : Object.keys(data.cars).map(Number)
    );
    return Object.entries(makeGroups)
      .map(([m, cars]) => ({ m, n: cars.filter((c) => inView.has(c)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || a.m.localeCompare(b.m));
  }, [makeGroups, classView, data]);
  const compare = [...compSet].filter((n) => n !== focusNum);
  const chips = [...view.fieldCars].sort((a, b) => a - b);

  const seg = (on: boolean) => ({
    background: on ? T.accent : "transparent",
    color: on ? "#0b0b18" : T.soft,
    fontWeight: on ? 600 : 400,
  });

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-6"
      style={{ borderColor: T.line }}
    >
      {/* Focus */}
      <div className={`relative flex items-center gap-2 ${compact ? "w-full" : ""}`}>
        {!compact && (
          <span className={labelCls} style={{ color: T.muted }}>
            Focus
          </span>
        )}
        <button
          type="button"
          onClick={() => setMenu(menu === "focus" ? null : "focus")}
          aria-haspopup="dialog"
          aria-expanded={menu === "focus"}
          aria-label={`Focus car: #${focusNum} ${focus?.team ?? ""}. Change`}
          className={`flex min-h-[36px] items-center gap-2 border px-3 text-sm ${compact ? "min-w-0 flex-1 rounded-full" : "max-w-[320px] rounded-md"}`}
          style={{ background: T.card, borderColor: T.accent, color: T.text }}
        >
          <span className="font-mono font-semibold">#{focusNum}</span>
          <span className="min-w-0 truncate">{focus?.team}</span>
          <span className="shrink-0 whitespace-nowrap" style={{ color: T.muted }}>· {focus?.cls}</span>
          <span aria-hidden className="ml-auto">
            ▾
          </span>
        </button>
        {compact && (
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className="min-h-[36px] shrink-0 rounded-full border px-3.5 text-[13px]"
            style={{
              background: T.card,
              borderColor: filtersOpen ? T.accent : T.border,
              color: T.text,
            }}
          >
            Filters
            {classView || compSet.size
              ? ` · ${[classView, compSet.size ? `${[...compSet].filter((n) => n !== focusNum).length} compare` : ""].filter(Boolean).join(", ")}`
              : ""}
          </button>
        )}
        {menu === "focus" && (
          <CarMenu
            title="Choose the focus car"
            data={data}
            exclude={new Set([focusNum])}
            onPick={(n) => {
              p.onFocus(n);
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
          />
        )}
      </div>

      {/* Class */}
      {showFilters && classes.length > 1 && (
        <div
          role="group"
          aria-label="Class"
          className="flex overflow-hidden rounded-md border"
          style={{ borderColor: T.border }}
        >
          <button
            type="button"
            aria-pressed={!classView}
            onClick={() => view.pickClass("")}
            className="min-h-[32px] px-2.5 text-[13px]"
            style={seg(!classView)}
          >
            All {data.totalCars}
          </button>
          {classes.map(([cls, cars]) => (
            <button
              key={cls}
              type="button"
              aria-pressed={classView === cls}
              onClick={() => view.pickClass(classView === cls ? "" : cls)}
              className="min-h-[32px] border-l px-2.5 text-[13px]"
              style={{ ...seg(classView === cls), borderColor: T.border }}
            >
              {cls} {cars.length}
            </button>
          ))}
        </div>
      )}

      {/* Make */}
      {showFilters && makes.length >= 2 && (
        <div
          role="group"
          aria-label="Make"
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className={labelCls} style={{ color: T.muted }}>
            Make
          </span>
          {[{ m: "", n: 0 }, ...makes].map(({ m, n }) => {
            const on = m ? view.makeFilter.includes(m) : view.makeFilter.length === 0;
            return (
              <button
                key={m || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (!m) return view.setMakeFilter([]);
                  const next = on ? view.makeFilter.filter((x) => x !== m) : [...view.makeFilter, m];
                  // Every make picked is the same as all of them.
                  view.setMakeFilter(next.length === makes.length ? [] : next);
                }}
                className="rounded-xl border px-2.5 py-0.5 text-[11px]"
                style={pill(on)}
              >
                {m ? `${m} ${n}` : "All"}
              </button>
            );
          })}
        </div>
      )}

      {/* Compare: every car in view as a small chip, coloured when compared (as on Lap Times) */}
      {showFilters && (
        <div className="flex w-full flex-wrap items-center gap-1">
          <span className={`${labelCls} mr-1`} style={{ color: T.muted }}>
            Compare
          </span>
          <button
            type="button"
            aria-pressed={view.compareAll}
            onClick={() => view.setCompareAll(true)}
            title="Compare with every car in view, each in its own colour"
            className="rounded-xl border px-2.5 py-0.5 text-[11px]"
            style={pill(view.compareAll)}
          >
            All {classView || "cars"} ({chips.length})
          </button>
          <button
            type="button"
            onClick={view.clearComp}
            disabled={compare.length === 0}
            className="mr-1 rounded-xl border px-2.5 py-0.5 text-[11px] disabled:opacity-40"
            style={pill(false)}
          >
            Clear
          </button>
          {chips.map((n) => {
            const on = compSet.has(n) && n !== focusNum;
            const isFocus = n === focusNum;
            const col = on ? getCompColor(compSet, focusNum, n) : undefined;
            const car = data.cars[String(n)];
            const noLaps = !car || car.laps.length === 0;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                disabled={isFocus || noLaps}
                onClick={() => view.toggleComp(n)}
                title={isFocus ? `${carLabel(data, n)} (focus car)` : `${carLabel(data, n)}${car?.make ? ` · ${car.make}` : ""} (${car?.cls})${noLaps ? ` — ${car?.status || "no laps"}` : ""}`}
                className="rounded-lg border px-2 py-0.5 font-mono text-[11px]"
                style={{
                  borderColor: isFocus ? T.accent : col || T.line,
                  background: isFocus ? "rgba(244,140,52,0.14)" : col ? `${col}33` : "transparent",
                  color: isFocus ? T.accent : on ? "#fff" : "#6b6b88",
                  opacity: noLaps ? 0.35 : 1,
                }}
              >
                #{n}
              </button>
            );
          })}
        </div>
      )}

      {compact && filtersOpen && p.xAxisMode && p.setXAxisMode && <AxisToggle value={p.xAxisMode} onChange={p.setXAxisMode} />}
    </div>
  );
}

/** Laps / Time / Both for the x axis. */
export function AxisToggle({
  value,
  onChange,
  small,
}: {
  value: "laps" | "hours" | "both";
  onChange: (m: "laps" | "hours" | "both") => void;
  small?: boolean;
}) {
  return (
    <div role="group" aria-label="X axis" className="flex overflow-hidden rounded-md border" style={{ borderColor: T.border }}>
      {(["laps", "hours", "both"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onChange(m)}
          className={small ? "min-h-[28px] px-2.5 text-xs" : "min-h-[40px] px-3 text-sm"}
          style={{ background: value === m ? T.line : "transparent", color: value === m ? T.text : T.muted }}
        >
          {m === "laps" ? "Laps" : m === "hours" ? "Time" : "Both"}
        </button>
      ))}
    </div>
  );
}
