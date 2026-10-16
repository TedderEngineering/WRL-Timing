import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { carMatchesSearch, carNo } from "./car-number";
import { COMPARE_PALETTE, TRACE } from "./constants";
import {
  type WindowKind,
  gapSeries,
  isCleanLap,
  lapOf,
  lapTimeText,
  recentPace,
  relativeTo,
  relativeText,
  resolveTarget,
  secondsText,
  windowStart,
} from "./gap-math";
import { Eyebrow, PANEL, SearchIcon, Section, Segmented, driversOf } from "./panel-ui";
import { stopsOf } from "./pit-stops";

interface HeadToHeadPanelProps {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
  defaultCompareNum?: number;
  /** Pit markers, for the stops comparison. */
  annotations?: AnnotationData;
}

const RIVAL = COMPARE_PALETTE[0];
const RECENT = 7;

export function HeadToHeadPanel({ data, focusNum, activeLap, defaultCompareNum, annotations }: HeadToHeadPanelProps) {
  const [rival, setRival] = useState<number | null>(defaultCompareNum ?? null);
  const [picking, setPicking] = useState(defaultCompareNum == null);
  const [win, setWin] = useState<WindowKind>("recent");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => setShowAll(false), [win, rival]);

  const from = windowStart(data, focusNum, activeLap, win, RECENT);
  const stintLaps = activeLap - windowStart(data, focusNum, activeLap, "stint", RECENT) + 1;

  const cmp = useMemo(() => (rival === null ? null : compare(data, focusNum, rival, from, activeLap)), [data, focusNum, rival, from, activeLap]);
  const rows = useMemo(
    () => (cmp && rival !== null ? matchupRows(data, focusNum, rival, activeLap, cmp, annotations) : []),
    [data, focusNum, rival, activeLap, cmp, annotations],
  );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto" style={{ scrollbarWidth: "none", color: PANEL.text }}>
      <div className="grid items-stretch gap-1.5 border-b px-4 py-2.5" style={{ borderColor: PANEL.line, gridTemplateColumns: "minmax(0,1fr) 28px minmax(0,1fr)" }}>
        <CarCard data={data} num={focusNum} lap={activeLap} color={TRACE.focus} />
        <div className="flex items-center justify-center text-xs font-bold" style={{ color: PANEL.muted }}>
          vs
        </div>
        {rival !== null && !picking ? (
          <CarCard data={data} num={rival} lap={activeLap} color={RIVAL} onChange={() => setPicking(true)} />
        ) : (
          <div className="flex items-center justify-center rounded-lg border-[1.5px] border-dashed p-2 text-center text-[13px]" style={{ borderColor: "#3a3a60", color: PANEL.muted }}>
            Pick a rival below
          </div>
        )}
      </div>

      {picking || rival === null ? (
        <RivalPicker
          data={data}
          focusNum={focusNum}
          activeLap={activeLap}
          current={rival}
          onPick={(n) => {
            setRival(n);
            setPicking(false);
          }}
          onCancel={rival !== null ? () => setPicking(false) : undefined}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 border-b px-4 py-2.5" style={{ borderColor: PANEL.line }}>
            <Summary data={data} focusNum={focusNum} rival={rival} lap={activeLap} cmp={cmp} win={win} />
            <Segmented
              compact
              label="Laps compared"
              value={win}
              onChange={setWin}
              options={[
                { value: "recent", label: `Last ${RECENT}` },
                { value: "stint", label: `This stint · ${stintLaps}` },
                { value: "race", label: "Whole race" },
              ]}
            />
          </div>
          {cmp && (
            <>
              <Section id="h2h.compare" title="Comparison" summary={matchupSummary(data, rival, rows)}>
                <Matchup rows={rows} />
              </Section>
              {cmp.compared > 0 && cmp.laps.length >= 2 && (
                <Section
                  id="h2h.bars"
                  title="Each lap"
                  summary={`#${carNo(data, rival)} quicker on ${cmp.rivalQuicker} of ${cmp.compared}`}
                >
                  <LapBars data={data} focusNum={focusNum} rival={rival} cmp={cmp} />
                </Section>
              )}
              <Section id="h2h.laps" title="Laps" summary={`${cmp.laps.length} laps · newest first`}>
                <LapTable data={data} focusNum={focusNum} rival={rival} cmp={cmp} showAll={showAll} onShowAll={() => setShowAll(true)} />
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---- The numbers ----

interface LapPair {
  lap: number;
  mine: number | null;
  theirs: number | null;
  /** Mine minus theirs on a lap both ran clean; negative = the focus car was quicker. */
  delta: number | null;
  gap: number | null;
  pitMine: boolean;
  pitTheirs: boolean;
}

interface Comparison {
  laps: LapPair[];
  compared: number;
  rivalQuicker: number;
  avgDelta: number | null;
  avgMine: number | null;
  avgTheirs: number | null;
  bestMine: number | null;
  bestTheirs: number | null;
  spreadMine: number | null;
  spreadTheirs: number | null;
}

function stats(xs: number[]) {
  if (!xs.length) return { avg: null, best: null, spread: null };
  return { avg: xs.reduce((a, b) => a + b, 0) / xs.length, best: Math.min(...xs), spread: xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : null };
}

export function compare(data: RaceChartData, focusNum: number, rival: number, from: number, to: number): Comparison {
  const me = data.cars[String(focusNum)];
  const them = data.cars[String(rival)];
  const gaps = gapSeries(data, focusNum, [rival], from, to);
  const laps: LapPair[] = gaps.map((g) => {
    const both = isCleanLap(data, me, g.lap) && isCleanLap(data, them, g.lap);
    return {
      lap: g.lap,
      mine: g.focusLt,
      theirs: g.targetLt,
      delta: both && g.focusLt !== null && g.targetLt !== null ? g.focusLt - g.targetLt : null,
      gap: g.gap,
      pitMine: g.focusPit,
      pitTheirs: g.targetPit,
    };
  });
  const clean = laps.filter((l) => l.delta !== null);
  const mineClean: number[] = [];
  const theirsClean: number[] = [];
  for (let l = from; l <= to; l++) {
    if (isCleanLap(data, me, l)) mineClean.push(lapOf(me, l)!.ltSec);
    if (isCleanLap(data, them, l)) theirsClean.push(lapOf(them, l)!.ltSec);
  }
  const a = stats(clean.map((l) => l.mine!));
  const b = stats(clean.map((l) => l.theirs!));
  const sm = stats(mineClean);
  const st = stats(theirsClean);
  return {
    laps,
    compared: clean.length,
    rivalQuicker: clean.filter((l) => l.delta! > 0).length,
    avgDelta: clean.length ? clean.reduce((s, l) => s + l.delta!, 0) / clean.length : null,
    avgMine: a.avg,
    avgTheirs: b.avg,
    bestMine: sm.best,
    bestTheirs: st.best,
    spreadMine: sm.spread,
    spreadTheirs: st.spread,
  };
}

// ---- Header ----

function CarCard({ data, num, lap, color, onChange }: { data: RaceChartData; num: number; lap: number; color: string; onChange?: () => void }) {
  const car = data.cars[String(num)];
  const at = lapOf(car, lap);
  const { team, drivers } = driversOf(data, num);
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-1.5">
        <span className="text-xl font-extrabold leading-tight tabular-nums" style={{ color }}>
          #{carNo(data, num)}
        </span>
        <span className="truncate text-xs font-bold tabular-nums">{at ? `P${at.cp} ${car?.cls}` : car?.cls}</span>
      </span>
      <span className="block truncate text-[13px] font-semibold" title={team}>
        {team || "—"}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs" style={{ color: PANEL.muted }} title={drivers ?? undefined}>
          {drivers ?? "\u00a0"}
        </span>
        {onChange && (
          <span className="shrink-0 text-xs font-semibold" style={{ color: TRACE.focus }}>
            Change
          </span>
        )}
      </span>
    </>
  );
  const cls = "flex min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left";
  const style = { background: PANEL.well, borderTop: `3px solid ${color}` };
  return onChange ? (
    <button type="button" onClick={onChange} className={`${cls} hover:bg-white/[0.04]`} style={style} aria-label={`#${carNo(data, num)} ${team}: change rival`}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

const PHRASE: Record<WindowKind, string> = { recent: `in the last ${RECENT} laps`, stint: "this stint", race: "this race" };

function Summary({ data, focusNum, rival, lap, cmp, win }: { data: RaceChartData; focusNum: number; rival: number; lap: number; cmp: Comparison | null; win: WindowKind }) {
  const who = `#${carNo(data, rival)}`;
  const rel = relativeTo(data, focusNum, rival, lap);
  // relativeTo says where the rival is; the sentence is about the focus car.
  const flipped = relativeText({ laps: -rel.laps, sec: rel.sec === null ? null : -rel.sec });
  const onTrack = flipped ? (
    <>
      <strong className="tabular-nums">{flipped.replace(/ (ahead|behind)$/, "")}</strong> {flipped.endsWith("ahead") ? "ahead of" : "behind"} {who}
      {rel.laps === 0 ? " on track" : ""} at lap {lap}.{" "}
    </>
  ) : null;
  let pace: ReactNode = `No green laps to compare ${PHRASE[win]}.`;
  if (cmp && cmp.compared > 0 && cmp.avgDelta !== null) {
    const by = Math.abs(cmp.avgDelta).toFixed(2);
    const k = cmp.rivalQuicker;
    const n = cmp.compared;
    if (k === n) pace = <><strong>{who} has been quicker on every lap</strong> {PHRASE[win]}, by <span className="tabular-nums">{by} s</span> a lap on average.</>;
    else if (k === 0) pace = <><strong>You've been quicker on every lap</strong> {PHRASE[win]}, by <span className="tabular-nums">{by} s</span> a lap on average.</>;
    else
      pace = (
        <>
          <strong>{who} quicker on {k} of {n} laps</strong> {PHRASE[win]}; on average {cmp.avgDelta > 0 ? who : "you"} by <span className="tabular-nums">{by} s</span> a lap.
        </>
      );
  }
  return (
    <div className="text-sm leading-relaxed">
      {onTrack}
      {pace}
    </div>
  );
}

// ---- Matchup rows ----

interface Row {
  label: string;
  mine: string;
  theirs: string;
  /** Positive = the rival is ahead on this measure; 0 = level; null = can't tell. */
  edge: number | null;
}

/** The comparison rows: average and best lap, laps quicker, spread, stops. */
function matchupRows(data: RaceChartData, focusNum: number, rival: number, lap: number, cmp: Comparison, annotations?: AnnotationData): Row[] {
  const lower = (a: number | null, b: number | null, scale: number) => (a === null || b === null ? null : (a - b) / scale);
  const rows: Row[] = [
    { label: "Avg green lap", mine: lapTimeText(cmp.avgMine), theirs: lapTimeText(cmp.avgTheirs), edge: lower(cmp.avgMine, cmp.avgTheirs, 1) },
    { label: "Best lap", mine: lapTimeText(cmp.bestMine), theirs: lapTimeText(cmp.bestTheirs), edge: lower(cmp.bestMine, cmp.bestTheirs, 1) },
    {
      label: "Laps quicker",
      mine: `${cmp.compared - cmp.rivalQuicker} of ${cmp.compared}`,
      theirs: `${cmp.rivalQuicker} of ${cmp.compared}`,
      edge: cmp.compared ? (2 * cmp.rivalQuicker - cmp.compared) / cmp.compared : null,
    },
    {
      label: "Spread, best to worst",
      mine: cmp.spreadMine === null ? "—" : `${cmp.spreadMine.toFixed(2)} s`,
      theirs: cmp.spreadTheirs === null ? "—" : `${cmp.spreadTheirs.toFixed(2)} s`,
      edge: cmp.spreadMine === null || cmp.spreadTheirs === null ? null : (cmp.spreadMine - cmp.spreadTheirs) / Math.max(cmp.spreadMine, cmp.spreadTheirs, 0.01),
    },
  ];
  if (annotations) {
    const so = (n: number) => {
      const s = stopsOf(data, annotations, n).filter((r) => r.pitLap <= lap);
      const losses = s.map((r) => r.timing.totalPitLoss);
      const known = losses.every((x): x is number => x !== null && x !== undefined);
      return { count: s.length, lost: known && s.length ? losses.reduce((a, b) => a + (b as number), 0) : null };
    };
    const a = so(focusNum);
    const b = so(rival);
    const txt = (x: { count: number; lost: number | null }) => `${x.count}${x.lost !== null ? ` · ${secondsText(x.lost, 0)}` : ""}`;
    rows.push({
      label: a.lost !== null && b.lost !== null ? "Stops · time lost, so far" : "Stops so far",
      mine: txt(a),
      theirs: txt(b),
      edge: a.lost !== null && b.lost !== null && a.count === b.count ? (a.lost - b.lost) / 30 : a.count === b.count ? 0 : null,
    });
  }
  return rows;
}

function edgeOf(r: Row): number {
  return r.edge === null || Math.abs(r.edge) < 1e-6 ? 0 : r.edge > 0 ? 1 : -1; // 1 = rival ahead
}

/** "#37 ahead on 4 of 5" for the folded comparison. */
function matchupSummary(data: RaceChartData, rival: number, rows: Row[]): string {
  const known = rows.filter((r) => r.edge !== null);
  const theirs = known.filter((r) => edgeOf(r) > 0).length;
  const mine = known.filter((r) => edgeOf(r) < 0).length;
  if (!known.length) return "";
  if (!theirs && !mine) return "Level";
  return theirs >= mine ? `#${carNo(data, rival)} ahead on ${theirs} of ${known.length}` : `You ahead on ${mine} of ${known.length}`;
}

function Matchup({ rows }: { rows: Row[] }) {
  return (
    <div className="flex flex-col px-4 pb-2" title="✓ and the bar mark who is ahead; the longer the bar, the bigger the margin. Green laps both cars ran clean.">
      {rows.map((r, i) => {
        const e = r.edge;
        const lead = edgeOf(r);
        const w = e === null ? 0 : Math.min(50, Math.abs(e) * 50);
        return (
          <div key={r.label} className={`grid items-center gap-2 py-1.5 ${i < rows.length - 1 ? "border-b" : ""}`} style={{ borderColor: PANEL.line, gridTemplateColumns: "84px minmax(0,1fr) 84px" }}>
            <span className="text-sm font-bold tabular-nums" style={{ color: lead < 0 ? TRACE.focus : undefined }}>
              {r.mine}
              {lead < 0 ? " ✓" : ""}
            </span>
            <div className="flex flex-col items-center gap-1">
              <span className="text-center text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: PANEL.muted }}>
                {r.label}
              </span>
              <div className="flex h-1.5 w-full rounded" style={{ background: PANEL.well }} aria-hidden="true">
                <span className="flex w-1/2 justify-end">
                  {lead < 0 && <span className="h-full rounded-l" style={{ width: `${w * 2}%`, background: TRACE.focus }} />}
                </span>
                <span className="flex w-1/2">{lead > 0 && <span className="h-full rounded-r" style={{ width: `${w * 2}%`, background: RIVAL }} />}</span>
              </div>
            </div>
            <span className="text-right text-sm font-bold tabular-nums" style={{ color: lead > 0 ? RIVAL : undefined }}>
              {r.theirs}
              {lead > 0 ? " ✓" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---- Lap by lap ----

function LapBars({ data, focusNum, rival, cmp }: { data: RaceChartData; focusNum: number; rival: number; cmp: Comparison }) {
  const laps = cmp.laps;
  if (laps.length < 2 || cmp.compared === 0) return null;
  const W = 368;
  const H = 84;
  const L = 30;
  const R = 360;
  const mid = 42;
  const half = 34;
  const deltas = laps.map((l) => l.delta).filter((d): d is number => d !== null).map(Math.abs).sort((a, b) => a - b);
  const p90 = deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.9))];
  const cap = p90 <= 0.25 ? 0.25 : p90 <= 0.5 ? 0.5 : p90 <= 1 ? 1 : 2;
  const step = (R - L) / laps.length;
  const bw = Math.max(1, Math.min(18, step * 0.6));
  const first = laps[0].lap;
  const last = laps[laps.length - 1].lap;
  const quicker = cmp.rivalQuicker;
  return (
    <div className="px-4 pb-2">
      <div className="flex justify-between pb-1 text-[11px] font-bold" style={{ color: PANEL.muted }}>
        <span style={{ color: TRACE.focus }}>▲ #{carNo(data, focusNum)} quicker</span>
        <span style={{ color: RIVAL }}>▼ #{carNo(data, rival)} quicker</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: "auto" }} role="img" aria-label={`Lap-by-lap difference, laps ${first} to ${last}: #${carNo(data, rival)} quicker on ${quicker} of ${cmp.compared} green laps`}>
        <line x1={L} x2={R} y1={mid - half} y2={mid - half} stroke={PANEL.line} />
        <line x1={L} x2={R} y1={mid + half} y2={mid + half} stroke={PANEL.line} />
        <line x1={L} x2={R} y1={mid} y2={mid} stroke="#3a3a60" />
        <text x={L - 6} y={mid - half + 3.5} textAnchor="end" fontSize="10" fill={PANEL.muted}>{cap}</text>
        <text x={L - 6} y={mid + 3.5} textAnchor="end" fontSize="10" fill={PANEL.muted}>0</text>
        <text x={L - 6} y={mid + half + 3.5} textAnchor="end" fontSize="10" fill={PANEL.muted}>{cap}</text>
        {laps.map((l, i) => {
          if (l.delta === null) return null;
          const h = Math.max(1, (Math.min(Math.abs(l.delta), cap) / cap) * half);
          const x = L + i * step + (step - bw) / 2;
          const theirs = l.delta > 0;
          return <rect key={l.lap} x={x} y={theirs ? mid : mid - h} width={bw} height={h} rx={bw > 4 ? 2 : 0} fill={theirs ? RIVAL : TRACE.focus} />;
        })}
      </svg>
      <div className="flex justify-between pl-[30px] text-[11px] tabular-nums" style={{ color: PANEL.muted }}>
        <span>L{first}</span>
        <span>L{last}</span>
      </div>
    </div>
  );
}

const SHOWN = 5;

function LapTable({ data, focusNum, rival, cmp, showAll, onShowAll }: { data: RaceChartData; focusNum: number; rival: number; cmp: Comparison; showAll: boolean; onShowAll: () => void }) {
  const rows = [...cmp.laps].reverse();
  const shown = showAll ? rows : rows.slice(0, SHOWN);
  const them = `#${carNo(data, rival)}`;
  return (
    <div className="px-4 pb-3">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-right text-[11px]" style={{ color: PANEL.muted }}>
            <th className="py-1.5 text-left font-semibold">Lap</th>
            <th className="py-1.5 font-semibold" style={{ color: TRACE.focus }}>#{carNo(data, focusNum)}</th>
            <th className="py-1.5 font-semibold" style={{ color: RIVAL }}>{them}</th>
            <th className="py-1.5 font-semibold">Quicker</th>
            <th className="py-1.5 font-semibold">Gap</th>
          </tr>
        </thead>
        <tbody className="text-right tabular-nums">
          {shown.map((l, i) => {
            const d = l.delta;
            const note = l.pitMine || l.pitTheirs ? "pit" : d === null ? "caution" : null;
            return (
              <tr key={l.lap} className="border-t" style={{ borderColor: PANEL.line, background: i === 0 ? "rgba(244,140,52,0.08)" : undefined }}>
                <td className="py-[7px] pl-1.5 text-left" style={{ fontWeight: i === 0 ? 700 : 400 }}>{l.lap}</td>
                <td>{lapTimeText(l.mine)}</td>
                <td>{lapTimeText(l.theirs)}</td>
                <td style={{ color: d === null ? PANEL.muted : d > 0 ? RIVAL : d < 0 ? TRACE.focus : PANEL.muted }}>
                  {d === null ? note ?? "—" : Math.abs(d) < 0.005 ? "level" : `${d > 0 ? them : "You"} ${Math.abs(d).toFixed(2)}`}
                </td>
                <td>{l.gap === null ? "—" : `${l.gap < 0 ? "−" : ""}${secondsText(l.gap)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!showAll && rows.length > SHOWN && (
        <button type="button" onClick={onShowAll} className="mt-1.5 min-h-[36px] text-[13px] font-semibold" style={{ color: TRACE.focus }}>
          Show all {rows.length} laps
        </button>
      )}
      <div className="pt-1 text-[11px]" style={{ color: PANEL.muted }}>
        Gap: seconds behind {them} at the line · − = ahead
      </div>
    </div>
  );
}

// ---- Choosing a rival ----

function compactRel(rel: { laps: number; sec: number | null }): string {
  if (rel.laps !== 0) return `${rel.laps < 0 ? "−" : "+"}${Math.abs(rel.laps)} lap${Math.abs(rel.laps) === 1 ? "" : "s"}`;
  return rel.sec === null ? "" : `${rel.sec < 0 ? "−" : "+"}${Math.abs(rel.sec).toFixed(1)} s`;
}

function RivalPicker({
  data,
  focusNum,
  activeLap,
  current,
  onPick,
  onCancel,
}: {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
  current: number | null;
  onPick: (n: number) => void;
  onCancel?: () => void;
}) {
  const me = data.cars[String(focusNum)];
  const [q, setQ] = useState("");
  const [cls, setCls] = useState<string>(me?.cls ?? "");

  const suggestions = useMemo(() => {
    const out: { label: string; num: number; note: string }[] = [];
    const seen = new Set<number>();
    const add = (label: string, num: number | undefined, note?: string) => {
      if (num === undefined || seen.has(num)) return;
      seen.add(num);
      out.push({ label, num, note: note ?? relativeText(relativeTo(data, focusNum, num, activeLap)) });
    };
    add("Car ahead", resolveTarget(data, focusNum, "ahead", activeLap)?.cars[0]);
    add("Car behind", resolveTarget(data, focusNum, "behind", activeLap)?.cars[0]);
    add("Class leader", resolveTarget(data, focusNum, "classLeader", activeLap)?.cars[0]);
    const mine = recentPace(data, focusNum, activeLap, 10);
    if (mine !== null) {
      let best: { n: number; d: number } | null = null;
      for (const n of data.classGroups?.[me?.cls ?? ""] ?? []) {
        if (n === focusNum || seen.has(n)) continue;
        const p = recentPace(data, n, activeLap, 10);
        if (p !== null && (!best || Math.abs(p - mine) < best.d)) best = { n, d: Math.abs(p - mine) };
      }
      if (best) add("Closest pace", best.n, `±${best.d.toFixed(2)} s/lap`);
    }
    return out;
  }, [data, focusNum, activeLap, me?.cls]);

  const classes = useMemo(() => Object.keys(data.classGroups ?? {}).sort(), [data.classGroups]);

  const list = useMemo(() => {
    const query = q.trim();
    const cars = Object.keys(data.cars)
      .map(Number)
      .filter((n) => (cls ? data.cars[String(n)].cls === cls : true))
      .filter((n) => !query || n === focusNum || carMatchesSearch(data, n, query));
    // Running order at the selected lap; cars without a lap there go last.
    const pos = (n: number) => {
      const l = lapOf(data.cars[String(n)], activeLap);
      return l ? (cls ? l.cp : l.p) : 9999;
    };
    return cars.sort((a, b) => pos(a) - pos(b) || a - b).slice(0, 60);
  }, [data, cls, q, focusNum, activeLap]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <Eyebrow>Suggested at lap {activeLap}</Eyebrow>
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-[32px] text-[13px] font-semibold" style={{ color: TRACE.focus }}>
            Cancel
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-b px-4 pb-3" style={{ borderColor: PANEL.line }}>
        {suggestions.map((s) => (
          <button
            key={s.num}
            type="button"
            onClick={() => onPick(s.num)}
            className="flex min-h-[64px] flex-col items-start justify-center gap-0.5 rounded-lg border px-2.5 py-2 text-left"
            style={{ background: PANEL.raised, borderColor: current === s.num ? TRACE.focus : PANEL.control }}
          >
            <span className="text-xs" style={{ color: PANEL.muted }}>{s.label}</span>
            <span className="text-sm font-bold tabular-nums">
              #{carNo(data, s.num)}
              {s.note ? ` · ${s.note}` : ""}
            </span>
          </button>
        ))}
        {suggestions.length === 0 && (
          <div className="col-span-2 text-xs" style={{ color: PANEL.muted }}>No suggestions at this lap — pick any car below.</div>
        )}
      </div>

      <div className="flex flex-col gap-2 px-4 pb-2 pt-3">
        <label htmlFor="rival-search" className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: PANEL.muted }}>
          Any car
        </label>
        <div className="flex min-h-[40px] items-center gap-2 rounded-lg border px-2.5" style={{ background: PANEL.well, borderColor: PANEL.control }}>
          <SearchIcon />
          <input
            id="rival-search"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Car #, team or driver"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#6b6b88]"
          />
        </div>
        <div role="group" aria-label="Class" className="flex flex-wrap gap-1.5">
          {["", ...classes].map((c) => {
            const on = cls === c;
            const n = c ? (data.classGroups[c] ?? []).length : Object.keys(data.cars).length;
            return (
              <button
                key={c || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setCls(c)}
                className="min-h-[32px] rounded-full border px-3 text-xs font-bold"
                style={on ? { borderColor: TRACE.focus, background: "rgba(244,140,52,0.14)", color: TRACE.focus } : { borderColor: PANEL.control, color: PANEL.muted }}
              >
                {c || "All"} · {n}
              </button>
            );
          })}
        </div>
      </div>

      <div role="listbox" aria-label={`Cars${cls ? ` in ${cls}` : ""}, by position at lap ${activeLap}`} className="flex flex-col px-2 pb-3">
        {list.map((n) => {
          const car = data.cars[String(n)];
          const l = lapOf(car, activeLap);
          const posText = l ? `P${cls ? l.cp : l.p}` : "—";
          if (n === focusNum) {
            return (
              <div key={n} className="grid min-h-[44px] items-center gap-1.5 rounded-lg px-2 py-1" style={{ gridTemplateColumns: "34px 50px minmax(0,1fr)", background: "rgba(244,140,52,0.10)", color: TRACE.focus }}>
                <span className="text-xs tabular-nums">{posText}</span>
                <span className="font-extrabold tabular-nums">#{carNo(data, n)}</span>
                <span className="text-[13px] font-semibold">You</span>
              </div>
            );
          }
          const { team, drivers } = driversOf(data, n);
          return (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={current === n}
              onClick={() => onPick(n)}
              className="grid min-h-[52px] items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-white/[0.04]"
              style={{ gridTemplateColumns: "34px 50px minmax(0,1fr) auto", background: current === n ? "rgba(57,135,229,0.14)" : undefined }}
            >
              <span className="text-xs tabular-nums" style={{ color: PANEL.muted }}>{posText}</span>
              <span className="font-extrabold tabular-nums">#{carNo(data, n)}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{team || "—"}</span>
                <span className="block truncate text-xs" style={{ color: PANEL.muted }}>
                  {drivers ?? (cls ? "" : car.cls)}
                </span>
              </span>
              <span className="text-xs tabular-nums" style={{ color: PANEL.muted }}>{compactRel(relativeTo(data, focusNum, n, activeLap))}</span>
            </button>
          );
        })}
        {list.length <= 1 && q.trim() && (
          <div className="px-2 py-3 text-center text-xs" style={{ color: PANEL.muted }}>No cars match</div>
        )}
        <div className="px-2 pt-2 text-xs" style={{ color: PANEL.muted }}>
          Gaps are on track at lap {activeLap} · − ahead of you, + behind
        </div>
      </div>
    </div>
  );
}
