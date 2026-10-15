/**
 * The fact engine's pit analysis on the race page (item 4 of the open list).
 *
 * The chart's pit markers, pit timing, pit cycles and cycle gains used to come from the import's
 * own heuristics (utils/parsers/position-analysis.ts), which the Stage 1 audits found wrong in
 * many places: cycle ids shared across classes, comparisons pooling other classes, phantom stops,
 * hard-coded drive-through cut-offs, overall positions passed off as class ones. When a race has
 * an analysis package, these facts come from it instead, in the chart's existing shapes, so every
 * panel (chart, Lap details, Pit cycle, Your car, benchmarks, share card, season recap, emails)
 * shows the engine's numbers without its own copy of the rules:
 *
 *   laps        p, cp, flag and pit from the package's lap table (D-POS, D-FCY-LAP, D-PASSAGE)
 *   fcy         caution bands from fcyPeriods (leader laps)
 *   pits        one marker per pit passage at its in-lap: kind, official pit-lane time, time lost
 *               with its method and FCY context, the class pit cycle and its other members
 *   settles     one per cycle result: class position before the stop and after the cycle closed
 *
 * Cars are matched by number (normCar), then team and class when two package cars share a chart
 * key (4 and 4A). A car the chart does not have, or cannot tell apart, keeps its import values.
 */
import { normCar } from "../intake/reimport.js";

// ── The slice of a package this needs (kept small for the cache) ─────────────

export interface PitFacts {
  packageId: string;
  engineVersion: string;
  /** Leader-lap ranges of the caution periods. */
  fcy: [number, number][];
  entries: Record<string, { cls: string; team: string }>;
  laps: Record<string, { lap: number[]; lapTimeS: (number | null)[]; pos: number[]; cpos: number[]; fcy: number[]; pit: number[] }>;
  passages: {
    id: string;
    car: string;
    kind: string;
    inLap: number;
    outLap: number | null;
    stopNumber: number | null;
    officialPitLaneTimeS: number | null;
    fcyContext: "green" | "fcy" | "mixed";
    timeLostS: number | null;
    lossMethod: string;
    refLapS: number | null;
    groupId: string | null;
    cycleId: string | null;
    driverChange: boolean | null;
  }[];
  groups: Record<string, { timeLostS: number | null; lossMethod: string; refLapS: number | null; passageIds: string[] }>;
  cycles: Record<string, { cls: string; ordinal: number; members: string[]; passageIds: string[] }>;
  cycleResults: {
    cycleId: string;
    car: string;
    passageId: string;
    beforeLap: number | null;
    afterLap: number | null;
    classPosBefore: number | null;
    classPosAfter: number | null;
    netClass: number | null;
    overallPosBefore: number | null;
    overallPosAfter: number | null;
  }[];
  /** Same-class position swaps (positionChanges): lap, winner, loser, mechanism. */
  swaps: [number, string, string, string][];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Cut what the chart needs from a package (any schema-1.x package). */
export function extractPitFacts(pkg: any): PitFacts {
  const entries: PitFacts["entries"] = {};
  for (const e of pkg.entries ?? []) entries[String(e.car)] = { cls: String(e.class ?? ""), team: String(e.team ?? "") };

  const laps: PitFacts["laps"] = {};
  for (const [car, c] of Object.entries<any>(pkg.laps?.cars ?? {})) {
    if (!Array.isArray(c?.lap)) continue;
    laps[car] = {
      lap: c.lap,
      lapTimeS: c.lapTimeS ?? c.lap.map(() => null),
      pos: c.pos ?? [],
      cpos: c.cpos ?? [],
      fcy: c.fcy ?? c.lap.map(() => 0),
      pit: c.pit ?? c.lap.map(() => 0),
    };
  }

  const fcy: [number, number][] = [];
  for (const f of pkg.fcyPeriods ?? []) {
    const ll = f.leaderLaps;
    if (Array.isArray(ll) && ll.length >= 2 && num(ll[0]) !== null && num(ll[1]) !== null) fcy.push([ll[0], ll[1]]);
  }
  fcy.sort((a, b) => a[0] - b[0]);

  const passages: PitFacts["passages"] = (pkg.events?.pitPassages ?? []).map((p: any) => ({
    id: String(p.id),
    car: String(p.car),
    kind: String(p.kind),
    inLap: p.inLap,
    outLap: num(p.outLap),
    stopNumber: num(p.stopNumber),
    officialPitLaneTimeS: num(p.officialPitLaneTimeS),
    fcyContext: p.fcyContext ?? "green",
    timeLostS: num(p.timeLost?.valueS),
    lossMethod: String(p.timeLost?.method ?? "none"),
    refLapS: num(p.timeLost?.refLapS),
    groupId: p.groupId ?? p.timeLost?.groupId ?? null,
    cycleId: p.cycleId ?? null,
    driverChange: typeof p.driverChange === "boolean" ? p.driverChange : null,
  }));

  const groups: PitFacts["groups"] = {};
  for (const g of pkg.events?.pitGroups ?? []) {
    groups[String(g.id)] = {
      timeLostS: num(g.timeLost?.valueS),
      lossMethod: String(g.timeLost?.method ?? "none"),
      refLapS: num(g.timeLost?.refLapS),
      passageIds: g.passageIds ?? [],
    };
  }

  const cycles: PitFacts["cycles"] = {};
  for (const c of pkg.pitCycles ?? []) {
    cycles[String(c.id)] = {
      cls: String(c.class),
      ordinal: c.ordinal,
      members: (c.members ?? []).map((m: any) => String(m.car)),
      passageIds: (c.members ?? []).map((m: any) => String(m.passageId)),
    };
  }

  const cycleResults: PitFacts["cycleResults"] = (pkg.cycleResults ?? []).map((r: any) => ({
    cycleId: String(r.cycleId),
    car: String(r.car),
    passageId: String(r.passageId),
    beforeLap: num(r.beforeLap),
    afterLap: num(r.afterLap),
    classPosBefore: num(r.classPosBefore),
    classPosAfter: num(r.classPosAfter),
    netClass: num(r.netClass),
    overallPosBefore: num(r.overallPosBefore),
    overallPosAfter: num(r.overallPosAfter),
  }));

  const pc = pkg.positionChanges?.rows;
  const swaps: PitFacts["swaps"] = [];
  if (pc && Array.isArray(pc.lap)) {
    for (let i = 0; i < pc.lap.length; i++) swaps.push([pc.lap[i], String(pc.winner[i]), String(pc.loser[i]), String(pc.mechanism?.[i] ?? "on_track")]);
  }

  return { packageId: String(pkg.packageId ?? ""), engineVersion: String(pkg.engineVersion ?? ""), fcy, entries, laps, passages, groups, cycles, cycleResults, swaps };
}

// ── Chart shapes (server side; client: shared/types.ts) ─────────────────────

interface Lap {
  l: number;
  p: number;
  cp: number;
  ltSec?: number;
  flag: string;
  pit: number;
  [k: string]: unknown;
}
interface Car {
  num: number;
  team: string;
  cls: string;
  laps: Lap[];
  [k: string]: unknown;
}
export interface Chart {
  maxLap: number;
  cars: Record<string, Car>;
  fcy: [number, number][];
  [k: string]: unknown;
}
interface Marker {
  l: number;
  lb: string;
  c: string;
  yo: number;
  da: number;
  [k: string]: unknown;
}
export type Annotations = Record<string, { reasons: Record<string, string>; pits: Marker[]; settles: any[] }>;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Package car → chart key, for the cars the chart can be matched to without doubt. */
export function matchCars(chart: Chart, facts: PitFacts): Map<string, string> {
  const byKey = new Map<string, string[]>();
  for (const car of Object.keys(facts.laps)) {
    const key = chart.cars[car] ? car : Object.keys(chart.cars).find((k) => normCar(k) === normCar(car)) ?? String(parseInt(car, 10));
    if (!chart.cars[key]) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), car]);
  }
  const out = new Map<string, string>();
  for (const [key, cars] of byKey) {
    if (cars.length === 1) {
      out.set(cars[0], key);
      continue;
    }
    // Two package cars on one chart key (4 and 4A, 7 and 07): only the one that is plainly this chart car.
    const c = chart.cars[key];
    const same = cars.filter((car) => {
      const e = facts.entries[car];
      if (!e || e.cls !== c.cls) return false;
      const a = squash(e.team), b = squash(c.team);
      return !!a && !!b && (a.includes(b) || b.includes(a));
    });
    const exact = cars.filter((car) => car === key);
    const pick = same.length === 1 ? same[0] : exact.length === 1 && same.length === 0 ? exact[0] : null;
    if (pick) out.set(pick, key);
  }
  return out;
}

const COLORS = { stop: "#fbbf24", garage: "#f97316", penalty: "#f87171", gain: "#4ade80", loss: "#f87171", held: "#888" };

const MARKED = new Set(["stop", "drive_through", "stop_and_go", "penalty_served", "garage", "retirement"]);

function markerLabel(kind: string, stopNumber: number | null): string {
  switch (kind) {
    case "drive_through":
      return "Drive-through";
    case "stop_and_go":
      return "Stop and go";
    case "penalty_served":
      return "Penalty served";
    case "retirement":
      return "Retired in the pits";
    case "garage":
      return `Pit ${stopNumber ?? ""} (garage)`.replace("  ", " ");
    default:
      return stopNumber ? `Pit ${stopNumber}` : "Pit";
  }
}

/**
 * The chart with the package's pit facts in place of the import's. Pure; returns new objects and
 * leaves the inputs untouched.
 */
export function applyPitFacts(chart: Chart, annotations: Annotations, facts: PitFacts): { data: Chart; annotations: Annotations; matched: number } {
  const carKey = matchCars(chart, facts);
  const data: Chart = { ...chart, cars: { ...chart.cars }, fcy: facts.fcy.length || Object.keys(facts.laps).length ? facts.fcy : chart.fcy };
  const ann: Annotations = { ...annotations };
  const keyNum = (car: string) => {
    const k = carKey.get(car);
    return k ? chart.cars[k].num : null;
  };

  const passagesBy = new Map<string, PitFacts["passages"]>();
  for (const p of facts.passages) passagesBy.set(p.car, [...(passagesBy.get(p.car) ?? []), p]);
  const passageById = new Map(facts.passages.map((p) => [p.id, p]));
  const resultsBy = new Map<string, PitFacts["cycleResults"]>();
  for (const r of facts.cycleResults) resultsBy.set(r.car, [...(resultsBy.get(r.car) ?? []), r]);

  for (const [car, key] of carKey) {
    const src = chart.cars[key];
    const cols = facts.laps[car];
    const row = new Map(cols.lap.map((l, i) => [l, i]));

    // Laps: positions, caution and pit flags as the engine reads them.
    const laps = src.laps.map((ld) => {
      const i = row.get(ld.l);
      if (i === undefined) return { ...ld, pit: 0 };
      const bits = cols.pit[i] ?? 0;
      return {
        ...ld,
        p: cols.pos[i] ?? ld.p,
        cp: cols.cpos[i] ?? ld.cp,
        flag: (cols.fcy[i] ?? 0) > 0 ? "FCY" : "GF",
        // In-lap and interior laps of a passage; the out-lap is back on track.
        pit: bits & 1 || bits & 4 ? 1 : 0,
      };
    });
    data.cars[key] = { ...src, laps };

    const lapTime = (lap: number | null) => {
      if (lap === null) return null;
      const i = row.get(lap);
      return i === undefined ? null : cols.lapTimeS[i] ?? null;
    };

    // Pit markers, one per passage; driver names kept from the import's marker on the same stop.
    const old = annotations[key]?.pits ?? [];
    const pits: Marker[] = [];
    for (const p of passagesBy.get(car) ?? []) {
      if (!MARKED.has(p.kind)) continue;
      const prev = old.find((m) => m.l === p.inLap) ?? old.find((m) => Math.abs(m.l - p.inLap) === 1 && !pits.some((x) => x.l === m.l));
      const group = p.groupId ? facts.groups[p.groupId] : undefined;
      // A back-to-back group reports its time lost once, on its first passage.
      const firstOfGroup = !group || group.passageIds[0] === p.id;
      const lost = group ? (firstOfGroup ? group.timeLostS : null) : p.timeLostS;
      const method = group ? (firstOfGroup ? group.lossMethod : "see_group") : p.lossMethod;
      const cycle = p.cycleId ? facts.cycles[p.cycleId] : undefined;
      const driverSuffix = typeof prev?.lb === "string" && prev.lb.includes(" · ") ? ` · ${prev.lb.split(" · ").pop()}` : "";
      const marker: Marker = {
        l: p.inLap,
        lb: markerLabel(p.kind, p.stopNumber) + (p.kind === "stop" || p.kind === "garage" ? driverSuffix : ""),
        c: p.kind === "garage" ? COLORS.garage : ["drive_through", "stop_and_go", "penalty_served"].includes(p.kind) ? COLORS.penalty : COLORS.stop,
        yo: 0,
        da: 0,
        kind: p.kind,
        ...(p.kind === "garage" ? { isGarage: true } : {}),
      };
      for (const f of ["outDriver", "inDriver", "driverChanged", "stintNumber"]) if (prev && prev[f] !== undefined) marker[f] = prev[f];
      if (p.kind !== "retirement") {
        marker.pitTiming = {
          pitInTime: null,
          pitRoadTime: p.officialPitLaneTimeS,
          pitOutTime: null,
          isDriveThrough: p.kind === "drive_through",
          totalPitLoss: lost,
          inLapTime: lapTime(p.inLap),
          outLapTime: lapTime(p.outLap),
          avgGreenLapTime: (group && firstOfGroup ? group.refLapS : p.refLapS) ?? null,
          splitReliable: false,
          decompositionLevel: "total_only",
          context: p.fcyContext,
          lossMethod: method,
          source: "facts",
        };
      }
      if (cycle) {
        const members = [...new Set(cycle.members.filter((m) => m !== car).map(keyNum).filter((n): n is number => n !== null))];
        marker.cycle = { id: p.cycleId, ordinal: cycle.ordinal, cls: cycle.cls };
        marker.alsoPittingCars = members;
      }
      pits.push(marker);
    }

    // Settles: where each pit cycle closed for this car, with class positions before and after.
    const settles = [];
    for (const r of resultsBy.get(car) ?? []) {
      if (r.afterLap === null || r.classPosBefore === null || r.classPosAfter === null) continue;
      const net = r.netClass ?? r.classPosBefore - r.classPosAfter;
      const i = row.get(r.afterLap);
      const p = r.overallPosAfter ?? (i !== undefined ? cols.pos[i] : null);
      if (p === null) continue;
      const verb = net > 0 ? `Gained ${net}` : net < 0 ? `Lost ${-net}` : "Held";
      settles.push({
        l: r.afterLap,
        p,
        lb: `Settled P${p}`,
        su: `Was P${r.overallPosBefore ?? "?"} · ${(() => {
          const o = r.overallPosBefore !== null && r.overallPosAfter !== null ? r.overallPosBefore - r.overallPosAfter : null;
          return o === null ? verb : o > 0 ? `Gained ${o}` : o < 0 ? `Lost ${-o}` : "Held";
        })()}`,
        c: net > 0 ? COLORS.gain : net < 0 ? COLORS.loss : COLORS.held,
        cpBefore: r.classPosBefore,
        cpAfter: r.classPosAfter,
        cycle: r.cycleId,
        stopLap: passageById.get(r.passageId)?.inLap ?? null,
      });
    }
    settles.sort((a, b) => a.l - b.l);

    ann[key] = { reasons: reasonsFor(car, facts, keyNum, chart, pits, settles), pits, settles };
  }
  return { data, annotations: ann, matched: carKey.size };
}

// How the subject car gained or lost each place (D-CAUSE), in the words the Lap details panel used.
const GAINED_HOW: Record<string, string> = {
  on_track: "on track",
  loser_pitted: "pitted",
  winner_pitted: "during this car's stop",
  both_pitted: "in the pit cycle",
  penalty: "penalty",
  retirement: "retired",
};
const LOST_HOW: Record<string, string> = {
  on_track: "on track",
  loser_pitted: "during this car's stop",
  winner_pitted: "in its own stop",
  both_pitted: "in the pit cycle",
  penalty: "penalty",
  retirement: "retired",
};

/** The "What changed" lines: class swaps per lap, and each stop's cycle result on its in-lap. */
function reasonsFor(
  car: string,
  facts: PitFacts,
  keyNum: (car: string) => number | null,
  chart: Chart,
  pits: Marker[],
  settles: { l: number; cpBefore: number; cpAfter: number; stopLap: number | null }[]
): Record<string, string> {
  const name = (c: string) => {
    const n = keyNum(c);
    const team = n !== null ? chart.cars[String(n)]?.team : facts.entries[c]?.team;
    return `#${c}${team ? ` ${team}` : ""}`;
  };
  const gained = new Map<number, string[]>();
  const lost = new Map<number, string[]>();
  for (const [lap, w, l, how] of facts.swaps) {
    if (w === car) gained.set(lap, [...(gained.get(lap) ?? []), `${name(l)} ${GAINED_HOW[how] ?? how}`]);
    if (l === car) lost.set(lap, [...(lost.get(lap) ?? []), `${name(w)} ${LOST_HOW[how] ?? how}`]);
  }
  const out: Record<string, string> = {};
  const laps = new Set([...gained.keys(), ...lost.keys()]);
  for (const lap of laps) {
    const parts: string[] = [];
    const g = gained.get(lap);
    const l = lost.get(lap);
    if (g) parts.push(`Gained ${g.length} in class — passed ${g.join("; ")}`);
    if (l) parts.push(`Lost ${l.length} in class — passed by ${l.join("; ")}`);
    out[String(lap)] = parts.join(". ");
  }
  for (const m of pits) {
    const s = settles.find((x) => x.stopLap === m.l);
    const what = m.lb.split(" · ")[0];
    const line = s
      ? `${what} — P${s.cpBefore} in class before; P${s.cpAfter} when the cycle closed on lap ${s.l}`
      : what;
    out[String(m.l)] = out[String(m.l)] ? `${line}. ${out[String(m.l)]}` : line;
  }
  return out;
}
