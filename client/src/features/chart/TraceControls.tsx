/**
 * Control bar of the race charts (Position Trace and Lap Times; mockups F1 / F6): focus car,
 * class, make and the compare cars, the same on both tabs.
 */
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { getCompColor } from "./chart-renderer";
import { makeGroupsOf } from "./makes";
import { useIsCompact } from "../../lib/breakpoint";
import type { TraceView } from "./trace-view";
import { carNo } from "./car-number";
import { carGroups } from "./car-groups";
import { AxisToggle, T } from "./controls-ui";
import { PhoneCarBar } from "./CarSheet";


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
  /**
   * RaceTrace Live: where the focus car and class picker go instead of their own row (the page's
   * tab row). Wider than a phone only; a phone keeps them here.
   */
  headSlot?: HTMLElement | null;
  /**
   * Phones held sideways: the race page's top row, where the car pill goes so the chart keeps
   * the height (the pill is portalled there, slim).
   */
  phoneSlot?: HTMLElement | null;
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

/**
 * Searchable list of cars, grouped by class in finishing order. The current focus car is listed
 * too, ticked, so the class order reads from P1 (it used to be left out, so a winner's list began at P2).
 */
function CarMenu({
  data,
  selected,
  onPick,
  onClose,
  title,
}: {
  data: RaceChartData;
  selected: number;
  onPick: (n: number) => void;
  onClose: () => void;
  title: string;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Open on the current focus car (scroll the list only, never the page).
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>("[data-selected]");
    if (list && row) list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 3);
  }, []);
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

  const groups = useMemo(() => carGroups(data, q), [data, q]);

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
        placeholder="Car number, team, driver or make"
        className="m-2 rounded-md border px-3 py-2 text-sm outline-none"
        style={{ background: "#0b0b18", borderColor: T.border, color: T.text }}
      />
      <div ref={listRef} className="relative overflow-y-auto pb-2">
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
                aria-current={c.n === selected ? "true" : undefined}
                data-selected={c.n === selected || undefined}
                onClick={() => (c.n === selected ? onClose() : onPick(c.n))}
                className="flex min-h-[40px] w-full items-center gap-3 px-3 text-left text-sm hover:bg-white/5 disabled:opacity-40"
                style={{ color: T.text, background: c.n === selected ? "rgba(244,140,52,0.10)" : undefined }}
              >
                <span className="w-12 font-mono font-semibold" style={{ color: c.n === selected ? T.accent : undefined }}>
                  #{carNo(data, c.n)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate" style={{ color: T.soft }}>
                    {c.team}
                  </span>
                  {c.driver && (
                    <span className="truncate text-xs" style={{ color: T.muted }}>
                      {c.driver}
                    </span>
                  )}
                </span>
                {c.n === selected && (
                  <span aria-label="current focus" className="text-xs" style={{ color: T.accent }}>
                    ✓
                  </span>
                )}
                <span className="font-mono text-xs" style={{ color: T.muted }}>
                  {c.dns ? "DNS" : c.classified ? `P${c.pos}` : data.maxLap > 0 ? c.official : ""}
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

export function TraceControls(p: TraceControlsProps) {
  const { data, focusNum, classView, compSet, view } = p;
  const [menu, setMenu] = useState<"focus" | null>(null);
  // Phones have their own car pill and sheet (CarSheet.tsx, mobile redesign PR 3).
  const compact = useIsCompact();
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
  if (compact) {
    const bar = (
      <PhoneCarBar
        data={data}
        focusNum={focusNum}
        onFocus={p.onFocus}
        classView={classView}
        compSet={compSet}
        view={view}
        xAxisMode={p.xAxisMode}
        setXAxisMode={p.setXAxisMode}
        slim={!!p.phoneSlot}
      />
    );
    return p.phoneSlot ? createPortal(bar, p.phoneSlot) : bar;
  }
  const compare = [...compSet].filter((n) => n !== focusNum);
  // In published-number order: "007" sits with "7", not after the stand-in key (car-number.ts).
  const chips = [...view.fieldCars].sort((a, b) => {
    const [x, y] = [carNo(data, a), carNo(data, b)];
    return parseInt(x, 10) - parseInt(y, 10) || x.localeCompare(y);
  });

  const seg = (on: boolean) => ({
    background: on ? T.accent : "transparent",
    color: on ? "#0b0b18" : T.soft,
    fontWeight: on ? 600 : 400,
  });

  const head = p.headSlot ?? null;
  const focusAndClass = (
    <>
      {/* Focus */}
      <div className="relative flex items-center gap-2">
        <span className={labelCls} style={{ color: T.muted }}>
          Focus
        </span>
        <button
          type="button"
          onClick={() => setMenu(menu === "focus" ? null : "focus")}
          aria-haspopup="dialog"
          aria-expanded={menu === "focus"}
          aria-label={`Focus car: #${carNo(data, focusNum)} ${focus?.team ?? ""}. Change`}
          className="flex min-h-[36px] max-w-[320px] items-center gap-2 rounded-md border px-3 text-sm"
          style={{ background: T.card, borderColor: T.accent, color: T.text }}
        >
          <span className="font-mono font-semibold">#{carNo(data, focusNum)}</span>
          <span className="min-w-0 truncate">{focus?.team}</span>
          <span className="shrink-0 whitespace-nowrap" style={{ color: T.muted }}>· {focus?.cls}</span>
          <span aria-hidden className="ml-auto">
            ▾
          </span>
        </button>
        {menu === "focus" && (
          <CarMenu
            title="Choose the focus car"
            data={data}
            selected={focusNum}
            onPick={(n) => {
              p.onFocus(n);
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
          />
        )}
      </div>

      {/* Class */}
      {classes.length > 1 && (
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
    </>
  );

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-6"
      style={{ borderColor: T.line }}
    >
      {head ? createPortal(focusAndClass, head) : focusAndClass}

      {/* Make */}
      {makes.length >= 2 && (
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
          const noLaps = !car || (car.laps.length === 0 && data.maxLap > 0);
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
              #{carNo(data, n)}
            </button>
          );
        })}
      </div>


    </div>
  );
}

export { AxisToggle };
