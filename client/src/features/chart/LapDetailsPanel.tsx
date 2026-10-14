/**
 * Lap details beside the Position Trace (mockup F1 aside; F6 below the chart
 * on a phone): the focus car, the selected lap, its pit stop, what changed,
 * and the deeper panels.
 */
import type { RaceChartData } from "@shared/types";
import { formatLapTime, type LapInfoData } from "./chart-renderer";
import { TRACE } from "./constants";

const T = { card: "#12122a", line: "#1e1e38", text: "#e0e0e8", soft: "#cbd5e1", muted: "#9a9ab4", good: "#4ade80", bad: "#e66767", warn: "#fab219" };

function sec(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const sign = s < 0 ? "−" : "";
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const r = a - m * 60;
  return m > 0 ? `${sign}${m}:${r.toFixed(3).padStart(6, "0")}` : `${sign}${r.toFixed(3)}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
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

export function LapDetailsPanel({
  data,
  info,
  focusNum,
  classView,
  onOpen,
}: {
  data: RaceChartData;
  info: LapInfoData | null;
  focusNum: number;
  classView: string;
  onOpen: (panel: "pit" | "gap" | "h2h" | "event") => void;
}) {
  const car = data.cars[String(focusNum)];
  if (!car) return null;
  const lapsRun = car.laps.length;
  const finish = car.finishPos && car.finishPos < 999 ? `P${car.finishPosClass} in ${car.cls} · P${car.finishPos} overall` : car.status || "Not classified";

  const lap = info?.lap ?? null;
  const pit = info?.pitInfo ?? null;
  const pitHere = !!pit && lap !== null && data.cars[String(focusNum)]?.laps.some((l) => l.l === lap.l && l.pit === 1);
  const lapTag = pitHere ? "pit lap" : pit ? "out-lap" : null;
  const t = pit?.timing ?? null;
  const spc = t?.spcAnalysis?.totalLoss;
  const fcy = lap?.flag === "FCY";

  return (
    <div className="flex flex-col gap-3">
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
          Finished {finish} · {lapsRun} laps
        </div>
      </div>

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
                  {t?.isDriveThrough ? "▲ Drive-through" : "● Pit stop"}
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
                    {sec(t.inLapTime)} · {sec(t.outLapTime)}
                  </dd>
                  <dt style={{ color: T.muted }}>Time lost</dt>
                  <dd className="m-0 font-mono">
                    {sec(t.totalPitLoss)}{" "}
                    <span className="font-sans text-[11px]" style={{ color: T.muted }}>
                      vs green pace ({sec(t.avgGreenLapTime)})
                    </span>
                  </dd>
                </dl>
              )}
              {spc && spc.classification !== "normal" && (
                <div className="text-[13px]" style={{ color: spc.direction === "fast" ? T.good : T.warn }}>
                  {spc.direction === "fast" ? "Quicker" : "Slower"} than this race's typical stop
                </div>
              )}
              {pitHere && pit.alsoPittingCars?.length ? (
                <div className="text-[13px]" style={{ color: T.muted }}>
                  Also in the pits: {pit.alsoPittingCars.map((n) => `#${n}`).join(", ")}
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
