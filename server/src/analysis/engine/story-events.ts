/**
 * Story event skeletons (schema 1.1.0 carStories[].events). Deterministic, built from the fact
 * sections of a package only, so the validator can rebuild them from the facts base and refuse a
 * story whose skeleton differs. Claude fills `title` and `text` only.
 */
import type { CarId, Confidence, EventCause, RaceAnalysisPackage, StoryEvent, TimePoint } from "../schema/package-types.js";
import { isoLocal } from "../util.js";

type Skeleton = Omit<StoryEvent, "title" | "text">;

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const worst = (...cs: (Confidence | undefined)[]): Confidence =>
  cs.filter((c): c is Confidence => !!c).reduce<Confidence>((a, b) => (RANK[b] > RANK[a] ? b : a), "high");

function resultOf(net: number | null | undefined): StoryEvent["outcome"]["result"] {
  if (net === null || net === undefined) return "none";
  return net > 0 ? "gained" : net < 0 ? "lost" : "held";
}

export function buildStoryEvents(pkg: RaceAnalysisPackage): Record<CarId, StoryEvent[]> {
  const out: Record<CarId, StoryEvent[]> = {};
  const laps = pkg.laps.cars;
  const cycByPassage = new Map(pkg.cycleResults.map((r) => [r.passageId, r]));
  const rows = pkg.positionChanges.rows;
  const ld = pkg.positionChanges.lapDowns ?? { car: [], lap: [], lapsDown: [], cause: [] };
  // Wall clock for a raceTimeS, when the package has one (timeOrigin + offset; absent for the WRL website export).
  const m = pkg.metadata.timeOrigin.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(Z|([+-])(\d{2}):(\d{2}))$/);
  const hasClock = pkg.metadata.timeOriginSource !== "manual" && !!m;
  const point = (raceTimeS: number): TimePoint => {
    const tp: TimePoint = { raceTimeS };
    if (hasClock && m) {
      const off = m[5] === "Z" ? 0 : (m[6] === "-" ? -1 : 1) * (Number(m[7]) * 60 + Number(m[8]));
      tp.clock = isoLocal(m[1], Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]) + raceTimeS, off);
    }
    return tp;
  };
  const lapStart = (car: string, lap: number): TimePoint => {
    const c = laps[car];
    if (!c) return point(0);
    const i = c.lap.indexOf(lap);
    if (i > 0) return point(c.endS[i - 1]);
    if (i === 0) return point(Math.max(0, Math.round((c.endS[0] - (c.lapTimeS[0] ?? c.endS[0])) * 1000) / 1000));
    return point(c.endS.length ? c.endS[c.endS.length - 1] : 0);
  };
  const cposAt = (car: string, lap: number): number | null => {
    const c = laps[car];
    if (!c) return null;
    const i = c.lap.indexOf(lap);
    return i >= 0 ? c.cpos[i] : null;
  };
  for (const e of pkg.entries) {
    const car = e.car;
    const sk: (Skeleton & { order: number })[] = [];
    const covered: [number, number][] = [];
    const passages = pkg.events.pitPassages.filter((p) => p.car === car && p.kind !== "pit_lane_start").sort((a, b) => a.ordinal - b.ordinal);
    for (const p of passages) {
      const cr = cycByPassage.get(p.id);
      const eff = cr ?? p.positionEffect ?? null;
      const causes: EventCause[] = [];
      if (p.kind === "stop" || p.kind === "garage") causes.push("pit_cycle");
      if (p.kind === "drive_through" || p.kind === "stop_and_go" || p.kind === "penalty_served") causes.push("penalty");
      if (p.kind === "retirement") causes.push("retirement");
      if (p.fcyContext !== "green") causes.push("fcy");
      const end = eff?.afterLap ?? p.outLap ?? p.inLap;
      const lapEnd = Math.max(p.inLap, end);
      covered.push([p.inLap, lapEnd]);
      const lapDownIds: string[] = [];
      for (let i = 0; i < ld.car.length; i++) if (ld.car[i] === car && ld.lap[i] >= p.inLap && ld.lap[i] <= lapEnd) lapDownIds.push(`lapdown:${car}:${ld.lap[i]}`);
      const ev: Skeleton & { order: number } = {
        id: "",
        lap: p.inLap,
        at: p.pitIn ?? lapStart(car, p.inLap),
        causes,
        outcome: {
          result: p.kind === "retirement" ? "retired" : resultOf(eff?.netClass),
          classPosBefore: eff?.classPosBefore ?? null,
          classPosAfter: eff?.classPosAfter ?? null,
          netClass: eff?.netClass ?? null,
          lapDown: p.lapDown ?? null,
        },
        evidence: [p.id, ...(cr ? [cr.id, cr.cycleId] : []), ...(p.groupId ? [p.groupId] : []), ...p.penaltiesServed, ...lapDownIds],
        confidence: worst(p.confidence, cr?.confidence),
        order: 0,
      };
      if (lapEnd > p.inLap) ev.lapEnd = lapEnd;
      sk.push(ev);
    }
    const inPassage = (lap: number) => covered.some(([a, b]) => lap >= a && lap <= b);
    // penalties that no passage served (unserved, converted, post-race); warnings are not events
    for (const pen of pkg.events.penalties.filter((x) => x.car === car && !x.servedByPassageId && x.penaltyType !== "warning")) {
      const c = laps[car];
      let lap = c?.lap.length ? c.lap[c.lap.length - 1] : 1;
      let at: TimePoint = point(c?.endS.length ? c.endS[c.endS.length - 1] : 0);
      if (pen.issued && c) {
        const i = c.endS.findIndex((t) => t >= pen.issued!.raceTimeS);
        if (i >= 0) lap = c.lap[i];
        at = pen.issued;
      }
      sk.push({
        id: "",
        lap,
        at,
        causes: ["penalty"],
        outcome: { result: pen.status === "applied_post_race" || pen.status === "converted_post_race" ? "penalty_applied" : "none" },
        evidence: [pen.id, ...(pen.status === "applied_post_race" || pen.status === "converted_post_race" ? [`result:${car}`] : [])].filter((f) => f !== `result:${car}` || !!e.result),
        confidence: pen.confidence,
        order: 1,
      });
    }
    // lap-down events outside passages
    for (let i = 0; i < ld.car.length; i++) {
      if (ld.car[i] !== car || inPassage(ld.lap[i])) continue;
      const cause = ld.cause[i];
      const causes: EventCause[] = cause === "on_track" ? ["on_track_pass"] : cause === "fcy_pit" ? ["pit_cycle", "fcy"] : cause === "pit" ? ["pit_cycle"] : ["on_track_pass"];
      sk.push({ id: "", lap: ld.lap[i], at: point(laps[car]?.endS[laps[car].lap.indexOf(ld.lap[i])] ?? 0), causes, outcome: { result: "lap_down", lapDown: true }, evidence: [`lapdown:${car}:${ld.lap[i]}`], confidence: "high", order: 2 });
    }
    // position changes outside the car's own passages, one event per stint
    const stints = pkg.stints.filter((s) => s.car === car).sort((a, b) => a.ordinal - b.ordinal);
    for (const st of stints) {
      const ids: string[] = [];
      const causes = new Set<EventCause>();
      let net = 0;
      let first = Infinity;
      let last = -Infinity;
      for (let i = 0; i < rows.lap.length; i++) {
        const L = rows.lap[i];
        if (L < st.startLap || L > st.endLap || inPassage(L)) continue;
        const won = rows.winner[i] === car;
        if (!won && rows.loser[i] !== car) continue;
        const m = rows.mechanism[i];
        let c: EventCause | null = null;
        if (m === "on_track") c = "on_track_pass";
        else if (m === "penalty") c = "penalty";
        else if (m === "retirement") c = "retirement";
        else if ((m === "loser_pitted" && won) || (m === "winner_pitted" && !won)) c = "rival_pit";
        if (!c) continue;
        causes.add(c);
        ids.push(`pass:${rows.winner[i]}:${L}:${rows.loser[i]}`);
        net += won ? 1 : -1;
        first = Math.min(first, L);
        last = Math.max(last, L);
      }
      if (!ids.length) continue;
      const before = cposAt(car, first - 1);
      const after = cposAt(car, last);
      const ev: Skeleton & { order: number } = {
        id: "",
        lap: first,
        at: lapStart(car, first),
        causes: (["on_track_pass", "rival_pit", "penalty", "retirement"] as EventCause[]).filter((c) => causes.has(c)),
        outcome: { result: resultOf(before !== null && after !== null ? before - after : net), classPosBefore: before, classPosAfter: after, netClass: before !== null && after !== null ? before - after : null },
        evidence: [st.id, ...ids],
        confidence: "high",
        order: 3,
      };
      if (last > first) ev.lapEnd = last;
      sk.push(ev);
    }
    // retirement with no retirement passage
    for (const r of pkg.events.retirements.filter((x) => x.car === car && !x.passageId && x.where !== "did_not_start")) {
      sk.push({ id: "", lap: Math.max(1, r.lastCompletedLap), at: r.at ?? point(0), causes: ["retirement"], outcome: { result: "retired" }, evidence: [r.id], confidence: r.confidence, order: 4 });
    }
    sk.sort((a, b) => a.lap - b.lap || a.at.raceTimeS - b.at.raceTimeS || a.order - b.order);
    out[car] = sk.map((x, i) => {
      const { order: _order, ...rest } = x;
      void _order;
      return { ...rest, id: `event:${car}:${i + 1}` };
    });
  }
  return out;
}
