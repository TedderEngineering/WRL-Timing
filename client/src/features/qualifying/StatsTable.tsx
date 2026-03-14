import { useMemo } from "react";
import { CHART_STYLE } from "../chart/constants";
import type { QualifyingChartData, QualifyingCar } from "@shared/types";

interface StatsTableProps {
  data: QualifyingChartData;
  compSet: Set<string>;
  classView: string;
}

interface CarStats {
  car: QualifyingCar;
  pos: number;
  delta: number;
  s1Avg: number;
  s2Avg: number;
  s3Avg: number;
  s1Std: number;
  s2Std: number;
  s3Std: number;
  consistency: number;
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stdDev(vals: number[], avg: number): number {
  if (vals.length < 2) return 0;
  const variance = vals.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(variance);
}

function fmtSec(sec: number): string {
  if (sec <= 0) return "--";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  if (m > 0) return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  return s.toFixed(3);
}

function fmtDelta(sec: number): string {
  if (sec <= 0) return "--";
  return `+${sec.toFixed(3)}`;
}

function fmtPct(pct: number): string {
  return `${(pct * 100).toFixed(1)}%`;
}

/** Color a value relative to a class average and stddev */
function deltaColor(value: number, classAvg: number, classStd: number): string {
  if (classStd === 0 || classAvg === 0) return CHART_STYLE.text;
  const diff = value - classAvg;
  if (diff < -classStd) return "#4ade80"; // green — faster than average by >1σ
  if (diff > classStd) return "#f87171"; // red — slower than average by >1σ
  return CHART_STYLE.text; // neutral
}

/** Inverse color for consistency (higher = better) */
function consistencyColor(value: number, classAvg: number, classStd: number): string {
  if (classStd === 0 || classAvg === 0) return CHART_STYLE.text;
  const diff = value - classAvg;
  if (diff > classStd) return "#4ade80";
  if (diff < -classStd) return "#f87171";
  return CHART_STYLE.text;
}

export function StatsTable({ data, compSet, classView }: StatsTableProps) {
  const { rows, classAvgs } = useMemo(() => {
    // Filter to selected cars + class view
    const filtered = data.cars.filter((c) => {
      if (!compSet.has(c.num)) return false;
      if (classView && c.cls !== classView) return false;
      return true;
    });

    // Compute stats per car
    const carStats: CarStats[] = filtered.map((car, idx) => {
      const validLaps = car.laps.filter((l) => l.s1 > 0 && l.s2 > 0 && l.s3 > 0);
      const s1Vals = validLaps.map((l) => l.s1);
      const s2Vals = validLaps.map((l) => l.s2);
      const s3Vals = validLaps.map((l) => l.s3);

      const s1Avg = mean(s1Vals);
      const s2Avg = mean(s2Vals);
      const s3Avg = mean(s3Vals);
      const s1Std = stdDev(s1Vals, s1Avg);
      const s2Std = stdDev(s2Vals, s2Avg);
      const s3Std = stdDev(s3Vals, s3Avg);

      // Consistency = weighted average of (1 − σ/μ) across sectors
      const sectors = [
        { avg: s1Avg, std: s1Std },
        { avg: s2Avg, std: s2Std },
        { avg: s3Avg, std: s3Std },
      ];
      const totalAvg = sectors.reduce((s, v) => s + v.avg, 0);
      let consistency = 0;
      if (totalAvg > 0) {
        const weightedSum = sectors.reduce((sum, { avg, std }) => {
          if (avg <= 0) return sum;
          return sum + (1 - std / avg) * (avg / totalAvg);
        }, 0);
        consistency = weightedSum;
      }

      return {
        car,
        pos: idx + 1,
        delta: car.bestLap - car.theoreticalBest,
        s1Avg,
        s2Avg,
        s3Avg,
        s1Std,
        s2Std,
        s3Std,
        consistency,
      };
    });

    // Sort by best lap
    carStats.sort((a, b) => a.car.bestLap - b.car.bestLap);
    carStats.forEach((s, i) => (s.pos = i + 1));

    // Compute class averages for color coding
    const byClass = new Map<string, CarStats[]>();
    for (const s of carStats) {
      const cls = s.car.cls || "All";
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls)!.push(s);
    }

    const avgMap = new Map<
      string,
      {
        bestLap: number; thBest: number; delta: number;
        s1Best: number; s1Avg: number; s1Std: number;
        s2Best: number; s2Avg: number; s2Std: number;
        s3Best: number; s3Avg: number; s3Std: number;
        consistency: number;
        // stddevs of each column for color thresholds
        bestLapStd: number; thBestStd: number; deltaStd: number;
        s1BestStd: number; s1AvgStd: number; s1StdStd: number;
        s2BestStd: number; s2AvgStd: number; s2StdStd: number;
        s3BestStd: number; s3AvgStd: number; s3StdStd: number;
        consistencyStd: number;
        count: number;
      }
    >();

    for (const [cls, stats] of byClass) {
      const m = (fn: (s: CarStats) => number) => mean(stats.map(fn));
      const sd = (fn: (s: CarStats) => number) => {
        const avg = m(fn);
        return stdDev(stats.map(fn), avg);
      };
      avgMap.set(cls, {
        bestLap: m((s) => s.car.bestLap),
        thBest: m((s) => s.car.theoreticalBest),
        delta: m((s) => s.delta),
        s1Best: m((s) => s.car.bestS1),
        s1Avg: m((s) => s.s1Avg),
        s1Std: m((s) => s.s1Std),
        s2Best: m((s) => s.car.bestS2),
        s2Avg: m((s) => s.s2Avg),
        s2Std: m((s) => s.s2Std),
        s3Best: m((s) => s.car.bestS3),
        s3Avg: m((s) => s.s3Avg),
        s3Std: m((s) => s.s3Std),
        consistency: m((s) => s.consistency),
        bestLapStd: sd((s) => s.car.bestLap),
        thBestStd: sd((s) => s.car.theoreticalBest),
        deltaStd: sd((s) => s.delta),
        s1BestStd: sd((s) => s.car.bestS1),
        s1AvgStd: sd((s) => s.s1Avg),
        s1StdStd: sd((s) => s.s1Std),
        s2BestStd: sd((s) => s.car.bestS2),
        s2AvgStd: sd((s) => s.s2Avg),
        s2StdStd: sd((s) => s.s2Std),
        s3BestStd: sd((s) => s.car.bestS3),
        s3AvgStd: sd((s) => s.s3Avg),
        s3StdStd: sd((s) => s.s3Std),
        consistencyStd: sd((s) => s.consistency),
        count: stats.length,
      });
    }

    return { rows: carStats, classAvgs: avgMap };
  }, [data, compSet, classView]);

  if (rows.length === 0) {
    return (
      <div
        className="rounded-lg border p-8 text-center"
        style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, color: CHART_STYLE.muted }}
      >
        No cars selected.
      </div>
    );
  }

  const headerStyle = {
    padding: "6px 8px",
    textAlign: "center" as const,
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: CHART_STYLE.muted,
    borderBottom: `1px solid ${CHART_STYLE.border}`,
    whiteSpace: "nowrap" as const,
  };

  const cellStyle = {
    padding: "5px 8px",
    textAlign: "center" as const,
    fontSize: "12px",
    fontFamily: "monospace",
    borderBottom: `1px solid ${CHART_STYLE.border}`,
    whiteSpace: "nowrap" as const,
  };

  const leftCell = { ...cellStyle, textAlign: "left" as const };

  return (
    <div
      className="rounded-lg border overflow-x-auto"
      style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={headerStyle}>Pos</th>
            <th style={{ ...headerStyle, textAlign: "left" }}>Car</th>
            <th style={{ ...headerStyle, textAlign: "left" }}>Driver</th>
            <th style={headerStyle}>Class</th>
            <th style={headerStyle}>Best Lap</th>
            <th style={headerStyle}>Theo. Best</th>
            <th style={headerStyle}>Delta</th>
            <th style={{ ...headerStyle, borderLeft: `1px solid ${CHART_STYLE.border}` }}>S1 Best</th>
            <th style={headerStyle}>S1 Avg</th>
            <th style={headerStyle}>S1 σ</th>
            <th style={{ ...headerStyle, borderLeft: `1px solid ${CHART_STYLE.border}` }}>S2 Best</th>
            <th style={headerStyle}>S2 Avg</th>
            <th style={headerStyle}>S2 σ</th>
            <th style={{ ...headerStyle, borderLeft: `1px solid ${CHART_STYLE.border}` }}>S3 Best</th>
            <th style={headerStyle}>S3 Avg</th>
            <th style={headerStyle}>S3 σ</th>
            <th style={{ ...headerStyle, borderLeft: `1px solid ${CHART_STYLE.border}` }}>Consistency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const avg = classAvgs.get(row.car.cls || "All");
            const dc = (val: number, cAvg: number, cStd: number) =>
              deltaColor(val, cAvg, cStd);
            // For time-based columns: lower is better (green)
            // For consistency: higher is better (invert)

            return (
              <tr
                key={row.car.num}
                style={{ background: row.pos % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}
              >
                <td style={{ ...cellStyle, fontWeight: 600 }}>{row.pos}</td>
                <td style={leftCell}>#{row.car.num}</td>
                <td style={{ ...leftCell, color: CHART_STYLE.text, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row.car.driver}
                </td>
                <td style={cellStyle}>{row.car.cls}</td>
                <td style={{ ...cellStyle, color: avg ? dc(row.car.bestLap, avg.bestLap, avg.bestLapStd) : CHART_STYLE.text }}>
                  {fmtSec(row.car.bestLap)}
                </td>
                <td style={{ ...cellStyle, color: avg ? dc(row.car.theoreticalBest, avg.thBest, avg.thBestStd) : CHART_STYLE.text }}>
                  {fmtSec(row.car.theoreticalBest)}
                </td>
                <td style={{ ...cellStyle, color: avg ? dc(row.delta, avg.delta, avg.deltaStd) : CHART_STYLE.text }}>
                  {fmtDelta(row.delta)}
                </td>
                <td style={{ ...cellStyle, borderLeft: `1px solid ${CHART_STYLE.border}`, color: avg ? dc(row.car.bestS1, avg.s1Best, avg.s1BestStd) : CHART_STYLE.text }}>
                  {fmtSec(row.car.bestS1)}
                </td>
                <td style={{ ...cellStyle, color: avg ? dc(row.s1Avg, avg.s1Avg, avg.s1AvgStd) : CHART_STYLE.text }}>
                  {fmtSec(row.s1Avg)}
                </td>
                <td style={{ ...cellStyle, color: CHART_STYLE.muted }}>{row.s1Std.toFixed(3)}</td>
                <td style={{ ...cellStyle, borderLeft: `1px solid ${CHART_STYLE.border}`, color: avg ? dc(row.car.bestS2, avg.s2Best, avg.s2BestStd) : CHART_STYLE.text }}>
                  {fmtSec(row.car.bestS2)}
                </td>
                <td style={{ ...cellStyle, color: avg ? dc(row.s2Avg, avg.s2Avg, avg.s2AvgStd) : CHART_STYLE.text }}>
                  {fmtSec(row.s2Avg)}
                </td>
                <td style={{ ...cellStyle, color: CHART_STYLE.muted }}>{row.s2Std.toFixed(3)}</td>
                <td style={{ ...cellStyle, borderLeft: `1px solid ${CHART_STYLE.border}`, color: avg ? dc(row.car.bestS3, avg.s3Best, avg.s3BestStd) : CHART_STYLE.text }}>
                  {fmtSec(row.car.bestS3)}
                </td>
                <td style={{ ...cellStyle, color: avg ? dc(row.s3Avg, avg.s3Avg, avg.s3AvgStd) : CHART_STYLE.text }}>
                  {fmtSec(row.s3Avg)}
                </td>
                <td style={{ ...cellStyle, color: CHART_STYLE.muted }}>{row.s3Std.toFixed(3)}</td>
                <td style={{ ...cellStyle, borderLeft: `1px solid ${CHART_STYLE.border}`, color: avg ? consistencyColor(row.consistency, avg.consistency, avg.consistencyStd) : CHART_STYLE.text }}>
                  {fmtPct(row.consistency)}
                </td>
              </tr>
            );
          })}

          {/* ── Class average rows ────────────────────────────────── */}
          {[...classAvgs.entries()].map(([cls, avg]) => (
            <tr key={`avg-${cls}`} style={{ background: "rgba(255,255,255,0.04)" }}>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}></td>
              <td style={{ ...leftCell, color: CHART_STYLE.dim, fontStyle: "italic" }} colSpan={2}>
                {cls} Average ({avg.count} cars)
              </td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{cls}</td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{fmtSec(avg.bestLap)}</td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{fmtSec(avg.thBest)}</td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{fmtDelta(avg.delta)}</td>
              <td style={{ ...cellStyle, borderLeft: `1px solid ${CHART_STYLE.border}`, color: CHART_STYLE.dim }}>{fmtSec(avg.s1Best)}</td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{fmtSec(avg.s1Avg)}</td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{avg.s1Std.toFixed(3)}</td>
              <td style={{ ...cellStyle, borderLeft: `1px solid ${CHART_STYLE.border}`, color: CHART_STYLE.dim }}>{fmtSec(avg.s2Best)}</td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{fmtSec(avg.s2Avg)}</td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{avg.s2Std.toFixed(3)}</td>
              <td style={{ ...cellStyle, borderLeft: `1px solid ${CHART_STYLE.border}`, color: CHART_STYLE.dim }}>{fmtSec(avg.s3Best)}</td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{fmtSec(avg.s3Avg)}</td>
              <td style={{ ...cellStyle, color: CHART_STYLE.dim }}>{avg.s3Std.toFixed(3)}</td>
              <td style={{ ...cellStyle, borderLeft: `1px solid ${CHART_STYLE.border}`, color: CHART_STYLE.dim }}>{fmtPct(avg.consistency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
