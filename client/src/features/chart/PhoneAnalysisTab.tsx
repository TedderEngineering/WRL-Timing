/**
 * Gaps and Head-to-head as views of their own on a phone (mobile redesign). On a laptop they open
 * beside the chart from a lap's details; on a phone they had sat at the foot of the lap sheet,
 * two links deep. Here each fills the screen under the car pill, with the lap it is read at
 * on one line: ‹ At lap 124 of 249 ›. The lap is the race page's selected lap, shared with the
 * charts, so a lap picked on the trace carries over; with none picked, the end of the race.
 */
import type { AnnotationData, RaceChartData } from "@shared/types";
import { GapEvolutionPanel } from "./GapEvolutionPanel";
import { HeadToHeadPanel } from "./HeadToHeadPanel";
import { TraceControls } from "./TraceControls";
import { CHART_STYLE } from "./constants";
import type { TraceView } from "./trace-view";

const STEP = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#cbd5e1] active:bg-white/10 disabled:opacity-30";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

export function PhoneAnalysisTab({
  kind,
  data,
  annotations,
  focusNum,
  setFocusNum,
  compSet,
  classView,
  view,
  activeLap,
  setActiveLap,
  h2hRival,
}: {
  kind: "gaps" | "h2h";
  data: RaceChartData;
  annotations: AnnotationData;
  focusNum: number;
  setFocusNum: (n: number) => void;
  compSet: Set<number>;
  classView: string;
  view: TraceView;
  activeLap: number | null;
  setActiveLap: (l: number) => void;
  /** Head-to-head: the rival a pass card asked for. */
  h2hRival?: number;
}) {
  const laps = (data.cars[String(focusNum)]?.laps ?? []).map((l) => l.l);
  const first = laps[0] ?? 1;
  const last = laps[laps.length - 1] ?? data.maxLap;
  // With no lap picked: the last lap that another car in the class also ran, so a class leader
  // who lapped the field still has a car to measure against (at its own last lap it has none).
  const cls = data.cars[String(focusNum)]?.cls;
  const classLast = Object.entries(data.cars).reduce((m, [n, c]) => {
    if (Number(n) === focusNum || c.cls !== cls || !c.laps.length) return m;
    return Math.max(m, c.laps[c.laps.length - 1].l);
  }, 0);
  const fallback = laps.filter((l) => l <= (classLast || last)).pop() ?? last;
  // The selected lap, or the nearest lap the focus car ran before it.
  const lap = activeLap === null ? fallback : (laps.filter((l) => l <= activeLap).pop() ?? first);
  const idx = laps.indexOf(lap);
  const go = (l: number | undefined) => l !== undefined && setActiveLap(l);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }}>
      <TraceControls data={data} focusNum={focusNum} onFocus={setFocusNum} classView={classView} compSet={compSet} view={view} />
      <div className="flex h-11 shrink-0 items-center px-1" data-phone-shell="analysis-lap">
        <button type="button" aria-label="Previous lap" className={STEP} disabled={idx <= 0} onClick={() => go(laps[idx - 1])}>
          <Chevron dir="left" />
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-[14px]" aria-live="polite">
          <span style={{ color: "#9a9ab4" }}>At lap </span>
          <span className="font-semibold">{lap}</span>
          <span style={{ color: "#9a9ab4" }}> of {last}</span>
        </div>
        <button type="button" aria-label="Next lap" className={STEP} disabled={idx < 0 || idx >= laps.length - 1} onClick={() => go(laps[idx + 1])}>
          <Chevron dir="right" />
        </button>
      </div>
      {/* Each panel scrolls its own list */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t" style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border }}>
        {kind === "gaps" ? (
          <GapEvolutionPanel data={data} focusNum={focusNum} activeLap={lap} compSet={compSet} />
        ) : (
          <HeadToHeadPanel key={`${focusNum}-${h2hRival ?? ""}`} data={data} focusNum={focusNum} activeLap={lap} defaultCompareNum={h2hRival} annotations={annotations} />
        )}
      </div>
    </div>
  );
}
