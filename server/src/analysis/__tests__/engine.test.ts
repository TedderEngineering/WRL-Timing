/**
 * Unit tests for the fact engine on synthetic races, one or more per scenario in the Stage 1
 * catalogues (ACCURACY_ALKAMEL.md §4, ACCURACY_WRL.md §4).
 */
import { describe, expect, it } from "vitest";
import { buildFacts } from "../buildFacts.js";
import { validatePackage } from "../validate-package.js";
import { AdapterBlocker } from "../adapters/index.js";
import type { PitPassage, RaceAnalysisPackage } from "../schema/package-types.js";
import { fcyRace, greenRace, OPTS, redFlagRace, doubleStopRace, penaltyRace, noCardPenaltyRace, serveWindowRace } from "./scenarios.js";
import { synthImsa, synthSpeedhive, synthWrlWebsite, textFile } from "./synth.js";

const green = buildFacts({ format: "alkamel-imsa", files: synthImsa(greenRace()), options: OPTS });
const fcy = buildFacts({ format: "alkamel-imsa", files: synthImsa(fcyRace()), options: OPTS });
const pass = (pkg: RaceAnalysisPackage, id: string): PitPassage => {
  const p = pkg.events.pitPassages.find((x) => x.id === id);
  if (!p) throw new Error(`no ${id}`);
  return p;
};

describe("synthetic green race", () => {
  it("is a schema-valid draft with empty prose sections", () => {
    const r = validatePackage(green);
    expect(r.errors).toEqual([]);
    expect(green.status).toBe("draft");
    expect(green.carStories).toEqual([]);
    expect(green.raceSummary).toBeNull();
    expect(green.schemaVersion).toBe("1.1.0");
  });

  it("D-CAR: '7', '07' and '007' are three cars with their own passages (AS1)", () => {
    const cars = green.entries.map((e) => e.car);
    expect(cars).toEqual(expect.arrayContaining(["7", "07", "007"]));
    expect(pass(green, "pit:7:1").inLap).toBe(10);
    expect(pass(green, "pit:07:1").officialPitLaneTimeS).toBe(63);
    expect(pass(green, "pit:007:1").inLap).toBe(11);
    expect(green.entries.find((e) => e.car === "007")!.make).toBe("Aston Martin");
    expect(Object.keys(green.laps.cars)).toEqual(expect.arrayContaining(["7", "07", "007"]));
    expect(green.dataQuality.some((d) => d.code === "CAR-ID-LEADING-ZERO")).toBe(true);
  });

  it("drive-through: RC penalty + passage within 1.15 x transit (AS2, AS2b)", () => {
    const p = pass(green, "pit:11:1");
    expect(p.kind).toBe("drive_through");
    expect(p.kindBasis).toContain("rc_penalty_match");
    expect(p.stopNumber).toBeNull();
    expect(p.cycleId).toBeNull();
    expect(p.penaltiesServed).toEqual(["pen:11:1"]);
    expect(green.events.penalties.find((x) => x.id === "pen:11:1")!.status).toBe("served");
    expect(pass(green, "pit:11:2").stopNumber).toBe(1);
  });

  it("stop-and-go: matched to its penalty at any duration", () => {
    const p = pass(green, "pit:12:1");
    expect(p.kind).toBe("stop_and_go");
    expect(p.penaltiesServed).toEqual(["pen:12:1"]);
    expect(p.positionEffect).toBeDefined();
  });

  it("garage: rejoined with pit-lane time over 600 s; not a cycle member (AS9b)", () => {
    const p = pass(green, "pit:10:2");
    expect(p.kind).toBe("garage");
    expect(p.officialPitLaneTimeS).toBe(700);
    expect(p.cycleId).toBeNull();
    expect(p.timeLost.valueS).toBeGreaterThan(600);
  });

  it("retirement in the pits: no out-lap, no pit-out, no time lost (AS9, WS7)", () => {
    const p = pass(green, "pit:24:2");
    expect(p.kind).toBe("retirement");
    expect(p.outcome).toBe("retired");
    expect(p.outLap).toBeNull();
    expect(p.pitOut).toBeNull();
    expect(p.officialPitLaneTimeS).toBeNull();
    expect(p.timeLost).toEqual({ valueS: null, method: "none" });
    const r = green.events.retirements.find((x) => x.car === "24")!;
    expect(r.where).toBe("pit_lane");
    expect(r.passageId).toBe("pit:24:2");
  });

  it("pit-lane start: not a stop, no time lost, no cycle (AS10)", () => {
    const p = pass(green, "pit:25:1");
    expect(p.kind).toBe("pit_lane_start");
    expect(p.stopNumber).toBeNull();
    expect(p.timeLost.method).toBe("none");
    expect(pass(green, "pit:25:2").stopNumber).toBe(1);
  });

  it("missing time card: passage from the B flag, pit-lane time null, medium (AO1)", () => {
    const p = pass(green, "pit:23:2");
    expect(p.kind).toBe("stop");
    expect(p.pitIn).toBeNull();
    expect(p.officialPitLaneTimeS).toBeNull();
    expect(p.confidenceNotes).toContain("no_time_card");
    expect(p.confidence).toBe("medium");
  });

  it("lap down in a stop: lapsDown rises through the stop (D-LAPDOWN)", () => {
    const p = pass(green, "pit:22:1");
    expect(p.lapDown).toBe(true);
    const cr = green.cycleResults.find((r) => r.passageId === "pit:22:1")!;
    expect(cr.lapsDownAfter! - cr.lapsDownBefore!).toBeGreaterThanOrEqual(1);
  });

  it("cross-class cycle separation: same moment, one cycle per class (AS7, WS14)", () => {
    const gs = green.pitCycles.find((c) => c.id === "cycle:GS:1")!;
    const tcr = green.pitCycles.find((c) => c.members.some((m) => m.car === "20"))!;
    expect(gs.members.map((m) => m.car).sort()).toEqual(["007", "07", "10", "11", "12", "7"]);
    expect(tcr.class).toBe("TCR");
    expect(tcr.members.every((m) => ["20", "21", "23", "24", "25"].includes(m.car))).toBe(true);
    for (const r of green.cycleResults) {
      const cls = green.entries.find((e) => e.car === r.car)!.class;
      for (const cp of [...r.gainedOn, ...r.lostTo]) expect(green.entries.find((e) => e.car === cp.car)!.class).toBe(cls);
    }
  });

  it("post-race penalty in the official results: positions before and after (AS17, D-FINISH)", () => {
    const e = green.entries.find((x) => x.car === "21")!;
    expect(e.result!.postRacePenaltyS).toBe(39);
    // Pre-penalty rank: same laps, its own total minus the penalty, every other car unchanged.
    const classified = green.entries.filter((x) => x.result?.status === "classified");
    const key = (x: (typeof classified)[number]) => [-(x.result!.laps), x.result!.totalTimeS! - (x === e ? 39 : 0)];
    const order = [...classified].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
    expect(e.result!.prePenaltyPositionOverall).toBe(order.indexOf(e) + 1);
    expect(e.result!.prePenaltyPositionOverall!).toBeLessThanOrEqual(e.result!.positionOverall!);
    const pens = green.events.penalties.filter((p) => p.car === "21");
    expect(pens.map((p) => [p.penaltyType, p.status])).toEqual([
      ["drive_through", "converted_post_race"],
      ["post_race_time", "applied_post_race"],
    ]);
    expect(pens[1].convertedFromId).toBe("pen:21:1");
    expect(pens[1].resultsEffectS).toBe(39);
  });

  it("green time lost = lap sum - n x reference (D-LOSS-GREEN)", () => {
    const p = pass(green, "pit:7:1");
    expect(p.timeLost.method).toBe("green_reference");
    expect(p.timeLost.nLaps).toBe(2);
    expect(p.timeLost.valueS).toBeCloseTo(p.timeLost.lapSumS! - 2 * p.timeLost.refLapS!, 3);
    expect(p.timeLost.refWindowLaps).toBe(5);
  });

  it("pits_open flags are events with a class scope", () => {
    const f = green.events.flags.find((x) => x.type === "pits_open")!;
    expect(f.classes).toEqual([]);
    expect(f.message).toBe("PITS OPEN ALL CARS");
  });

  it("drive time per driver excludes penalty pit-lane time (D-DRIVETIME)", () => {
    const st = green.stints.filter((s) => s.car === "11");
    expect(st[0].penaltyPassageIds).toEqual(["pit:11:1"]);
    const raw = st[0].end.raceTimeS - st[0].start.raceTimeS;
    expect(st[0].driveTimeS).toBeCloseTo(raw - 35, 3);
    expect(green.driveTimes.some((d) => d.car === "7" && d.driver === 2)).toBe(true);
  });

  it("is deterministic (T12)", () => {
    const again = buildFacts({ format: "alkamel-imsa", files: synthImsa(greenRace()), options: OPTS });
    expect(JSON.stringify(again)).toBe(JSON.stringify(green));
  });
});

describe("synthetic FCY race", () => {
  it("FCY stop: pit-in under the flags-file FCY uses neighbours, never green reference (AS4, WS4)", () => {
    const p = pass(fcy, "pit:30:1");
    expect(p.fcyContext).toBe("fcy");
    expect(p.fcyPeriodIds).toEqual(["fcy:1"]);
    expect(p.timeLost.method).toBe("fcy_neighbours");
    expect(p.timeLost.neighbourCars!.length).toBeGreaterThanOrEqual(2);
    expect(p.timeLost.greenReferenceValueS).not.toBeNull();
    expect(fcy.fcyPeriods[0].source.kind).toBe("official");
    const c = fcy.pitCycles.find((x) => x.id === "cycle:GS:1")!;
    expect(c.trigger).toBe("fcy");
  });

  it("D-FCY-LAP: laps are 0/1/2 by overlap, never by the flag at the line", () => {
    const cols = fcy.laps.cars["34"];
    expect(cols.fcy.some((x) => x === 2)).toBe(true);
    expect(cols.fcy.some((x) => x === 1)).toBe(true);
    expect(cols.clean.every((c, i) => !c || cols.fcy[i] === 0)).toBe(true);
  });
});

describe("adapters and import blockers", () => {
  it("duplicate lap number is an import blocker (LAP-DUPLICATE)", () => {
    const files = synthImsa(greenRace());
    const lines = files[0].text!.split("\n");
    files[0] = textFile(files[0].name, "laps", [...lines.slice(0, 3), lines[2], ...lines.slice(3)].join("\n"));
    expect(() => buildFacts({ format: "alkamel-imsa", files, options: OPTS })).toThrow(AdapterBlocker);
  });

  it("missing header is an import blocker", () => {
    const f = textFile("23_Time Cards_Race.CSV", "laps", "NUMBER;LAP_NUMBER\n1;1\n");
    expect(() => buildFacts({ format: "alkamel-imsa", files: [f], options: OPTS })).toThrow(/ADAPTER-HEADER-MISSING/);
  });
});

describe("WRL website export", () => {
  // 4 cars, class GTU; car 40 has a lap-0 row; car 30 has a blank Lap_Time (WS20) and a span row (WN1);
  // car 31 has a slow lap 1 with no In_Pit flag (WS19); car 32 has Last_In_Pit without In_Pit (WN3).
  const rows: [string, string, number, string, string, boolean, boolean, string][] = [];
  const add = (car: string, lap: number, lt: number | null, trt: number, ip = false, lip = false) =>
    rows.push([car, "GTU", lap, lt === null ? "" : `00:${String(Math.floor(lt / 60)).padStart(2, "0")}:${(lt % 60).toFixed(3).padStart(6, "0")}`, `${String(Math.floor(trt / 3600)).padStart(2, "0")}:${String(Math.floor((trt % 3600) / 60)).padStart(2, "0")}:${(trt % 60).toFixed(3).padStart(6, "0")}`, ip, lip, "Green"]);
  for (const [car, off] of [["30", 0], ["31", 1], ["32", 2], ["40", 3]] as const) {
    let t = 10 + off;
    for (let L = 1; L <= 12; L++) {
      let lt = 140 + off * 0.2 + (L === 1 ? 10 : 0) + (car === "31" && L === 1 ? 60 : 0);
      let ip = false;
      let lip = false;
      if (car === "32" && L === 6) lt += 40;
      if (car === "32" && L === 7) {
        lt += 60;
        lip = true;
      }
      if (car === "30" && L === 8) ip = true;
      if (car === "30" && L === 9) lt += 70;
      if (car === "30" && L === 4) continue; // span: lap 5 row covers laps 4-5
      t += lt * (car === "30" && L === 5 ? 2 : 1);
      add(car, L, car === "30" && L === 3 ? null : lt, t, ip, lip);
    }
  }
  rows.unshift(["40", "GTU", 0, "", "", false, false, "Green"]);
  const pkg = buildFacts({
    format: "wrl-website",
    files: synthWrlWebsite(rows, [["30", 1, 1, 12], ["31", 2, 2, 12], ["32", 3, 3, 12], ["40", 4, 4, 12]]),
    options: { ...OPTS, rulebook: { pitCycleModel: "windows" }, raceDate: "2025-12-06" },
  });
  it("validates", () => expect(validatePackage(pkg).errors).toEqual([]));
  it("blank Lap_Time is null and not clean (WS20, WN2)", () => {
    const c = pkg.laps.cars["30"];
    const i = c.lap.indexOf(3);
    expect(c.lapTimeS[i]).toBeNull();
    expect(c.clean[i]).toBe(0);
  });
  it("skipped lap numbers give a span row (WN1)", () => {
    const c = pkg.laps.cars["30"];
    expect(c.lap.includes(4)).toBe(false);
    expect(c.span![c.lap.indexOf(5)]).toBe(2);
  });
  it("lap-0 row dropped with a note (WN4)", () => {
    expect(pkg.laps.cars["40"].lap[0]).toBe(1);
    expect(pkg.dataQuality.some((d) => d.code === "LAP-ZERO-DROPPED")).toBe(true);
  });
  it("slow lap 1 without a pit flag is not a passage (WS19)", () => {
    expect(pkg.events.pitPassages.filter((p) => p.car === "31")).toEqual([]);
  });
  it("In_Pit run: in-lap = first flagged lap, out-lap = next row (WS1)", () => {
    const p = pkg.events.pitPassages.find((x) => x.car === "30")!;
    expect([p.inLap, p.outLap, p.pitIn, p.officialPitLaneTimeS]).toEqual([8, 9, null, null]);
  });
  it("Last_In_Pit without In_Pit is a passage with in-lap = previous row (WN3)", () => {
    const p = pkg.events.pitPassages.find((x) => x.car === "32")!;
    expect([p.inLap, p.outLap]).toEqual([6, 7]);
    expect(p.confidenceNotes).toContain("last_in_pit_inferred");
  });
  it("time axis has no wall clock; date is the owner's", () => {
    expect(pkg.metadata.raceDate).toBe("2025-12-06");
    expect(pkg.metadata.timeOriginSource).toBe("manual");
    expect(pkg.fcyPeriods.every((f) => f.start.clock === undefined)).toBe(true);
  });
});

describe("Speedhive export", () => {
  it("date from Time of Day; passages from In Pit; reconstructed FCY by time (D-FCY-RECON)", () => {
    const rows: [string, string, number, string, string, boolean, string][] = [];
    for (const [car, off] of [["5", 0], ["6", 0.5], ["8", 1]] as const) {
      let t = 9 * 3600 + 30 + off;
      for (let L = 1; L <= 10; L++) {
        const lt = 100 + (L === 4 || L === 5 ? 30 : 0) + (car === "6" && L === 7 ? 40 : 0) + (car === "6" && L === 8 ? 50 : 0);
        t += lt;
        const h = Math.floor(t / 3600);
        const m = Math.floor((t % 3600) / 60);
        rows.push([car, "GP1", L, `1:${(lt - 60).toFixed(3).padStart(6, "0")}`.replace(/^1:(\d)/, "1:$1"), `2026-02-28T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${(t % 60).toFixed(3).padStart(6, "0")}`, car === "6" && L === 7, L === 4 || L === 5 ? "YELLOW" : "GREEN"]);
      }
    }
    const pkg = buildFacts({ format: "speedhive", files: synthSpeedhive(rows, [["5", 1, "GP1", 1, "Normal"], ["6", 3, "GP1", 3, "Normal"], ["8", 2, "GP1", 2, "Normal"]]), options: { ...OPTS, rulebook: { pitCycleModel: "windows" }, raceDate: undefined } });
    expect(validatePackage(pkg).errors).toEqual([]);
    expect(pkg.metadata.raceDate).toBe("2026-02-28");
    expect(pkg.fcyPeriods.length).toBe(1);
    expect(pkg.fcyPeriods[0].source.kind).toBe("reconstructed");
    const p = pkg.events.pitPassages.find((x) => x.car === "6")!;
    expect([p.inLap, p.outLap, p.kind]).toEqual([7, 8, "stop"]);
    expect(pkg.entries.every((e) => e.result?.status === "classified")).toBe(true);
  });
});

describe("red flag: cars held in the pit lane", () => {
  const red = buildFacts({ format: "alkamel-imsa", files: synthImsa(redFlagRace()), options: OPTS });

  it("is schema-valid", () => {
    expect(validatePackage(red).errors).toEqual([]);
  });

  it("a visit inside the red flag is a red_flag_hold: no stop number, no time lost, no pit cycle", () => {
    for (const car of ["40", "41", "42"]) {
      const hold = red.events.pitPassages.find((p) => p.car === car && p.inLap === 10)!;
      expect(hold.kind).toBe("red_flag_hold");
      expect(hold.kindBasis).toEqual(["red_flag_period"]);
      expect(hold.stopNumber).toBeNull();
      expect(hold.timeLost).toMatchObject({ valueS: null, method: "none" });
      expect(hold.cycleId).toBeNull();
    }
    expect(red.pitCycles.flatMap((c) => c.members.map((m) => m.passageId))).not.toContain("pit:40:1");
  });

  it("stops either side of the hold keep their numbers", () => {
    const ps = red.events.pitPassages.filter((p) => p.car === "41");
    expect(ps.map((p) => [p.inLap, p.kind, p.stopNumber])).toEqual([
      [5, "stop", 1],
      [10, "red_flag_hold", null],
      [15, "stop", 2],
    ]);
  });

  it("the Drive Time row after the restart joins the held visit instead of becoming a drive-through", () => {
    expect(red.events.pitPassages.filter((p) => p.kind === "drive_through").map((p) => p.id)).toEqual(["pit:44:1"]);
    expect(red.events.pitPassages.filter((p) => p.car === "40")).toHaveLength(1);
    expect((pass(red, "pit:40:1").source.refs ?? []).some((r) => r.startsWith("f") && r.includes(":L"))).toBe(true);
  });

  it("a retirement's Drive Time rows split by the red flag are one visit", () => {
    const ps = red.events.pitPassages.filter((p) => p.car === "43");
    expect(ps.map((p) => p.kind)).toEqual(["retirement"]);
    expect(red.events.retirements.find((r) => r.car === "43")!.passageId).toBe(ps[0].id);
  });
});

describe("a car that stops twice in one pit cycle", () => {
  const f = buildFacts({ format: "alkamel-imsa", files: synthImsa(doubleStopRace()), options: OPTS });
  const cy = f.pitCycles.find((c) => c.members.some((m) => m.passageId === "pit:52:2"))!;

  it("is schema-valid", () => {
    expect(validatePackage(f).errors).toEqual([]);
  });

  it("counts the car once: nMembers is the number of cars", () => {
    expect(cy.members.map((m) => m.passageId)).toContain("pit:52:1");
    expect(cy.stats.nMembers).toBe(5);
  });

  it("gives the car one result, on its first stop, ranked by its stops' total time lost", () => {
    const rs = f.cycleResults.filter((r) => r.cycleId === cy.id);
    expect(rs.map((r) => r.car).sort()).toEqual(["50", "51", "52", "53", "54"]);
    expect(new Set(rs.map((r) => r.id)).size).toBe(rs.length);
    const r52 = rs.find((r) => r.car === "52")!;
    expect(r52.passageId).toBe("pit:52:1");
    expect(r52.confidenceNotes).toContain("several_stops_in_cycle");
    const total = pass(f, "pit:52:1").timeLost.valueS! + pass(f, "pit:52:2").timeLost.valueS!;
    expect(r52.timeLostRank).toBe(5);
    const others = rs.filter((r) => r.car !== "52").map((r) => pass(f, r.passageId).timeLost.valueS!);
    const mu = (others.reduce((a, b) => a + b, 0) + total) / 5;
    expect(r52.deltaToCycleMeanS).toBeCloseTo(total - mu, 2);
    expect(cy.stats.meanTimeLostS).toBeCloseTo(mu, 2);
  });
});

describe("green time lost above the official pit-lane time", () => {
  const race = doubleStopRace();
  race.cars = race.cars.filter((c) => c.car !== "52");
  race.cars[0] = { ...race.cars[0], extra: { 11: 45 } };
  const f = buildFacts({ format: "alkamel-imsa", files: synthImsa(race), options: OPTS });

  it("keeps the value, adds green_loss_exceeds_pit_lane and lowers confidence to medium", () => {
    const p = pass(f, "pit:50:1");
    expect(p.timeLost.valueS!).toBeGreaterThan(p.officialPitLaneTimeS! + 10);
    expect(p.confidenceNotes).toContain("green_loss_exceeds_pit_lane");
    expect(p.confidence).toBe("medium");
    const q = pass(f, "pit:51:1");
    expect(q.confidenceNotes ?? []).not.toContain("green_loss_exceeds_pit_lane");
  });
});

describe("penalty linking", () => {
  const opts = { ...OPTS, rulebook: { ...OPTS.rulebook!, serveWindowS: 300 } };
  const build = (dt61: number) => buildFacts({ format: "alkamel-imsa", files: synthImsa(penaltyRace(dt61)), options: opts });
  const pen = (f: RaceAnalysisPackage, id: string) => f.events.penalties.find((x) => x.id === id)!;
  const f = build(2062);

  it("is schema-valid", () => {
    expect(validatePackage(f).errors).toEqual([]);
  });

  it("counts the serve window in green-flag time: a caution doesn't use it up", () => {
    expect(pen(f, "pen:60:1").servedByPassageId).toBe("pit:60:1");
    expect(pass(f, "pit:60:1").kind).toBe("drive_through");
    expect(pass(f, "pit:60:1").kindBasis).toContain("rc_penalty_match");
  });

  it("links a drive-through served just before race control's message, at medium confidence", () => {
    const x = pen(f, "pen:61:1");
    expect(x.servedByPassageId).toBe("pit:61:1");
    expect(x.status).toBe("served");
    expect(x.confidence).toBe("medium");
    expect(x.confidenceNotes).toContain("served_before_message");
    expect(pass(f, "pit:61:1").confidenceNotes).toContain("served_before_message");
  });

  it("does not link a drive-through that came long before the message", () => {
    const g = build(5000);
    expect(pen(g, "pen:61:1").servedByPassageId).toBeNull();
    expect(pass(g, "pit:61:1").confidenceNotes).toContain("drive_through_by_duration");
  });

  it("serves a time penalty at the car's next stop, however long the stint", () => {
    expect(pen(f, "pen:62:1").servedByPassageId).toBe("pit:62:2");
  });

  it("reads a penalty message sent twice as one penalty", () => {
    const ps = f.events.penalties.filter((x) => x.car === "63");
    expect(ps).toHaveLength(1);
    expect(ps[0].source.refs).toHaveLength(2);
  });
});

describe("penalties without pit-lane times, and a post-race penalty printed twice", () => {
  const f = buildFacts({ format: "alkamel-imsa", files: synthImsa(noCardPenaltyRace()), options: OPTS });

  it("is schema-valid", () => {
    expect(validatePackage(f).errors).toEqual([]);
  });

  it("a pit-lane pass with no time card right after a drive-through penalty is that drive-through", () => {
    const p = f.events.pitPassages.find((x) => x.car === "70")!;
    expect(p.kind).toBe("drive_through");
    expect(p.confidenceNotes).toContain("drive_through_without_pit_time");
    expect(f.events.penalties.find((x) => x.car === "70")!.servedByPassageId).toBe(p.id);
    expect(f.pitCycles.flatMap((c) => c.members.map((m) => m.passageId))).not.toContain(p.id);
  });

  it("race control's post-race penalty and the results line for it are one penalty", () => {
    const ps = f.events.penalties.filter((x) => x.car === "71");
    expect(ps).toHaveLength(1);
    expect(ps[0].status).toBe("applied_post_race");
    expect(ps[0].source.refs!.length).toBe(2);
  });

  it("reads 'moved to the back of the field' and 'post race time penalty' lines from the results", () => {
    const back = f.events.penalties.find((x) => x.car === "72")!;
    expect(back).toMatchObject({ penaltyType: "position", status: "applied_post_race", amountS: null });
    expect(back.reason).toMatch(/^Moved to the back of the field/);
    expect(f.events.penalties.find((x) => x.car === "73")).toMatchObject({ penaltyType: "post_race_time", amountS: 5, status: "applied_post_race" });
  });
});

describe("serve windows: garage time and stop penalties announced after the car came in", () => {
  const opts = { ...OPTS, rulebook: { ...OPTS.rulebook!, serveWindowS: 600 } };
  const probe = buildFacts({ format: "alkamel-imsa", files: synthImsa(serveWindowRace(99999)), options: opts });
  const pin81 = probe.events.pitPassages.find((x) => x.car === "81")!.pitIn!.raceTimeS!;
  const f = buildFacts({ format: "alkamel-imsa", files: synthImsa(serveWindowRace(Math.round(pin81) + 2)), options: opts });
  const pen = (car: string) => f.events.penalties.find((x) => x.car === car)!;

  it("is schema-valid", () => {
    expect(validatePackage(f).errors).toEqual([]);
  });

  it("time the car spent in the garage does not use up the serve window", () => {
    expect(pen("80").servedByPassageId).toBe("pit:80:2");
  });

  it("a long stop that began just before race control's Stop + 60 message served it", () => {
    expect(pen("81").servedByPassageId).toBe("pit:81:1");
    expect(f.events.pitPassages.find((x) => x.id === "pit:81:1")!.kind).toBe("penalty_served");
    expect(pen("81").confidenceNotes).toContain("served_before_message");
  });

  it("a Stop + 60 is not served by a pass at transit speed", () => {
    const race = serveWindowRace(99999);
    race.cars[1] = { ...race.cars[1], stops: [{ lap: 13, pitLane: 34 }, { lap: 15, pitLane: 125 }] };
    race.rc = [[1150, "Car 81: Penalty - More than Emergency Service in closed pit - Stop + 60"]];
    const g = buildFacts({ format: "alkamel-imsa", files: synthImsa(race), options: opts });
    expect(g.events.penalties.find((x) => x.car === "81")!.servedByPassageId).not.toBe("pit:81:1");
  });
});
