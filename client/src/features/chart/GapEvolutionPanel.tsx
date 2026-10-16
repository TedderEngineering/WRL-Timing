import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { carMatchesSearch, carNo } from "./car-number";
import { COMPARE_PALETTE, TRACE } from "./constants";
import {
  type GapRow,
  type GapTarget,
  type GapTargetKind,
  type WindowKind,
  TARGET_NAMES,
  gapRate,
  gapSeries,
  lapOf,
  niceTicks,
  percentText,
  recentPace,
  relativeTo,
  relativeText,
  resolveTarget,
  secondsText,
  lapTimeText,
  windowStart,
} from "./gap-math";
import { ChevronIcon, Eyebrow, PANEL, SearchIcon, Section, Segmented, driversOf } from "./panel-ui";

interface GapEvolutionPanelProps {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
  /** The cars on the chart. */
  compSet?: Set<number>;
}

const TARGET_COLOR = COMPARE_PALETTE[0];
const BEHIND_COLOR = COMPARE_PALETTE[4];
/** Below this, a gap is holding steady (seconds a lap). */
const STEADY = 0.02;

type Unit = "s" | "pct";

export function GapEvolutionPanel({ data, focusNum, activeLap, compSet }: GapEvolutionPanelProps) {
  const [kind, setKind] = useState<GapTargetKind>("ahead");
  const [chosen, setChosen] = useState<number[]>([]);
  const [win, setWin] = useState<WindowKind>("stint");
  const [unit, setUnit] = useState<Unit>("s");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const target = useMemo(() => {
    const t = resolveTarget(data, focusNum, kind, activeLap, { compSet, cars: chosen });
    if (t) return t;
    // The class leader has no car ahead: measure against the car behind instead.
    return kind === "ahead" ? resolveTarget(data, focusNum, "behind", activeLap) : null;
  }, [data, focusNum, kind, activeLap, compSet, chosen]);

  const from = windowStart(data, focusNum, activeLap, win, 10);
  const rows = useMemo(
    () => (target ? gapSeries(data, focusNum, target.cars, from, activeLap) : []),
    [data, focusNum, target, from, activeLap],
  );
  const rate = useMemo(() => gapRate(rows, 5), [rows]);
  const focusPace = useMemo(() => recentPace(data, focusNum, activeLap, 10), [data, focusNum, activeLap]);
  const last = [...rows].reverse().find((r) => r.gap !== null) ?? null;
  const single = target && target.cars.length === 1 ? target.cars[0] : null;
  const fmt = (sec: number) => (unit === "pct" ? percentText(sec, focusPace) : secondsText(sec));

  useEffect(() => setShowAll(false), [win, target?.kind]);
  const outlook = useMemo(
    () => (target && last ? outlookLines({ data, focusNum, activeLap, target, single, last, rate }) : []),
    [data, focusNum, activeLap, target, single, last, rate],
  );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto" style={{ scrollbarWidth: "none", color: PANEL.text }}>
      <div className="flex flex-col gap-2 border-b px-4 py-2.5" style={{ borderColor: PANEL.line }}>
        <div className="relative flex items-stretch gap-2">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border px-3 py-1 text-left"
            style={{ background: PANEL.raised, borderColor: menuOpen ? TRACE.focus : PANEL.control }}
          >
            <TargetLabel data={data} focusNum={focusNum} activeLap={activeLap} target={target} fallback={TARGET_NAMES[kind]} />
            <ChevronIcon up={menuOpen} />
          </button>
          <div role="group" aria-label="Units" className="flex overflow-hidden rounded-lg border" style={{ borderColor: PANEL.control }}>
            {(["s", "pct"] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                onClick={() => setUnit(u)}
                className="min-h-[44px] min-w-[36px] text-[13px] font-semibold"
                style={unit === u ? { background: PANEL.control, color: "#fff" } : { color: PANEL.muted }}
                title={u === "s" ? "Seconds" : "Share of a lap"}
              >
                {u === "s" ? "s" : "%"}
              </button>
            ))}
          </div>
          {menuOpen && (
            <TargetMenu
              data={data}
              focusNum={focusNum}
              activeLap={activeLap}
              compSet={compSet}
              kind={target?.kind ?? kind}
              chosen={chosen}
              onPick={(k, cars) => {
                setKind(k);
                if (cars) setChosen(cars);
                setMenuOpen(false);
              }}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>

        <Segmented
          compact
          label="Laps shown"
          value={win}
          onChange={setWin}
          options={[
            { value: "recent", label: "Last 10" },
            { value: "stint", label: "This stint" },
            { value: "race", label: "Whole race" },
          ]}
        />
      </div>

      {!target || !last ? (
        <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm" style={{ color: PANEL.muted }}>
          {!target ? "No car to measure against at this lap." : "No laps to compare in this window."}
        </div>
      ) : (
        <>
          <Headline data={data} target={target} single={single} lap={last.lap} gap={last.gap!} rate={rate} fmt={fmt} unit={unit} />
          <Section id="gap.chart" title="Chart" summary={<Sparkline rows={rows} />}>
            <div className="px-4 pb-2">
              <GapChart data={data} rows={rows} single={single} />
            </div>
          </Section>
          {outlook.length > 0 && (
            <Section id="gap.outlook" title="At this pace" summary={outlook[0].lead.replace(/\.$/, "")}>
              <Outlook lines={outlook} />
            </Section>
          )}
          <Section id="gap.laps" title="Laps" summary={`${rows.length} laps · newest first`}>
            <GapTable data={data} focusNum={focusNum} single={single} rows={rows} fmt={fmt} showAll={showAll} onShowAll={() => setShowAll(true)} />
          </Section>
        </>
      )}
    </div>
  );
}

// ---- Header pieces ----

/** What the menu button shows: the choice, and the car it means at this lap. */
function TargetLabel({
  data,
  focusNum,
  activeLap,
  target,
  fallback,
}: {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
  target: GapTarget | null;
  fallback: string;
}) {
  let detail: ReactNode = null;
  if (target && target.cars.length === 1) {
    const n = target.cars[0];
    const car = data.cars[String(n)];
    const l = lapOf(car, activeLap);
    const me = lapOf(data.cars[String(focusNum)], activeLap);
    detail = (
      <>
        <span style={{ color: TARGET_COLOR }}>#{carNo(data, n)}</span> {driversOf(data, n).team}
        <span className="font-normal" style={{ color: PANEL.muted }}>
          {l ? ` · P${l.cp}` : " · not running"}
          {me ? ` (you P${me.cp})` : ""}
        </span>
      </>
    );
  } else if (target) {
    detail = (
      <span className="font-normal" style={{ color: PANEL.muted }}>
        {target.cars.slice(0, 6).map((n) => `#${carNo(data, n)}`).join(" ")}
        {target.cars.length > 6 ? " …" : ""}
      </span>
    );
  }
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[11px] font-semibold" style={{ color: PANEL.muted }}>
        Gap to · {target ? target.name : fallback}
      </span>
      {detail && <span className="block truncate text-sm font-bold">{detail}</span>}
    </span>
  );
}

interface MenuProps {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
  compSet?: Set<number>;
  kind: GapTargetKind;
  chosen: number[];
  onPick: (kind: GapTargetKind, cars?: number[]) => void;
  onClose: () => void;
}

/** The "Gap to" menu: a car picked for you, a group average, or any car. */
function TargetMenu({ data, focusNum, activeLap, compSet, kind, chosen, onPick, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<number[]>(kind === "cars" ? chosen : []);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.("[aria-haspopup=listbox]")) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  const singles: GapTargetKind[] = ["ahead", "behind", "classLeader", "leader"];
  const groups: GapTargetKind[] = ["classAvg", "chartAvg", "fieldAvg"];
  const cars = useMemo(() => {
    const query = q.trim();
    if (!query) return [];
    return Object.keys(data.cars)
      .map(Number)
      .filter((n) => n !== focusNum && carMatchesSearch(data, n, query))
      .slice(0, 30);
  }, [data, focusNum, q]);

  const optionCls = "flex min-h-[48px] w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-45";
  const check = (on: boolean) => (
    <span className="flex w-4 shrink-0 justify-center">
      {on && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TRACE.focus} strokeWidth="3" aria-hidden="true">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </span>
  );

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Measure the gap to"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="absolute left-0 right-0 top-[46px] z-20 flex max-h-[70vh] flex-col overflow-y-auto rounded-xl border p-1.5"
      style={{ background: PANEL.raised, borderColor: PANEL.control, boxShadow: "0 12px 32px rgba(0,0,0,0.45)", scrollbarWidth: "thin" }}
    >
      <Eyebrow className="px-2.5 pb-1 pt-2">One car · picked for you</Eyebrow>
      {singles.map((k) => {
        const t = resolveTarget(data, focusNum, k, activeLap);
        const n = t?.cars[0];
        const rel = n !== undefined ? relativeText(relativeTo(data, focusNum, n, activeLap)) : "";
        const car = n !== undefined ? data.cars[String(n)] : undefined;
        const pos = n !== undefined ? lapOf(car, activeLap) : undefined;
        return (
          <button key={k} type="button" role="option" aria-selected={kind === k} disabled={!t} onClick={() => onPick(k)} className={optionCls} style={kind === k ? { background: "rgba(244,140,52,0.14)" } : undefined}>
            {check(kind === k)}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{TARGET_NAMES[k]}</span>
              <span className="block truncate text-xs" style={{ color: PANEL.muted }}>
                {n !== undefined
                  ? `#${carNo(data, n)} ${driversOf(data, n).team}${pos ? ` · P${k === "leader" ? pos.p : pos.cp}` : ""}`
                  : k === "ahead" || k === "classLeader"
                    ? "You lead the class"
                    : k === "leader"
                      ? "You lead the race"
                      : "Nobody behind in class"}
              </span>
            </span>
            {rel && <span className="shrink-0 text-xs tabular-nums" style={{ color: PANEL.muted }}>{rel}</span>}
          </button>
        );
      })}

      <div className="mx-1 my-1.5 h-px" style={{ background: PANEL.control }} />
      <Eyebrow className="px-2.5 pb-1 pt-2">Average pace of a group</Eyebrow>
      {groups.map((k) => {
        const t = resolveTarget(data, focusNum, k, activeLap, { compSet });
        return (
          <button key={k} type="button" role="option" aria-selected={kind === k} disabled={!t} onClick={() => onPick(k)} className={`${optionCls} min-h-[44px]`} style={kind === k ? { background: "rgba(244,140,52,0.14)" } : undefined}>
            {check(kind === k)}
            <span className="flex-1 text-sm font-semibold">{t?.name ?? TARGET_NAMES[k]}</span>
            <span className="text-xs tabular-nums" style={{ color: PANEL.muted }}>
              {t ? `${t.cars.length} car${t.cars.length === 1 ? "" : "s"}` : k === "chartAvg" ? "none on the chart" : ""}
            </span>
          </button>
        );
      })}

      <div className="mx-1 my-1.5 h-px" style={{ background: PANEL.control }} />
      <label htmlFor="gap-target-search" className="px-2.5 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: PANEL.muted }}>
        Pick a car
      </label>
      <div className="px-1.5 pb-1.5">
        <div className="flex min-h-[40px] items-center gap-2 rounded-lg border px-2.5" style={{ background: PANEL.well, borderColor: PANEL.control }}>
          <SearchIcon />
          <input
            id="gap-target-search"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Car #, team or driver"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#6b6b88]"
            autoComplete="off"
          />
        </div>
      </div>
      {cars.map((n) => {
        const car = data.cars[String(n)];
        const pos = lapOf(car, activeLap);
        const ticked = draft.includes(n);
        return (
          <div key={n} className="flex items-center gap-1">
            <button type="button" role="option" aria-selected={kind === "cars" && chosen.length === 1 && chosen[0] === n} onClick={() => onPick("cars", [n])} className={`${optionCls.replace(" w-full", "")} min-w-0 flex-1`}>
              <span className="w-12 shrink-0 font-extrabold tabular-nums">#{carNo(data, n)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{driversOf(data, n).team}</span>
                <span className="block truncate text-xs" style={{ color: PANEL.muted }}>
                  {[driversOf(data, n).drivers, pos ? `${car?.cls} P${pos.cp}` : car?.cls].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
            <label className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center" title="Add to an average">
              <input
                type="checkbox"
                checked={ticked}
                onChange={() => setDraft((d) => (ticked ? d.filter((x) => x !== n) : [...d, n]))}
                aria-label={`Add #${carNo(data, n)} to an average`}
                className="h-4 w-4 cursor-pointer accent-[#F48C34]"
              />
            </label>
          </div>
        );
      })}
      {q.trim() && cars.length === 0 && (
        <div className="px-2.5 py-2 text-xs" style={{ color: PANEL.muted }}>No cars match</div>
      )}
      {draft.length >= 2 ? (
        <button
          type="button"
          onClick={() => onPick("cars", draft)}
          className="m-1.5 min-h-[40px] rounded-lg text-sm font-semibold"
          style={{ background: TRACE.focus, color: "#12122a" }}
        >
          Average of {draft.length} ticked cars
        </button>
      ) : (
        <div className="px-2.5 pb-2 pt-1 text-xs" style={{ color: PANEL.muted }}>
          Tick two or more cars to measure against their average
        </div>
      )}
    </div>
  );
}

// ---- The gap now ----

function rateWords(rate: number): { text: string; color: string; down: boolean | null } {
  const r = Math.abs(rate).toFixed(2);
  if (Math.abs(rate) < STEADY) return { text: "Holding steady", color: PANEL.muted, down: null };
  return rate < 0
    ? { text: `Gaining ${r} s/lap`, color: TRACE.gain, down: false }
    : { text: `Losing ${r} s/lap`, color: TRACE.loss, down: true };
}

function Headline({
  data,
  target,
  single,
  lap,
  gap,
  rate,
  fmt,
  unit,
}: {
  data: RaceChartData;
  target: GapTarget;
  single: number | null;
  lap: number;
  gap: number;
  rate: { rate: number; laps: number } | null;
  fmt: (s: number) => string;
  unit: Unit;
}) {
  const who = single !== null ? `#${carNo(data, single)}` : `the ${target.name.toLowerCase()}`;
  const w = rate ? rateWords(rate.rate) : null;
  return (
    <div className="flex items-end justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: PANEL.line }}>
      <div className="min-w-0">
        <div className="mb-0.5 text-xs" style={{ color: PANEL.muted }}>
          {gap >= 0 ? "Behind" : "Ahead of"} {who} at lap {lap}
        </div>
        <div className="text-[30px] font-extrabold leading-none tracking-tight tabular-nums">
          {fmt(gap)}
          {unit === "s" && <span className="text-base font-semibold" style={{ color: PANEL.muted }}> s</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {w ? (
          <>
            <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums" style={{ color: w.color, background: w.down === null ? "rgba(154,154,180,0.12)" : w.down ? "rgba(248,113,113,0.12)" : "rgba(74,222,128,0.12)" }}>
              {w.down !== null && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path d={w.down ? "M12 5v14M5 12l7 7 7-7" : "M12 19V5M5 12l7-7 7 7"} />
                </svg>
              )}
              {w.text}
            </div>
            <div className="mt-1 text-[11px]" style={{ color: PANEL.muted }}>
              last {rate!.laps} green laps
            </div>
          </>
        ) : (
          <div className="text-[11px]" style={{ color: PANEL.muted }}>Not enough green laps for a rate</div>
        )}
      </div>
    </div>
  );
}

// ---- Chart ----

const W = 368;
const H = 112;
const L = 30;
const R = 360;
const T = 8;
const B = 94;

function GapChart({ data, rows, single }: { data: RaceChartData; rows: GapRow[]; single: number | null }) {
  const pts = rows.filter((r) => r.gap !== null);
  if (pts.length < 2) return null;
  const first = rows[0].lap;
  const lastLap = rows[rows.length - 1].lap;
  const span = Math.max(1, lastLap - first);
  const vals = pts.map((r) => r.gap!);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 3);
  const d0 = ticks[0];
  const d1 = ticks[ticks.length - 1];
  const x = (lap: number) => L + ((lap - first) / span) * (R - L);
  const y = (v: number) => T + (1 - (v - d0) / (d1 - d0 || 1)) * (B - T);

  // The line, broken where a lap is missing.
  const segs: string[] = [];
  let cur: string[] = [];
  for (const r of rows) {
    if (r.gap === null) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
    } else cur.push(`${x(r.lap).toFixed(1)},${y(r.gap).toFixed(1)}`);
  }
  if (cur.length > 1) segs.push(cur.join(" "));

  const fcy = (data.fcy ?? [])
    .filter(([a, b]) => b >= first && a <= lastLap)
    .map(([a, b]) => [Math.max(a, first), Math.min(b, lastLap)] as const);
  const dense = span > 60;
  const pr = dense ? 3.5 : 7;
  const end = pts[pts.length - 1];
  const fp = rows.filter((r) => r.focusPit && r.gap !== null);
  const tp = single !== null ? rows.filter((r) => r.targetPit && r.gap !== null) : [];
  const mid = Math.round((first + lastLap) / 2);
  const desc = `Gap from lap ${first} to ${lastLap}: ${secondsText(pts[0].gap!)} s ${pts[0].gap! >= 0 ? "behind" : "ahead"} to ${secondsText(end.gap!)} s ${end.gap! >= 0 ? "behind" : "ahead"}`;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: "auto" }} role="img" aria-label={desc}>
        {fcy.map(([a, b]) => (
          <rect key={`f${a}`} x={Math.max(L, x(a - 0.5))} y={T - 2} width={Math.max(3, Math.min(R, x(b + 0.5)) - Math.max(L, x(a - 0.5)))} height={B - T + 4} fill="rgba(251,191,36,0.10)" />
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#3a3a60" : PANEL.line} />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={PANEL.muted}>
              {t < 0 ? "−" : ""}{Math.abs(t) >= 60 ? secondsText(t, 0) : Math.abs(t)}
            </text>
          </g>
        ))}
        {segs.map((s, i) => (
          <polyline key={i} points={s} fill="none" stroke={TRACE.focus} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {tp.map((r) => (
          <g key={`t${r.lap}`}>
            <circle cx={x(r.lap)} cy={y(r.gap!)} r={pr} fill={PANEL.card} stroke={TARGET_COLOR} strokeWidth="1.5" />
            {!dense && <text x={x(r.lap)} y={y(r.gap!) + 3.3} textAnchor="middle" fontSize="9" fontWeight="800" fill={TARGET_COLOR}>P</text>}
          </g>
        ))}
        {fp.map((r) => (
          <g key={`p${r.lap}`}>
            <circle cx={x(r.lap)} cy={y(r.gap!)} r={pr} fill={TRACE.focus} />
            {!dense && <text x={x(r.lap)} y={y(r.gap!) + 3.3} textAnchor="middle" fontSize="9" fontWeight="800" fill={PANEL.card}>P</text>}
          </g>
        ))}
        <line x1={x(end.lap)} x2={x(end.lap)} y1={T - 2} y2={B + 2} stroke="rgba(255,255,255,0.35)" strokeDasharray="3 3" />
        <circle cx={x(end.lap)} cy={y(end.gap!)} r="4" fill={TRACE.focus} />
      </svg>
      <div className="flex justify-between pl-[30px] text-[11px] tabular-nums" style={{ color: PANEL.muted }}>
        <span>L{first}</span>
        {span >= 4 && <span>L{mid}</span>}
        <span>L{lastLap}</span>
      </div>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-1 pt-1.5 text-[11px]" style={{ color: PANEL.muted }}>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: TRACE.focus }} />
          Your stop
        </span>
        {single !== null && (
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full border-[1.5px]" style={{ borderColor: TARGET_COLOR }} />#{carNo(data, single)} stop
          </span>
        )}
        {fcy.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "rgba(251,191,36,0.35)" }} />
            Caution
          </span>
        )}
        <span>below 0 = ahead</span>
      </figcaption>
    </figure>
  );
}

// ---- At this pace ----

interface Line {
  dot: string;
  lead: string;
  rest: string;
}

/** How a single car is moving relative to the focus car over the last 10 laps. */
function trend(data: RaceChartData, focusNum: number, other: number, lap: number) {
  const rows = gapSeries(data, focusNum, [other], Math.max(1, lap - 9), lap);
  const last = [...rows].reverse().find((r) => r.gap !== null);
  return { gap: last?.gap ?? null, rate: gapRate(rows, 5)?.rate ?? null };
}

function lapsUntil(distance: number, speed: number): number | null {
  if (!(speed > STEADY) || !(distance > 0)) return null;
  const n = Math.round(distance / speed);
  return n >= 1 && n < 1000 ? n : null;
}

/** The "At this pace" sentences: the target, the car behind, the class leader. */
function outlookLines({
  data,
  focusNum,
  activeLap,
  target,
  single,
  last,
  rate,
}: {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
  target: GapTarget;
  single: number | null;
  last: GapRow;
  rate: { rate: number; laps: number } | null;
}) {
  const lines: Line[] = [];
  const me = data.cars[String(focusNum)];
  const at = lapOf(me, activeLap);

  // 1. The car (or group) being measured against.
  if (rate && last.gap !== null) {
    const r = rate.rate;
    const g = last.gap;
    const quick = Math.abs(r).toFixed(2);
    if (single !== null) {
      const who = `#${carNo(data, single)}`;
      if (g >= 0) {
        const n = lapsUntil(g, -r);
        if (n !== null) lines.push({ dot: TARGET_COLOR, lead: `Catching ${who}`, rest: ` — ${quick} s a lap; level around lap ${last.lap + n}.` });
        else if (r > STEADY) lines.push({ dot: TARGET_COLOR, lead: `Not catching ${who}`, rest: ` — they are ${quick} s a lap quicker.` });
        else lines.push({ dot: TARGET_COLOR, lead: `Holding ${who}`, rest: " — the gap is steady." });
      } else {
        const n = lapsUntil(-g, r);
        if (n !== null) lines.push({ dot: TARGET_COLOR, lead: `${who} is closing`, rest: ` — ${quick} s a lap; reaches you around lap ${last.lap + n}.` });
        else if (r < -STEADY) lines.push({ dot: TARGET_COLOR, lead: `Pulling away from ${who}`, rest: ` — ${quick} s a lap.` });
        else lines.push({ dot: TARGET_COLOR, lead: `Holding off ${who}`, rest: " — the gap is steady." });
      }
    } else {
      lines.push({
        dot: PANEL.muted,
        lead: Math.abs(r) < STEADY ? "Matching" : r < 0 ? "Quicker than" : "Slower than",
        rest: ` the ${target.name.toLowerCase()}${Math.abs(r) < STEADY ? "." : ` by ${quick} s a lap.`}`,
      });
    }
  }

  // 2. The car behind in class, when it isn't the one being measured.
  const behind = resolveTarget(data, focusNum, "behind", activeLap)?.cars[0];
  if (behind !== undefined && behind !== single) {
    const t = trend(data, focusNum, behind, activeLap);
    if (t.gap !== null && t.rate !== null) {
      const back = -t.gap; // seconds the car behind is back
      const who = `#${carNo(data, behind)} behind`;
      const rel = relativeTo(data, focusNum, behind, activeLap);
      if (rel.laps > 0) lines.push({ dot: BEHIND_COLOR, lead: who, rest: ` is ${relativeText(rel).replace(" behind", "")} down on you.` });
      else {
        const n = lapsUntil(back, t.rate);
        lines.push({
          dot: BEHIND_COLOR,
          lead: who,
          rest:
            n !== null
              ? ` is ${back.toFixed(1)} s back and closing ${t.rate.toFixed(2)} s a lap — reaches you around lap ${activeLap + n}.`
              : t.rate < -STEADY
                ? ` is ${back.toFixed(1)} s back and dropping away ${Math.abs(t.rate).toFixed(2)} s a lap.`
                : ` is ${back.toFixed(1)} s back, holding steady.`,
        });
      }
    }
  }

  // 3. The class leader: on the lead lap or not, and whether they will lap you.
  const leader = resolveTarget(data, focusNum, "classLeader", activeLap)?.cars[0];
  if (at && at.cp === 1) {
    lines.push({ dot: PANEL.muted, lead: "Leading the class.", rest: "" });
  } else if (leader !== undefined && leader !== single) {
    const rel = relativeTo(data, focusNum, leader, activeLap);
    const t = trend(data, focusNum, leader, activeLap);
    const leaderLap = recentPace(data, leader, activeLap, 10);
    const who = `#${carNo(data, leader)}`;
    const down = rel.laps < 0 ? -rel.laps : 0;
    let next = "";
    if (t.gap !== null && t.rate !== null && leaderLap) {
      const toNext = (down + 1) * leaderLap - t.gap;
      const n = lapsUntil(toNext, t.rate);
      next = n !== null ? ` At this pace they lap you${down ? " again" : ""} around lap ${activeLap + n}.` : t.rate > STEADY ? "" : " You're keeping pace with them.";
    }
    lines.push({
      dot: PANEL.muted,
      lead: down ? `${down} lap${down === 1 ? "" : "s"} down` : "On the lead lap.",
      rest: down ? ` to class leader ${who}.${next}` : ` Class leader ${who} is ${rel.sec !== null ? `${Math.abs(rel.sec).toFixed(1)} s` : "less than a lap"} ahead.${next}`,
    });
  }

  return lines;
}

function Outlook({ lines }: { lines: Line[] }) {
  return (
    <div className="flex flex-col gap-2 px-4 pb-3" title="Green-flag laps only: pit stops and cautions are left out of the rates">
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2.5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: l.dot }} />
          <div className="text-[13px] leading-snug">
            <strong>{l.lead}</strong>
            {l.rest}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Lap table ----

type Item =
  | { kind: "lap"; row: GapRow }
  | { kind: "caution"; from: number; to: number; gapIn: number | null; gapOut: number | null; you: boolean; them: boolean };

function tableItems(rows: GapRow[]): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.caution) {
      out.push({ kind: "lap", row: r });
      continue;
    }
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].caution) j++;
    const run = rows.slice(i, j + 1);
    out.push({
      kind: "caution",
      from: r.lap,
      to: rows[j].lap,
      gapIn: i > 0 ? rows[i - 1].gap : null,
      gapOut: rows[j].gap,
      you: run.some((x) => x.focusPit),
      them: run.some((x) => x.targetPit),
    });
    i = j;
  }
  return out.reverse();
}

const SHOWN = 5;

function GapTable({
  data,
  focusNum,
  single,
  rows,
  fmt,
  showAll,
  onShowAll,
}: {
  data: RaceChartData;
  focusNum: number;
  single: number | null;
  rows: GapRow[];
  fmt: (s: number) => string;
  showAll: boolean;
  onShowAll: () => void;
}) {
  const items = tableItems(rows);
  const shown = showAll ? items : items.slice(0, SHOWN);
  const them = single !== null ? `#${carNo(data, single)}` : "Avg";
  const signed = (v: number | null) => (v === null ? "—" : `${v < 0 ? "−" : ""}${fmt(v)}`);
  return (
    <div className="px-4 pb-3">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-right text-[11px]" style={{ color: PANEL.muted }}>
            <th className="py-1.5 text-left font-semibold">Lap</th>
            <th className="py-1.5 font-semibold">Gap</th>
            <th className="py-1.5 font-semibold">Change</th>
            <th className="py-1.5 font-semibold" style={{ color: TRACE.focus }}>#{carNo(data, focusNum)}</th>
            <th className="py-1.5 font-semibold" style={{ color: single !== null ? TARGET_COLOR : PANEL.muted }}>{them}</th>
          </tr>
        </thead>
        <tbody className="text-right tabular-nums">
          {shown.map((it, i) => {
            if (it.kind === "caution") {
              const who = it.you && it.them ? "both stopped" : it.you ? "you stopped" : it.them ? `${them} stopped` : "";
              return (
                <tr key={`c${it.from}`} className="border-t" style={{ borderColor: PANEL.line, color: TRACE.fcyBar }}>
                  <td colSpan={5} className="py-[7px] pl-1.5 text-left text-xs">
                    {it.from === it.to ? `Lap ${it.from}` : `Laps ${it.from}–${it.to}`} · caution{who ? ` · ${who}` : ""}
                    {it.gapIn !== null && it.gapOut !== null ? ` · gap ${signed(it.gapIn)} → ${signed(it.gapOut)}` : ""}
                  </td>
                </tr>
              );
            }
            const r = it.row;
            const c = r.change;
            const gained = c !== null && c < -0.05;
            const lost = c !== null && c > 0.05;
            return (
              <tr key={r.lap} className="border-t" style={{ borderColor: PANEL.line, background: i === 0 && !showAll ? "rgba(244,140,52,0.08)" : undefined }}>
                <td className="py-[7px] pl-1.5 text-left" style={{ fontWeight: i === 0 ? 700 : 400 }}>
                  {r.lap}
                  {(r.focusPit || r.targetPit) && (
                    <span className="ml-1.5 rounded px-1 text-[10px] font-bold" style={{ background: "rgba(255,255,255,0.08)", color: r.focusPit ? TRACE.focus : TARGET_COLOR }}>
                      PIT
                    </span>
                  )}
                </td>
                <td style={{ fontWeight: i === 0 ? 700 : 400 }}>{signed(r.gap)}</td>
                <td style={{ color: gained ? TRACE.gain : lost ? TRACE.loss : PANEL.muted }}>
                  {c === null ? "—" : gained ? `▲ ${fmt(c)}` : lost ? `▼ ${fmt(c)}` : fmt(c)}
                </td>
                <td>{lapTimeText(r.focusLt)}</td>
                <td>{lapTimeText(r.targetLt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!showAll && items.length > SHOWN && (
        <button type="button" onClick={onShowAll} className="mt-1.5 min-h-[36px] text-[13px] font-semibold" style={{ color: TRACE.focus }}>
          Show all {rows.length} laps
        </button>
      )}
      <div className="pt-1.5 text-[11px]" style={{ color: PANEL.muted }}>
        ▲ green = you gained · ▼ red = you lost · newest first · − = ahead
      </div>
    </div>
  );
}

/** The gap line in miniature, for the folded chart section. */
function Sparkline({ rows }: { rows: GapRow[] }) {
  const pts = rows.filter((r) => r.gap !== null);
  if (pts.length < 2) return null;
  const vals = pts.map((r) => r.gap!);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const w = 96;
  const h = 18;
  const d = pts
    .map((r, i) => `${((i / (pts.length - 1)) * (w - 4) + 2).toFixed(1)},${(2 + (1 - (r.gap! - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block align-middle" aria-hidden="true">
      <polyline points={d} fill="none" stroke={TRACE.focus} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
