import { useState, useMemo } from "react";
import type { RaceChartData, AnnotationData } from "@shared/types";
import { CLASS_COLORS, CHART_STYLE } from "./constants";

interface PassEventPanelProps {
  reason: string;
  posDelta: number;
  focusNum: number;
  isPit?: boolean;
  data?: RaceChartData;
  annotations?: AnnotationData;
  activeLap?: number | null;
  onOpenH2H: (carNum: number) => void;
  onAddToCompare: (carNum: number) => void;
}

// ── Racing lap types ─────────────────────────────────────────────────

interface CarEvent {
  kind: "car";
  carNum: number;
  teamName: string;
  reason: "on pace" | "pitted" | "yellow" | "unknown";
  direction: "gained" | "lost" | "neutral";
}

type ParsedEvent = CarEvent;

const REASON_STYLES: Record<string, { bg: string; border: string; color: string; label: string }> = {
  "on pace": { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", color: "#93c5fd", label: "on pace" },
  pitted: { bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)", color: "#fcd34d", label: "pitted" },
  yellow: { bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)", color: "#fcd34d", label: "on yellow" },
  unknown: { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", label: "—" },
};

function parseRacingLap(reason: string, posDelta: number): ParsedEvent[] {
  const direction: CarEvent["direction"] = posDelta > 0 ? "gained" : posDelta < 0 ? "lost" : "neutral";
  const rawParts = reason.split(/;\s*/);
  const seen = new Set<string>();
  const dedupParts: string[] = [];
  for (const p of rawParts) {
    const t = p.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    dedupParts.push(t);
  }
  const deduped = dedupParts.join("; ");

  let body = deduped;
  const gainMatch = deduped.match(/^Gained\s*—\s*passed\s*/i);
  const lossMatch = deduped.match(/^Lost\s*—\s*/i);
  if (gainMatch) body = deduped.slice(gainMatch[0].length);
  else if (lossMatch) body = deduped.slice(lossMatch[0].length);

  const events: ParsedEvent[] = [];
  for (const part of body.split(/;\s*/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^#(\d+)\s*(.*?)?\s+(on pace|pitted|\(yellow\))$/i);
    if (m) {
      const carNum = parseInt(m[1], 10);
      const teamName = (m[2] || "").trim();
      let reasonType: CarEvent["reason"] = "unknown";
      const r = m[3].toLowerCase();
      if (r === "on pace") reasonType = "on pace";
      else if (r === "pitted") reasonType = "pitted";
      else if (r === "(yellow)") reasonType = "yellow";
      events.push({ kind: "car", carNum, teamName, reason: reasonType, direction });
    } else {
      const numMatch = trimmed.match(/^#(\d+)/);
      if (numMatch) {
        events.push({ kind: "car", carNum: parseInt(numMatch[1], 10), teamName: trimmed.replace(/^#\d+\s*/, ""), reason: "unknown", direction });
      }
    }
  }
  return events;
}

// ── Pit cycle types ──────────────────────────────────────────────────

interface AlsoPittedRow {
  num: number;
  team: string;
  cls: string;
  posBefore: number;
  posAfter: number;
  pitDur: string | null;
  lap: number;
}

type PitSortKey = "position" | "pitDuration" | "car" | "class";

function secToDisplay(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}

function clsStyle(cls: string): { bg: string; text: string } {
  const c = CLASS_COLORS[cls];
  return c ? { bg: c, text: "#fff" } : { bg: "#444", text: "#fff" };
}

// ── Component ────────────────────────────────────────────────────────

export function PassEventPanel({ reason, posDelta, focusNum, isPit, data, annotations, activeLap, onOpenH2H, onAddToCompare }: PassEventPanelProps) {
  const isPitStop = reason.startsWith("Pit stop");

  // ── Pit stop view ──────────────────────────────────────────────
  if (isPitStop && data && annotations && activeLap != null) {
    return (
      <PitCycleView
        reason={reason}
        posDelta={posDelta}
        focusNum={focusNum}
        data={data}
        annotations={annotations}
        activeLap={activeLap}
        onOpenH2H={onOpenH2H}
        onAddToCompare={onAddToCompare}
      />
    );
  }

  // ── Racing lap view (unchanged) ────────────────────────────────
  return (
    <RacingLapView
      reason={reason}
      posDelta={posDelta}
      focusNum={focusNum}
      isPit={isPit}
      onOpenH2H={onOpenH2H}
      onAddToCompare={onAddToCompare}
    />
  );
}

// ── Pit Cycle View (mockup design) ───────────────────────────────────

function PitCycleView({
  reason, posDelta, focusNum, data, annotations, activeLap, onOpenH2H, onAddToCompare,
}: {
  reason: string; posDelta: number; focusNum: number;
  data: RaceChartData; annotations: AnnotationData; activeLap: number;
  onOpenH2H: (n: number) => void; onAddToCompare: (n: number) => void;
}) {
  const [sortBy, setSortBy] = useState<PitSortKey>("position");
  const [filterClass, setFilterClass] = useState("All");
  const [expanded, setExpanded] = useState<number | null>(null);

  const dirColor = posDelta > 0 ? "#4ade80" : posDelta < 0 ? "#f87171" : "rgba(255,255,255,0.5)";

  // Focus car data
  const focusCar = data.cars[String(focusNum)];
  const focusAnn = annotations[String(focusNum)];
  const focusPit = focusAnn?.pits?.find((p) => p.l === activeLap);
  const focusTiming = focusPit?.pitTiming;
  const focusLaps = focusCar?.laps || [];
  const focusLap = focusLaps.find((l) => l.l === activeLap);
  const prevLap = focusLap ? focusLaps.find((l) => l.l === activeLap - 1) : null;
  const posBefore = prevLap?.p ?? focusLap?.p ?? 0;
  const posAfter = focusLap?.p ?? 0;

  // Parse pit cycle delta from reason string
  const cycleMatch = reason.match(/(Gained|Lost)\s+(\d+)\s+in pit cycle/i);
  const cycleDelta = cycleMatch
    ? (cycleMatch[1].toLowerCase() === "gained" ? 1 : -1) * parseInt(cycleMatch[2], 10)
    : 0;

  // Build also-pitted rows from pit marker's alsoPittingCars or reason string fallback
  const alsoPittedRows = useMemo<AlsoPittedRow[]>(() => {
    let carNums: number[] = [];

    // Prefer structured data from pit marker
    if (focusPit?.alsoPittingCars && focusPit.alsoPittingCars.length > 0) {
      carNums = focusPit.alsoPittingCars;
    } else {
      // Fallback: parse from reason string
      const alsoMatch = reason.match(/also pitting:\s*(.+?)(?:;|$)/i);
      if (alsoMatch) {
        for (const m of alsoMatch[1].matchAll(/#(\d+)/g)) {
          carNums.push(parseInt(m[1], 10));
        }
      }
    }

    return carNums.map((num) => {
      const car = data.cars[String(num)];
      const carLaps = car?.laps || [];
      const cl = carLaps.find((l) => l.l === activeLap);
      const cp = carLaps.find((l) => l.l === activeLap - 1);
      const carAnn = annotations[String(num)];
      const carPit = carAnn?.pits?.find((p) => Math.abs(p.l - activeLap) <= 1);
      const pitLoss = carPit?.pitTiming?.totalPitLoss;

      return {
        num,
        team: car?.team || `Car #${num}`,
        cls: car?.cls || "",
        posBefore: cp?.p ?? cl?.p ?? 0,
        posAfter: cl?.p ?? 0,
        pitDur: pitLoss != null ? secToDisplay(pitLoss) : null,
        lap: carPit?.l ?? activeLap,
      };
    });
  }, [data, annotations, activeLap, focusPit, reason]);

  // Filter + sort
  const classes = useMemo(() => {
    const s = new Set(alsoPittedRows.map((r) => r.cls).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [alsoPittedRows]);

  const sorted = useMemo(() => {
    const filtered = filterClass === "All" ? alsoPittedRows : alsoPittedRows.filter((r) => r.cls === filterClass);
    return [...filtered].sort((a, b) => {
      if (sortBy === "position") return a.posAfter - b.posAfter;
      if (sortBy === "car") return a.num - b.num;
      if (sortBy === "class") return a.cls.localeCompare(b.cls);
      if (sortBy === "pitDuration") return (a.pitDur || "z").localeCompare(b.pitDur || "z");
      return 0;
    });
  }, [alsoPittedRows, filterClass, sortBy]);

  const SORT_OPTIONS: { key: PitSortKey; label: string }[] = [
    { key: "position", label: "Position" },
    { key: "pitDuration", label: "Pit Duration" },
    { key: "car", label: "Car #" },
    { key: "class", label: "Class" },
  ];

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${CHART_STYLE.border}` }}>
        <div className="flex justify-between items-start">
          <div>
            <div className="text-[10px] tracking-wider mb-1" style={{ color: CHART_STYLE.muted, letterSpacing: "0.08em" }}>
              POSITION CHANGE · L{activeLap}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold" style={{ color: dirColor }}>
                {posDelta > 0 ? `▲ Gained ${posDelta}` : posDelta < 0 ? `▼ Lost ${Math.abs(posDelta)}` : "No change"}
              </span>
              <span className="text-[13px]" style={{ color: CHART_STYLE.muted }}>
                position{Math.abs(posDelta) !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Focus car summary */}
        <div
          className="mt-3 px-3 py-2 rounded-lg flex items-center gap-4"
          style={{
            background: posDelta < 0 ? "rgba(239,68,68,0.07)" : posDelta > 0 ? "rgba(74,222,128,0.07)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${posDelta < 0 ? "rgba(239,68,68,0.18)" : posDelta > 0 ? "rgba(74,222,128,0.18)" : "rgba(255,255,255,0.08)"}`,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: clsStyle(focusCar?.cls || "").bg, color: clsStyle(focusCar?.cls || "").text }}>
              #{focusNum}
            </span>
            <ClassBadge cls={focusCar?.cls || ""} />
          </div>
          <div className="flex-1 text-[11px] truncate" style={{ color: "rgba(255,255,255,0.5)" }}>
            {focusCar?.team || ""}
          </div>
          <div className="text-[11px] text-right shrink-0">
            <div style={{ color: CHART_STYLE.muted }}>P{posBefore} → P{posAfter}</div>
            {focusTiming && (
              <div className="font-bold" style={{ color: dirColor }}>
                pit loss {secToDisplay(focusTiming.totalPitLoss)}
              </div>
            )}
          </div>
        </div>

        {/* Pit stats */}
        {focusTiming && (
          <div className="mt-2 flex rounded-md overflow-hidden" style={{ background: CHART_STYLE.card, border: `1px solid ${CHART_STYLE.border}` }}>
            {[
              { label: "IN-LAP", val: secToDisplay(focusTiming.inLapTime) },
              { label: "OUT-LAP", val: secToDisplay(focusTiming.outLapTime) },
              { label: "GRN AVG", val: secToDisplay(focusTiming.avgGreenLapTime) },
            ].map((s, i) => (
              <div key={i} className="flex-1 text-center py-1.5 px-2" style={{ borderRight: i < 2 ? `1px solid ${CHART_STYLE.border}` : "none" }}>
                <div className="text-[9px] tracking-wider" style={{ color: CHART_STYLE.muted, letterSpacing: "0.08em" }}>{s.label}</div>
                <div className="text-[13px] font-semibold mt-0.5" style={{ color: CHART_STYLE.text }}>{s.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Pit cycle net */}
        {cycleDelta !== 0 && (
          <div className="mt-2 text-xs" style={{ color: cycleDelta > 0 ? "#4ade80" : "#f87171" }}>
            {cycleDelta > 0 ? `▲ Gained ${cycleDelta}` : `▼ Lost ${Math.abs(cycleDelta)}`} in pit cycle
          </div>
        )}
      </div>

      {/* Also pitted section */}
      {alsoPittedRows.length > 0 && (
        <>
          {/* Filter + sort controls */}
          <div className="px-5 py-2" style={{ borderBottom: `1px solid ${CHART_STYLE.border}` }}>
            <div className="flex justify-between items-center">
              <div className="text-[10px] tracking-wider" style={{ color: CHART_STYLE.muted, letterSpacing: "0.07em" }}>
                ALSO PITTED THIS LAP — {alsoPittedRows.length} CARS
              </div>
              <div className="flex gap-1">
                {classes.map((c) => (
                  <button key={c} onClick={() => setFilterClass(c)}
                    className="px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors"
                    style={{
                      background: filterClass === c ? CHART_STYLE.border : "transparent",
                      border: `1px solid ${filterClass === c ? CHART_STYLE.dim : "transparent"}`,
                      color: filterClass === c ? CHART_STYLE.text : CHART_STYLE.muted,
                    }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-1 mt-1.5">
              <span className="text-[10px] mr-1 leading-[22px]" style={{ color: CHART_STYLE.dim }}>Sort:</span>
              {SORT_OPTIONS.map((o) => (
                <button key={o.key} onClick={() => setSortBy(o.key)}
                  className="px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors"
                  style={{
                    background: sortBy === o.key ? CHART_STYLE.border : "transparent",
                    border: `1px solid ${sortBy === o.key ? CHART_STYLE.dim : "transparent"}`,
                    color: sortBy === o.key ? "#60a5fa" : CHART_STYLE.muted,
                  }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table header */}
          <div
            className="grid gap-1 px-5 py-1.5 text-[9px] tracking-wider"
            style={{
              gridTemplateColumns: "36px 1fr 48px 52px 72px 24px",
              color: CHART_STYLE.dim, letterSpacing: "0.07em",
              borderBottom: `1px solid ${CHART_STYLE.border}`,
            }}
          >
            <div>CAR</div>
            <div>TEAM</div>
            <div className="text-center">CLASS</div>
            <div className="text-center">POS</div>
            <div className="text-center">PIT DUR</div>
            <div />
          </div>

          {/* Table rows */}
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {sorted.map((car) => {
              const isExp = expanded === car.num;
              const cc = CLASS_COLORS[car.cls] || "#666";
              const delta = car.posAfter - car.posBefore;

              return (
                <div key={car.num} className="mt-0.5">
                  <div
                    onClick={() => setExpanded(isExp ? null : car.num)}
                    className="grid gap-1 items-center cursor-pointer transition-colors"
                    style={{
                      gridTemplateColumns: "36px 1fr 48px 52px 72px 24px",
                      padding: "6px 8px",
                      borderRadius: isExp ? "6px 6px 0 0" : 6,
                      background: isExp ? CHART_STYLE.card : "transparent",
                      border: `1px solid ${isExp ? CHART_STYLE.border : "transparent"}`,
                      borderBottom: isExp ? "none" : undefined,
                    }}
                    onMouseEnter={(e) => { if (!isExp) e.currentTarget.style.background = CHART_STYLE.card; }}
                    onMouseLeave={(e) => { if (!isExp) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div className="font-mono text-xs font-bold" style={{ color: cc }}>#{car.num}</div>
                    <div className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.6)" }}>{car.team}</div>
                    <div className="text-center"><ClassBadge cls={car.cls} small /></div>
                    <div className="text-center text-[11px]" style={{ color: CHART_STYLE.muted }}>
                      P{car.posBefore}→P{car.posAfter}
                    </div>
                    <div className="text-center text-xs font-semibold" style={{ color: CHART_STYLE.text }}>
                      {car.pitDur || "—"}
                    </div>
                    <div className="text-center">
                      <DeltaBadge delta={delta} />
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExp && (
                    <div
                      className="flex gap-2 px-2 pb-2.5 pt-2"
                      style={{
                        background: CHART_STYLE.card,
                        borderRadius: "0 0 6px 6px",
                        border: `1px solid ${CHART_STYLE.border}`,
                        borderTop: "none",
                      }}
                    >
                      <div className="flex-1 flex rounded-md overflow-hidden" style={{ background: CHART_STYLE.bg, border: `1px solid ${CHART_STYLE.border}` }}>
                        {[
                          { label: "PIT LAP", val: `L${car.lap}` },
                          { label: "NET CHANGE", val: <DeltaBadge delta={delta} /> },
                        ].map((s, i) => (
                          <div key={i} className="flex-1 text-center py-1 px-2" style={{ borderRight: i < 1 ? `1px solid ${CHART_STYLE.border}` : "none" }}>
                            <div className="text-[9px] tracking-wider" style={{ color: CHART_STYLE.dim, letterSpacing: "0.07em" }}>{s.label}</div>
                            <div className="text-xs font-semibold mt-0.5" style={{ color: CHART_STYLE.text }}>{s.val}</div>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => onOpenH2H(car.num)}
                          className="px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer transition-colors hover:bg-indigo-500/20 whitespace-nowrap"
                          style={{ background: CHART_STYLE.border, border: `1px solid ${CHART_STYLE.dim}`, color: "#60a5fa" }}
                        >
                          H2H vs #{car.num}
                        </button>
                        <button
                          onClick={() => onAddToCompare(car.num)}
                          className="px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer transition-colors hover:bg-purple-500/20"
                          style={{ background: CHART_STYLE.border, border: `1px solid ${CHART_STYLE.dim}`, color: "#a78bfa" }}
                        >
                          + Compare
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* No also-pitted cars */}
      {alsoPittedRows.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-4">
          <span className="text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>
            No other class cars pitted this lap
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-2 mt-auto flex justify-between items-center" style={{ borderTop: `1px solid ${CHART_STYLE.border}` }}>
        <span className="text-[10px]" style={{ color: CHART_STYLE.dim }}>
          Focus car #{focusNum} is highlighted on the chart above.
        </span>
      </div>
    </div>
  );
}

// ── Racing Lap View (existing logic, unchanged) ──────────────────────

function RacingLapView({
  reason, posDelta, focusNum, isPit, onOpenH2H, onAddToCompare,
}: {
  reason: string; posDelta: number; focusNum: number; isPit?: boolean;
  onOpenH2H: (n: number) => void; onAddToCompare: (n: number) => void;
}) {
  const isGain = posDelta > 0;
  const carEvents = parseRacingLap(reason, posDelta).filter((e) => e.carNum !== focusNum);
  const dirColor = isGain ? "#4ade80" : posDelta < 0 ? "#f87171" : "rgba(255,255,255,0.5)";
  const isEmpty = carEvents.length === 0;

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold" style={{ color: dirColor }}>
            {isGain ? `▲ Gained ${posDelta}` : posDelta < 0 ? `▼ Lost ${Math.abs(posDelta)}` : "No change"}
          </span>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            position{Math.abs(posDelta) !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {carEvents.map((ev) => {
          const style = REASON_STYLES[ev.reason];
          return (
            <div key={`${ev.carNum}-${ev.reason}`} className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <span className="text-xs font-bold shrink-0 w-16" style={{ color: dirColor }}>
                {ev.direction === "gained" ? "▲ Gained" : ev.direction === "lost" ? "▼ Lost" : "—"}
              </span>
              <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(255,255,255,0.08)", color: "#fff" }}>
                #{ev.carNum}
              </span>
              <span className="text-xs truncate min-w-0" style={{ color: "rgba(255,255,255,0.6)" }}>
                {ev.teamName || `Car #${ev.carNum}`}
              </span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ml-auto"
                style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}>
                {style.label}
              </span>
            </div>
          );
        })}

        {/* Pit-only or no events fallback */}
        {isEmpty && (
          <div className="px-4 py-6">
            <div className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
              {isPit ? "Pit lap — see pit details above" : reason || "No position changes this lap"}
            </div>
          </div>
        )}

        {/* Action buttons */}
        {carEvents.length > 0 && (
          <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="flex flex-col gap-1.5">
              {carEvents.map((ev) => (
                <div key={`actions-${ev.carNum}`} className="flex items-center gap-2">
                  <span className="font-mono font-bold text-[11px] text-white">#{ev.carNum}</span>
                  <div className="flex gap-1.5 ml-auto">
                    <button onClick={() => onOpenH2H(ev.carNum)}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors hover:bg-indigo-500/20"
                      style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc" }}>
                      H2H vs #{ev.carNum}
                    </button>
                    <button onClick={() => onAddToCompare(ev.carNum)}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors hover:bg-white/[0.08]"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)" }}>
                      + Compare
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 mt-auto">
        <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
          Focus car #{focusNum} is highlighted on the chart above.
        </div>
      </div>
    </div>
  );
}

// ── Shared helpers ───────────────────────────────────────────────────

function ClassBadge({ cls, small }: { cls: string; small?: boolean }) {
  const c = clsStyle(cls);
  return (
    <span
      className="font-bold rounded whitespace-nowrap"
      style={{
        background: c.bg, color: c.text,
        fontSize: small ? 9 : 10,
        letterSpacing: "0.04em",
        padding: small ? "1px 5px" : "2px 7px",
      }}
    >
      {cls || "—"}
    </span>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-xs" style={{ color: CHART_STYLE.muted }}>—</span>;
  const gained = delta < 0;
  return (
    <span className="text-xs font-bold flex items-center gap-0.5" style={{ color: gained ? "#22c55e" : "#ef4444" }}>
      {gained ? "▲" : "▼"} {Math.abs(delta)}
    </span>
  );
}
