/**
 * RaceTrace Live: the Strategy tab. For the focus car, its pit window, where it rejoins if it
 * stops now (and what a stop under the current caution saves), and its projected finish; for its
 * class, stops still to make, the order once every car has made them, and the projected order at
 * the flag. All from live-strategy.ts, rebuilt on each update.
 */
import type { ReactNode } from "react";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { gapClock, lapsAndSeconds } from "./live-gaps";
import { liveStrategy, type CarStrategy, type LiveStrategy } from "./live-strategy";

const T = { line: "#1e1e38", card: "#12122a", text: "#e0e0e8", soft: "#cbd5e1", muted: "#9a9ab4", accent: "#F48C34", gain: "#4ade80", lose: "#f87171", caution: "#facc15" };

/** Behind the class leader: "54.1 s", or "12.3 (+1L)" at the leader's pace. */
function behind(sec: number | null, pace: number | null): string {
  if (sec === null) return "—";
  if (sec < 0.05) return "Leader";
  return pace ? lapsAndSeconds(sec / pace, pace) : gapClock(sec);
}

function Move({ from, to }: { from: number; to: number | null }) {
  if (to === null) return <span style={{ color: T.muted }}>—</span>;
  const d = from - to;
  return (
    <span className="whitespace-nowrap">
      P{to}
      {d !== 0 && (
        <span className="ml-1 text-xs" style={{ color: d > 0 ? T.gain : T.lose }} aria-label={d > 0 ? `up ${d}` : `down ${-d}`}>
          {d > 0 ? "▲" : "▼"}
          {Math.abs(d)}
        </span>
      )}
    </span>
  );
}

function Card({ title, tone, children }: { title: string; tone?: "caution"; children: ReactNode }) {
  return (
    <section
      className="flex min-w-0 flex-1 basis-60 flex-col gap-1 rounded-lg border px-4 py-3"
      style={tone === "caution" ? { borderColor: T.caution, background: "rgba(250,204,21,0.08)" } : { borderColor: T.line, background: T.card }}
    >
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: tone === "caution" ? T.caution : T.muted }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

const Big = ({ children }: { children: ReactNode }) => <div className="text-2xl font-semibold leading-tight">{children}</div>;
const Note = ({ children }: { children: ReactNode }) => <p className="m-0 text-sm" style={{ color: T.soft }}>{children}</p>;

function FocusCards({ s, data }: { s: LiveStrategy; data: RaceChartData }) {
  const f = s.focus!;
  const c = f.car;
  const num = carNo(data, c.num);
  const lead = s.cars[0];
  const stint = (
    <Note>
      {c.lastStopLap > 0 ? `${c.stintLaps} laps since its stop on lap ${c.lastStopLap}` : `${c.stintLaps} laps, no stop yet`}
      {s.stintLength !== null ? ` · ${s.cls} stints run about ${s.stintLength} laps` : ""}.
    </Note>
  );
  return (
    <div className="flex flex-wrap gap-3">
      <Card title={`Pit window · #${num}`}>
        {c.stopped ? (
          <Big>Stopped</Big>
        ) : c.stopsToGo === null ? (
          <>
            <Big>Not known yet</Big>
            <Note>{s.stintLength === null ? `Waits for the ${s.cls} cars to run a few full stints.` : "Waits for the car's green-flag pace and the time to go."}</Note>
          </>
        ) : c.stopsToGo === 0 ? (
          <>
            <Big>Can reach the flag</Big>
            {stint}
          </>
        ) : f.window ? (
          <>
            <Big>
              {f.window.from >= f.window.to ? `By lap ${f.window.to}` : `Laps ${f.window.from}–${f.window.to}`}
            </Big>
            <Note>
              {f.window.stopsToGo === 1 ? "One stop to go." : `${f.window.stopsToGo} stops to go; stopping before lap ${f.window.from} adds one.`}
            </Note>
            {stint}
          </>
        ) : null}
      </Card>

      {f.pitNow && (
        <Card title={f.pitNow.caution ? "Stop now, under the caution" : "Stop now"} tone={f.pitNow.caution ? "caution" : undefined}>
          <Big>Rejoins P{f.pitNow.rejoinPos} in class</Big>
          <Note>
            Loses about {gapClock(f.pitNow.lostS)}
            {f.pitNow.savesS !== null && f.pitNow.savesS > 0 ? `, ${gapClock(f.pitNow.savesS)} less than a green-flag stop` : ""}
            {f.pitNow.measured ? " (this race's stops)" : " (estimated: no stop under a caution yet)"}.
            {f.pitNow.caution ? " Cars around it may stop too." : ""}
          </Note>
        </Card>
      )}

      <Card title="Projected finish">
        {c.projPos === null ? (
          <>
            <Big>Not known yet</Big>
            <Note>Needs the car's stops to go and its green-flag pace.</Note>
          </>
        ) : (
          <>
            <Big>P{c.projPos} in class</Big>
            <Note>
              {c.projPos === 1 ? "First in class at the flag at today's paces" : `${behind(c.projGapS, lead.pace)} behind the class's first at the flag`}
              {c.netPos !== null ? `; P${c.netPos} once every car has made the stops it owes.` : "."}
            </Note>
          </>
        )}
      </Card>
    </div>
  );
}

function ClassTable({ s, data, focusNum, setFocusNum }: { s: LiveStrategy; data: RaceChartData; focusNum: number; setFocusNum: (n: number) => void }) {
  const leadPace = s.cars[0].pace;
  // Moves are counted among the cars still running (a stopped car ahead is not a place gained).
  const runningRank = new Map(s.cars.filter((c) => c.netPos !== null).map((c, i) => [c.num, i + 1]));
  const head = (label: string, title: string, right = true) => (
    <th scope="col" className={`whitespace-nowrap px-2 py-1.5 font-semibold ${right ? "text-right" : "text-left"}`} title={title}>
      {label}
    </th>
  );
  const row = (c: CarStrategy) => {
    const focus = c.num === focusNum;
    return (
      <tr
        key={c.num}
        onClick={() => setFocusNum(c.num)}
        className="cursor-pointer border-t hover:brightness-125"
        style={{ borderColor: T.line, background: focus ? "rgba(244,140,52,0.12)" : undefined }}
      >
        <td className="px-2 py-1.5 text-right">P{c.posClass}</td>
        <td className="px-2 py-1.5">
          <span className="font-mono font-semibold" style={{ color: focus ? T.accent : T.text }}>
            #{carNo(data, c.num)}
          </span>{" "}
          <span className="hidden sm:inline" style={{ color: T.muted }}>
            {c.team}
          </span>
        </td>
        <td className="px-2 py-1.5 text-right">{c.laps}</td>
        <td className="px-2 py-1.5 text-right">{c.stopped ? "—" : behind(c.gapS, leadPace)}</td>
        <td className="px-2 py-1.5 text-right">{c.stops.filter((x) => x.kind !== "drive_through").length}</td>
        <td className="px-2 py-1.5 text-right">{c.stopped ? "—" : c.stintLaps}</td>
        <td className="px-2 py-1.5 text-right">{c.stopped ? <span style={{ color: T.muted }}>Stopped</span> : (c.stopsToGo ?? "—")}</td>
        <td className="px-2 py-1.5 text-right">
          <Move from={runningRank.get(c.num) ?? c.posClass} to={c.netPos} />
        </td>
        <td className="px-2 py-1.5 text-right">
          <Move from={runningRank.get(c.num) ?? c.posClass} to={c.projPos} />
        </td>
        <td className="hidden px-2 py-1.5 text-right md:table-cell">{c.projGapS === null ? "—" : behind(c.projGapS, leadPace)}</td>
      </tr>
    );
  };
  return (
    <div className="custom-scroll overflow-x-auto rounded-lg border" style={{ borderColor: T.line }}>
      <table className="w-full min-w-[640px] text-sm" style={{ color: T.text }}>
        <caption className="px-3 pb-1 pt-2.5 text-left text-xs" style={{ color: T.muted }}>
          {s.cls}: tap a car to follow it.
        </caption>
        <thead style={{ color: T.muted }}>
          <tr>
            {head("Now", "Class position now")}
            {head("Car", "", false)}
            {head("Laps", "Laps completed")}
            {head("Behind", "Behind the class leader now (whole laps at the leader's pace, then seconds)")}
            {head("Stops", "Stops made (drive-throughs not counted)")}
            {head("Stint", "Laps since its last stop")}
            {head("To go", "Stops still needed to reach the flag, from the class's long stints")}
            {head("After stops", "Class position once every car has made the stops it owes (green-flag stops)")}
            {head("Projected", "Class position at the flag: after the stops, at each car's green-flag pace")}
            <th scope="col" className="hidden whitespace-nowrap px-2 py-1.5 text-right font-semibold md:table-cell" title="Behind the class's first at the flag, projected">
              At the flag
            </th>
          </tr>
        </thead>
        <tbody>{s.cars.map(row)}</tbody>
      </table>
    </div>
  );
}

export function LiveStrategyTab({
  data,
  annotations,
  focusNum,
  setFocusNum,
  flag,
  timeToGoS,
}: {
  data: RaceChartData;
  annotations: AnnotationData | null;
  focusNum: number;
  setFocusNum: (n: number) => void;
  flag: string | null;
  timeToGoS: number | null;
}) {
  const s = liveStrategy({ data, annotations, focusNum, flag, timeToGoS });
  if (!s || !s.focus) return <p style={{ color: T.muted }}>Pick a car to see its strategy.</p>;
  return (
    <div className="flex flex-col gap-4" style={{ color: T.text }}>
      <FocusCards s={s} data={data} />
      <ClassTable s={s} data={data} focusNum={focusNum} setFocusNum={setFocusNum} />
      <p className="m-0 max-w-3xl text-xs leading-relaxed" style={{ color: T.muted }}>
        Estimates from this race so far, updated with each lap. Stops to go come from the long stints {s.cls} has run
        {s.stintLength !== null ? ` (about ${s.stintLength} laps)` : ""}, with a little to spare for a stretched last stint.
        {s.greenStopS !== null ? ` A green-flag stop loses about ${gapClock(s.greenStopS)}` : ""}
        {s.cautionStopS !== null ? `, a stop under a caution about ${gapClock(s.cautionStopS)}${s.cautionMeasured ? "" : " (estimated)"}` : ""}
        {s.greenStopS !== null ? "." : ""} The projection carries today's gaps and each car's pace over its last ten green-flag laps to the flag; cautions, repairs and penalties change it.
      </p>
    </div>
  );
}
