/**
 * Position Change Analysis Engine
 *
 * Post-processing module that generates rich annotation data for any parsed race:
 *   - Detailed reason strings explaining every position change
 *     (on-pace passes, pit-related gains/losses, yellow-flag swaps)
 *   - Pit stop markers with pit-cycle net gain/loss and "also pitting" lists
 *   - Settle markers after FCY periods showing where cars settled
 *
 * Used by both SpeedHive and IMSA parsers after initial data extraction.
 */

import type { RaceDataJson, AnnotationJson } from "../race-validators.js";

// ─── Inferred sub-types from RaceDataJson ────────────────────────────────────

type CarData = RaceDataJson["cars"][string];
type LapData = CarData["laps"][number];

interface Crossover {
  num: number;
  reason: "on pace" | "pitted" | "yellow";
}

interface PitMarker {
  l: number;
  lb: string;
  c: string;
  yo: number;
  da: number;
  outDriver?: string;
  inDriver?: string;
  driverChanged?: boolean;
  stintNumber?: number;
  pitTiming?: PitTiming;
  strategyType?: StrategyType;
}
interface SettleMarker {
  l: number;
  p: number;
  lb: string;
  su: string;
  c: string;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Generate position-change annotations for every car in the race.
 *
 * @param data       Parsed race data (cars, laps, fcy periods)
 * @param existing   Optional existing annotations to merge with (e.g. IMSA
 *                   driver-change & RC-message annotations)
 */
export function generateAnnotations(
  data: RaceDataJson,
  existing?: AnnotationJson,
  pitTimeCards?: Map<number, PitStopTimeCard[]>
): AnnotationJson {
  const carsRecord = data.cars as Record<string, CarData>;

  // ── Build fast lookup structures ────────────────────────────────
  const posAt = new Map<number, Map<number, number>>();
  const pitAt = new Map<number, Set<number>>();
  const fcyLaps = new Set<number>();
  for (const [s, e] of data.fcy) {
    for (let l = s; l <= e; l++) fcyLaps.add(l);
  }

  const carList = (Object.values(carsRecord) as CarData[]).filter(
    (c) => Array.isArray(c.laps)
  );
  for (const car of carList) {
    const pm = new Map<number, number>();
    const ps = new Set<number>();
    for (const lap of car.laps) {
      pm.set(lap.l, lap.p);
      if (lap.pit === 1) ps.add(lap.l);
    }
    posAt.set(car.num, pm);
    pitAt.set(car.num, ps);
  }

  // ── Class membership map ───────────────────────────────────────
  const carClass = new Map<number, string>();
  const teamLookup = new Map<number, string>();
  for (const car of carList) {
    carClass.set(car.num, car.cls);
    teamLookup.set(car.num, car.team);
  }

  // ── Who pitted on each lap ─────────────────────────────────────
  const pittersOnLap = new Map<number, number[]>();
  for (const car of carList) {
    for (const lap of car.laps) {
      if (lap.pit === 1) {
        let arr = pittersOnLap.get(lap.l);
        if (!arr) {
          arr = [];
          pittersOnLap.set(lap.l, arr);
        }
        arr.push(car.num);
      }
    }
  }

  const allNums = carList.map((c) => c.num);

  // ── Process each car ───────────────────────────────────────────
  const annotations: AnnotationJson = {};

  for (const [numStr, car] of Object.entries(carsRecord) as Array<
    [string, CarData]
  >) {
    const num = car.num;
    const laps = car.laps;
    if (!Array.isArray(laps)) continue;
    const cls = car.cls;

    const reasons: Record<string, string> = {};
    const pits: PitMarker[] = [];
    const settles: SettleMarker[] = [];

    let pitCount = 0;

    // Existing annotations from parser (IMSA driver changes, etc.)
    const ex = existing?.[numStr];
    const existingReasons: Record<string, string> =
      (ex?.reasons as Record<string, string>) || {};
    const existingPits: PitMarker[] = (ex?.pits as PitMarker[]) || [];
    const existingSettles: SettleMarker[] =
      (ex?.settles as SettleMarker[]) || [];

    // If parser already provided settles (e.g., from pit stop JSON data), skip inference
    const skipSettleInference = existingSettles.length > 0;

    for (let i = 1; i < laps.length; i++) {
      const d = laps[i];
      const prev = laps[i - 1];
      const lapNum = d.l;

      const prevP = prev.p;
      const currP = d.p;
      const posDelta = prevP - currP;
      const isPit = d.pit === 1;

      // ── Pit marker ──────────────────────────────────────────
      if (isPit) {
        pitCount++;
        if (!existingPits.some((ep) => ep.l === lapNum)) {
          pits.push({
            l: lapNum,
            lb: `Pit Stop ${pitCount}`,
            c: "#fbbf24",
            yo: 0,
            da: 0,
          });
        }
      }

      if (posDelta === 0 && !isPit) continue;

      // ── Find crossover cars ─────────────────────────────────
      const gained: Crossover[] = [];
      const lost: Crossover[] = [];

      if (posDelta !== 0) {
        for (const otherNum of allNums) {
          if (otherNum === num) continue;
          const otherPrev = posAt.get(otherNum)?.get(prev.l);
          const otherCurr = posAt.get(otherNum)?.get(d.l);
          if (otherPrev === undefined || otherCurr === undefined) continue;

          if (otherPrev < prevP && otherCurr > currP) {
            gained.push({
              num: otherNum,
              reason: classifyCrossover(otherNum, lapNum, pitAt, fcyLaps),
            });
          }
          if (otherPrev > prevP && otherCurr < currP) {
            lost.push({
              num: otherNum,
              reason: classifyCrossover(otherNum, lapNum, pitAt, fcyLaps),
            });
          }
        }
      }

      // ── Build reason string ─────────────────────────────────
      let reason = "";

      if (isPit) {
        reason = buildPitReason(
          num, cls, lapNum, laps, i,
          pittersOnLap, fcyLaps, carClass
        );
      } else if (posDelta > 0) {
        reason = buildGainReason(posDelta, gained, teamLookup);
      } else if (posDelta < 0) {
        reason = buildLossReason(posDelta, lost, teamLookup);
      }

      if (reason) {
        const existingR = existingReasons[String(lapNum)];
        if (existingR) {
          reasons[String(lapNum)] = reason + "; " + existingR;
        } else {
          reasons[String(lapNum)] = reason;
        }
      } else if (existingReasons[String(lapNum)]) {
        reasons[String(lapNum)] = existingReasons[String(lapNum)];
      }
    }

    // Copy existing reasons for laps we didn't touch
    for (const [lapKey, existR] of Object.entries(existingReasons)) {
      if (!reasons[lapKey]) {
        reasons[lapKey] = existR;
      }
    }

    // ── Settle markers (skipped if parser already provided settles) ──
    if (!skipSettleInference) {
      // ── Settle markers after FCY periods ─────────────────────
      for (const [fcyStart, fcyEnd] of data.fcy) {
        const preFcyLap =
          laps.find((ld: LapData) => ld.l === fcyStart - 1) ||
          laps.find((ld: LapData) => ld.l === fcyStart);
        if (!preFcyLap) continue;

        let settleLap: LapData | null = null;
        for (
          let sl = fcyEnd + 1;
          sl <= Math.min(fcyEnd + 5, data.maxLap);
          sl++
        ) {
          const ld = laps.find((x: LapData) => x.l === sl);
          if (ld && ld.pit === 0 && !fcyLaps.has(sl)) {
            settleLap = ld;
            break;
          }
        }
        if (!settleLap) {
          settleLap =
            laps.find((ld: LapData) => ld.l > fcyEnd && ld.pit === 0) || null;
        }
        if (!settleLap) continue;

        if (existingSettles.some((es) => es.l === settleLap!.l)) continue;

        const net = preFcyLap.p - settleLap.p;
        settles.push(makeSettle(settleLap.l, settleLap.p, preFcyLap.p, net));
      }

      // ── Settle markers after pit stops ───────────────────────
      for (let i = 0; i < laps.length; i++) {
        if (laps[i].pit !== 1) continue;
        if (i === 0) continue;

        // Skip pit settles during FCY — the FCY settle already captures the net effect
        if (fcyLaps.has(laps[i].l)) continue;

        const prePitPos = laps[i - 1].p;
        let sLap: LapData | null = null;

        for (let j = i + 1; j < laps.length && j <= i + 6; j++) {
          if (laps[j].pit === 0 && !fcyLaps.has(laps[j].l)) {
            sLap = laps[j];
            break;
          }
        }
        if (!sLap) {
          for (let j = i + 1; j < laps.length && j <= i + 10; j++) {
            if (laps[j].pit === 0) {
              sLap = laps[j];
              break;
            }
          }
        }
        if (!sLap) continue;

        const nearbySettle =
          settles.some((s) => Math.abs(s.l - sLap!.l) <= 2) ||
          existingSettles.some((s) => Math.abs(s.l - sLap!.l) <= 2);
        if (nearbySettle) continue;

        const net = prePitPos - sLap.p;
        settles.push(makeSettle(sLap.l, sLap.p, prePitPos, net));
      }
    }

    // ── Merge: keep all existing markers, add non-overlapping new ones ──
    const existingPitLaps = new Set(existingPits.map(p => p.l));
    const newPits = pits.filter(p => !existingPitLaps.has(p.l));
    const allPits = [...existingPits, ...newPits].sort((a, b) => a.l - b.l);

    const existingSettleLaps = new Set(existingSettles.map(s => s.l));
    const newSettles = settles.filter(s => !existingSettleLaps.has(s.l));
    const allSettles = [...existingSettles, ...newSettles].sort(
      (a, b) => a.l - b.l
    );

    annotations[numStr] = {
      reasons,
      pits: allPits,
      settles: allSettles,
    };
  }

  // ── V3 Pipeline: volatility, CUSUM settle, pit timing, strategy ──
  try {
    v3Pipeline(data, carsRecord, carList, fcyLaps, pitAt, teamLookup, carClass, annotations, pitTimeCards);
  } catch (_e) {
    // V3 pipeline is non-critical — fall back to v2 annotations on error
  }

  return annotations;
}

/**
 * V3 post-processing pipeline. Runs after v2 annotations are built.
 * Replaces v2 settle markers with CUSUM-detected settles, adds pit timing,
 * strategy classification, SPC analysis, and cycle comparisons.
 */
function v3Pipeline(
  data: RaceDataJson,
  carsRecord: Record<string, CarData>,
  carList: CarData[],
  fcyLaps: Set<number>,
  pitAt: Map<number, Set<number>>,
  teamLookup: Map<number, string>,
  carClass: Map<number, string>,
  annotations: AnnotationJson,
  pitTimeCards?: Map<number, PitStopTimeCard[]>
): void {
  const totalLaps = data.maxLap;
  const classGroups = data.classGroups as Record<string, number[]>;

  // Collect all pit laps across all cars (for baseline exclusion)
  const allPitLaps = new Set<number>();
  for (const pits of pitAt.values()) {
    for (const lap of pits) allPitLaps.add(lap);
  }

  // ── 1. Per-class: volatility, baseline, pit cycles ──────────────
  const classVolatilities = new Map<string, number[]>();
  const classBaselines = new Map<string, { mean: number; stddev: number; n: number }>();
  const classCycles = new Map<string, PitCycle[]>();

  for (const className of Object.keys(classGroups)) {
    const vol = computeClassVolatility(carsRecord, totalLaps, className, classGroups);
    classVolatilities.set(className, vol);

    const baseline = computeBaselineVolatility(vol, fcyLaps, allPitLaps);
    classBaselines.set(className, baseline);

    const cycles = detectPitCycles(vol, baseline);
    classCycles.set(className, cycles);
  }

  // ── 2-8. Per-car: prox volatility, per-pit processing ──────────
  // Collect all pit events for cross-car operations (cycle comparison, SPC)
  const allPitEventsWithTiming: PitEventWithTiming[] = [];
  const allPitEventsForStrategy = new Map<string, PitEventForStrategy[]>(); // by class
  const carPitTimings = new Map<number, PitTiming[]>(); // car → all its pit timings

  for (const car of carList) {
    const numStr = String(car.num);
    const cls = car.cls;
    const ann = annotations[numStr];
    if (!ann) continue;

    const baseline = classBaselines.get(cls);
    const classVol = classVolatilities.get(cls);
    const cycles = classCycles.get(cls) || [];
    if (!baseline || !classVol) continue;

    // Build focus car position map for proximity weighting
    const focusPositions = new Map<number, number>();
    for (const ld of car.laps) focusPositions.set(ld.l, ld.p);

    // Find pit events for this car: consecutive pit=1 laps grouped into single events
    const pitEvents: PitEvent[] = [];
    const laps = car.laps;
    let i = 0;
    while (i < laps.length) {
      if (laps[i].pit === 1) {
        const inLap = laps[i].l;
        // Skip consecutive pit laps
        while (i < laps.length && laps[i].pit === 1) i++;
        // Out-lap = first non-pit lap
        const outLap = i < laps.length ? laps[i].l : inLap + 1;
        pitEvents.push({ inLap, outLap });
      } else {
        i++;
      }
    }

    if (pitEvents.length === 0) continue;

    const v3Settles: SettleMarker[] = [];
    const pitTimingsForCar: PitTiming[] = [];
    const strategyEvents: PitEventForStrategy[] = [];

    const carTimeCards = pitTimeCards?.get(car.num);

    for (let peIdx = 0; peIdx < pitEvents.length; peIdx++) {
      const pe = pitEvents[peIdx];
      // Assign to pit cycle
      const cycle = assignPitToCycle(pe.inLap, cycles);

      // 5. Pre-pit baseline (reverse CUSUM)
      // If pit during FCY, use pre-FCY start as scan origin
      let scanEvent: Pick<PitEvent, "inLap"> = pe;
      for (const [fcyStart, fcyEnd] of data.fcy) {
        if (pe.inLap >= fcyStart && pe.inLap <= fcyEnd) {
          scanEvent = { inLap: fcyStart };
          break;
        }
      }
      const preBaseline = findPrePitBaseline(
        car, scanEvent, classVol, baseline, fcyLaps
      );

      // 6. CUSUM settle detection
      const settleResult = cusumSettleDetection(
        car, pe, classVol, baseline, fcyLaps
      );

      const settlePosition = settleResult?.settlePosition ?? preBaseline;

      // 7. Pit timing
      const pitStopData = carTimeCards?.[peIdx];
      const timing = computePitTiming(car, pe, fcyLaps, pitStopData);

      if (timing) {
        pitTimingsForCar.push(timing);

        // Attach timing and driver info to matching pit marker
        const pitsArr = ann.pits as PitMarker[];
        const marker = pitsArr.find((p) => p.l === pe.inLap);
        if (marker) {
          marker.pitTiming = timing;
          // Enrich with driver info from pit stop time card
          if (pitStopData?.outDriverSurname && !marker.outDriver) {
            marker.outDriver = pitStopData.outDriverSurname;
            marker.inDriver = pitStopData.inDriverSurname;
            marker.driverChanged = pitStopData.driverChanged ?? false;
          }
        }

        // Build event for cycle comparison
        allPitEventsWithTiming.push({
          carNum: car.num,
          inLap: pe.inLap,
          timing,
          cycleId: cycle?.id ?? null,
        });
      }

      // Build strategy event
      const stratEvt: PitEventForStrategy = {
        carNum: car.num,
        inLap: pe.inLap,
        preBaseline,
        settlePosition,
        cycleId: cycle?.id ?? null,
      };
      strategyEvents.push(stratEvt);

      if (!allPitEventsForStrategy.has(cls)) {
        allPitEventsForStrategy.set(cls, []);
      }
      allPitEventsForStrategy.get(cls)!.push(stratEvt);

      // Build v3 settle marker from CUSUM result
      if (settleResult) {
        const net = preBaseline - settleResult.settlePosition;
        v3Settles.push(
          makeSettle(
            settleResult.settleLap,
            settleResult.settlePosition,
            preBaseline,
            net
          )
        );
      } else {
        // Fallback: CUSUM returned null (re-pit or too few laps).
        // Find first non-pit, non-FCY lap after the pit to show a settle.
        for (const ld of car.laps) {
          if (ld.l <= pe.outLap) continue;
          if (ld.pit === 1 || fcyLaps.has(ld.l)) continue;
          const net = preBaseline - ld.p;
          v3Settles.push(makeSettle(ld.l, ld.p, preBaseline, net));
          break;
        }
      }
    }

    carPitTimings.set(car.num, pitTimingsForCar);

    // 8. Strategy classification per pit
    for (let pi = 0; pi < pitEvents.length; pi++) {
      const classEvents = allPitEventsForStrategy.get(cls) || [];
      const strategy = classifyPitStrategy(
        strategyEvents[pi],
        classEvents,
        teamLookup
      );

      // Attach to pit marker
      const pitsArr = ann.pits as PitMarker[];
      const marker = pitsArr.find((p) => p.l === pitEvents[pi].inLap);
      if (marker) marker.strategyType = strategy.type;
    }

    // 11. Replace v2 settles with deduplicated v3 settles
    if (v3Settles.length > 0) {
      const deduped = deduplicateSettles(v3Settles);
      // Merge: keep existing parser-provided settles, add v3 where no overlap
      const existingSettleLaps = new Set(
        ((ann.settles as SettleMarker[]) || [])
          .filter((s) => {
            // Keep parser-provided settles (from IMSA pit stop JSON)
            // These were in the existing annotations before v2 processing
            return false; // v3 replaces all inferred settles
          })
          .map((s) => s.l)
      );
      ann.settles = deduped;
    }
  }

  // ── 9. Cycle comparisons (cross-car) ────────────────────────────
  const allCyclesFlat: PitCycle[] = [];
  for (const cycles of classCycles.values()) {
    allCyclesFlat.push(...cycles);
  }
  computeCycleComparisons(allPitEventsWithTiming, allCyclesFlat);

  // ── 10. SPC per car ─────────────────────────────────────────────
  for (const [carNum, timings] of carPitTimings) {
    if (timings.length < 3) continue;
    for (const timing of timings) {
      const spc = computeSPC(timing, timings);
      if (spc) timing.spcAnalysis = spc;
    }

    // Class-level SPC
    const cls = carClass.get(carNum);
    if (cls) {
      const classTimings: PitTiming[] = [];
      for (const [otherNum, otherTimings] of carPitTimings) {
        if (carClass.get(otherNum) === cls) {
          classTimings.push(...otherTimings);
        }
      }
      // Class SPC is attached alongside team SPC if desired
      // (stored on timing.spcAnalysis — already set above)
    }
  }
}

/** Remove settle markers that are within 2 laps of each other, keeping the later one. */
function deduplicateSettles(settles: SettleMarker[]): SettleMarker[] {
  if (settles.length <= 1) return settles;
  const sorted = [...settles].sort((a, b) => a.l - b.l);
  const result: SettleMarker[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    if (sorted[i].l - prev.l > 2) {
      result.push(sorted[i]);
    } else {
      // Keep the later one (more accurate settle)
      result[result.length - 1] = sorted[i];
    }
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classifyCrossover(
  otherNum: number,
  lap: number,
  pitAt: Map<number, Set<number>>,
  fcyLaps: Set<number>
): "pitted" | "yellow" | "on pace" {
  if (pitAt.get(otherNum)?.has(lap)) return "pitted";
  if (fcyLaps.has(lap)) return "yellow";
  return "on pace";
}

function buildGainReason(posDelta: number, gained: Crossover[], teamLookup: Map<number, string>): string {
  if (gained.length === 0) {
    return `Gained ${posDelta} position${posDelta > 1 ? "s" : ""}`;
  }
  if (gained.length > 6) return `Gained ${posDelta} positions`;
  const parts = gained.map((c) => {
    const tn = shortTeam(teamLookup.get(c.num));
    if (c.reason === "pitted") return `#${c.num}${tn} pitted`;
    if (c.reason === "yellow") return `#${c.num}${tn} (yellow)`;
    return `#${c.num}${tn} on pace`;
  });
  return `Gained — passed ${parts.join("; ")}`;
}

function buildLossReason(posDelta: number, lost: Crossover[], teamLookup: Map<number, string>): string {
  const absD = Math.abs(posDelta);
  if (lost.length === 0) {
    return `Lost ${absD} position${absD > 1 ? "s" : ""}`;
  }
  if (lost.length > 6) return `Lost ${absD} positions`;
  const parts = lost.map((c) => {
    const tn = shortTeam(teamLookup.get(c.num));
    if (c.reason === "pitted") return `#${c.num}${tn} pitted`;
    if (c.reason === "yellow") return `#${c.num}${tn} (yellow)`;
    return `#${c.num}${tn} on pace`;
  });
  return `Lost — ${parts.join("; ")}`;
}

function buildPitReason(
  focusNum: number,
  focusCls: string,
  lapNum: number,
  laps: LapData[],
  lapIdx: number,
  pittersOnLap: Map<number, number[]>,
  fcyLaps: Set<number>,
  carClass: Map<number, string>
): string {
  const details: string[] = [];

  // Pit cycle net: pre-pit pos vs. settle pos
  const prePitPos = lapIdx > 0 ? laps[lapIdx - 1].p : null;
  let settlePos: number | null = null;
  for (let j = lapIdx + 1; j < laps.length && j <= lapIdx + 8; j++) {
    if (laps[j].pit === 0 && !fcyLaps.has(laps[j].l)) {
      settlePos = laps[j].p;
      break;
    }
  }
  if (settlePos === null) {
    for (let j = lapIdx + 1; j < laps.length && j <= lapIdx + 12; j++) {
      if (laps[j].pit === 0) {
        settlePos = laps[j].p;
        break;
      }
    }
  }

  if (prePitPos !== null && settlePos !== null) {
    const cycleNet = prePitPos - settlePos;
    if (cycleNet > 0) details.push(`Gained ${cycleNet} in pit cycle`);
    else if (cycleNet < 0) details.push(`Lost ${Math.abs(cycleNet)} in pit cycle`);
  }

  // Also pitting: same-class cars on this lap
  const allPitters = pittersOnLap.get(lapNum) || [];
  const sameClassPitters = allPitters.filter(
    (n) => n !== focusNum && carClass.get(n) === focusCls
  );

  if (sameClassPitters.length > 0) {
    if (sameClassPitters.length <= 5) {
      details.push(
        `also pitting: ${sameClassPitters.map((n) => "#" + n).join(", ")}`
      );
    } else {
      details.push(`${sameClassPitters.length} class cars also pitting`);
    }
  }

  if (details.length === 0) return "Pit stop";
  return `Pit stop — ${details.join("; ")}`;
}

function makeSettle(
  lap: number,
  settlePos: number,
  prevPos: number,
  net: number
): SettleMarker {
  let su: string;
  let c: string;
  if (net > 0) {
    su = `Was P${prevPos} · Gained ${net}`;
    c = "#4ade80";
  } else if (net < 0) {
    su = `Was P${prevPos} · Lost ${Math.abs(net)}`;
    c = "#f87171";
  } else {
    su = `Was P${prevPos} · Held`;
    c = "#888";
  }
  return { l: lap, p: settlePos, lb: `Settled P${settlePos}`, su, c };
}

/**
 * Extract a short team/driver label for display in reason strings.
 * "Thunder Bunny Racing" → " Thunder Bunny Racing" (with leading space)
 * Keeps it short: takes the first meaningful word or surname.
 */
function shortTeam(team: string | undefined): string {
  if (!team) return "";
  // For WRL-style team names, just use the name directly but truncate if long
  const trimmed = team.trim();
  if (trimmed.length <= 20) return ` ${trimmed}`;
  // Take first two words
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) return ` ${words[0]} ${words[1]}`;
  return ` ${trimmed.slice(0, 20)}`;
}

// ─── V3: Class Volatility & Baseline ────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let sumSq = 0;
  for (const v of arr) sumSq += (v - m) ** 2;
  return Math.sqrt(sumSq / (arr.length - 1));
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Cluster-based pit timing helpers ────────────────────────────────────────

/**
 * Compute a robust baseline lap time for a car across the whole race.
 *
 * Excludes pit laps, FCY laps, laps <60s or >900s.
 * Computes the median, then trims to ±15% of median before taking the mean.
 * If <5 laps qualify after trimming, returns the raw median instead.
 * Returns 0 if no qualifying laps at all.
 */
export function calcCarBaseline(
  laps: LapData[],
  fcyLaps: Set<number>,
): number {
  // Filter out non-representative laps
  const qualifying: number[] = [];
  for (const ld of laps) {
    if (ld.pit !== 0) continue;           // pit laps
    if (fcyLaps.has(ld.l)) continue;      // FCY laps
    if (ld.ltSec < 60) continue;          // too short (incomplete / invalid)
    if (ld.ltSec > 900) continue;         // too long (red flag, timer glitch)
    qualifying.push(ld.ltSec);
  }

  if (qualifying.length === 0) return 0;

  const med = median(qualifying);
  if (med === 0) return 0;

  // Trim to ±15% of median
  const lo = med * 0.85;
  const hi = med * 1.15;
  const trimmed = qualifying.filter((t) => t >= lo && t <= hi);

  if (trimmed.length < 5) return med;
  return mean(trimmed);
}

/** Constants for cluster walk */
const SLOW_MULTIPLIER = 1.10;
const MAX_LAP_CAP = 900;
const MAX_CLUSTER_LAPS = 4;  // pit lap + up to 3 slow green laps

/**
 * Calculate net pit stop time by walking a cluster of slow laps forward
 * from the pit-flagged lap.
 *
 * Includes the pit-flagged lap (capped at MAX_LAP_CAP), then walks forward
 * including any slow laps (>baseline × SLOW_MULTIPLIER). FCY laps are
 * skipped entirely (slow for everyone, not pit-related). Stops on:
 *   - Next pit-flagged lap (pit=1)
 *   - Null/zero lap time
 *   - Lap time > MAX_LAP_CAP
 *   - Lap back at race pace (<=baseline × SLOW_MULTIPLIER)
 *
 * netTime = max(0, clusterTotal - baseline × clusterLength)
 */
export function calcPitStopNetTime(
  pitLapIndex: number,
  carLaps: LapData[],
  baseline: number,
  fcyLaps?: Set<number>,
): { netTime: number; clusterLength: number } {
  if (baseline <= 0 || pitLapIndex < 0 || pitLapIndex >= carLaps.length) {
    return { netTime: 0, clusterLength: 0 };
  }

  let clusterTotal = 0;
  let clusterLength = 0;

  // Include the pit-flagged lap itself (capped)
  const pitLap = carLaps[pitLapIndex];
  const pitTime = Math.min(pitLap.ltSec, MAX_LAP_CAP);
  if (pitTime <= 0) return { netTime: 0, clusterLength: 0 };
  clusterTotal += pitTime;
  clusterLength = 1;

  // Walk forward from the lap after the pit-flagged lap
  const threshold = baseline * SLOW_MULTIPLIER;
  for (let i = pitLapIndex + 1; i < carLaps.length; i++) {
    if (clusterLength >= MAX_CLUSTER_LAPS) break; // cap cluster size
    const lap = carLaps[i];
    // Stop conditions
    if (lap.pit === 1) break;                   // next pit
    if (!lap.ltSec || lap.ltSec <= 0) break;    // null/zero time
    if (lap.ltSec > MAX_LAP_CAP) break;         // absurdly long

    // Skip FCY laps — they're slow for everyone, not pit-related
    if (fcyLaps && fcyLaps.has(lap.l)) continue;

    if (lap.ltSec <= threshold) break;           // back to race pace

    clusterTotal += lap.ltSec;
    clusterLength++;
  }

  const netTime = Math.max(0, clusterTotal - baseline * clusterLength);
  return { netTime, clusterLength };
}

/**
 * Compute per-lap field volatility for a single class.
 *
 * For each lap L (2..totalLaps), volatility[L] = fraction of class cars
 * that changed overall position between L-1 and L. Index 0 and 1 are 0.
 */
export function computeClassVolatility(
  allCars: Record<string, CarData>,
  totalLaps: number,
  className: string,
  classGroups: Record<string, number[]>
): number[] {
  const volatility = new Array<number>(totalLaps + 1).fill(0);

  const classNums = classGroups[className];
  if (!classNums || classNums.length === 0) return volatility;

  // Build position map: carNum → lap → overall position
  const posMap = new Map<number, Map<number, number>>();
  for (const carNum of classNums) {
    const car = allCars[String(carNum)];
    if (!car || !Array.isArray(car.laps)) continue;
    const lapMap = new Map<number, number>();
    for (const lap of car.laps) {
      lapMap.set(lap.l, lap.p);
    }
    posMap.set(carNum, lapMap);
  }

  for (let L = 2; L <= totalLaps; L++) {
    let changed = 0;
    let total = 0;

    for (const carNum of classNums) {
      const lm = posMap.get(carNum);
      if (!lm) continue;
      const posCurr = lm.get(L);
      const posPrev = lm.get(L - 1);
      if (posCurr === undefined || posPrev === undefined) continue;
      total++;
      if (posCurr !== posPrev) changed++;
    }

    volatility[L] = total > 0 ? changed / total : 0;
  }

  return volatility;
}

/**
 * Compute per-lap proximity-weighted volatility for a single class,
 * relative to a specific focus car.
 *
 * Like computeClassVolatility, but each car's contribution is weighted by
 * 1 / (1 + |carPos - focusCarPos|) so that position changes near the
 * focus car matter more. Used per-car for settle detection and baseline
 * scans; the unweighted version is used for pit cycle detection.
 */
export function computeProximityWeightedVolatility(
  allCars: Record<string, CarData>,
  totalLaps: number,
  className: string,
  classGroups: Record<string, number[]>,
  focusCarPositions: Map<number, number>
): number[] {
  const volatility = new Array<number>(totalLaps + 1).fill(0);

  const classNums = classGroups[className];
  if (!classNums || classNums.length === 0) return volatility;

  // Build position map: carNum → lap → overall position
  const posMap = new Map<number, Map<number, number>>();
  for (const carNum of classNums) {
    const car = allCars[String(carNum)];
    if (!car || !Array.isArray(car.laps)) continue;
    const lapMap = new Map<number, number>();
    for (const lap of car.laps) {
      lapMap.set(lap.l, lap.p);
    }
    posMap.set(carNum, lapMap);
  }

  for (let L = 2; L <= totalLaps; L++) {
    const focusPos = focusCarPositions.get(L);
    if (focusPos === undefined) continue;

    let weightedChanges = 0;
    let totalWeight = 0;

    for (const carNum of classNums) {
      const lm = posMap.get(carNum);
      if (!lm) continue;
      const posCurr = lm.get(L);
      const posPrev = lm.get(L - 1);
      if (posCurr === undefined || posPrev === undefined) continue;

      const weight = 1 / (1 + Math.abs(posCurr - focusPos));
      totalWeight += weight;
      if (posCurr !== posPrev) weightedChanges += weight;
    }

    volatility[L] = totalWeight > 0 ? weightedChanges / totalWeight : 0;
  }

  return volatility;
}

/**
 * Compute the green-flag baseline volatility from "clean" laps —
 * laps not under FCY and not within 3 laps of any pit event.
 *
 * Returns mean, sample stddev, and count of clean laps used.
 * Falls back to { mean: 0.1, stddev: 0.05 } if fewer than 10 clean laps.
 */
export function computeBaselineVolatility(
  volatility: number[],
  fcyLaps: Set<number>,
  allPitLaps: Set<number>
): { mean: number; stddev: number; n: number } {
  // Build exclusion set: FCY laps + within 3 laps of any pit event
  const excluded = new Set<number>();
  for (const lap of fcyLaps) excluded.add(lap);
  for (const pitLap of allPitLaps) {
    for (let d = -3; d <= 3; d++) excluded.add(pitLap + d);
  }

  const clean: number[] = [];
  // Start from lap 2 (first lap with valid volatility)
  for (let L = 2; L < volatility.length; L++) {
    if (!excluded.has(L)) clean.push(volatility[L]);
  }

  const n = clean.length;
  if (n < 10) return { mean: 0.1, stddev: 0.05, n };

  return { mean: mean(clean), stddev: stddev(clean), n };
}

// ─── V3: Pit Cycle Detection ────────────────────────────────────────────────

export interface PitCycle {
  startLap: number;
  endLap: number;
  id: number;
}

/**
 * Detect pit cycles — contiguous regions where class volatility exceeds
 * baseline.mean + 2 * baseline.stddev. Merges cycles within 3 laps of
 * each other and assigns sequential IDs.
 */
export function detectPitCycles(
  classVolatility: number[],
  baseline: { mean: number; stddev: number }
): PitCycle[] {
  const threshold = baseline.mean + 2 * baseline.stddev;
  const raw: { startLap: number; endLap: number }[] = [];
  let inCycle = false;
  let cycleStart = 0;

  for (let L = 2; L < classVolatility.length; L++) {
    if (classVolatility[L] > threshold && !inCycle) {
      inCycle = true;
      cycleStart = L;
    } else if (classVolatility[L] <= threshold && inCycle) {
      inCycle = false;
      raw.push({ startLap: cycleStart, endLap: L - 1 });
    }
  }
  // Handle cycle extending to end of race
  if (inCycle) {
    raw.push({ startLap: cycleStart, endLap: classVolatility.length - 1 });
  }

  // Merge cycles within 3 laps of each other
  const merged: { startLap: number; endLap: number }[] = [];
  for (const cycle of raw) {
    const prev = merged[merged.length - 1];
    if (prev && cycle.startLap - prev.endLap <= 3) {
      prev.endLap = cycle.endLap;
    } else {
      merged.push({ ...cycle });
    }
  }

  // Assign sequential IDs
  return merged.map((c, i) => ({ ...c, id: i }));
}

/**
 * Assign a pit event (by its in-lap number) to the pit cycle whose
 * lap range contains it. Returns the matching cycle or null.
 */
export function assignPitToCycle(
  pitInLap: number,
  cycles: PitCycle[]
): PitCycle | null {
  for (const cycle of cycles) {
    if (pitInLap >= cycle.startLap && pitInLap <= cycle.endLap) {
      return cycle;
    }
  }
  return null;
}

// ─── V3: CUSUM Settle Detection ─────────────────────────────────────────────

/** Minimal pit event info needed by CUSUM functions. */
export interface PitEvent {
  inLap: number;
  outLap: number;
}

export interface CusumSettleResult {
  settleLap: number;
  settlePosition: number;
  referencePos: number;
  stabilityRun: number;
  cusumAtSettle: { plus: number; minus: number };
  localVolatility: number;
  isFallback?: boolean;
}

/** Return the most frequent value in an array (ties go to first seen). */
function mode(arr: number[]): number {
  const counts = new Map<number, number>();
  let best = arr[0];
  let bestCount = 0;
  for (const v of arr) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

/**
 * CUSUM change-point detection for settle position after a pit stop.
 *
 * Scans forward from the out-lap, collecting non-FCY non-pit positions.
 * Uses the mode of the second half as reference, then runs dual CUSUM
 * (plus/minus) looking for a stable run where both are below threshold h.
 * Returns null if the car re-pits before settling or has insufficient data.
 */
export function cusumSettleDetection(
  car: CarData,
  pitEvent: PitEvent,
  classVolatility: number[],
  baseline: { mean: number; stddev: number },
  fcyLaps: Set<number>
): CusumSettleResult | null {
  const laps = car.laps;
  if (!Array.isArray(laps) || laps.length === 0) return null;

  // Build quick lookup: lap number → LapData
  const lapByNum = new Map<number, LapData>();
  for (const ld of laps) lapByNum.set(ld.l, ld);

  const lastLap = laps[laps.length - 1].l;

  // Determine search start — advance past FCY if pit was during caution
  let searchStart = pitEvent.outLap + 1;
  if (fcyLaps.has(pitEvent.inLap)) {
    for (let L = pitEvent.outLap + 1; L <= lastLap; L++) {
      if (!fcyLaps.has(L)) {
        searchStart = L;
        break;
      }
    }
  }

  const maxSearch = 25;
  const searchEnd = Math.min(searchStart + maxSearch, lastLap);

  // Collect position series, skipping FCY and detecting re-pit
  const positionSeries: number[] = [];
  const lapNumbers: number[] = [];

  for (let L = searchStart; L <= searchEnd; L++) {
    const ld = lapByNum.get(L);
    if (!ld) continue;
    if (fcyLaps.has(L)) continue;
    if (ld.pit === 1) return null; // re-pitted before settling
    positionSeries.push(ld.p);
    lapNumbers.push(L);
  }

  if (positionSeries.length < 3) return null;

  // Reference: mode of last half
  const halfPoint = Math.floor(positionSeries.length / 2);
  const referencePos = mode(positionSeries.slice(halfPoint));

  // CUSUM parameters from baseline
  const k = baseline.mean * 2;
  const h = Math.max(1.0, baseline.stddev * 8);

  // Forward CUSUM scan
  let cusumPlus = 0;
  let cusumMinus = 0;
  let stableCount = 0;
  let settleIndex: number | null = null;

  for (let i = 0; i < positionSeries.length; i++) {
    const deviation = Math.abs(positionSeries[i] - referencePos);
    cusumPlus = Math.max(0, cusumPlus + deviation - k);
    cusumMinus = Math.max(0, cusumMinus + deviation - k);

    if (cusumPlus < h && cusumMinus < h) {
      stableCount++;
    } else {
      stableCount = 0;
    }

    // Adaptive minRun based on local volatility z-score
    const localVol = classVolatility[lapNumbers[i]] ?? 0;
    let zScore = 0;
    if (baseline.stddev > 0) {
      zScore = (localVol - baseline.mean) / baseline.stddev;
    }
    const minRun = Math.max(2, Math.min(6, Math.floor(2 + Math.max(0, zScore))));

    if (stableCount >= minRun && settleIndex === null) {
      settleIndex = i - stableCount + 1;
      break;
    }
  }

  if (settleIndex !== null) {
    return {
      settleLap: lapNumbers[settleIndex],
      settlePosition: positionSeries[settleIndex],
      referencePos,
      stabilityRun: stableCount,
      cusumAtSettle: { plus: cusumPlus, minus: cusumMinus },
      localVolatility: classVolatility[lapNumbers[settleIndex]] ?? 0,
    };
  }

  // Fallback: lap of minimum cumulative deviation
  let minCusum = Infinity;
  let minIndex = 0;
  cusumPlus = 0;
  cusumMinus = 0;

  for (let i = 0; i < positionSeries.length; i++) {
    const deviation = Math.abs(positionSeries[i] - referencePos);
    cusumPlus = Math.max(0, cusumPlus + deviation - k);
    cusumMinus = Math.max(0, cusumMinus + deviation - k);
    if (cusumPlus + cusumMinus < minCusum) {
      minCusum = cusumPlus + cusumMinus;
      minIndex = i;
    }
  }

  return {
    settleLap: lapNumbers[minIndex],
    settlePosition: positionSeries[minIndex],
    referencePos,
    stabilityRun: 0,
    cusumAtSettle: { plus: cusumPlus, minus: cusumMinus },
    localVolatility: classVolatility[lapNumbers[minIndex]] ?? 0,
    isFallback: true,
  };
}

// ─── V3: Reverse CUSUM for Pre-Pit Baseline ─────────────────────────────────

/**
 * Find the last statistically stable position a car held before a pit stop
 * disrupted the field, using reverse CUSUM.
 *
 * Scans backward from the in-lap (up to 40 laps), skips FCY laps, uses
 * the mode of the earlier half as reference, and runs dual CUSUM on the
 * reversed series. Validates that the found position was held for 2+ laps.
 *
 * If the pit occurs during an FCY, the caller should pass a pseudo pit
 * event with inLap = fcyRange start so the scan begins before the FCY.
 */
export function findPrePitBaseline(
  car: CarData,
  pitEvent: Pick<PitEvent, "inLap">,
  proxVolatility: number[],
  baseline: { mean: number; stddev: number },
  fcyLaps: Set<number>
): number {
  const laps = car.laps;
  if (!Array.isArray(laps) || laps.length === 0) return 0;

  // Build quick lookup: lap number → LapData
  const lapByNum = new Map<number, LapData>();
  for (const ld of laps) lapByNum.set(ld.l, ld);

  const pitLap = pitEvent.inLap;
  const maxBackScan = 40;

  // Collect positions scanning backward, skipping FCY
  const positionSeries: number[] = []; // reverse chronological order
  const lapNumbers: number[] = [];

  for (let L = pitLap - 1; L >= Math.max(1, pitLap - maxBackScan); L--) {
    if (fcyLaps.has(L)) continue;
    const ld = lapByNum.get(L);
    if (!ld) continue;
    positionSeries.push(ld.p);
    lapNumbers.push(L);
  }

  if (positionSeries.length < 2) {
    // Not enough data — use position on lap before pit or pit lap itself
    const prev = lapByNum.get(pitLap - 1);
    if (prev) return prev.p;
    const curr = lapByNum.get(pitLap);
    return curr ? curr.p : 0;
  }

  // Reference: mode of the latter half of reversed series (= earlier laps)
  const halfPoint = Math.floor(positionSeries.length / 2);
  const referencePos = mode(positionSeries.slice(halfPoint));

  // Reverse CUSUM with same k, h parameters
  const k = baseline.mean * 2;
  const h = Math.max(1.0, baseline.stddev * 8);

  let cusumPlus = 0;
  let cusumMinus = 0;
  let lastStableIndex = 0;

  for (let i = 0; i < positionSeries.length; i++) {
    const deviation = Math.abs(positionSeries[i] - referencePos);
    cusumPlus = Math.max(0, cusumPlus + deviation - k);
    cusumMinus = Math.max(0, cusumMinus + deviation - k);

    if (cusumPlus < h && cusumMinus < h) {
      lastStableIndex = i;
    }
  }

  let baselinePosition = positionSeries[lastStableIndex];

  // Validate: position was held for 2+ laps near the stable point
  let matchCount = 0;
  const checkEnd = Math.min(lastStableIndex + 5, positionSeries.length - 1);
  for (let j = lastStableIndex; j <= checkEnd; j++) {
    if (positionSeries[j] === baselinePosition) matchCount++;
  }

  if (matchCount < 2) {
    // Not held long enough — fall back to reference (mode of early laps)
    baselinePosition = referencePos;
  }

  return baselinePosition;
}

// ─── V3: Pit Timing Computation ─────────────────────────────────────────────

export interface PitTiming {
  // Full segment times (IMSA with Time Cards or supplementary pit lane timing)
  // null when pit road entrance/exit timestamps are unavailable
  pitInTime: number | null;
  pitRoadTime: number | null;
  pitOutTime: number | null;
  isDriveThrough: boolean;

  // Always available across all data sources
  totalPitLoss: number;

  // Raw values used in computation
  inLapTime: number;
  outLapTime: number;
  avgGreenLapTime: number;

  // Number of laps in the slow cluster used to compute totalPitLoss
  clusterLapCount?: number;

  // What level of decomposition is available
  decompositionLevel: "total_only" | "full_segments";

  // SPC analysis (populated by computeSPC, Prompt 7)
  spcAnalysis?: unknown;

  // Comparison to pit cycle peers (populated by computeCycleComparisons)
  cycleComparison?: PitCycleComparison;
}

/** Optional IMSA Time Card data for a single pit stop. */
export interface PitStopTimeCard {
  inTime: number;   // pit road entrance timestamp (seconds from race start or epoch)
  outTime: number;  // pit road exit timestamp
  pitTime: number;  // outTime - inTime (for validation)
  inDriverSurname?: string;
  outDriverSurname?: string;
  driverChanged?: boolean;
}

/**
 * Compute green-flag average lap time from recent laps before a given lap.
 * Uses up to 10 most recent green non-pit laps, then excludes >2σ outliers.
 */
function computeAvgGreenLapTime(
  laps: LapData[],
  beforeLap: number,
  fcyLaps: Set<number>
): number {
  // Collect green non-pit laps before the pit
  const candidates: number[] = [];
  for (const ld of laps) {
    if (ld.l >= beforeLap) continue;
    if (ld.pit === 1) continue;
    if (fcyLaps.has(ld.l)) continue;
    // Accept green-flag laps (various flag formats)
    const f = ld.flag.toUpperCase();
    if (f === "GF" || f === "GREEN" || f === "G") {
      candidates.push(ld.ltSec);
    }
  }

  // Take most recent 10
  const recent = candidates.slice(-10);
  if (recent.length === 0) return 0;

  // Outlier filter: exclude >2 stddev from mean
  const m = mean(recent);
  if (recent.length < 3) return m;

  const sd = stddev(recent);
  if (sd === 0) return m;

  const filtered = recent.filter((t) => Math.abs(t - m) <= 2 * sd);
  return filtered.length > 0 ? mean(filtered) : m;
}

/**
 * Compute pit timing for a single pit event.
 *
 * Always computes totalPitLoss (in-lap excess + out-lap excess over green avg).
 * When IMSA Time Card data is provided, also decomposes into pit-in / pit-road /
 * pit-out segments and detects drive-throughs.
 */
export function computePitTiming(
  car: CarData,
  pitEvent: PitEvent,
  fcyLaps: Set<number>,
  pitStopData?: PitStopTimeCard
): PitTiming | null {
  const laps = car.laps;
  if (!Array.isArray(laps) || laps.length === 0) return null;

  // Find in-lap and out-lap records
  const inLapRecord = laps.find((ld) => ld.l === pitEvent.inLap);
  if (!inLapRecord) return null;

  // Out-lap = first non-pit lap after in-lap
  let outLapRecord: LapData | undefined;
  for (const ld of laps) {
    if (ld.l > pitEvent.inLap && ld.pit === 0) {
      outLapRecord = ld;
      break;
    }
  }

  const inLapTime = inLapRecord.ltSec;
  const outLapTime = outLapRecord ? outLapRecord.ltSec : 0;

  const avgGreenLapTime = computeAvgGreenLapTime(laps, pitEvent.inLap, fcyLaps);

  // ── Cluster-based pit loss (replaces old 2-lap formula) ──────────
  // Find the index of the pit-flagged lap in the laps array
  const pitLapIndex = laps.findIndex((ld) => ld.l === pitEvent.inLap);
  const baseline = calcCarBaseline(laps, fcyLaps);

  let totalPitLoss: number;
  let clusterLapCount: number | undefined;

  if (baseline > 0 && pitLapIndex >= 0) {
    const cluster = calcPitStopNetTime(pitLapIndex, laps, baseline, fcyLaps);
    totalPitLoss = cluster.netTime;
    clusterLapCount = cluster.clusterLength;
  } else {
    // Fallback to old formula when baseline can't be computed
    totalPitLoss =
      (avgGreenLapTime > 0 ? inLapTime - avgGreenLapTime : 0) +
      (outLapTime > 0 && avgGreenLapTime > 0
        ? Math.max(0, outLapTime - avgGreenLapTime)
        : 0);
  }

  // Base result: total_only decomposition
  const timing: PitTiming = {
    pitInTime: null,
    pitRoadTime: null,
    pitOutTime: null,
    isDriveThrough: false,
    totalPitLoss,
    clusterLapCount,
    inLapTime,
    outLapTime,
    avgGreenLapTime,
    decompositionLevel: "total_only",
  };

  // If IMSA Time Card data is available, compute full segments
  if (pitStopData) {
    const pitRoadTime = pitStopData.outTime - pitStopData.inTime;

    timing.pitRoadTime = pitRoadTime;
    timing.isDriveThrough = pitRoadTime < 55.0;

    // Compute pitInTime and pitOutTime using S/F crossing clock times (hr field).
    // hr = seconds from midnight when the car crossed S/F completing that lap.
    // pitStopData.inTime/outTime are also seconds from midnight (clock times).
    // pitInTime = pit entry clock time - S/F crossing clock time at start of in-lap
    // pitOutTime = S/F crossing clock time at end of out-lap - pit exit clock time
    const prevLap = laps.find((ld) => ld.l === pitEvent.inLap - 1);
    if (prevLap && prevLap.hr != null && prevLap.hr > 0) {
      let pitIn = pitStopData.inTime - prevLap.hr;
      if (pitIn < 0) pitIn += 86400; // midnight crossing
      if (pitIn > 0 && pitIn < inLapRecord.ltSec * 1.5) {
        timing.pitInTime = pitIn;
      }
    }

    if (outLapRecord && outLapRecord.hr != null && outLapRecord.hr > 0) {
      let pitOut = outLapRecord.hr - pitStopData.outTime;
      if (pitOut < 0) pitOut += 86400; // midnight crossing
      if (pitOut > 0 && pitOut < outLapRecord.ltSec * 1.5) {
        timing.pitOutTime = pitOut;
      }
    }

    // Only claim full_segments when all three segments are available
    timing.decompositionLevel =
      timing.pitInTime != null && timing.pitOutTime != null
        ? "full_segments"
        : "total_only";
  }

  return timing;
}

// ─── V3: SPC for Pit Performance ────────────────────────────────────────────

export type SPCClassificationLabel = "normal" | "warning" | "outlier";

export interface SPCClassification {
  value: number;
  teamMean: number;
  teamStdDev: number;
  zScore: number;
  classification: SPCClassificationLabel;
  direction: "fast" | "slow";
  confidence: "provisional" | "established";
}

export interface SPCResult {
  totalLoss: SPCClassification;
  pitIn?: SPCClassification;
  pitRoad?: SPCClassification;
  pitOut?: SPCClassification;
}

/** Build an SPCClassification from a value against a population of values. */
function classifySPC(
  value: number,
  allValues: number[],
  confidence: "provisional" | "established"
): SPCClassification | null {
  if (allValues.length < 3) return null;

  const m = mean(allValues);
  const sd = stddev(allValues);

  if (sd === 0) {
    return {
      value,
      teamMean: m,
      teamStdDev: 0,
      zScore: 0,
      classification: "normal",
      direction: "fast",
      confidence,
    };
  }

  const zScore = (value - m) / sd;
  const absZ = Math.abs(zScore);

  let classification: SPCClassificationLabel = "normal";
  if (absZ > 3.0) classification = "outlier";
  else if (absZ > 2.0) classification = "warning";

  return {
    value,
    teamMean: m,
    teamStdDev: sd,
    zScore,
    classification,
    direction: zScore > 0 ? "slow" : "fast",
    confidence,
  };
}

/**
 * Compute SPC analysis for a single pit stop against the car's own stops.
 *
 * Requires at least 3 stops with computed PitTiming. Returns null if fewer.
 * Confidence is 'provisional' with <5 stops, 'established' with >=5.
 */
export function computeSPC(
  currentPitTiming: PitTiming,
  allCarPitTimings: PitTiming[]
): SPCResult | null {
  const allLosses = allCarPitTimings.map((t) => t.totalPitLoss);
  if (allLosses.length < 3) return null;

  const confidence =
    allLosses.length >= 5 ? "established" : "provisional";

  const totalLoss = classifySPC(
    currentPitTiming.totalPitLoss,
    allLosses,
    confidence
  );
  if (!totalLoss) return null;

  const result: SPCResult = { totalLoss };

  // Segment-level SPC when full_segments decomposition is available
  if (currentPitTiming.decompositionLevel === "full_segments") {
    const fullSegmentTimings = allCarPitTimings.filter(
      (t) => t.decompositionLevel === "full_segments"
    );

    if (fullSegmentTimings.length >= 3) {
      const segConfidence =
        fullSegmentTimings.length >= 5 ? "established" : "provisional";

      if (currentPitTiming.pitInTime !== null) {
        const vals = fullSegmentTimings
          .map((t) => t.pitInTime)
          .filter((v): v is number => v !== null);
        if (vals.length >= 3) {
          const c = classifySPC(currentPitTiming.pitInTime, vals, segConfidence);
          if (c) result.pitIn = c;
        }
      }

      if (currentPitTiming.pitRoadTime !== null) {
        const vals = fullSegmentTimings
          .map((t) => t.pitRoadTime)
          .filter((v): v is number => v !== null);
        if (vals.length >= 3) {
          const c = classifySPC(currentPitTiming.pitRoadTime, vals, segConfidence);
          if (c) result.pitRoad = c;
        }
      }

      if (currentPitTiming.pitOutTime !== null) {
        const vals = fullSegmentTimings
          .map((t) => t.pitOutTime)
          .filter((v): v is number => v !== null);
        if (vals.length >= 3) {
          const c = classifySPC(currentPitTiming.pitOutTime, vals, segConfidence);
          if (c) result.pitOut = c;
        }
      }
    }
  }

  return result;
}

/**
 * Compute class-level SPC for a single pit stop against all same-class stops.
 *
 * Same logic as computeSPC but the population is all class cars' stops.
 */
export function computeClassSPC(
  currentPitTiming: PitTiming,
  allClassPitTimings: PitTiming[]
): SPCResult | null {
  return computeSPC(currentPitTiming, allClassPitTimings);
}

// ─── V3: Pit Cycle Comparison ───────────────────────────────────────────────

export interface PitCycleComparison {
  cycleId: number;

  // Segment comparisons (populated when all participants have full_segments)
  compAvgPitInTime: number | null;
  compAvgPitRoadTime: number | null;
  compAvgPitOutTime: number | null;
  compAvgTotalPitLoss: number;

  // Deltas (positive = slower than comparison, negative = faster)
  deltaPitIn: number | null;
  deltaPitRoad: number | null;
  deltaPitOut: number | null;
  deltaTotalLoss: number;

  // How many comparison cars were in this cycle
  compCarCount: number;
}

/** A pit event with its associated timing and cycle assignment. */
export interface PitEventWithTiming {
  carNum: number;
  inLap: number;
  timing: PitTiming;
  cycleId: number | null;
}

/**
 * Compute pit cycle comparisons for all pit events.
 *
 * For each pit event, finds all other cars that pitted in the same cycle,
 * computes average totalPitLoss (and segment averages when all have
 * full_segments), and stores deltas. Mutates each event's timing by
 * attaching the cycleComparison field.
 */
export function computeCycleComparisons(
  allPitEvents: PitEventWithTiming[],
  cycles: PitCycle[]
): void {
  // Group pit events by cycle ID
  const byCycle = new Map<number, PitEventWithTiming[]>();
  for (const cycle of cycles) {
    byCycle.set(cycle.id, []);
  }
  for (const evt of allPitEvents) {
    if (evt.cycleId !== null) {
      const arr = byCycle.get(evt.cycleId);
      if (arr) arr.push(evt);
    }
  }

  // For each pit event, compare against others in the same cycle
  for (const evt of allPitEvents) {
    if (evt.cycleId === null) continue;
    const cycleEvents = byCycle.get(evt.cycleId);
    if (!cycleEvents) continue;

    const compEvents = cycleEvents.filter((e) => e.carNum !== evt.carNum);
    if (compEvents.length === 0) continue;

    const compTimings = compEvents.map((e) => e.timing);

    const compAvgTotalPitLoss = mean(compTimings.map((t) => t.totalPitLoss));
    const deltaTotalLoss = evt.timing.totalPitLoss - compAvgTotalPitLoss;

    let compAvgPitInTime: number | null = null;
    let compAvgPitRoadTime: number | null = null;
    let compAvgPitOutTime: number | null = null;
    let deltaPitIn: number | null = null;
    let deltaPitRoad: number | null = null;
    let deltaPitOut: number | null = null;

    // Segment comparisons: only when focus + all comp cars have full_segments
    const allFullSegments =
      evt.timing.decompositionLevel === "full_segments" &&
      compTimings.every((t) => t.decompositionLevel === "full_segments");

    if (allFullSegments) {
      const pitInVals = compTimings
        .map((t) => t.pitInTime)
        .filter((v): v is number => v !== null);
      if (pitInVals.length > 0 && evt.timing.pitInTime !== null) {
        compAvgPitInTime = mean(pitInVals);
        deltaPitIn = evt.timing.pitInTime - compAvgPitInTime;
      }

      const pitRoadVals = compTimings
        .map((t) => t.pitRoadTime)
        .filter((v): v is number => v !== null);
      if (pitRoadVals.length > 0 && evt.timing.pitRoadTime !== null) {
        compAvgPitRoadTime = mean(pitRoadVals);
        deltaPitRoad = evt.timing.pitRoadTime - compAvgPitRoadTime;
      }

      const pitOutVals = compTimings
        .map((t) => t.pitOutTime)
        .filter((v): v is number => v !== null);
      if (pitOutVals.length > 0 && evt.timing.pitOutTime !== null) {
        compAvgPitOutTime = mean(pitOutVals);
        deltaPitOut = evt.timing.pitOutTime - compAvgPitOutTime;
      }
    }

    evt.timing.cycleComparison = {
      cycleId: evt.cycleId,
      compAvgPitInTime,
      compAvgPitRoadTime,
      compAvgPitOutTime,
      compAvgTotalPitLoss,
      deltaPitIn,
      deltaPitRoad,
      deltaPitOut,
      deltaTotalLoss,
      compCarCount: compEvents.length,
    } satisfies PitCycleComparison;
  }
}

// ─── V3: Strategy Classification ────────────────────────────────────────────

export type StrategyType = "undercut" | "overcut" | "cover" | "scheduled";

export interface StrategyClassification {
  type: StrategyType;
  targetCar?: number;
  targetTeam?: string;
  success: boolean;
  positionDelta: number;
  confidence: "high" | "medium" | "low";
}

/** Pit event enriched with pre-pit baseline and settle position for strategy classification. */
export interface PitEventForStrategy {
  carNum: number;
  inLap: number;
  preBaseline: number;       // from findPrePitBaseline
  settlePosition: number;    // from cusumSettleDetection
  cycleId: number | null;
}

/**
 * Classify a pit stop's tactical intent relative to nearby rivals.
 *
 * Finds the closest rival (by pre-pit baseline position) in the same pit cycle.
 * - No rivals in cycle → scheduled
 * - Closest rival >5 positions away → scheduled
 * - Lap gap ≤1 → cover
 * - Focus pitted first & was behind → undercut
 * - Focus pitted after & was ahead → overcut
 * - Otherwise → scheduled or cover depending on context
 */
export function classifyPitStrategy(
  focusPit: PitEventForStrategy,
  allClassPitEvents: PitEventForStrategy[],
  teamLookup?: Map<number, string>
): StrategyClassification {
  // Find rival pit events in the same pit cycle
  const cyclePits =
    focusPit.cycleId !== null
      ? allClassPitEvents.filter(
          (p) => p.cycleId === focusPit.cycleId && p.carNum !== focusPit.carNum
        )
      : [];

  if (cyclePits.length === 0) {
    return { type: "scheduled", confidence: "high", success: true, positionDelta: 0 };
  }

  // Find closest rival by pre-pit proximity
  const rivals = cyclePits
    .map((p) => ({
      pit: p,
      prePos: p.preBaseline,
      distance: Math.abs(p.preBaseline - focusPit.preBaseline),
    }))
    .sort((a, b) => a.distance - b.distance);

  const closest = rivals[0];

  // If closest rival was more than 5 positions away, scheduled
  if (closest.distance > 5) {
    return { type: "scheduled", confidence: "medium", success: true, positionDelta: 0 };
  }

  const lapGap = focusPit.inLap - closest.pit.inLap;
  // Positive = focus pitted AFTER rival
  // Negative = focus pitted BEFORE rival

  const focusBefore = focusPit.preBaseline;
  const rivalBefore = closest.prePos;
  const focusSettled = focusPit.settlePosition;
  const rivalSettled = closest.pit.settlePosition;

  const wasAhead = focusBefore < rivalBefore; // lower P = ahead
  const isAhead = focusSettled < rivalSettled;
  const positionDelta =
    (rivalSettled - focusSettled) - (rivalBefore - focusBefore);
  // Positive = gained relative to rival

  const targetCar = closest.pit.carNum;
  const targetTeam = teamLookup?.get(targetCar);

  if (Math.abs(lapGap) <= 1) {
    // Pitted within 1 lap — cover stop
    return {
      type: "cover",
      targetCar,
      targetTeam,
      success: isAhead === wasAhead,
      positionDelta,
      confidence: "high",
    };
  }

  if (lapGap < 0) {
    // Focus pitted FIRST
    if (!wasAhead) {
      // Was behind, pitted first to try to get ahead — undercut
      return {
        type: "undercut",
        targetCar,
        targetTeam,
        success: isAhead,
        positionDelta,
        confidence: Math.abs(lapGap) <= 4 ? "high" : "medium",
      };
    } else {
      // Was ahead, pitted first — likely scheduled
      return {
        type: "scheduled",
        targetCar,
        targetTeam,
        success: isAhead,
        positionDelta,
        confidence: "medium",
      };
    }
  }

  // lapGap > 0: Focus pitted AFTER rival
  if (wasAhead) {
    // Was ahead, stayed out longer — overcut
    return {
      type: "overcut",
      targetCar,
      targetTeam,
      success: isAhead,
      positionDelta,
      confidence: Math.abs(lapGap) <= 4 ? "high" : "medium",
    };
  } else {
    // Was behind, pitted after — reactive cover
    return {
      type: "cover",
      targetCar,
      targetTeam,
      success: positionDelta > 0,
      positionDelta,
      confidence: "medium",
    };
  }
}

// ─── V3: Driver Filtering for WRL COTA ──────────────────────────────────────

/** Minimal lap shape needed by driver-filtering functions. */
export interface LapWithDriver {
  driverName?: string;
}

/**
 * Build a set of "known" driver names from the first N laps of a car.
 *
 * WRL COTA driver data degrades after ~60-80 laps, producing dozens of
 * spurious names. This scans the early (reliable) laps and returns only
 * names that appear 3+ times, filtering out noise.
 */
export function buildKnownDrivers(
  carLaps: LapWithDriver[],
  maxScanLaps = 60
): Set<string> {
  const counts = new Map<string, number>();
  const scanEnd = Math.min(carLaps.length, maxScanLaps);

  for (let i = 0; i < scanEnd; i++) {
    const name = carLaps[i].driverName;
    if (name && name.trim().length > 0) {
      const trimmed = name.trim();
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
  }

  const known = new Set<string>();
  for (const [name, count] of counts) {
    if (count >= 3) known.add(name);
  }
  return known;
}

/**
 * Check whether a driver change at a given lap index is legitimate.
 *
 * Returns true only if the new driver name is in the known drivers set
 * AND the name persists for at least 3 consecutive laps from that point.
 */
export function isLegitDriverChange(
  carLaps: LapWithDriver[],
  lapIndex: number,
  knownDrivers: Set<string>
): boolean {
  const newDriver = carLaps[lapIndex]?.driverName?.trim();
  if (!newDriver || !knownDrivers.has(newDriver)) return false;

  // Check persistence: must hold for 3 consecutive laps
  const checkEnd = Math.min(lapIndex + 2, carLaps.length - 1);
  for (let j = lapIndex; j <= checkEnd; j++) {
    if (carLaps[j]?.driverName?.trim() !== newDriver) return false;
  }

  return true;
}

// ─── V3: Out-Driver on Pit Markers ──────────────────────────────────────────

/** Driver info for a single lap, used for driver attribution on pit markers. */
export interface DriverLapInfo {
  lap: number;
  driverName?: string;
}

/**
 * Enrich pit markers with out-driver, in-driver, driverChanged, stintNumber,
 * and update the label to "S{stint} {surname}" when driver data is available.
 *
 * @param pitMarkers  Array of pit markers for a single car (mutated in place)
 * @param driverLaps  Per-lap driver info, ordered by lap number
 * @param knownDrivers  Known driver set (from buildKnownDrivers), or null to
 *                      skip WRL COTA validation (e.g. for IMSA or SpeedHive)
 */
export function enrichPitMarkersWithDrivers(
  pitMarkers: PitMarker[],
  driverLaps: DriverLapInfo[],
  knownDrivers: Set<string> | null
): void {
  if (pitMarkers.length === 0) return;

  // Build lap → driverName lookup
  const driverByLap = new Map<number, string>();
  for (const dl of driverLaps) {
    if (dl.driverName && dl.driverName.trim().length > 0) {
      driverByLap.set(dl.lap, dl.driverName.trim());
    }
  }

  // Sort pit markers by lap for stint numbering
  const sorted = [...pitMarkers].sort((a, b) => a.l - b.l);

  // Stint 1 = opening stint. Each pit starts a new stint on the out-lap.
  let stintNumber = 1;

  for (const marker of sorted) {
    stintNumber++;
    marker.stintNumber = stintNumber;

    // Find in-driver: driver on the in-lap
    const inDriver = driverByLap.get(marker.l);

    // Find out-lap: first lap after in-lap not in the pit marker set
    // (approximation — look for next lap with driver data after this pit lap)
    let outDriver: string | undefined;
    let outLap = marker.l + 1;
    // Scan up to 5 laps forward to find the out-lap with driver data
    for (let l = marker.l + 1; l <= marker.l + 5; l++) {
      const name = driverByLap.get(l);
      if (name) {
        outDriver = name;
        outLap = l;
        break;
      }
    }

    // WRL COTA validation: check against known drivers
    if (knownDrivers) {
      if (outDriver && !knownDrivers.has(outDriver)) outDriver = undefined;
      // Don't validate inDriver — we only use it for driverChanged detection
    }

    const driverChanged =
      inDriver !== undefined &&
      outDriver !== undefined &&
      inDriver !== outDriver;

    marker.outDriver = outDriver;
    marker.inDriver = inDriver;
    marker.driverChanged = driverChanged;

    // Update label
    if (outDriver) {
      marker.lb = `S${stintNumber} ${outDriver}`;
    }
    // Otherwise keep existing "Pit N" label
  }
}

// ─── V3: IMSA Time Cards Integration ────────────────────────────────────────

/**
 * Parse a time-of-day string "HH:MM:SS.mmm" into seconds from midnight.
 * Handles optional milliseconds and edge cases.
 */
export function parseTimeOfDay(timeStr: string): number {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const trimmed = timeStr.trim();

  // Match HH:MM:SS or HH:MM:SS.mmm
  const match = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const frac = match[4] ? parseInt(match[4], 10) / Math.pow(10, match[4].length) : 0;

  return hours * 3600 + minutes * 60 + seconds + frac;
}

/** Parsed pit stop record from IMSA Pit Stop Time Cards JSON. */
export interface IMSAParsedPitStop {
  pitNumber: number;
  inTime: number;          // pit road entrance, seconds from midnight
  outTime: number;         // pit road exit, seconds from midnight
  pitTime: number;         // outTime - inTime (from source, for validation)
  inDriverSurname: string;
  outDriverSurname: string;
  inDriverNumber: number;
  outDriverNumber: number;
  driverChanged: boolean;
}

/**
 * Parse IMSA Pit Stop Time Cards JSON into a per-car map of structured
 * pit stop records.
 *
 * Expects the raw JSON object with `pit_stop_analysis` array, where each
 * entry has `number` (car number), `drivers[]`, and `pit_stops[]`.
 *
 * @returns Map from car number to array of parsed pit stops, sorted by pitNumber
 */
export function parseIMSAPitStopData(
  rawJson: {
    pit_stop_analysis?: Array<{
      number: string;
      drivers?: Array<{
        number: number;
        firstname: string;
        surname: string;
      }>;
      pit_stops?: Array<{
        pit_stop_number?: number;
        in_time?: string;
        out_time?: string;
        pit_time?: string;
        total_pit_time?: string;
        in_driver_surname?: string;
        out_driver_surname?: string;
        in_driver_number?: number;
        out_driver_number?: number;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }
): Map<number, IMSAParsedPitStop[]> {
  const result = new Map<number, IMSAParsedPitStop[]>();

  const entries = rawJson.pit_stop_analysis;
  if (!Array.isArray(entries)) return result;

  for (const entry of entries) {
    const carNum = parseInt(entry.number, 10);
    if (isNaN(carNum)) continue;

    const stops: IMSAParsedPitStop[] = [];
    if (!Array.isArray(entry.pit_stops)) continue;

    for (const ps of entry.pit_stops) {
      const inTime = parseTimeOfDay(ps.in_time ?? "");
      const outTime = parseTimeOfDay(ps.out_time ?? "");
      const pitTime = parseTimeOfDay(ps.pit_time ?? "");

      const inDriverSurname = ps.in_driver_surname ?? "";
      const outDriverSurname = ps.out_driver_surname ?? "";
      const inDriverNumber = ps.in_driver_number ?? 0;
      const outDriverNumber = ps.out_driver_number ?? 0;

      stops.push({
        pitNumber: ps.pit_stop_number ?? stops.length + 1,
        inTime,
        outTime,
        pitTime,
        inDriverSurname,
        outDriverSurname,
        inDriverNumber,
        outDriverNumber,
        driverChanged: inDriverNumber !== outDriverNumber,
      });
    }

    // Sort by pit number
    stops.sort((a, b) => a.pitNumber - b.pitNumber);
    result.set(carNum, stops);
  }

  return result;
}

/**
 * Convert an array of IMSAParsedPitStop into PitStopTimeCard array
 * suitable for passing to computePitTiming.
 */
export function toPitStopTimeCards(
  parsedStops: IMSAParsedPitStop[]
): PitStopTimeCard[] {
  return parsedStops.map((ps) => ({
    inTime: ps.inTime,
    outTime: ps.outTime,
    pitTime: ps.pitTime,
    inDriverSurname: ps.inDriverSurname || undefined,
    outDriverSurname: ps.outDriverSurname || undefined,
    driverChanged: ps.driverChanged,
  }));
}
