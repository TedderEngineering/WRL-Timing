import { useState, useMemo, useEffect } from "react";
import { api, ApiClientError } from "../../lib/api";
import { Link } from "react-router-dom";
import type { RaceChartData } from "@shared/types";
import { carKey } from "./car-number";
import { CLASS_COLORS } from "./constants";
import { useIsCompact } from "../../lib/breakpoint";
import { ChipRow, PC, RowCard, SectionLabel, SortBar, StatGrid } from "./phone-cards";
import {
  DEFAULT_PIT_SORT,
  PIT_COLORS,
  PIT_KEY,
  PIT_KIND_LABEL,
  PIT_SORTS,
  isCautionStop,
  laneTime,
  pitMethod,
  pitRow,
  placesText,
  setPitView,
  stopPlaces,
  sortPits,
  stopTone,
  type PitRow,
  type PitSort,
  type PitSortKey,
  type StopPlaces,
} from "./pit-view";

// ─── API response types ─────────────────────────────────────────────────────

export interface PitStop {
  stopNumber: number;
  pitLap: number;
  condition: string;
  localRef_s: number | null;
  vsGlobal_s?: number;
  refSource: string;
  twoLapActual_s?: number;
  twoLapRef_s?: number;
  /** null when the stops come from the race's analysis package (no transit split). */
  serviceTime_s: number | null;
  pitRoadTime_s: number | null;
  timeLost_s: number | null;
  /** Legacy: against the car's own reference; analysis package: against the class pit cycle's mean. */
  delta_s: number | null;
  isCautionContaminated?: boolean;
  kind?: string;
  cycle?: number | null;
  /**
   * From the race's analysis: class positions before and after, over the whole class pit cycle
   * (on the car's first stop of the cycle) or over the visit itself (garage, penalty). netClass:
   * places gained, negative = lost.
   */
  classPosBefore?: number | null;
  classPosAfter?: number | null;
  netClass?: number | null;
  placesOver?: "cycle" | "stop" | null;
  /** The pit cycle never closed for the car (it retired, or the flag fell first). */
  cycleOpen?: boolean;
}

export interface CarAnalysis {
  carNumber: string;
  teamName: string;
  carClass: string;
  carColor: string | null;
  finishPos: number | null;
  stops: PitStop[];
}

export interface PitAnalysisResponse {
  /** "facts": the race's analysis package, the same stops as the Position Trace. */
  source?: "facts";
  raceId: string;
  track: string;
  trackConfig: { trackName: string; transitTime_s: number; transitOverhead_s: number } | null;
  cars: Record<string, CarAnalysis>;
  summary: {
    totalStops: number;
    totalCars: number;
    avgServiceTime_s: number | null;
    avgTimeLost_s: number | null;
  };
}

// ─── Style constants (matching StrategyTab) ─────────────────────────────────

const S = {
  bg: "#07080e",
  bg2: "#0c0e18",
  card: "#111425",
  bdr: "#1a1e36",
  bdr2: "#262b4a",
  txt: "#d0d4e8",
  txt2: "#8890b5",
  dim: "#555e88",
  acc: "#4a9eff",
  acc2: "#7b61ff",
  grn: "#22c55e",
  yel: "#eab308",
  red: "#ef4444",
  pit: "#ff6b9d",
} as const;

/** What the car did in the pit lane, when it was not an ordinary stop (left out of the averages). */
const KIND_LABEL: Record<string, string> = {
  garage: "Garage / long stop",
  drive_through: "Drive-through",
  stop_and_go: "Stop and go",
  penalty_served: "Penalty",
  retirement: "Retired",
  red_flag_hold: "Red flag hold",
};

// ─── Format helpers ─────────────────────────────────────────────────────────

function fmtTime(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = abs - m * 60;
  const sign = s < 0 ? "-" : "";
  return m > 0
    ? `${sign}${m}:${sec.toFixed(1).padStart(4, "0")}`
    : `${sign}${sec.toFixed(1)}`;
}

function fmtDelta(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const sign = s >= 0 ? "+" : "";
  return `${sign}${s.toFixed(1)}s`;
}

// ─── Derived row type ───────────────────────────────────────────────────────

interface CarRow {
  carNumber: string;
  teamName: string;
  carClass: string;
  finishPos: number;
  stopCount: number;
  avgServiceTime: number | null;
  avgTimeLost: number | null;
  bestTimeLost: number | null;
  worstTimeLost: number | null;
  greenStops: number;
  cautionStops: number;
  stops: PitStop[];
}


// ─── Props ──────────────────────────────────────────────────────────────────

interface PitAnalysisTabProps {
  /** The saved race to load the analysis for (not needed with `analysis`). */
  raceId?: string;
  /** RaceTrace Live: the analysis built from the live chart (live-pit-analysis.ts), kept current. */
  analysis?: PitAnalysisResponse | null;
  /** The race's chart data, to turn a published car number ("007") into its chart car. */
  chart?: RaceChartData | null;
  focusNum: number;
  setFocusNum: React.Dispatch<React.SetStateAction<number>>;
  onSwitchToTrace: () => void;
  /**
   * RaceTrace Live: the class picked in the page's shared controls ("" = all classes: the focus
   * car's class here, a pit-stop table is one class's). Given, the tab's own class buttons are left off.
   */
  classView?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PitAnalysisTab({ raceId, analysis, chart, focusNum, setFocusNum, onSwitchToTrace, classView }: PitAnalysisTabProps) {
  const [loaded, setData] = useState<PitAnalysisResponse | null>(null);
  const data = analysis !== undefined ? analysis : loaded;
  const [loading, setLoading] = useState(analysis === undefined);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [selectedCar, setSelectedCar] = useState<string | null>(null);
  const compact = useIsCompact();

  // Fetch pit analysis data
  useEffect(() => {
    if (analysis !== undefined || !raceId) return; // RaceTrace Live: given, not loaded
    setLoading(true);
    setError(null);
    setData(null);
    api
      .get<PitAnalysisResponse>(`/races/${raceId}/pit-analysis`)
      .then((res) => setData(res))
      .catch((err) => {
        if (err instanceof ApiClientError) {
          setError({ message: err.message, code: err.code });
        } else {
          setError({ message: "Failed to load pit analysis" });
        }
      })
      .finally(() => setLoading(false));
    // `analysis` only says whether to load; its updates (each live update) need no reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  // Build rows
  const rows = useMemo(() => {
    if (!data) return [];
    return Object.values(data.cars).map((car): CarRow => {
      const greenStops = car.stops.filter((s) => s.condition === "Full green").length;
      const nums = (xs: (number | null)[]) => xs.filter((v): v is number => typeof v === "number");
      const serviceTimes = nums(car.stops.map((s) => s.serviceTime_s));
      // From the analysis package, averages and best / worst are over green stops (not garage
      // visits): under a caution, time lost is measured against cars on track and can come out ahead.
      const timeLosts = nums((data.source === "facts" ? car.stops.filter((s) => s.condition === "Full green" && (s.kind ?? "stop") === "stop") : car.stops).map((s) => s.timeLost_s));
      return {
        carNumber: car.carNumber,
        teamName: car.teamName,
        carClass: car.carClass,
        finishPos: car.finishPos ?? 999,
        stopCount: car.stops.length,
        avgServiceTime: serviceTimes.length > 0 ? serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length : null,
        avgTimeLost: timeLosts.length > 0 ? timeLosts.reduce((a, b) => a + b, 0) / timeLosts.length : null,
        bestTimeLost: timeLosts.length > 0 ? Math.min(...timeLosts) : null,
        worstTimeLost: timeLosts.length > 0 ? Math.max(...timeLosts) : null,
        greenStops,
        cautionStops: car.stops.length - greenStops,
        stops: car.stops,
      };
    });
  }, [data]);

  // The table, one class at a time (as the PDF): each car's stops summed up (pit-view.ts).
  const pitRows = useMemo<PitRow[]>(() => {
    if (!data) return [];
    const cars = Object.values(data.cars);
    const rankIn = (cls: string, fp: number | null) => 1 + cars.filter((c) => c.carClass === cls && (c.finishPos ?? 999) < (fp ?? 999)).length;
    return cars.map((c) => {
      const k = carKey(chart, c.carNumber);
      const ch = k !== null ? chart?.cars[String(k)] : undefined;
      const classPos = ch?.finishPosClass || (c.finishPos ? rankIn(c.carClass, c.finishPos) : 999);
      return pitRow(String(k ?? c.carNumber), c.carNumber, c.teamName, c.carClass, classPos, c.stops);
    });
  }, [data, chart]);
  const classes = useMemo(() => [...new Set(pitRows.map((r) => r.cls))].sort(), [pitRows]);
  const focusCls = chart?.cars[String(focusNum)]?.cls;
  const [cls, setCls] = useState<string>("");
  const shared = classView !== undefined;
  const picked = shared ? classView : cls;
  const activeClass = classes.includes(picked) ? picked : focusCls && classes.includes(focusCls) ? focusCls : (classes[0] ?? "");
  const [sort, setSort] = useState<PitSort>(DEFAULT_PIT_SORT);
  const classRows = useMemo(() => sortPits(pitRows.filter((r) => r.cls === activeClass), sort), [pitRows, activeClass, sort]);
  // The PDF button prints the table as it is now: this class, this order.
  useEffect(() => {
    if (chart && activeClass) setPitView(chart, { cls: activeClass, sort });
  }, [chart, activeClass, sort]);
  const selectedRow = selectedCar ? rows.find((r) => r.carNumber === selectedCar) : null;
  const sortBy = (key: PitSortKey) => setSort((x) => (x.key === key ? { key, dir: x.dir === "asc" ? "desc" : "asc" } : { key, dir: PIT_SORTS[key].dir }));

  // ── Loading state ─────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ color: S.txt, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", color: S.dim }}>Loading pit analysis...</div>
      </div>
    );
  }

  // ── Error / gating ────────────────────────────────────────────
  if (error) {
    if (error.code === "INSUFFICIENT_TIER") {
      return (
        <div style={{ color: S.txt, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 8 }}>Team Feature</div>
          <div style={{ fontSize: "0.85rem", color: S.txt2, marginBottom: 16 }}>
            Pit Stop Analysis is available on the Team plan. Upgrade to see service times, time lost, and pit strategy breakdowns.
          </div>
          <Link
            to="/pricing"
            style={{
              display: "inline-block",
              padding: "8px 20px",
              borderRadius: 8,
              background: S.acc,
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.85rem",
              textDecoration: "none",
            }}
          >
            View Pricing
          </Link>
        </div>
      );
    }
    return (
      <div style={{ color: S.txt, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", color: S.red }}>{error.message}</div>
      </div>
    );
  }

  // ── No data ───────────────────────────────────────────────────
  if (!data || data.summary.totalStops === 0) {
    return (
      <div style={{ color: S.txt, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", color: S.dim }}>
          {analysis !== undefined ? "No pit stops yet." : "No pit stop analysis available for this race. Analysis may not have been run yet."}
        </div>
      </div>
    );
  }

  const facts = data.source === "facts";
  const stopsInClass = classRows.reduce((n, r) => n + r.stops.length, 0);
  const lostInClass = classRows.flatMap((r) => r.stops.filter((x) => (x.kind ?? "stop") === "stop" && !isCautionStop(x)).map((x) => x.timeLost_s)).filter((v): v is number => typeof v === "number");
  const avgLostInClass = lostInClass.length ? lostInClass.reduce((a, b) => a + b, 0) / lostInClass.length : null;
  const maxStops = Math.max(1, ...classRows.map((r) => r.stops.length));
  const cols: { key: PitSortKey; label: string; align: "left" | "right"; title?: string; wide?: boolean; cell: (r: PitRow) => React.ReactNode }[] = [
    { key: "classPos", label: "P", align: "right", cell: (r) => <b>{r.classPos >= 999 ? "—" : r.classPos}</b> },
    { key: "car", label: "Car", align: "left", cell: (r) => <span className="font-mono font-semibold" style={{ color: CLASS_COLORS[r.cls] ?? P.accent }}>#{r.label}</span> },
    { key: "team", label: "Team", align: "left", wide: true, cell: (r) => <span className="block max-w-[180px] truncate" title={r.team}>{r.team}</span> },
    { key: "stops", label: "Stops", align: "right", title: "Every pit-lane visit: stops, garage visits, drive-throughs and penalties", cell: (r) => r.visits },
    { key: "avgLane", label: facts ? "Avg lane" : "Avg service", align: "right", title: facts ? "Average time in the pit lane" : "Average service time", cell: (r) => <span className="font-mono">{fmtTime(r.avgLane)}</span> },
    { key: "avgLost", label: "Avg lost", align: "right", title: "Average time lost on green-flag stops", cell: (r) => <span className="font-mono">{fmtTime(r.avgLost)}</span> },
    { key: "best", label: "Best", align: "right", title: "Least time lost on a green-flag stop", cell: (r) => <span className="font-mono" style={{ color: P.gain }}>{fmtTime(r.best)}</span> },
    { key: "worst", label: "Worst", align: "right", title: "Most time lost on a green-flag stop", cell: (r) => <span className="font-mono" style={{ color: P.loss }}>{fmtTime(r.worst)}</span> },
  ];

  if (compact) {
    const mine = classRows.filter((r) => r.key === String(focusNum));
    const card = (r: PitRow, pinned = false) => {
      const open = r.label === selectedCar && (pinned || !mine.some((x) => x.key === r.key));
      const detail = open ? rows.find((x) => x.carNumber === r.label) : null;
      return (
        <RowCard
          key={`${pinned ? "pin" : "row"}-${r.key}`}
          focus={r.key === String(focusNum)}
          onClick={() => setSelectedCar(r.label === selectedCar ? null : r.label)}
          label={`#${r.label} ${r.team}: ${open ? "hide" : "show"} each stop`}
        >
          <div className="flex items-baseline gap-2">
            <span className="w-7 shrink-0 font-mono text-[14px] font-bold">{r.classPos >= 999 ? "—" : `P${r.classPos}`}</span>
            <span className="shrink-0 font-mono text-[15px] font-semibold" style={{ color: CLASS_COLORS[r.cls] ?? P.accent }}>#{r.label}</span>
            <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: P.soft }}>{r.team}</span>
            <span className="shrink-0 text-[13px]" style={{ color: P.muted }}>{r.visits} stops</span>
          </div>
          <StatGrid
            stats={[
              { label: facts ? "Avg lane" : "Avg service", value: fmtTime(r.avgLane) },
              { label: "Avg lost", value: fmtTime(r.avgLost) },
              { label: "Best", value: fmtTime(r.best), color: P.gain },
              { label: "Worst", value: fmtTime(r.worst), color: P.loss },
            ]}
            cols={4}
          />
          {/* Each stop, wrapped onto as many lines as it needs */}
          <div className="mt-2 flex flex-wrap gap-1">
            {r.stops.map((st, j) => (
              <StopCell key={j} s={st} facts={facts} />
            ))}
          </div>
          {detail ? (
            <PhoneStopList
              row={detail}
              facts={facts}
              onGoToTrace={() => {
                const k = carKey(chart, detail.carNumber);
                if (k !== null) setFocusNum(k);
                onSwitchToTrace();
              }}
            />
          ) : (
            <div className="mt-2 text-[12px]" style={{ color: P.accent }}>Each stop ›</div>
          )}
        </RowCard>
      );
    };
    return (
      <div className="pb-6" style={{ color: P.text }} data-phone-cards="pit-stops">
        <h2 className="m-0 text-[16px] font-semibold">Pit stops · {activeClass}</h2>
        <p className="m-0 mt-0.5 text-[13px]" style={{ color: P.muted }}>
          {classRows.length} cars · {stopsInClass} stops{avgLostInClass !== null ? ` · ${fmtTime(avgLostInClass)} lost on an average green-flag stop` : ""}
        </p>
        {classes.length > 1 && !shared && (
          <div className="mt-3">
            <ChipRow
              label="Class"
              items={classes.map((c) => ({ key: c, label: c, color: CLASS_COLORS[c] }))}
              value={activeClass}
              onChange={(c) => {
                setCls(c);
                setSelectedCar(null);
              }}
            />
          </div>
        )}
        <div className="mt-3">
          <SortBar
            options={cols.map((c) => ({ key: c.key, label: PIT_SORT_LABEL[c.key] ?? c.label }))}
            value={sort.key}
            dir={sort.dir}
            onChange={(k) => setSort({ key: k, dir: PIT_SORTS[k].dir })}
            onFlip={() => setSort({ key: sort.key, dir: sort.dir === "asc" ? "desc" : "asc" })}
          />
        </div>
        {mine.length > 0 && (
          <>
            <SectionLabel>Your car</SectionLabel>
            <div className="flex flex-col gap-2">{mine.map((r) => card(r, true))}</div>
          </>
        )}
        <SectionLabel>All {activeClass} cars</SectionLabel>
        <div className="flex flex-col gap-2">{classRows.map((r) => card(r))}</div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: P.muted }}>
          {facts && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-3 rounded-[2px] border" style={{ background: tint(PIT_COLORS.quick, 0.18), borderColor: rgb(PIT_COLORS.quick) }} /> {PIT_KEY.quick}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-3 rounded-[2px] border" style={{ background: tint(PIT_COLORS.slow, 0.18), borderColor: rgb(PIT_COLORS.slow) }} /> {PIT_KEY.slow}
              </span>
            </>
          )}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-[3px]" style={{ background: rgb(PIT_COLORS.caution) }} /> {PIT_KEY.caution}
          </span>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: P.muted }}>{pitMethod(facts)}</p>
      </div>
    );
  }

  return (
    <div className="px-2 py-3 sm:px-6" style={{ color: P.text }}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="m-0 text-base font-semibold">Pit stops · {activeClass}</h2>
        <span className="text-sm" style={{ color: P.muted }}>
          {classRows.length} cars · {stopsInClass} stops{avgLostInClass !== null ? ` · ${fmtTime(avgLostInClass)} lost on an average green-flag stop` : ""}
        </span>
      </div>

      {classes.length > 1 && !shared && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Class">
          {classes.map((c) => {
            const active = c === activeClass;
            const color = CLASS_COLORS[c] ?? P.accent;
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setCls(c);
                  setSelectedCar(null);
                }}
                className="rounded-md border px-3 py-1 text-xs font-semibold"
                style={{ borderColor: active ? color : P.border, background: active ? `${color}22` : P.card, color: active ? P.text : P.muted }}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}

      <div className="custom-scroll overflow-x-auto rounded-lg border" style={{ borderColor: P.line, background: P.card }}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr style={{ borderBottom: `1px solid ${P.border}` }}>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => sortBy(c.key)}
                  title={c.title}
                  className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-[11px] font-semibold uppercase tracking-wider${c.wide ? " hidden sm:table-cell" : ""}`}
                  style={{ color: sort.key === c.key ? P.text : P.muted, textAlign: c.align }}
                  aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: P.muted, minWidth: Math.min(maxStops, 8) * 104 }}>
                Each stop: lap · pit lane / time lost
              </th>
            </tr>
          </thead>
          <tbody>
            {classRows.map((r, i) => {
              const focus = r.key === String(focusNum);
              const open = r.label === selectedCar;
              return (
                <tr
                  key={r.key}
                  onClick={() => setSelectedCar(open ? null : r.label)}
                  className="cursor-pointer hover:brightness-125"
                  style={{ background: focus || open ? P.focus : i % 2 ? P.rowAlt : P.row }}
                  aria-expanded={open}
                >
                  {cols.map((c) => (
                    <td key={c.key} className={`whitespace-nowrap px-2 py-1${c.wide ? " hidden sm:table-cell" : ""}`} style={{ textAlign: c.align }}>
                      {c.cell(r)}
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    <div className="flex gap-1">
                      {r.stops.map((st, j) => (
                        <StopCell key={j} s={st} facts={facts} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: P.muted }}>
        {facts && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-3 rounded-[2px] border" style={{ background: tint(PIT_COLORS.quick, 0.18), borderColor: rgb(PIT_COLORS.quick) }} /> {PIT_KEY.quick}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-3 rounded-[2px] border" style={{ background: tint(PIT_COLORS.slow, 0.18), borderColor: rgb(PIT_COLORS.slow) }} /> {PIT_KEY.slow}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1">
                <Places p={{ net: 1, before: null, after: null, over: "cycle" }} bare />
                <Places p={{ net: -1, before: null, after: null, over: "cycle" }} bare />
              </span>{" "}
              {PIT_KEY.places}
            </span>
          </>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-[3px]" style={{ background: rgb(PIT_COLORS.caution) }} /> {PIT_KEY.caution}
        </span>
        <span>Tap a car for each stop's detail.</span>
      </div>
      <p className="mt-1.5 max-w-4xl text-xs leading-relaxed" style={{ color: P.muted }}>
        {pitMethod(facts)}
      </p>

      {selectedRow && (
        <div className="mt-4">
          <DetailPanel
            row={selectedRow}
            classPos={pitRows.find((r) => r.label === selectedRow.carNumber)?.classPos ?? null}
            trackConfig={data.trackConfig}
            facts={facts}
            onClose={() => setSelectedCar(null)}
            onGoToTrace={() => {
              const k = carKey(chart, selectedRow.carNumber);
              if (k !== null) setFocusNum(k);
              onSwitchToTrace();
            }}
          />
        </div>
      )}
    </div>
  );
}

// The page's look (as Strategy and the Driver Report).
const P = {
  card: "#12122a",
  row: "#101024",
  rowAlt: "#141430",
  line: "#1e1e38",
  border: "#3a3a5c",
  text: "#e0e0e8",
  soft: "#cbd5e1",
  muted: "#9a9ab4",
  accent: "#F48C34",
  gain: "#4ade80",
  loss: "#f87171",
  focus: "rgba(244,140,52,0.12)",
} as const;

const rgb = ([r, g, b]: readonly [number, number, number]) => `rgb(${r},${g},${b})`;
const tint = ([r, g, b]: readonly [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`;

/** One stop: in-lap (and what it was, if not a service stop), pit-lane time / time lost; coloured against its pit cycle. */
/** ▲2 / ▼3 in RaceTrace's gain and loss colours, = when the car held its class place. */
function Places({ p, bare = false }: { p: StopPlaces; bare?: boolean }) {
  const color = p.net > 0 ? P.gain : p.net < 0 ? P.loss : P.muted;
  return (
    <span className="inline-flex items-center gap-[2px] font-mono text-[10px] font-bold leading-none" style={{ color }} aria-label={bare ? undefined : placesText(p)}>
      {p.net === 0 ? (
        "="
      ) : (
        <svg viewBox="0 0 8 7" className="h-[7px] w-[8px]" fill="currentColor" aria-hidden>
          {p.net > 0 ? <path d="M4 0 8 7H0z" /> : <path d="M4 7 0 0h8z" />}
        </svg>
      )}
      {!bare && p.net !== 0 && Math.abs(p.net)}
    </span>
  );
}

function StopCell({ s, facts }: { s: PitStop; facts: boolean }) {
  const tone = stopTone(s);
  const caution = isCautionStop(s);
  const places = stopPlaces(s);
  const color = tone === "quick" ? PIT_COLORS.quick : tone === "slow" ? PIT_COLORS.slow : null;
  const lost = s.timeLost_s === null ? "—" : `${s.timeLost_s >= 0 ? "+" : "−"}${fmtTime(Math.abs(s.timeLost_s))}`;
  const title = [
    `Lap ${s.pitLap}${s.kind && PIT_KIND_LABEL[s.kind] ? ` · ${PIT_KIND_LABEL[s.kind]}` : ""} · ${s.condition}`,
    `${facts ? "Pit lane" : "Service"}: ${fmtTime(laneTime(s))}`,
    `Time lost: ${lost}`,
    s.delta_s !== null && s.delta_s !== undefined ? `Against the class's cycle average: ${fmtDelta(s.delta_s)}` : null,
    places ? placesText(places) : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div
      className="relative min-w-[98px] shrink-0 overflow-hidden rounded-md border px-2 py-1 text-[11px] leading-tight"
      style={{
        background: color ? tint(color, 0.14) : tone === "other" ? "rgba(154,154,180,0.12)" : P.row,
        borderColor: color ? tint(color, 0.6) : P.line,
      }}
      title={title}
    >
      {caution && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: rgb(PIT_COLORS.caution) }} aria-label="under caution" />}
      <div className="flex items-baseline justify-between gap-1">
        <b>L{s.pitLap}</b>
        <span className="flex items-baseline gap-1.5">
          {s.kind && PIT_KIND_LABEL[s.kind] && <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: P.muted }}>{PIT_KIND_LABEL[s.kind]}</span>}
          {places && <Places p={places} />}
        </span>
      </div>
      <div className="font-mono" style={{ color: P.soft }}>
        {fmtTime(laneTime(s))} / {lost}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: `1px solid ${S.bdr}`,
  whiteSpace: "nowrap",
};


function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
      {children}
      <span style={{ flex: 1, height: 1, background: S.bdr }} />
    </div>
  );
}

function DetailPanel({ row, classPos, trackConfig, facts, onClose, onGoToTrace }: {
  row: CarRow;
  classPos: number | null;
  trackConfig: PitAnalysisResponse["trackConfig"];
  facts: boolean;
  onClose: () => void;
  onGoToTrace: () => void;
}) {
  return (
    <div style={{
      background: S.card,
      border: `1px solid ${S.bdr}`,
      borderRadius: 12,
      padding: 20,
      marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.3rem", fontWeight: 800, color: CLASS_COLORS[row.carClass] ?? "#F48C34" }}>
          #{row.carNumber}
        </span>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>{row.teamName}</h3>
        <span style={{
          fontSize: "0.65rem",
          padding: "1px 6px",
          borderRadius: 4,
          fontWeight: 700,
          background: "rgba(34,197,94,0.15)",
          color: S.grn,
        }}>
          {classPos !== null && classPos < 999 ? `P${classPos} in ${row.carClass}` : row.carClass}
        </span>
        <button
          onClick={onGoToTrace}
          style={{
            fontSize: "0.72rem",
            color: S.acc,
            background: "none",
            border: `1px solid ${S.bdr}`,
            borderRadius: 6,
            padding: "4px 10px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          View on Trace
        </button>
        <span
          onClick={onClose}
          style={{ marginLeft: "auto", fontSize: "0.75rem", color: S.txt2, cursor: "pointer" }}
        >
          ✕ Close
        </span>
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
        <MiniCard label="Stops" value={String(row.stopCount)} color={S.acc} />
        {!facts && <MiniCard label="Avg Service" value={fmtTime(row.avgServiceTime)} color={S.pit} />}
        <MiniCard label="Avg Time Lost" value={fmtTime(row.avgTimeLost)} color={S.red} />
        <MiniCard label="Best Stop" value={fmtTime(row.bestTimeLost)} color={S.grn} />
        <MiniCard label="Worst Stop" value={fmtTime(row.worstTimeLost)} color={S.yel} />
      </div>

      {/* Per-stop table */}
      <SectionHeader>Stop Detail</SectionHeader>
      <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${S.bdr}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              {(facts
                ? ["#", "Lap", "Condition", "Pit Lane", "Time Lost", "Reference", "Measured against", "vs Cycle Avg", "Class places"]
                : ["#", "Lap", "Condition", "Service", "Pit Road", "Time Lost", "Local Ref", "Ref Source", "Delta"]
              ).map((h) => (
                <th
                  key={h}
                  style={{
                    background: S.bg2,
                    color: S.txt2,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    fontSize: "0.68rem",
                    padding: "8px 12px",
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    borderBottom: `1px solid ${S.bdr2}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row.stops.map((stop) => {
              const isGreen = stop.condition === "Full green";
              const condColor = isGreen ? S.grn : S.yel;
              return (
                <tr key={stop.stopNumber}>
                  <td style={{ ...tdStyle, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                    S{stop.stopNumber}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace" }}>
                    L{stop.pitLap}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: "0.65rem",
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontWeight: 700,
                      background: isGreen ? "rgba(34,197,94,0.15)" : "rgba(234,179,8,0.15)",
                      color: condColor,
                    }}>
                      {stop.condition}
                    </span>
                    {stop.kind && stop.kind !== "stop" && (
                      <span style={{ marginLeft: 6, fontSize: "0.65rem", color: S.txt2 }} title="Not counted in the green-stop averages">
                        {KIND_LABEL[stop.kind] ?? stop.kind}
                      </span>
                    )}
                  </td>
                  {!facts && (
                    <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: S.pit }}>
                      {fmtTime(stop.serviceTime_s)}
                    </td>
                  )}
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace" }}>
                    {fmtTime(stop.pitRoadTime_s)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: S.red }}>
                    {fmtTime(stop.timeLost_s)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: S.txt2 }}>
                    {fmtTime(stop.localRef_s)}
                  </td>
                  <td style={{ ...tdStyle, fontSize: "0.7rem", color: S.dim }}>
                    {stop.refSource}
                  </td>
                  <td style={{
                    ...tdStyle,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: stop.delta_s === null ? S.dim : stop.delta_s < 0 ? S.grn : S.red,
                  }}>
                    {fmtDelta(stop.delta_s)}
                  </td>
                  {facts && (
                    <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace" }}>
                      {(() => {
                        const pl = stopPlaces(stop);
                        if (!pl) return <span style={{ color: S.dim }}>—</span>;
                        return (
                          <span className="inline-flex items-center gap-2" title={placesText(pl)}>
                            {pl.before !== null && pl.after !== null && <span style={{ color: S.txt2 }}>P{pl.before} → P{pl.after}</span>}
                            <Places p={pl} />
                            <span style={{ color: S.dim, fontSize: "0.68rem", fontFamily: "inherit" }}>{pl.over === "cycle" ? "pit cycle" : "this stop"}</span>
                          </span>
                        );
                      })()}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Reference note */}
      {trackConfig && (
        <div style={{ marginTop: 12, fontSize: "0.72rem", color: S.dim }}>
          Track config: {trackConfig.trackName} · transit {fmtTime(trackConfig.transitTime_s)} · overhead {fmtTime(trackConfig.transitOverhead_s)}
        </div>
      )}
    </div>
  );
}

function MiniCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: S.bg2, border: `1px solid ${S.bdr}`, borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em", color: S.txt2, marginBottom: 2, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.1rem", fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>
        {value}
      </div>
    </div>
  );
}

const PIT_SORT_LABEL: Partial<Record<PitSortKey, string>> = {
  classPos: "Class position",
  car: "Car number",
  team: "Team",
  stops: "Stops",
  avgLane: "Average pit lane",
  avgLost: "Average time lost",
  best: "Best stop",
  worst: "Worst stop",
};

/** Phone: a car's stops as a list (the laptop's per-stop table), under its card. */
function PhoneStopList({ row, facts, onGoToTrace }: { row: CarRow; facts: boolean; onGoToTrace: () => void }) {
  return (
    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
      <SectionLabel>Each stop</SectionLabel>
      {row.stops.map((stop) => {
        const green = stop.condition === "Full green";
        const pl = stopPlaces(stop);
        return (
          <div key={stop.stopNumber} className="flex items-baseline gap-2 border-t py-2 text-[13px]" style={{ borderColor: PC.line }}>
            <span className="w-14 shrink-0 font-mono">Lap {stop.pitLap}</span>
            <span className="min-w-0 flex-1">
              <span style={{ color: green ? S.grn : S.yel }}>{stop.condition}</span>
              {stop.kind && stop.kind !== "stop" && <span style={{ color: PC.muted }}> · {KIND_LABEL[stop.kind] ?? stop.kind}</span>}
              <span className="block text-[12px]" style={{ color: PC.muted }}>
                {facts ? "Pit lane" : "Service"} {fmtTime(facts ? stop.pitRoadTime_s : stop.serviceTime_s)}
                {stop.delta_s !== null && stop.delta_s !== undefined ? ` · ${fmtDelta(stop.delta_s)} vs cycle` : ""}
                {pl ? ` · ${placesText(pl)}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right font-mono">
              <span className="block text-[11px]" style={{ color: PC.muted }}>Lost</span>
              {fmtTime(stop.timeLost_s)}
            </span>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onGoToTrace}
        className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-lg border text-[14px] font-semibold"
        style={{ borderColor: PC.border, color: PC.accent }}
      >
        View on the trace
      </button>
    </div>
  );
}
