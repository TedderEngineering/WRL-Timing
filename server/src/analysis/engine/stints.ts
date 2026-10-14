/**
 * M12 stints and drive time per driver (D-STINT, D-DRIVETIME).
 */
import type { DriveTime, Stint } from "../schema/package-types.js";
import type { CarId } from "../types.js";
import { carOrder, matchDriver, rd } from "../util.js";
import { tp, type Ctx } from "./context.js";
import type { Period } from "./fcy.js";
import type { Passage } from "./passages.js";

const SERVICE = new Set(["stop", "garage", "retirement"]);
const PENALTY = new Set(["drive_through", "stop_and_go", "penalty_served"]);


export function buildStints(
  ctx: Ctx,
  passages: Passage[],
  periods: Period[],
  driveEndT: number,
): { stints: Stint[]; driveTimes: DriveTime[] } {
  const stints: Stint[] = [];
  const driveTimes: DriveTime[] = [];
  const wrl = ctx.race.format === "speedhive" || ctx.race.format === "wrl-website";
  const byCar = new Map<string, Passage[]>();
  for (const p of passages) byCar.set(p.car, [...(byCar.get(p.car) ?? []), p]);
  for (const car of [...ctx.cars].sort(carOrder)) {
    const rows = ctx.laps[car] ?? [];
    if (!rows.length) continue;
    const plist = [...(byCar.get(car) ?? [])].sort((a, b) => a.sortT - b.sortT);
    const tookFlag = rows[rows.length - 1].endT >= ctx.chequerT - 1e-6;
    // Segment boundaries. WRL (and RedMist passages without pit clocks): no pit times, so a stint ends
    // at the in-lap end and restarts at it.
    const lapBased = (p: Passage) => wrl || (ctx.race.format === "redmist" && (p.pinT === null || p.poutT === null));
    const lapBasedCar = wrl || plist.some((p) => SERVICE.has(p.kind) && lapBased(p));
    const pinOf = (p: Passage) => (lapBased(p) ? rows[p.inIdx ?? 0].endT : p.pinT ?? p.sortT);
    const poutOf = (p: Passage) => (lapBased(p) ? rows[p.inIdx ?? 0].endT : p.poutT ?? p.rejoinT ?? p.sortT);
    type Seg = { a: number; b: number; sr: Stint["startReason"]; er: Stint["endReason"]; i0: number; i1: number };
    const segs: Seg[] = [];
    let a = ctx.axis.origin;
    let sr: Stint["startReason"] = "race_start";
    let i0 = 0;
    const pls = plist.find((p) => p.kind === "pit_lane_start");
    if (pls) {
      a = pls.poutT ?? pls.rejoinT ?? a;
      sr = "pit_lane_start";
    }
    for (const p of plist) {
      if (!SERVICE.has(p.kind)) continue;
      const endIdx = p.inIdx ?? rows.length - 1;
      if (p.kind === "retirement") {
        segs.push({ a, b: p.pinT ?? rows[endIdx].endT, sr, er: "retired", i0, i1: endIdx });
        i0 = -1;
        break;
      }
      if (p.outcome !== "rejoined" || p.outIdx === null) {
        segs.push({ a, b: pinOf(p), sr, er: "chequered", i0, i1: endIdx });
        i0 = -1;
        break;
      }
      segs.push({ a, b: pinOf(p), sr, er: "pit_in", i0, i1: endIdx });
      a = poutOf(p);
      sr = "pit_out";
      i0 = p.outIdx;
    }
    if (i0 >= 0) segs.push({ a, b: rows[rows.length - 1].endT, sr, er: tookFlag ? "chequered" : "retired", i0, i1: rows.length - 1 });

    const perDriver = new Map<number, { ids: string[]; t: number }>();
    const changeLaps: string[] = [];
    let n = 0;
    for (const s of segs) {
      // split at driver changes inside a stint (warning)
      const parts: { i0: number; i1: number; driver: number | null }[] = [];
      for (let i = s.i0; i <= s.i1; i++) {
        const d = rows[i].driver;
        const last = parts[parts.length - 1];
        if (last && (last.driver === d || d === null || last.driver === null)) {
          last.i1 = i;
          if (last.driver === null) last.driver = d;
        } else parts.push({ i0: i, i1: i, driver: d });
      }
      if (!parts.length) parts.push({ i0: s.i0, i1: s.i1, driver: null });
      if (parts.length > 1) changeLaps.push(`${rows[s.i0].lap}-${rows[s.i1].lap}`);
      parts.forEach((pt, k) => {
        const pa = k === 0 ? s.a : rows[pt.i0 - 1].endT;
        const pb = k === parts.length - 1 ? s.b : rows[pt.i1].endT;
        const inside = plist.filter((p) => PENALTY.has(p.kind) && (p.pinT ?? p.sortT) >= pa && (p.pinT ?? p.sortT) < pb);
        const penaltyLane = inside.reduce((x, p) => x + (p.official ?? 0), 0);
        const driveS = Math.max(0, Math.min(pb, driveEndT) - pa) - penaltyLane;
        const id = `stint:${car}:${++n}`;
        const notes: string[] = [];
        let conf: Stint["confidence"] = "high";
        if (lapBasedCar) {
          notes.push("wrl_boundaries_no_pit_times");
          conf = "medium";
        }
        if (parts.length > 1) {
          notes.push("driver_change_without_stop");
          conf = "medium";
        }
        const st: Stint = {
          id,
          car,
          ordinal: n,
          driver: pt.driver,
          start: tp(ctx, pa),
          end: tp(ctx, pb),
          startReason: k === 0 ? s.sr : "pit_out",
          endReason: k === parts.length - 1 ? s.er : "pit_in",
          startLap: rows[pt.i0].lap,
          endLap: rows[pt.i1].lap,
          laps: rows.slice(pt.i0, pt.i1 + 1).reduce((x, r) => x + r.span, 0),
          driveTimeS: rd(driveS),
          penaltyPassageIds: inside.map((p) => p.id),
          fcyTimeS: rd(periods.reduce((x, q) => x + Math.max(0, Math.min(pb, q.end) - Math.max(pa, q.start)), 0)),
          source: { kind: "derived", method: "D-STINT", files: [rows[0].fileId] },
          confidence: conf,
        };
        if (notes.length) st.confidenceNotes = notes;
        stints.push(st);
        if (pt.driver !== null) {
          const cur = perDriver.get(pt.driver) ?? { ids: [], t: 0 };
          cur.ids.push(id);
          cur.t += driveS;
          perDriver.set(pt.driver, cur);
        }
      });
    }
    if (changeLaps.length) {
      ctx.issues.push({
        severity: "warning",
        code: "DRIVER-CHANGE-NO-STOP",
        message: `Car ${car}: the lap driver changes inside a stint without a service passage (stint laps ${changeLaps.join(", ")}); the stint is split at the change.${ctx.race.format === "wrl-website" ? " WRL Driver_Name is unreliable after about lap 80 (WN5)." : ""}`,
        factIds: [`car:${car}`],
      });
    }
    // drive time per driver, with the official TOTAL_TRACK_TIME cross-check (last TRACK row per driver)
    const entry = ctx.race.entries.find((e) => e.car === car);
    const official = new Map<number, { v: number | null; ref: string }>();
    for (const d of ctx.race.driveStints) {
      if (d.car !== car || d.type !== "TRACK") continue;
      const n = matchDriver(d.driver, entry?.drivers ?? []);
      if (n !== null) official.set(n, { v: d.totalTrackTimeS, ref: `${d.fileId}:L${d.row}` });
    }
    for (const [drv, v] of [...perDriver.entries()].sort((x, y) => x[0] - y[0])) {
      const off = official.get(drv) ?? null;
      const dt: DriveTime = {
        id: `drive:${car}:${drv}`,
        car,
        driver: drv,
        driveTimeS: rd(v.t),
        officialDriveTimeS: off ? rd(off.v) : null,
        stintIds: v.ids,
        source: off ? { kind: "derived", method: "D-DRIVETIME", refs: [off.ref] } : { kind: "derived", method: "D-DRIVETIME" },
        confidence: lapBasedCar ? "medium" : "high",
      };
      driveTimes.push(dt);
    }
  }
  return { stints, driveTimes };
}

export type { CarId };
