/**
 * The phone's car controls (mobile redesign, PR 3): one sticky car pill above the chart, and a
 * car sheet behind it with the focus car, class, make, compare cars and the x axis. It replaces
 * the phone's Filters panel, whose wall of 20 px car chips pushed the chart three-quarters of
 * the way down the screen.
 *
 * Same state as the laptop control bar (TraceControls; trace-view.ts), so both tabs and both
 * widths keep the same cars, and the laptop's look: orange focus outline, orange selected
 * segment on dark, compare cars in their trace colours.
 */
import { useMemo, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { Sheet } from "../../components/Sheet";
import { getCompColor } from "./chart-renderer";
import { carGroups } from "./car-groups";
import { carNo } from "./car-number";
import { AxisToggle, T } from "./controls-ui";
import { finishInfo } from "./finish";
import { makeGroupsOf } from "./makes";
import type { TraceView } from "./trace-view";

type Axis = "laps" | "hours" | "both";

export interface PhoneCarBarProps {
  data: RaceChartData;
  focusNum: number;
  onFocus: (n: number) => void;
  classView: string;
  compSet: Set<number>;
  view: TraceView;
  xAxisMode?: Axis;
  setXAxisMode?: (m: Axis) => void;
  /** A phone held sideways: the pill sits in the race page's one top row, without its own band. */
  slim?: boolean;
}

const label = "mb-2 mt-5 text-[12px] font-semibold uppercase tracking-[0.06em]";
const row44 = "flex min-h-[44px] items-center";

export function PhoneCarBar(p: PhoneCarBarProps) {
  const { data, focusNum, compSet } = p;
  const [open, setOpen] = useState(false);
  const focus = data.cars[String(focusNum)];
  const compare = [...compSet].filter((n) => n !== focusNum);
  const finish = finishInfo(data, focusNum);
  const place = finish?.posClass != null ? `P${finish.posClass}` : (finish?.official ?? "");

  return (
    <div
      data-phone-shell="car-bar"
      className={p.slim ? "min-w-0" : "sticky top-0 z-20 border-b px-3 py-2"}
      style={p.slim ? undefined : { background: "#0b0b18", borderColor: T.line }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Cars on the chart: focus #${carNo(data, focusNum)} ${focus?.team ?? ""}, comparing ${p.view.compareAll ? "every car in view" : `${compare.length} cars`}. Change`}
        data-compare-count={compare.length}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-full border px-4 text-sm"
        style={{ background: T.card, borderColor: T.accent, color: T.text }}
      >
        <span className="font-mono font-semibold">#{carNo(data, focusNum)}</span>
        <span className="min-w-0 truncate">{focus?.team}</span>
        <span className="shrink-0 whitespace-nowrap" style={{ color: T.muted }}>
          · {focus?.cls}
          {place ? ` · ${place}` : ""}
        </span>
        <span className="ml-auto shrink-0 whitespace-nowrap" style={{ color: T.soft }}>
          {p.view.compareAll ? "vs all" : `vs ${compare.length}`} ▾
        </span>
      </button>
      <CarSheet {...p} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function CarSheet(p: PhoneCarBarProps & { open: boolean; onClose: () => void }) {
  const { data, focusNum, classView, compSet, view } = p;
  // The car list replaces the sheet's settings while picking: the focus car, or cars to compare.
  const [picking, setPicking] = useState<null | "focus" | "compare">(null);
  const [q, setQ] = useState("");
  const groups = useMemo(() => carGroups(data, q), [data, q]);
  const classes = Object.entries(data.classGroups).sort(([a], [b]) => a.localeCompare(b));
  const makeGroups = useMemo(() => makeGroupsOf(data), [data]);
  const makes = useMemo(() => {
    if (!makeGroups) return [];
    const inView = new Set(classView ? (data.classGroups[classView] ?? []) : Object.keys(data.cars).map(Number));
    return Object.entries(makeGroups)
      .map(([m, cars]) => ({ m, n: cars.filter((c) => inView.has(c)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || a.m.localeCompare(b.m));
  }, [makeGroups, classView, data]);
  const compare = [...compSet].filter((n) => n !== focusNum);
  const focusCls = data.cars[String(focusNum)]?.cls ?? "";

  const close = () => {
    setPicking(null);
    setQ("");
    p.onClose();
  };
  const seg = (on: boolean) => ({
    background: on ? T.accent : "transparent",
    color: on ? "#0b0b18" : T.soft,
    fontWeight: on ? 600 : 400,
    borderColor: T.border,
  });
  const chip = (on: boolean) => ({
    background: on ? "rgba(244,140,52,0.14)" : T.card,
    borderColor: on ? T.accent : T.border,
    color: on ? T.text : T.soft,
  });

  if (picking) {
    const focusPick = picking === "focus";
    return (
      <Sheet open={p.open} onClose={close} title={focusPick ? "Choose the focus car" : "Cars to compare"}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Car number, team, driver or make"
          aria-label="Search cars"
          className="sticky top-[60px] z-10 min-h-[44px] w-full rounded-lg border px-3 text-base outline-none"
          style={{ background: "#0b0b18", borderColor: T.border, color: T.text }}
        />
        {groups.map((g) => (
          <div key={g.cls}>
            <div className={label} style={{ color: T.muted }}>
              {g.cls}
            </div>
            {g.cars.map((c) => {
              const on = focusPick ? c.n === focusNum : compSet.has(c.n) && c.n !== focusNum;
              const isFocus = c.n === focusNum;
              const col = !focusPick && on ? getCompColor(compSet, focusNum, c.n) : undefined;
              return (
                <button
                  key={c.n}
                  type="button"
                  disabled={c.dns || (!focusPick && isFocus)}
                  aria-pressed={on}
                  onClick={() => {
                    if (focusPick) {
                      p.onFocus(c.n);
                      setPicking(null);
                      setQ("");
                    } else view.toggleComp(c.n);
                  }}
                  className="flex min-h-[48px] w-full items-center gap-3 border-b text-left text-[15px] disabled:opacity-40"
                  style={{ borderColor: T.line, color: T.text }}
                >
                  <span className="w-14 shrink-0 font-mono font-semibold" style={{ color: isFocus ? T.accent : (col ?? T.text) }}>
                    #{carNo(data, c.n)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate" style={{ color: T.soft }}>
                      {c.team}
                    </span>
                    {c.driver && (
                      <span className="truncate text-[13px]" style={{ color: T.muted }}>
                        {c.driver}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[13px]" style={{ color: T.muted }}>
                    {c.dns ? "DNS" : c.classified ? `P${c.pos}` : c.official}
                  </span>
                  <span aria-hidden className="w-5 shrink-0 text-center" style={{ color: col ?? T.accent }}>
                    {on ? "✓" : !focusPick && !isFocus ? "+" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="py-4 text-sm" style={{ color: T.muted }}>
            No car matches.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setPicking(null);
            setQ("");
          }}
          className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-full border text-[15px] font-semibold"
          style={{ background: "rgba(244,140,52,0.14)", borderColor: T.accent, color: T.text }}
        >
          {focusPick ? "Back" : `Done · ${compare.length} compared`}
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet open={p.open} onClose={close} title="Cars on the chart">
      {/* Focus */}
      <div className={label} style={{ color: T.muted }}>
        Focus
      </div>
      <button
        type="button"
        onClick={() => setPicking("focus")}
        className="flex min-h-[48px] w-full items-center gap-2 rounded-lg border px-4 text-left text-[15px]"
        style={{ background: "rgba(244,140,52,0.10)", borderColor: T.accent, color: T.text }}
      >
        <span className="font-mono font-semibold" style={{ color: T.accent }}>
          #{carNo(data, focusNum)}
        </span>
        <span className="min-w-0 flex-1 truncate">{data.cars[String(focusNum)]?.team}</span>
        <span style={{ color: T.muted }}>Change ›</span>
      </button>

      {/* Class */}
      {classes.length > 1 && (
        <>
          <div className={label} style={{ color: T.muted }}>
            Class
          </div>
          <div role="group" aria-label="Class" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!classView} onClick={() => view.pickClass("")} className={`${row44} rounded-lg border px-3 text-sm`} style={seg(!classView)}>
              All {data.totalCars}
            </button>
            {classes.map(([cls, cars]) => (
              <button
                key={cls}
                type="button"
                aria-pressed={classView === cls}
                onClick={() => view.pickClass(classView === cls ? "" : cls)}
                className={`${row44} rounded-lg border px-3 text-sm`}
                style={seg(classView === cls)}
              >
                {cls} {cars.length}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Make */}
      {makes.length >= 2 && (
        <>
          <div className={label} style={{ color: T.muted }}>
            Make
          </div>
          <div role="group" aria-label="Make" className="flex flex-wrap gap-2">
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
                    view.setMakeFilter(next.length === makes.length ? [] : next);
                  }}
                  className={`${row44} rounded-full border px-3 text-sm`}
                  style={chip(on)}
                >
                  {m ? `${m} ${n}` : "All makes"}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Compare */}
      <div className={label} style={{ color: T.muted }}>
        Compare with
      </div>
      <div role="group" aria-label="Compare with" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={view.compareRivals} onClick={view.setCompareRivals} className={`${row44} rounded-full border px-3 text-sm`} style={chip(view.compareRivals)}>
          {focusCls ? `${focusCls} rivals` : "Class rivals"}
        </button>
        <button type="button" aria-pressed={view.compareAll} onClick={() => view.setCompareAll(true)} className={`${row44} rounded-full border px-3 text-sm`} style={chip(view.compareAll)}>
          Every car in view ({view.fieldCars.length - (view.fieldCars.includes(focusNum) ? 1 : 0)})
        </button>
        <button type="button" onClick={view.clearComp} disabled={compare.length === 0} className={`${row44} rounded-full border px-3 text-sm disabled:opacity-40`} style={chip(false)}>
          None
        </button>
      </div>
      {view.compareRivals && (
        <p className="mb-0 mt-2 text-[13px]" style={{ color: T.muted }}>
          Up to two cars ahead and two behind #{carNo(data, focusNum)} in the {focusCls} finishing order.
        </p>
      )}
      {!view.compareAll && (
        <div className="mt-3 flex flex-wrap gap-2">
          {compare.map((n) => {
            const col = getCompColor(compSet, focusNum, n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => view.toggleComp(n)}
                aria-label={`Stop comparing #${carNo(data, n)}`}
                className={`${row44} gap-2 rounded-full border px-3 font-mono text-sm`}
                style={{ borderColor: col, background: `${col}22`, color: T.text }}
              >
                #{carNo(data, n)} <span aria-hidden style={{ color: T.muted }}>×</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPicking("compare")}
            className={`${row44} rounded-full border border-dashed px-3 text-sm`}
            style={{ borderColor: T.border, color: T.soft }}
          >
            + Add a car
          </button>
        </div>
      )}

      {/* X axis (Position Trace) */}
      {p.xAxisMode && p.setXAxisMode && (
        <>
          <div className={label} style={{ color: T.muted }}>
            Bottom axis
          </div>
          <AxisToggle value={p.xAxisMode} onChange={p.setXAxisMode} />
        </>
      )}

      <button
        type="button"
        onClick={close}
        className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full border text-[15px] font-semibold"
        style={{ background: "rgba(244,140,52,0.14)", borderColor: T.accent, color: T.text }}
      >
        Done
      </button>
    </Sheet>
  );
}
