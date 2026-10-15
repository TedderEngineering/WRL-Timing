/**
 * A-LC: the official lap chart against the positions the engine derives from crossing times
 * (D-POS). IMSA publishes "12_Lap Chart" (JSON: laps[].positions[] = { position, number }), the
 * running order as each car completed each lap. The engine never takes positions from it; it
 * only reports where the two disagree, so a timing-file problem shows up before a story states
 * a position. Positions must already be set on the lap rows (computePositions).
 */
import type { Issue, SourceFileInfo } from "../types.js";
import type { LapRows } from "./context.js";

interface LapChartDoc {
  laps?: { lap_number?: number; positions?: { position?: number; number?: string | number }[] }[];
}

export interface LapChartCheck {
  compared: number;
  differing: number;
  /** Chart entries for a car or lap the timing files do not have. */
  unmatched: number;
}

export function checkLapChart(files: SourceFileInfo[], laps: LapRows, issues: Issue[]): LapChartCheck | null {
  const f = files.find((x) => x.role === "lap_chart" && x.text);
  if (!f) return null;
  let doc: LapChartDoc;
  try {
    doc = JSON.parse(f.text!.replace(/^﻿/, "")) as LapChartDoc;
  } catch {
    issues.push({ severity: "note", code: "LAP-CHART-UNREAD", message: `${f.name} is not readable JSON; positions were not cross-checked.`, files: [f.fileId] });
    return null;
  }
  if (!Array.isArray(doc.laps)) {
    issues.push({ severity: "note", code: "LAP-CHART-UNREAD", message: `${f.name} has no laps list; positions were not cross-checked.`, files: [f.fileId] });
    return null;
  }
  const out: LapChartCheck = { compared: 0, differing: 0, unmatched: 0 };
  const samples: string[] = [];
  const byCarLap = new Map<string, Map<number, number>>();
  for (const [car, rows] of Object.entries(laps)) byCarLap.set(car, new Map(rows.map((r) => [r.lap, r.pos])));
  for (const lap of doc.laps) {
    const L = lap.lap_number;
    if (typeof L !== "number") continue;
    for (const e of lap.positions ?? []) {
      const car = String(e.number ?? "").trim();
      const mine = byCarLap.get(car)?.get(L);
      if (mine === undefined || typeof e.position !== "number") {
        out.unmatched++;
        continue;
      }
      out.compared++;
      if (mine !== e.position) {
        out.differing++;
        if (samples.length < 3) samples.push(`#${car} lap ${L}: chart P${e.position}, crossings P${mine}`);
      }
    }
  }
  if (out.differing > 0) {
    issues.push({
      severity: "warning",
      code: "LAP-CHART-MISMATCH",
      message: `${out.differing} of ${out.compared} positions in ${f.name} differ from the crossing order (${samples.join("; ")}). Check the timing files before a story states these positions.`,
      files: [f.fileId],
    });
  }
  if (out.unmatched > 0) {
    issues.push({
      severity: "note",
      code: "LAP-CHART-UNMATCHED",
      message: `${out.unmatched} lap-chart entries name a car or lap the timing files do not have.`,
      files: [f.fileId],
    });
  }
  return out;
}
