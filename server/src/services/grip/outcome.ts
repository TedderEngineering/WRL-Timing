/**
 * Finding Grip — how a calculated run came in.
 *
 * After a run the driver records the hot pressures they measured. Comparing
 * them with the target hot pressures shows how close the calculation got.
 * Pure functions, so they are easy to test; the routes load the rows.
 */

/** A corner is "on target" when it came in within this many PSI of its target hot pressure. */
export const ON_TARGET_PSI = 0.5;

export interface Four {
  lf: number;
  rf: number;
  lr: number;
  rr: number;
}
const KEYS = ["lf", "rf", "lr", "rr"] as const;

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface Comparison {
  /** Measured minus target, per corner (PSI). Positive means it came in high. */
  delta: Four;
  onTarget: boolean;
  /** Largest miss on any corner (PSI, absolute). */
  worstMiss: number;
  /** Mean miss across the four corners (PSI, absolute). */
  averageMiss: number;
}

export function compare(target: Four, hot: Four): Comparison {
  const delta = Object.fromEntries(
    KEYS.map((k) => [k, round2(hot[k] - target[k])])
  ) as unknown as Four;
  const misses = KEYS.map((k) => Math.abs(delta[k]));
  return {
    delta,
    // A hair of tolerance so 0.5 PSI on the nose counts, whatever the float maths says.
    onTarget: misses.every((m) => m <= ON_TARGET_PSI + 1e-9),
    worstMiss: round2(Math.max(...misses)),
    averageMiss: round2(misses.reduce((a, b) => a + b, 0) / 4),
  };
}

/** The measured hot pressures, or null when the run has not been recorded. */
export function actualOf(c: {
  actualHotLf: number | null;
  actualHotRf: number | null;
  actualHotLr: number | null;
  actualHotRr: number | null;
  outcomeAt: Date | null;
}): Four | null {
  if (
    c.outcomeAt === null ||
    c.actualHotLf === null ||
    c.actualHotRf === null ||
    c.actualHotLr === null ||
    c.actualHotRr === null
  )
    return null;
  return { lf: c.actualHotLf, rf: c.actualHotRf, lr: c.actualHotLr, rr: c.actualHotRr };
}

// ─── Progress over time ──────────────────────────────────────────────────────

/** The columns the progress summary needs from a calculation row (with its track). */
export interface CalcRow {
  id: string;
  name: string;
  sessionDate: Date;
  track: { id: string; name: string; shortName: string };
  targetLf: number;
  targetRf: number;
  targetLr: number;
  targetRr: number;
  actualHotLf: number | null;
  actualHotRf: number | null;
  actualHotLr: number | null;
  actualHotRr: number | null;
  outcomeAt: Date | null;
}

interface Recorded {
  row: CalcRow;
  cmp: Comparison;
}

function recordedOf(rows: CalcRow[]): Recorded[] {
  const out: Recorded[] = [];
  for (const row of rows) {
    const hot = actualOf(row);
    if (!hot) continue;
    const target = {
      lf: row.targetLf,
      rf: row.targetRf,
      lr: row.targetLr,
      rr: row.targetRr,
    };
    out.push({ row, cmp: compare(target, hot) });
  }
  // Newest run first.
  return out.sort((a, b) => b.row.sessionDate.getTime() - a.row.sessionDate.getTime());
}

const mean = (xs: number[]) =>
  xs.length === 0 ? null : round2(xs.reduce((a, b) => a + b, 0) / xs.length);

const trackOut = (t: CalcRow["track"]) => ({
  id: t.id,
  name: t.name,
  shortName: t.shortName,
});

/**
 * How close the driver's recorded runs came, stated as facts for the
 * dashboard: the last ten, the latest five against the five before (once there
 * are six or more), and each track. Averages are of each run's worst corner,
 * the same measure that decides "on target". Only the driver's own runs; nothing is
 * compared with other drivers.
 */
export function progressSummary(rows: CalcRow[], recentCount = 10) {
  const recorded = recordedOf(rows);
  const recent = recorded.slice(0, recentCount);

  let trend: {
    latestAverage: number;
    previousAverage: number;
    latestRuns: number;
    previousRuns: number;
    direction: "smaller" | "similar" | "larger";
  } | null = null;
  if (recorded.length >= 6) {
    const latest = recorded.slice(0, 5);
    const previous = recorded.slice(5, 10);
    const latestAverage = mean(latest.map((r) => r.cmp.worstMiss))!;
    const previousAverage = mean(previous.map((r) => r.cmp.worstMiss))!;
    trend = {
      latestAverage,
      previousAverage,
      latestRuns: latest.length,
      previousRuns: previous.length,
      // Differences under 0.1 PSI are within gauge reading; call them similar.
      direction:
        latestAverage < previousAverage - 0.1
          ? "smaller"
          : latestAverage > previousAverage + 0.1
            ? "larger"
            : "similar",
    };
  }

  const groups = new Map<string, Recorded[]>();
  for (const r of recorded) {
    const list = groups.get(r.row.track.id) ?? [];
    list.push(r);
    groups.set(r.row.track.id, list);
  }
  const tracks = [...groups.values()]
    .map((list) => ({
      track: trackOut(list[0].row.track),
      recorded: list.length,
      onTarget: list.filter((r) => r.cmp.onTarget).length,
      averageWorstMiss: mean(list.map((r) => r.cmp.worstMiss)),
      lastDate: list[0].row.sessionDate,
    }))
    .sort((a, b) => b.recorded - a.recorded || a.track.name.localeCompare(b.track.name));

  return {
    onTargetPsi: ON_TARGET_PSI,
    recordedTotal: recorded.length,
    recent: {
      count: recent.length,
      onTarget: recent.filter((r) => r.cmp.onTarget).length,
      averageWorstMiss: mean(recent.map((r) => r.cmp.worstMiss)),
      // Oldest first, for a left-to-right strip.
      runs: [...recent].reverse().map((r) => ({
        id: r.row.id,
        name: r.row.name,
        sessionDate: r.row.sessionDate,
        track: trackOut(r.row.track),
        worstMiss: r.cmp.worstMiss,
        onTarget: r.cmp.onTarget,
      })),
    },
    trend,
    tracks,
  };
}
