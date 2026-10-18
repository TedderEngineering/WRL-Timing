/**
 * RedMist adapter and passages on a synthetic race (redmist-synth.ts): every mapping the adapter does
 * (time axis, flags, lap pit flags, pit report, results, control log) and the pit-passage rules.
 */
import { describe, expect, it } from "vitest";
import { buildFacts } from "../buildFacts.js";
import { adaptRedmist, parseUtcLabel, renumberedVisitS, rmLineFlag } from "../adapters/redmist.js";
import { detectRole } from "../adapters/index.js";
import { buildLaps, type LapRow } from "../engine/context.js";
import { penaltyType, redmistFlagVisits } from "../engine/passages.js";
import { validatePackage } from "../validate-package.js";
import type { BuildOptions, SourceFileInfo } from "../types.js";
import { crossing, RM_CAR1_ENTRY, RM_CAR1_PIT, RM_CARS, RM_GARAGE_EXTRA_S, redmistFiles } from "./redmist-synth.js";

const OPTS: BuildOptions = {
  series: "World Racing League",
  event: "Synthetic Raceway",
  session: "Saturday 8 Hour",
  track: { id: "synthetic", name: "Synthetic Raceway", timezone: "America/Chicago" },
  rulebook: { id: "wrl-2026", version: "0.1.0", pitCycleModel: "windows" },
  generatedAt: "2026-10-14T00:00:00Z",
};

const withIds = (pits = true): SourceFileInfo[] => redmistFiles({ pits }).map((f, i) => ({ ...f, fileId: `f${i + 1}` }));
const build = (pits = true) => buildFacts({ format: "redmist", files: redmistFiles({ pits }), options: OPTS });
const codes = (pkg: ReturnType<typeof build>) => pkg.dataQuality.map((d) => d.code);

describe("RedMist helpers", () => {
  it("detectRole maps the five RedMist exports", () => {
    expect(detectRole("redmist_405_3_laps.json")).toBe("laps");
    expect(detectRole("405_3_pits.json")).toBe("pit_cards_json");
    expect(detectRole("redmist_405_3_results.json")).toBe("results");
    expect(detectRole("redmist_405_3_flags.json")).toBe("flags");
    expect(detectRole("redmist_405_3_control.json")).toBe("control_log");
    // existing names unchanged
    expect(detectRole("x_all_laps.csv")).toBe("laps");
    expect(detectRole("20_Pit Stops Time Cards_Race.JSON")).toBe("pit_cards_json");
  });

  it("maps the RedMist Flags enum to the line flag", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 12].map(rmLineFlag)).toEqual([null, "G", "Y", "R", "G", "C", null, "Y", "Y", null]);
  });

  it("parses the track time-zone label", () => {
    expect(parseUtcLabel("UTC-06:00")).toBe(-360);
    expect(parseUtcLabel("UTC+05:30")).toBe(330);
    expect(parseUtcLabel("UTC")).toBe(0);
    expect(parseUtcLabel("nonsense")).toBeNull();
  });

  it("estimates a renumbered stop from the first to the last entry time plus the final duration", () => {
    const laps = [
      { llp: 74, pet: "0001-04-11T17:39:58Z", pdm: 6000 },
      { llp: 75, pet: "0001-04-11T17:41:23Z", pdm: 10000 },
    ];
    expect(renumberedVisitS(laps)).toBe(95);
    expect(renumberedVisitS(laps.slice(0, 1))).toBeNull();
  });

  it("lap pit flags: visits open on the first flagged lap and close at the first crossing on track", () => {
    const mk = (flags: [boolean, boolean][]): LapRow[] =>
      flags.map(([lip, ip], i) => ({ idx: i, lap: i + 1, inPit: lip, crossedInPit: ip }) as unknown as LapRow);
    // lap-1 staging ignored; 3 (in pit at the line) -> 4; 6..8 (in pit at 6 and 7) -> 8; a lone flag on
    // lap 10 with both crossings on track landed a lap late -> 9-10; 12 in the pit at the last crossing -> no rejoin
    const rows = mk([[true, false], [false, false], [true, true], [true, false], [false, false], [true, true], [false, true], [true, false], [false, false], [true, false], [false, false], [true, true]]);
    const v = redmistFlagVisits(rows);
    expect(v.map((x) => [rows[x.i0].lap, x.i1 === null ? null : rows[x.i1].lap])).toEqual([
      [3, 4],
      [6, 8],
      [9, 10],
      [12, null],
    ]);
    expect(v.map((x) => !!x.lateFlag)).toEqual([false, false, true, false]);
    // a lone flag right after an out-lap cannot move back: the next row is its out-lap (as Speedhive)
    const after = mk([[false, false], [true, true], [true, false], [true, false], [false, false]]);
    expect(redmistFlagVisits(after).map((x) => [x.i0 + 1, x.i1! + 1])).toEqual([
      [2, 3],
      [4, 5],
    ]);
    // back-to-back visits inside one flagged run (car 25 at West Desert): split at each crossing on track
    const run = mk([[true, true], [true, false], [true, true], [true, false]]);
    expect(redmistFlagVisits(run).map((v) => [v.i0 + 1, v.i1! + 1])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("RedMist pit flags stuck on after the car rejoined", () => {
  it("ends the visit at the out-lap and ignores flags on later laps at racing pace", () => {
    // Laps 1-3 racing (152 s); 4 in-lap (in pit at the line); 5 out-lap with the stop (270 s);
    // 6-9 racing but still flagged; 10 in-lap again, 11 out-lap (217 s), 12-13 racing, flagged.
    const t = [152, 151, 153, 162, 270, 153, 152, 151, 152, 163, 217, 153, 152];
    const flagged = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const rows = t.map((v, i) => ({ idx: i, lap: i + 1, lapTimeS: v, inPit: flagged.has(i + 1), crossedInPit: flagged.has(i + 1) }) as unknown as LapRow);
    const v = redmistFlagVisits(rows);
    expect(v.map((x) => [rows[x.i0].lap, x.i1 === null ? null : rows[x.i1].lap])).toEqual([
      [4, 5],
      [10, 11],
    ]);
    expect(v.every((x) => x.stuckFlags)).toBe(true);
  });

  it("keeps a real multi-lap stay in the pit lane (slow laps)", () => {
    const t = [152, 151, 160, 400, 380, 260, 152];
    const flagged = new Set([3, 4, 5]);
    const rows = t.map((v, i) => ({ idx: i, lap: i + 1, lapTimeS: v, inPit: flagged.has(i + 1), crossedInPit: flagged.has(i + 1) }) as unknown as LapRow);
    expect(redmistFlagVisits(rows).map((x) => [rows[x.i0].lap, x.i1 === null ? null : rows[x.i1].lap])).toEqual([[3, 6]]);
  });
});

describe("RedMist pit report stop with the pit flags stuck on", () => {
  it("ends the stop at its out-lap, not where the stuck flags end", () => {
    const pkg = buildFacts({ format: "redmist", files: redmistFiles({ stuckFlags: true }), options: OPTS });
    const p = pkg.events.pitPassages.find((e: any) => e.car === "2" && e.inLap === 12) as any;
    expect(p.outLap).toBe(13);
    expect(pkg.events.pitPassages.filter((e: any) => e.car === "2" && e.kind !== "pit_lane_start")).toHaveLength(1);
    expect(validatePackage(pkg as any, { stage: "facts" }).errors).toEqual([]);
  });
});

describe("RedMist pit report rows that are not stops", () => {
  it("drops a row with no lap pit flag and a few seconds in the pit lane, and says so", () => {
    const pkg = buildFacts({ format: "redmist", files: redmistFiles({ phantom: true }), options: OPTS });
    expect(pkg.events.pitPassages.filter((e: any) => e.car === "1").map((e: any) => e.inLap)).toEqual([6]);
    expect(pkg.dataQuality.some((q: any) => q.code === "PIT-REPORT-PHANTOM" && /1 L15/.test(q.message))).toBe(true);
    expect(validatePackage(pkg as any, { stage: "facts" }).errors).toEqual([]);
  });
});

describe("RedMist adapter", () => {
  const { race, issues } = adaptRedmist(withIds());

  it("puts crossings on the track-local clock: session start + total race time", () => {
    expect(race.format).toBe("redmist");
    expect(race.timeBase).toBe("clock");
    expect(race.session.utcOffsetCandidates[0].offsetMinutes).toBe(-300);
    expect(race.session.dateCandidates[0].date).toBe("2026-05-02");
    const l1 = race.laps["1"][0];
    expect(l1.tS).toBeCloseTo(9 * 3600 + crossing(RM_CARS[0], 1), 6);
    expect(l1.lapTimeS).toBe(100);
    expect(race.laps["1"][5]).toMatchObject({ lap: 6, inPit: true, crossedInPit: true, lapTimeS: 125, flag: "G", driverName: "Ann Able" });
    expect(race.laps["1"][6]).toMatchObject({ lap: 7, inPit: true, crossedInPit: false, driverName: "Bob Baker", driverNumber: 2 });
    expect(race.laps["2"][11].flag).toBe("Y");
    expect(issues.find((x) => x.code === "REDMIST-SESSION-START")?.message).toContain("09:00:00");
  });

  it("reads the pit report: clocks when the equipment clock was set, else the duration only", () => {
    const [c1, c2, c4, c5] = race.pitRecords;
    expect(c1).toMatchObject({ car: "1", source: "pit_json", inLap: 6, outLap: 7, pitTimeS: RM_CAR1_PIT, inDriver: "Ann Able", outDriver: "Bob Baker", timePrecision: "ms" });
    expect(c1.inClockS).toBeCloseTo(9 * 3600 + RM_CAR1_ENTRY, 6);
    expect(c1.outClockS).toBeCloseTo(9 * 3600 + RM_CAR1_ENTRY + RM_CAR1_PIT, 6);
    expect(c2).toMatchObject({ car: "2", inClockS: null, outClockS: null, pitTimeS: 88, timePrecision: "s", entryUnavailable: true });
    expect(c4).toMatchObject({ car: "4", inLap: 10, outLap: 10 });
    expect(c5).toMatchObject({ car: "5", inLap: 1, pitTimeS: 1500 });
  });

  it("flags: race records from the first green, pre-race and sub-10-s green blips dropped", () => {
    expect(race.flagRecords.map((r) => [r.recType, r.tS - 9 * 3600])).toEqual([
      ["GF", 10],
      ["FCY", 1201],
      ["FCY", 1506],
      ["GF", 1621],
      ["FF", 2040],
    ]);
    expect(issues.map((x) => x.code)).toEqual(expect.arrayContaining(["REDMIST-PRE-RACE-FLAGS", "REDMIST-FLAG-BLIP"]));
  });

  it("control log: penalty lines for the responsible car, notes for the rest, duplicates and impossible times handled", () => {
    const t = race.raceControl.map((m) => m.text);
    expect(t).toContain("Car 4: Penalty - CONTACT (turn 4) - 1 LAP");
    expect(t).toContain("Car 3: Penalty - PIT LANE/FUELING INFRACTION (PR) - WARNING");
    expect(t).toContain("#1 / #2: CONTACT (turn 7) - NO ACTION NEEDED, FINAL");
    expect(t).toContain("FULL COURSE CAUTION");
    expect(t.filter((x) => x.startsWith("Car 4:"))).toHaveLength(1);
    expect(race.raceControl.find((m) => m.text.startsWith("#2 / #5"))?.tS).toBeNull();
    expect(issues.map((x) => x.code)).toEqual(expect.arrayContaining(["REDMIST-CONTROL-DUPLICATES", "REDMIST-CONTROL-TIME", "REDMIST-CONTROL-MINUTES"]));
  });

  it("entries and results: team and class from the event entries, drivers from the lap RFID names, results unofficial", () => {
    expect(race.entries.map((e) => [e.car, e.className, e.team])).toEqual(RM_CARS.map((c) => [c.car, c.cls, c.team]));
    expect(race.entries[0].drivers.map((d) => d.name)).toEqual(["Ann Able", "Bob Baker"]);
    expect(race.entries[0].vehicle).toBeNull();
    expect(race.results?.mark).toBe("unofficial");
    expect(race.results?.rows[0]).toMatchObject({ car: "1", position: 1, positionClass: 1, laps: 20, bestLapS: 100, bestLapNumber: 2, totalTimeS: null });
  });

  it("drops lap driver names without a driver source when they appear on several cars", () => {
    const files = withIds();
    const doc = JSON.parse(files[0].text!);
    for (const l of doc.laps) {
      delete l.ds;
      if (l.n === "2" && l.llp === 3) l.dn = "Ann Able";
    }
    files[0] = { ...files[0], text: JSON.stringify(doc) };
    const r = adaptRedmist(files);
    expect(r.race.laps["1"][0].driverName).toBeNull();
    expect(r.issues.map((x) => x.code)).toContain("REDMIST-DRIVER-NAMES-UNUSED");
  });

  it("requires the laps file", () => {
    expect(() => adaptRedmist(withIds().slice(1))).toThrow(/ADAPTER-REQUIRED-FILE-MISSING/);
  });

  it("without a results file the start is estimated from the first green and the earliest lap-1 start", () => {
    const r = adaptRedmist(withIds().filter((f) => f.role !== "results"));
    expect(r.issues.map((x) => x.code)).toContain("REDMIST-START-ESTIMATED");
    // first green 09:00:10 less the earliest lap-1 start on the race clock (10 s) = 09:00:00
    expect(r.race.laps["1"][0].tS).toBeCloseTo(9 * 3600 + crossing(RM_CARS[0], 1), 6);
  });
});

describe("RedMist pit passages (with the Flagtronics pit report)", () => {
  const pkg = build();
  const pp = (id: string) => pkg.events.pitPassages.find((p) => p.id === id)!;

  it("validates (V1-V8) and labels results unofficial", () => {
    expect(validatePackage(pkg, { publish: false }).errors).toEqual([]);
    expect(pkg.metadata.sourceFormat).toBe("redmist");
    expect(pkg.metadata.resultsStatus).toBe("unofficial");
    expect(pkg.entries.every((e) => e.result?.resultsStatus === "unofficial")).toBe(true);
  });

  it("Flagtronics stop with clocks: pit-in/out, official pit-lane time, in/out laps, driver change, green time lost", () => {
    const p = pp("pit:1:1");
    expect(p).toMatchObject({ kind: "stop", inLap: 6, outLap: 7, officialPitLaneTimeS: 95.123, pitLaneTimeReliable: true, fcyContext: "green", driverIn: 1, driverOut: 2, driverChange: true });
    expect(p.source.kind).toBe("official");
    expect(p.pitIn?.clock).toBe("2026-05-02T09:09:40.000-05:00");
    expect(p.pitOut?.clock).toBe("2026-05-02T09:11:15.123-05:00");
    expect(p.timeLost).toMatchObject({ method: "green_reference", valueS: 90, nLaps: 2, refLapS: 100 });
    expect(pkg.laps.cars["1"].pit.slice(5, 7)).toEqual([1, 2]);
  });

  it("duration-only stop: whole-second pit-lane time, no pit-in/out, FCY time lost from neighbours", () => {
    const p = pp("pit:2:1");
    expect(p).toMatchObject({ inLap: 12, outLap: 13, officialPitLaneTimeS: 88, pitIn: null, pitOut: null, fcyContext: "fcy" });
    expect(p.timeLost.method).toBe("fcy_neighbours");
    expect(p.timeLost.valueS).toBe(90);
    expect(p.notes?.join(" ")).toMatch(/whole seconds/);
  });

  it("a pit visit only in the lap flags becomes a passage without a pit-lane time", () => {
    const p = pp("pit:3:1");
    expect(p).toMatchObject({ inLap: 15, outLap: 16, officialPitLaneTimeS: null, pitIn: null });
    expect(p.source.kind).toBe("derived");
    expect(p.confidenceNotes).toContain("not_in_pit_report");
    expect(codes(pkg)).toContain("PASSAGE-NOT-IN-PIT-REPORT");
  });

  it("a report stop is re-anchored when the car was already in the pit lane at the previous crossing", () => {
    const p = pp("pit:4:1");
    expect(p).toMatchObject({ inLap: 9, outLap: 10, officialPitLaneTimeS: 70 });
    expect(p.confidenceNotes).toContain("pit_report_laps_corrected");
    expect(p.timeLost.valueS).toBe(90);
    expect(codes(pkg)).toContain("PIT-REPORT-LAPS-CORRECTED");
  });

  it("a lap-1 report stop with the lap-1 crossing on track is a pit-lane start, not a 1500-s stop", () => {
    const p = pp("pit:5:1");
    expect(p).toMatchObject({ kind: "pit_lane_start", inLap: 1, officialPitLaneTimeS: null, stopNumber: null });
    expect(p.timeLost.method).toBe("none");
  });

  it("FCY from the flags file (rank 1), penalties from the control log", () => {
    expect(pkg.fcyPeriods).toHaveLength(1);
    expect(pkg.fcyPeriods[0]).toMatchObject({ type: "fcy", start: { raceTimeS: 1191 }, end: { raceTimeS: 1611 } });
    expect(pkg.fcyPeriods[0].source.kind).toBe("official");
    expect(pkg.events.penalties.map((x) => [x.car, x.penaltyType, x.status])).toEqual([
      ["3", "warning", "warning_only"],
      ["4", "lap", "issued"],
    ]);
  });

  it("stints break at pit-in / pit-out when the clocks are known", () => {
    const s = pkg.stints.filter((x) => x.car === "1");
    expect(s.map((x) => [x.driver, x.startLap, x.endLap, x.endReason])).toEqual([
      [1, 1, 6, "pit_in"],
      [2, 7, 20, "chequered"],
    ]);
    expect(s[0].end.clock).toBe("2026-05-02T09:09:40.000-05:00");
    expect(s[1].start.clock).toBe("2026-05-02T09:11:15.123-05:00");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(build())).toEqual(JSON.stringify(pkg));
  });
});

describe("penalty types", () => {
  it("a black flag calls the car in; only the word disqualification is a disqualification", () => {
    expect(penaltyType("TEAM REQUEST BLACK FLAG").type).toBe("other");
    expect(penaltyType("BLACK FLAG").type).toBe("other");
    expect(penaltyType("Disqualified").type).toBe("disqualification");
    expect(penaltyType("DSQ").type).toBe("disqualification");
    expect(penaltyType("DRIVE THROUGH").type).toBe("drive_through");
  });
});

describe("RedMist repairs behind the wall (pit report times the pit lane only)", () => {
  const pkg = buildFacts({ format: "redmist", files: redmistFiles({ garage: true }), options: OPTS });
  const p3 = pkg.events.pitPassages.find((e: any) => e.car === "3" && e.inLap === 15) as any;

  it("a visit whose time lost is over the garage threshold is a garage visit, not a stop", () => {
    expect(p3).toBeTruthy();
    expect(p3.officialPitLaneTimeS).toBeLessThan(600);
    expect(p3.timeLost.valueS).toBeGreaterThan(RM_GARAGE_EXTRA_S);
    expect(p3.kind).toBe("garage");
    expect(p3.kindBasis).toEqual(["garage_threshold"]);
    expect(p3.notes.some((n: string) => n.startsWith("garage_by_time_lost"))).toBe(true);
    expect(p3.stopNumber).toBe(1);
  });

  it("joins no pit cycle, and the package still validates", () => {
    expect(p3.cycleId).toBeNull();
    expect(pkg.pitCycles.some((c: any) => c.members.some((m: any) => m.passageId === p3.id))).toBe(false);
    expect(validatePackage(pkg as any, { stage: "facts" }).errors).toEqual([]);
  });

  it("leaves ordinary stops alone", () => {
    const p1 = pkg.events.pitPassages.find((e: any) => e.car === "1" && e.inLap === 6) as any;
    expect(p1.kind).toBe("stop");
  });
});

describe("RedMist pit passages without a pit report (lap flags only, as Speedhive)", () => {
  const pkg = build(false);

  it("passages from the lap pit flags, no pit-lane times, same in/out laps", () => {
    expect(validatePackage(pkg, { publish: false }).errors).toEqual([]);
    expect(pkg.events.pitPassages.map((p) => [p.car, p.inLap, p.outLap, p.officialPitLaneTimeS, p.pitIn])).toEqual([
      ["1", 6, 7, null, null],
      ["2", 12, 13, null, null],
      ["3", 15, 16, null, null],
      ["4", 9, 10, null, null],
    ]);
    expect(pkg.events.pitPassages.every((p) => p.source.kind === "derived")).toBe(true);
    expect(pkg.events.pitPassages.map((p) => p.timeLost.valueS)).toEqual([90, 90, 90, 90]);
    expect(codes(pkg)).toEqual(expect.arrayContaining(["REDMIST-NO-PIT-REPORT", "REDMIST-LAP1-PIT-FLAG"]));
    expect(pkg.events.pitPassages[0]).toMatchObject({ driverIn: 1, driverOut: 2, driverChange: true });
  });

  it("stints break at the in-lap end (no pit clocks)", () => {
    const s = pkg.stints.filter((x) => x.car === "1");
    expect(s.map((x) => [x.startLap, x.endLap])).toEqual([
      [1, 6],
      [7, 20],
    ]);
    expect(s[0].confidenceNotes).toContain("wrl_boundaries_no_pit_times");
  });
});

describe("RedMist race without time-of-day sources", () => {
  it("falls back to the race clock (elapsed axis) and says so", () => {
    const files = redmistFiles().filter((f) => f.role === "laps");
    const pkg = buildFacts({ format: "redmist", files, options: { ...OPTS, raceDate: "2026-05-02" } });
    expect(codes(pkg)).toEqual(expect.arrayContaining(["REDMIST-START-UNKNOWN", "RESULTS-MISSING"]));
    expect(pkg.events.pitPassages.map((p) => p.inLap)).toEqual([6, 12, 15, 9]);
  });
});
