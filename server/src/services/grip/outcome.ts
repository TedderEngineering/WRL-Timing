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
  /** The car from the shared My cars list, when the run has one. */
  userCar?: { id: string; label: string | null; number: string; series: string } | null;
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

  // Each car (shared My cars list); runs without a car are left out here.
  const carGroups = new Map<string, Recorded[]>();
  for (const r of recorded) {
    const car = r.row.userCar;
    if (!car) continue;
    const list = carGroups.get(car.id) ?? [];
    list.push(r);
    carGroups.set(car.id, list);
  }
  const cars = [...carGroups.values()]
    .map((list) => {
      const c = list[0].row.userCar!;
      return {
        car: { id: c.id, label: c.label, number: c.number, series: c.series },
        recorded: list.length,
        onTarget: list.filter((r) => r.cmp.onTarget).length,
        averageWorstMiss: mean(list.map((r) => r.cmp.worstMiss)),
        lastDate: list[0].row.sessionDate,
      };
    })
    .sort((a, b) => b.recorded - a.recorded || a.car.number.localeCompare(b.car.number));

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
    cars,
  };
}

// ─── Season recap ────────────────────────────────────────────────────────────

/** The columns the season recap needs from a reference session (with its track). */
export interface RefRow {
  id: string;
  sessionDate: Date;
  track: CalcRow["track"];
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A driver's season (calendar year) in facts, for the recap card. Rows must
 * already be limited to that year and to the driver. Only their own runs;
 * nothing is compared with other drivers.
 */
export function seasonSummary(year: number, calcs: CalcRow[], refs: RefRow[]) {
  const recorded = recordedOf(calcs);
  const days = new Set<string>();
  const tracks = new Map<
    string,
    {
      track: ReturnType<typeof trackOut>;
      days: Set<string>;
      calculations: number;
      recorded: number;
      onTarget: number;
    }
  >();
  const entry = (t: CalcRow["track"]) => {
    let e = tracks.get(t.id);
    if (!e) {
      e = {
        track: trackOut(t),
        days: new Set(),
        calculations: 0,
        recorded: 0,
        onTarget: 0,
      };
      tracks.set(t.id, e);
    }
    return e;
  };
  for (const c of calcs) {
    const e = entry(c.track);
    e.calculations += 1;
    e.days.add(dayKey(c.sessionDate));
    days.add(dayKey(c.sessionDate));
  }
  for (const r of refs) {
    entry(r.track).days.add(dayKey(r.sessionDate));
    days.add(dayKey(r.sessionDate));
  }
  for (const r of recorded) {
    const e = entry(r.row.track);
    e.recorded += 1;
    if (r.cmp.onTarget) e.onTarget += 1;
  }

  // The run that came closest: the smallest worst-corner miss (earliest on a tie).
  const closest = [...recorded].sort(
    (a, b) =>
      a.cmp.worstMiss - b.cmp.worstMiss ||
      a.row.sessionDate.getTime() - b.row.sessionDate.getTime()
  )[0];
  const onTarget = recorded.filter((r) => r.cmp.onTarget).length;
  const dates = [...days].sort();

  return {
    year,
    onTargetPsi: ON_TARGET_PSI,
    calculations: calcs.length,
    referenceSessions: refs.length,
    trackDays: days.size,
    recorded: recorded.length,
    onTarget,
    averageWorstMiss: mean(recorded.map((r) => r.cmp.worstMiss)),
    tracks: [...tracks.values()]
      .map((t) => ({
        track: t.track,
        days: t.days.size,
        calculations: t.calculations,
        recorded: t.recorded,
        onTarget: t.onTarget,
      }))
      .sort(
        (a, b) =>
          b.days - a.days ||
          b.calculations - a.calculations ||
          a.track.name.localeCompare(b.track.name)
      ),
    closest: closest
      ? {
          id: closest.row.id,
          name: closest.row.name,
          track: trackOut(closest.row.track),
          sessionDate: closest.row.sessionDate,
          worstMiss: closest.cmp.worstMiss,
          onTarget: closest.cmp.onTarget,
        }
      : null,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}
