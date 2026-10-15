/**
 * Lap details beside the Position Trace (mockup F1 aside; F6 below the chart
 * on a phone): the focus car, the selected lap, its pit stop, what changed,
 * and the deeper panels.
 */
import { finishInfo } from "./finish";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { classBenchmarks } from "./benchmarks";
import { ShareCarImageButton } from "./raceCard";
import { formatLapTime, type LapInfoData } from "./chart-renderer";
import { TRACE } from "./constants";

const T = { card: "#12122a", line: "#1e1e38", text: "#e0e0e8", soft: "#cbd5e1", muted: "#9a9ab4", good: "#4ade80", bad: "#e66767", warn: "#fab219" };

/** The pit-lane visit's name, from the analysis package when the race has one. */
export function pitKindLabel(kind: string | undefined, driveThrough: boolean): string {
  if (kind === "drive_through" || (!kind && driveThrough)) return "▲ Drive-through";
  if (kind === "stop_and_go") return "■ Stop and go";
  if (kind === "penalty_served") return "■ Penalty served";
  if (kind === "garage") return "● Garage visit";
  if (kind === "retirement") return "✕ Retired in the pits";
  return "● Pit stop";
}

/** What time lost is measured against (D-LOSS), in a few words. */
export function lossBasis(t: { lossMethod?: string; context?: string; avgGreenLapTime: number | null }): string {
  switch (t.lossMethod) {
    case "fcy_neighbours":
      return "against cars on track under the caution";
    case "fcy_lap_field":
      return "against the field's caution laps";
    case "see_group":
      return "counted with the stop before it";
    case "none":
      return "not measurable from the timing";
    case "green_reference":
      return t.avgGreenLapTime !== null ? `vs green pace (${sec(t.avgGreenLapTime)})` : "vs green pace";
    default:
      return t.avgGreenLapTime !== null ? `vs green pace (${sec(t.avgGreenLapTime)})` : "";
  }
}

function sec(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const sign = s < 0 ? "−" : "";
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const r = a - m * 60;
  return m > 0 ? `${sign}${m}:${r.toFixed(3).padStart(6, "0")}` : `${sign}${r.toFixed(3)}`;
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.06em]" style={{ color: T.muted }}>
        {label}
      </div>
      <div className="font-mono text-base">{value}</div>
      {sub && (
        <div className="text-xs" style={{ color: T.muted }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="min-h-[36px] text-left text-[13px] hover:underline" style={{ color: TRACE.focus }}>
      {children} ›
    </button>
  );
}

/**
 * The focus car: number, team, class, vehicle and finish (top of both charts' side panels), and
 * its class benchmarks as facts (top three only; a weak result gets no badge).
 */
export function CarSummary({ data, focusNum, annotations = null }: { data: RaceChartData; focusNum: number; annotations?: AnnotationData | null }) {
  const car = data.cars[String(focusNum)];
  const f = finishInfo(data, focusNum);
  if (!car || !f) return null;
  const marks = classBenchmarks(data, annotations, focusNum);
  const finish =
    f.pos !== null
      ? `Finished P${f.posClass ?? "?"} in ${car.cls} · P${f.pos} overall`
      : f.status === "dsq"
        ? "Disqualified"
        : f.status === "dns"
          ? "Did not start"
          : f.official;
  return (
    <div className="flex flex-col gap-1">
      <div className="font-semibold">
        <span className="font-mono" style={{ color: TRACE.focus }}>
          #{focusNum}
        </span>{" "}
        {car.team} · {car.cls}
      </div>
      {(car.make || car.vehicle) && (
        <div className="text-[13px]" style={{ color: T.soft }}>
          {car.vehicle || car.make}
        </div>
      )}
      <div className="text-[13px]" style={{ color: T.muted }}>
        {finish} · {car.laps.length} laps
      </div>
      {marks.length > 0 && (
        <ul className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0" aria-label="Class benchmarks">
          {marks.map((m) => (
            <li
              key={m.text}
              className="rounded-md border px-2 py-0.5 text-[12px]"
              style={{ borderColor: "rgba(74,222,128,0.35)", color: T.soft, background: "rgba(74,222,128,0.06)" }}
            >
              {m.text}
            </li>
          ))}
        </ul>
      )}
      {(f.changed || (f.pos === null && f.crossed && f.status !== "dnf")) && f.crossed && (
        <div
          className="mt-1 rounded-md border px-2.5 py-1.5 text-[12px] leading-snug"
          style={{ borderColor: "rgba(250,178,25,0.45)", color: T.soft, background: "rgba(250,178,25,0.06)" }}
        >
          Crossed the line <b className="font-mono">P{f.crossed.pos}</b>
          {f.crossed.lap < data.maxLap ? ` on lap ${f.crossed.lap}` : ""} · official result{" "}
          <b className="font-mono">{f.official}</b>. The result changed after the race (a penalty,
          an exclusion or a red-flag count-back); the trace shows the order on track.
        </div>
      )}
    </div>
  );
}

export function LapDetailsPanel({
  data,
  annotations = null,
  info,
  focusNum,
  classView,
  onOpen,
}: {
  data: RaceChartData;
  annotations?: AnnotationData | null;
  info: LapInfoData | null;
  focusNum: number;
  classView: string;
  onOpen: (panel: "pit" | "gap" | "h2h" | "event") => void;
}) {
  const car = data.cars[String(focusNum)];
  if (!car) return null;

  const lap = info?.lap ?? null;
  const pit = info?.pitInfo ?? null;
  const pitHere = !!pit && lap !== null && data.cars[String(focusNum)]?.laps.some((l) => l.l === lap.l && l.pit === 1);
  const lapTag = pitHere ? "pit lap" : pit ? "out-lap" : null;
  const t = pit?.timing ?? null;
  const spc = t?.spcAnalysis?.totalLoss;
  const fcy = lap?.flag === "FCY";
  // The import drops the out-lap when it cannot split off the pit-lane time (pit box before the
  // timing line); the lap itself is still known, so show it whole (marked *).
  const pitLap = lap ? (pitHere ? lap.l : [...car.laps].reverse().find((l) => l.l < lap.l && l.pit === 1)?.l) : undefined;
  const outLapWhole = !!t && (t.outLapTime === null || t.outLapTime === undefined || t.outLapTime <= 0);
  const outLap = !t ? null : outLapWhole ? (pitLap !== undefined ? car.laps.find((l) => l.l > pitLap && l.pit === 0)?.ltSec ?? null : null) : t.outLapTime;

  return (
    <div className="flex flex-col gap-3">
      <CarSummary data={data} focusNum={focusNum} annotations={annotations} />
      <ShareCarImageButton data={data} annotations={annotations} carNum={focusNum} />

      {!lap ? (
        <p className="rounded-lg border p-3 text-[13px]" style={{ background: T.card, borderColor: T.line, color: T.muted }}>
          Pick a lap: click or tap the chart, drag the strip under it, or use ◀ ▶ (arrow keys on a keyboard).
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 rounded-lg border p-3" style={{ background: T.card, borderColor: T.line }}>
            <div className="col-span-2 flex justify-between">
              <span className="font-semibold">Lap {lap.l}</span>
              <span style={{ color: fcy ? T.warn : "#0ca30c" }}>● {fcy ? "Full Course Yellow" : "Green"}</span>
            </div>
            <Stat
              label="Position"
              value={classView ? `P${lap.cp} in ${classView}` : `P${lap.p}`}
              sub={classView ? `P${lap.p} overall` : `P${lap.cp} in ${car.cls}`}
            />
            <Stat label="Lap time" value={formatLapTime(lap.lt)} sub={lapTag ?? undefined} />
            {info?.posDelta ? (
              <div className="col-span-2 text-[13px]" style={{ color: info.posDelta > 0 ? T.good : T.bad }}>
                {info.posDelta > 0 ? `▲ Gained ${info.posDelta}` : `▼ Lost ${-info.posDelta}`} {info.posDelta === 1 || info.posDelta === -1 ? "place" : "places"} on this lap
              </div>
            ) : null}
            {info?.paceInfo?.compAvg && info.paceInfo.delta !== null && (
              <div className="col-span-2 text-[13px]" style={{ color: T.soft }}>
                <span className="font-mono" style={{ color: info.paceInfo.delta <= 0 ? T.good : T.bad }}>
                  {info.paceInfo.delta <= 0 ? "" : "+"}
                  {info.paceInfo.delta.toFixed(3)}
                </span>{" "}
                vs the {classView || "field"} average this lap ({info.paceInfo.compAvg}, {info.paceInfo.compN} cars on green-flag laps)
              </div>
            )}
          </div>

          {pit && (
            <article className="flex flex-col gap-2 rounded-lg border p-3" style={{ background: T.card, borderColor: T.line }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border px-2 text-[11px]" style={{ borderColor: T.text }}>
                  {pitKindLabel(pit.kind, !!t?.isDriveThrough)}
                </span>
                <span className="font-semibold">
                  {pit.pitLabel}
                  {pit.driverChanged && pit.outDriver && pit.inDriver ? ` · ${pit.outDriver} → ${pit.inDriver}` : ""}
                </span>
              </div>
              {t && (
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                  {t.pitRoadTime !== null && (
                    <>
                      <dt style={{ color: T.muted }}>Pit-lane time</dt>
                      <dd className="m-0 font-mono">{sec(t.pitRoadTime)}</dd>
                    </>
                  )}
                  <dt style={{ color: T.muted }}>In-lap · out-lap</dt>
                  <dd className="m-0 font-mono">
                    {sec(t.inLapTime)} · {sec(outLap)}
                    {outLapWhole ? "*" : ""}
                  </dd>
                  <dt style={{ color: T.muted }}>Time lost</dt>
                  <dd className="m-0 font-mono">
                    {sec(t.totalPitLoss)}{" "}
                    <span className="font-sans text-[11px]" style={{ color: T.muted }}>
                      {lossBasis(t)}
                    </span>
                  </dd>
                </dl>
              )}
              {outLapWhole && outLap !== null && (
                <div className="text-[11px]" style={{ color: T.muted }}>
                  * The whole out-lap: the pit box is before the timing line here, so the stop falls in the in-lap.
                </div>
              )}
              {spc && spc.classification !== "normal" && (
                <div className="text-[13px]" style={{ color: spc.direction === "fast" ? T.good : T.warn }}>
                  {spc.direction === "fast" ? "Quicker" : "Slower"} than this race's typical stop
                </div>
              )}
              {pitHere && pit.alsoPittingCars?.length ? (
                <div className="text-[13px]" style={{ color: T.muted }}>
                  {pit.cycle ? `Also in ${pit.cycle.cls} pit cycle ${pit.cycle.ordinal}` : "Also in the pits"}:{" "}
                  {pit.alsoPittingCars.map((n) => `#${n}`).join(", ")}
                </div>
              ) : null}
              <LinkButton onClick={() => onOpen("pit")}>Open the pit cycle</LinkButton>
            </article>
          )}

          {info?.reason && (
            <div className="rounded-lg border p-3 text-[13px]" style={{ background: T.card, borderColor: T.line, color: T.soft }}>
              <div className="mb-1 text-[11px] uppercase tracking-[0.06em]" style={{ color: T.muted }}>
                What changed
              </div>
              {info.reason}
              <div>
                <LinkButton onClick={() => onOpen("event")}>Position change details</LinkButton>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-x-4">
            <LinkButton onClick={() => onOpen("gap")}>Gap evolution</LinkButton>
            <LinkButton onClick={() => onOpen("h2h")}>Head-to-head</LinkButton>
          </div>
        </>
      )}
    </div>
  );
}
