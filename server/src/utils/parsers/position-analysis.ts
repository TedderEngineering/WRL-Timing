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
  existing?: AnnotationJson
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
            lb: `Pit ${pitCount}`,
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

  return annotations;
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
