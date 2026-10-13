/**
 * Unit tests per rule type on synthetic fact packages: boundaries, FCY interaction, driver-number keying,
 * severity capping, TBD handling.
 */
import { describe, expect, it } from "vitest";
import { runRuleChecks } from "../run-rule-checks.js";
import type { OverrideDef, RuleDef } from "../rulebook-types.js";
import { makePkg, makeRulebook, rule } from "./helpers.js";

const run = (rules: RuleDef[], pkg: ReturnType<typeof makePkg>, extra = {}) =>
  runRuleChecks(pkg, makeRulebook(rules, extra));
const ids = (r: ReturnType<typeof runRuleChecks>, ruleId: string) =>
  r.ruleFindings.filter((f) => f.ruleId === ruleId);

// ─── severity, citations, generic outcomes ─────────────────────────────────

describe("generic behaviour", () => {
  const minPit = (extra: Partial<RuleDef> = {}) =>
    rule(
      "t.pit.min",
      "min_pit_time",
      { value_s: 60, measure: "pit_lane_loop_to_loop", applies_to_stop: "any" },
      { severity: "likely", ...extra }
    );
  const pkg = makePkg({
    cars: { "7": { class: "GS" } },
    passages: [{ car: "7", pitIn: 1000, lane: 50, inLap: 10 }],
  });

  it("an unverified rule caps a finding at possible; a verified one allows likely", () => {
    expect(run([minPit()], pkg).ruleFindings[0]).toMatchObject({
      severity: "possible",
      severityNotes: ["rule_unverified"],
      verified: false,
    });
    expect(run([minPit({ verified: true })], pkg).ruleFindings[0]).toMatchObject({
      severity: "likely",
      verified: true,
    });
  });

  it("a rule carried from another season caps at possible", () => {
    expect(
      run([minPit({ verified: true, season_confirmed: false })], pkg).ruleFindings[0]
        .severity
    ).toBe("possible");
  });

  it("never exceeds the severity an override lowered the rule to", () => {
    const ev: OverrideDef = {
      rule: "t.pit.min",
      severity: "info",
      source: { doc: "DOC", section: "E", page: 1 },
      quote: "event says so",
      verified: true,
    };
    const r = runRuleChecks(
      pkg,
      makeRulebook([minPit({ verified: true })], {
        events: {
          e: {
            name: "E",
            track: "test-track",
            dates: ["2026-05-01", "2026-05-01"],
            sessions: [{ key: "race", date: "2026-05-01" }],
            overrides: [ev],
          },
        },
      })
    );
    expect(r.rulebook.eventKey).toBe("e");
    expect(r.ruleFindings[0].severity).toBe("info");
  });

  it("findings carry rule id, citation, car, lap, clock, evidence and no prose", () => {
    const f = run([minPit()], pkg).ruleFindings[0];
    expect(f).toMatchObject({
      id: "finding:1",
      ruleId: "t.pit.min",
      car: "7",
      class: "GS",
      lap: 10,
      clock: "2026-05-01T12:16:40.000-04:00",
      measured: 50,
      threshold: 60,
      marginS: -10,
      statement: null,
      citation: {
        doc: "DOC",
        section: "1.1",
        quote: "A short verbatim quote.",
        docTitle: "Test regulations",
        layer: "series",
      },
    });
    expect(f.evidence).toEqual([{ label: "passage", factId: "pit:7:1" }]);
  });

  it("a disabled rule, a format the rule cannot use, and TBD values are reported as not checkable", () => {
    const off: OverrideDef = {
      rule: "t.pit.min",
      disabled: true,
      source: { doc: "DOC", section: "C", page: 1 },
      quote: "not this class",
      verified: false,
    };
    const r1 = run([minPit()], pkg, { class_overrides: { GS: [off] } });
    expect(r1.notCheckable[0]).toMatchObject({ ruleId: "t.pit.min", reason: "disabled" });
    const r2 = run([minPit({ checkable_with: { alkamel_imsa: [] } })], pkg);
    expect(r2.notCheckable[0]).toMatchObject({ reason: "format_not_checkable" });
    const r3 = run(
      [
        rule(
          "t.pit.min",
          "min_pit_time",
          { value_s: "TBD", measure: "pit_lane_loop_to_loop" },
          {
            tbd: [{ field: "params.value_s", question: "Event bulletin value?" }],
          }
        ),
      ],
      pkg
    );
    expect(r3.notCheckable[0]).toMatchObject({
      reason: "tbd_value",
      detail: "params.value_s",
      tbd: [{ field: "params.value_s", question: "Event bulletin value?" }],
    });
    expect(r3.ruleFindings).toHaveLength(0);
  });

  it("a value set by a layer whose quote is TBD (document not obtained) is not used", () => {
    const ov: OverrideDef = {
      rule: "t.pit.min",
      params: { value_s: 70 },
      source: { doc: "DOC", section: "E", page: 1 },
      quote: "TBD",
      verified: false,
      tbd: [{ field: "quote", question: "fetch the bulletin" }],
    };
    const r = run([minPit()], pkg, { class_overrides: { GS: [ov] } });
    expect(r.notCheckable[0]).toMatchObject({
      reason: "unsourced_value",
      detail: "params.value_s",
    });
  });
});

// ─── minimum pit-lane time ─────────────────────────────────────────────────

describe("min_pit_time", () => {
  const r = rule(
    "t.pit.min",
    "min_pit_time",
    {
      value_s: 108,
      measure: "pit_lane_loop_to_loop",
      applies_to_stop: "mandatory",
      add_pending_time_penalties: true,
    },
    { severity: "possible" }
  );
  const pkg = makePkg({
    cars: {
      "1": { class: "GS" },
      "2": { class: "GS" },
      "3": { class: "GS" },
      "4": { class: "GS" },
      "5": { class: "GS" },
      "6": { class: "GS" },
    },
    passages: [
      { car: "1", pitIn: 1000, lane: 108.0, inLap: 10 }, // exactly the minimum: pass
      { car: "2", pitIn: 1000, lane: 107.7, inLap: 10 }, // inside the 0.5 s card tolerance: lowered to info
      { car: "3", pitIn: 1000, lane: 106.582, inLap: 10 }, // short: possible, penalised by race control
      { car: "4", pitIn: 1000, lane: 117.4, inLap: 10 }, // +10 s time penalty pending: short
      { car: "5", pitIn: 1000, lane: null, pitOut: null, inLap: 10 }, // no official time
      { car: "6", pitIn: 1000, lane: 63, kind: "drive_through", inLap: 10 }, // not a service stop
    ],
    penalties: [
      {
        car: "3",
        type: "post_race_time",
        issued: 1400,
        reason: "Short Pit Stop Time",
        amountS: 14.18,
      },
      { car: "4", type: "time_at_stop", issued: 500, amountS: 10, servedBy: 1 },
    ],
  });
  const res = run([r], pkg);

  it("boundaries, tolerance and pending time penalties", () => {
    const f = ids(res, "t.pit.min");
    expect(f.map((x) => [x.car, x.severity, x.marginS])).toEqual([
      ["2", "info", -0.3],
      ["3", "possible", -1.418],
      ["4", "possible", -0.6],
    ]);
    expect(f[0].severityNotes).toContain("within_measurement_tolerance");
    expect(f[2]).toMatchObject({
      threshold: 118,
      notes: ["pending_time_penalties_added"],
    });
    expect(f[2].evidence).toContainEqual({
      label: "pending_time_penalty",
      factId: "pen:4:1",
    });
  });

  it("links race-control penalties for the same matter", () => {
    const [, three] = ids(res, "t.pit.min");
    expect(three.raceControl).toEqual({ status: "penalised", penaltyIds: ["pen:3:1"] });
    expect(ids(res, "t.pit.min")[0].raceControl.status).toBe("none_found");
  });

  it("passages without an official pit-lane time are not evaluated", () => {
    expect(res.checksRun[0]).toMatchObject({ evaluated: 4, passed: 1, findings: 3 });
    expect(res.checksRun[0].notEvaluated).toEqual([
      { car: "5", factId: "pit:5:1", reason: "no_official_pit_lane_time" },
    ]);
  });

  it("a stationary-time minimum is not in timing data", () => {
    const st = rule("t.pit.min", "min_pit_time", { value_s: 30, measure: "stationary" });
    expect(run([st], pkg).notCheckable[0]).toMatchObject({
      reason: "data_missing",
      detail: "measure_stationary",
    });
  });

  it("WRL formats (no pit-lane times) are not checkable", () => {
    const wrl = makePkg({
      format: "speedhive",
      cars: { "1": { class: "GS" } },
      passages: [{ car: "1", inLap: 5, outLap: 6, lane: null }],
    });
    expect(run([r], wrl).notCheckable[0]).toMatchObject({
      reason: "data_missing",
      detail: "no_pit_lane_times_in_format",
    });
  });
});

// ─── pit window and earliest legal pit ─────────────────────────────────────

describe("pit_window and earliest_legal_pit markers", () => {
  const closed = rule(
    "t.fcy.closed",
    "fcy_pit_procedure",
    { pits_closed_on: "fcy_announcement" },
    { severity: "possible" }
  );
  const win = (p: Record<string, unknown> = {}) =>
    rule(
      "t.pit.window",
      "pit_window",
      {
        open: { by: "time", value: 600, from: "green_flag" },
        close: { by: "time", value: 1800, from: "green_flag" },
        applies_to_stop: "mandatory",
        boundary: "pit_in",
        fcy_effect: "none",
        ...p,
      },
      { severity: "possible" }
    );
  const laps = (n: number, lap = 100): [number, number][] =>
    Array.from({ length: n }, (_, i) => [i + 1, (i + 1) * lap]);
  const pkg = makePkg({
    cars: {
      A: { class: "GS", laps: laps(30) },
      B: { class: "GS", laps: laps(30) },
      C: { class: "TCR", laps: laps(30) },
    },
    passages: [
      { car: "A", pitIn: 700, lane: 100, inLap: 7 },
      { car: "B", pitIn: 500, lane: 100, inLap: 5 },
      { car: "C", pitIn: 2000, lane: 100, inLap: 20 },
    ],
    fcy: [{ start: 550, end: 900 }],
    flags: [{ type: "pits_open", at: 650, classes: [], message: "PITS ARE OPEN" }],
  });

  it("stops outside the window are findings; inside pass", () => {
    const res = run([win(), closed], pkg);
    const f = ids(res, "t.pit.window");
    expect(f.map((x) => [x.car, x.measured, x.marginS])).toEqual([
      ["B", 500, -100],
      ["C", 2000, 200],
    ]);
    expect(f[0].threshold).toEqual([600, 1800]);
  });

  it("earliest legal pit = window open AND pit lane open for the class (FCY closure until 650 s)", () => {
    const res = run([win(), closed], pkg);
    expect(res.ruleMarkers.map((m) => [m.car, m.raceTimeS, m.lap, m.kind])).toEqual([
      ["A", 650, 7, "earliest_legal_pit"],
      ["B", 650, 7, "earliest_legal_pit"],
      ["C", 650, 7, "earliest_legal_pit"],
    ]);
    expect(res.ruleMarkers[0].clock).toBe("2026-05-01T12:10:50.000-04:00");
    expect(res.ruleMarkers[1].findingId).toBe(ids(res, "t.pit.window")[0].id);
    expect(res.ruleMarkers[0].findingId).toBeNull();
  });

  it("without an FCY closure rule the marker is the window opening", () => {
    expect(run([win()], pkg).ruleMarkers[0].raceTimeS).toBe(600);
  });

  it("window by lap uses the in-lap", () => {
    const byLap = win({
      open: { by: "lap", value: 6, from: "green_flag" },
      close: { by: "lap", value: 18, from: "green_flag" },
    });
    const res = run([byLap], pkg);
    expect(ids(res, "t.pit.window").map((x) => [x.car, x.measured])).toEqual([
      ["B", 5],
      ["C", 20],
    ]);
    expect(res.ruleMarkers[0]).toMatchObject({ lap: 6, raceTimeS: 500 });
  });

  it("an unknown FCY effect lowers findings to info when an FCY overlaps the window", () => {
    const tbdWin = {
      ...win({ fcy_effect: "TBD" }),
      tbd: [{ field: "params.fcy_effect", question: "Does an FCY extend the window?" }],
    };
    const res = run([tbdWin], pkg);
    expect(ids(res, "t.pit.window").every((x) => x.severity === "info")).toBe(true);
  });

  it("TBD window values are not checkable and produce no markers", () => {
    const tbd = rule(
      "t.pit.window",
      "pit_window",
      {
        open: { by: "time", value: "TBD", from: "TBD" },
        close: { by: "time", value: "TBD", from: "TBD" },
        boundary: "TBD",
      },
      {
        tbd: [
          { field: "params.open.value", question: "open?" },
          { field: "params.open.from", question: "from?" },
          { field: "params.close.value", question: "close?" },
          { field: "params.close.from", question: "from?" },
          { field: "params.boundary", question: "in or out?" },
        ],
      }
    );
    const res = run([tbd], pkg);
    expect(res.notCheckable[0].reason).toBe("tbd_value");
    expect(res.ruleMarkers).toHaveLength(0);
  });
});

// ─── drive time ────────────────────────────────────────────────────────────

describe("min / max drive time per driver", () => {
  const min = rule("t.dt.min", "min_drive_time_per_driver", {
    value_s: 2400,
    measure: "track_time_excl_pit_lane",
    ends: "published_time_expiry",
    exempt_if_car_race_time_fraction_below: 0.9,
  });
  const max = rule("t.dt.max", "max_drive_time_per_driver", {
    value_s: 4800,
    measure: "track_time_excl_pit_lane",
    ends: "published_time_expiry",
  });

  it("keys drivers by number, never by name (two drivers with the same abbreviated name)", () => {
    // Both nominated drivers of #55 are 'A. Driver' (helpers); by name they would sum to 7,118.691 s > 4,800 s.
    const pkg = makePkg({
      durationS: 7200,
      cars: { "55": { class: "TCR" } },
      driveTimes: [
        { car: "55", driver: 1, s: 3825.142 },
        { car: "55", driver: 2, s: 3293.549 },
      ],
    });
    const res = run([max, min], pkg);
    expect(res.ruleFindings).toHaveLength(0);
    expect(res.checksRun.find((c) => c.ruleId === "t.dt.max")).toMatchObject({
      evaluated: 2,
      passed: 2,
    });
  });

  it("over the maximum by more than the tolerance; inside the tolerance is lowered", () => {
    const pkg = makePkg({
      durationS: 7200,
      cars: { "1": { class: "GS" }, "2": { class: "GS" } },
      driveTimes: [
        { car: "1", driver: 1, s: 4802 },
        { car: "1", driver: 2, s: 2398 },
        { car: "2", driver: 1, s: 4800.5 },
        { car: "2", driver: 2, s: 2399.5 },
      ],
    });
    const verified = { verified: true };
    const res = run(
      [
        { ...max, ...verified },
        { ...min, ...verified },
      ],
      pkg
    );
    expect(
      ids(res, "t.dt.max").map((f) => [f.car, f.severity, f.marginS, f.notes[0]])
    ).toEqual([
      ["1", "likely", 2, "driver_number_1"],
      ["2", "possible", 0.5, "driver_number_1"],
    ]);
    expect(ids(res, "t.dt.min").map((f) => [f.car, f.severity, f.marginS])).toEqual([
      ["1", "likely", -2],
      ["2", "possible", -0.5],
    ]);
    expect(ids(res, "t.dt.max")[0].evidence[0]).toEqual({
      label: "drive_time",
      factId: "drive:1:1",
    });
  });

  it("a car below 90 % of race time is exempt from the minimum (info), and a nominated driver who never drove counts 0", () => {
    const pkg = makePkg({
      durationS: 7200,
      cars: { "77": { class: "TCR" } },
      driveTimes: [{ car: "77", driver: 2, s: 3284.485 }],
    });
    const res = run([{ ...min, verified: true }], pkg);
    expect(res.ruleFindings).toHaveLength(1);
    expect(res.ruleFindings[0]).toMatchObject({
      car: "77",
      severity: "info",
      measured: 0,
      notes: [
        "driver_number_1",
        "driver_has_no_drive_time",
        "car_race_time_fraction_0.456",
      ],
    });
    expect(res.ruleFindings[0].severityNotes).toContain(
      "car_below_race_time_fraction_exempt"
    );
  });

  it("maximum by driver count", () => {
    const byCount = rule(
      "t.dt.max",
      "max_drive_time_per_driver",
      { value_s: "TBD", by_driver_count: { "3": 9600, "2": 12000 } },
      { tbd: [{ field: "params.value_s", question: "?" }] }
    );
    const pkg = makePkg({
      durationS: 14400,
      cars: {
        "2D": { class: "GS", drivers: [1, 2] },
        "3D": { class: "GS", drivers: [1, 2, 3] },
      },
      driveTimes: [
        { car: "2D", driver: 1, s: 10000 },
        { car: "2D", driver: 2, s: 4400 },
        { car: "3D", driver: 1, s: 10000 },
        { car: "3D", driver: 2, s: 2200 },
        { car: "3D", driver: 3, s: 2200 },
      ],
    });
    const f = run([byCount], pkg).ruleFindings;
    expect(f.map((x) => [x.car, x.threshold, x.marginS])).toEqual([["3D", 9600, 400]]);
  });

  it("no drive-time facts or a red flag make the rule not checkable", () => {
    const none = makePkg({ cars: { "1": { class: "GS" } } });
    expect(run([min], none).notCheckable[0]).toMatchObject({
      reason: "data_missing",
      detail: "no_drive_time_facts",
    });
    const red = makePkg({
      cars: { "1": { class: "GS" } },
      driveTimes: [{ car: "1", driver: 1, s: 100 }],
      fcy: [{ start: 100, end: 200, type: "red" }],
    });
    const withRed = rule("t.dt.min", "min_drive_time_per_driver", {
      value_s: 2400,
      red_flag_adjustment: { first_half: 0.5 },
    });
    expect(run([withRed], red).notCheckable[0]).toMatchObject({ reason: "data_missing" });
  });
});

// ─── maximum stint and minimum break ───────────────────────────────────────

describe("max_stint", () => {
  const maxStint = rule(
    "t.drive.max_stint",
    "max_stint",
    { per: "driver", value_s: 14400, fcy_extension_s: 0 },
    { severity: "possible", verified: true }
  );
  const minBreak = rule(
    "t.drive.min_break",
    "max_stint",
    { per: "driver", min_break_s: 3600 },
    { severity: "possible", verified: true }
  );

  it("Alkamel stints are exact (pit-in / pit-out times)", () => {
    const pkg = makePkg({
      cars: {
        "1": {
          class: "GS",
          laps: [
            [1, 100],
            [150, 14600],
          ],
        },
      },
      stints: [
        {
          car: "1",
          startLap: 1,
          endLap: 150,
          start: { raceTimeS: 0 },
          end: { raceTimeS: 14500 },
          startReason: "race_start",
          driver: 1,
        },
        {
          car: "1",
          startLap: 151,
          endLap: 160,
          start: { raceTimeS: 14600 },
          end: { raceTimeS: 15500 },
          endReason: "chequered",
          driver: 2,
        },
      ],
      passages: [{ car: "1", pitIn: 14500, lane: 100, inLap: 150, outLap: 151 }],
    });
    const f = run([maxStint], pkg).ruleFindings;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      car: "1",
      measured: 14500,
      measuredRange: null,
      marginS: 100,
      severity: "possible",
      lap: 150,
    });
  });

  describe("WRL lap-crossing bounds", () => {
    // in-lap and out-lap are 200 s each; lower = in-lap start - out-lap end; upper adds both boundary laps
    const wrl = (inLapEnd: number) =>
      makePkg({
        format: "wrl-website",
        classes: [{ id: "GP1", median: 150 }],
        cars: {
          "9": {
            class: "GP1",
            laps: [
              [10, 1000, 200],
              [80, inLapEnd, 200],
            ],
          },
        },
        stints: [
          {
            car: "9",
            startLap: 10,
            endLap: 80,
            startReason: "pit_out",
            endReason: "pit_in",
            driver: null,
            confidence: "medium",
          },
        ],
        passages: [{ car: "9", inLap: 80, outLap: 81 }],
      });

    it("lower bound over the limit: possible", () => {
      const f = run([maxStint], wrl(1000 + 14400 + 250)).ruleFindings[0];
      expect(f).toMatchObject({
        severity: "possible",
        measured: 14450,
        measuredRange: [14450, 14850],
        marginS: 50,
      });
      expect(f.notes).toContain("lap_crossing_bounds");
      expect(f.evidence.map((e) => e.factId)).toEqual([
        "stint:9:1",
        "pit:9:1",
        "lap:9:10",
        "lap:9:80",
      ]);
    });

    it("only the upper bound over the limit: info", () => {
      const f = run([maxStint], wrl(1000 + 14400 + 100)).ruleFindings[0];
      expect(f).toMatchObject({ severity: "info", measuredRange: [14300, 14700] });
      expect(f.severityNotes).toContain("only_upper_bound_exceeds");
    });

    it("boundary laps are capped at 2x the slowest class median lap", () => {
      const pkg = makePkg({
        format: "wrl-website",
        classes: [{ id: "GP1", median: 150 }],
        cars: {
          "9": {
            class: "GP1",
            laps: [
              [10, 3000, 2000],
              [80, 10000, 200],
            ],
          },
        },
        stints: [
          {
            car: "9",
            startLap: 10,
            endLap: 80,
            startReason: "pit_out",
            endReason: "pit_in",
            driver: null,
          },
        ],
      });
      const r = run([{ ...maxStint, params: { per: "car", value_s: 6000 } }], pkg)
        .ruleFindings[0];
      expect(r.measuredRange).toEqual([6800, 7300]); // out-lap 2000 s capped to 300 s
    });

    it("both bounds under the limit: pass", () => {
      const res = run([maxStint], wrl(1000 + 10000));
      expect(res.ruleFindings).toHaveLength(0);
      expect(res.checksRun[0]).toMatchObject({ evaluated: 1, passed: 1 });
    });
  });

  it("a driver staying in through a stop: run across stints; low-confidence driver data is info only", () => {
    const pkg = (conf: "medium" | "low") =>
      makePkg({
        format: "wrl-website",
        cars: {
          "5": {
            class: "GP1",
            laps: [
              [1, 100, 100],
              [40, 8000, 100],
              [41, 8300, 100],
              [80, 16000, 100],
            ],
          },
        },
        stints: [
          {
            car: "5",
            startLap: 1,
            endLap: 40,
            startReason: "race_start",
            endReason: "pit_in",
            driver: 1,
            confidence: conf,
          },
          {
            car: "5",
            startLap: 41,
            endLap: 80,
            startReason: "pit_out",
            endReason: "pit_in",
            driver: 1,
            confidence: conf,
          },
        ],
      });
    const ok = run([maxStint], pkg("medium")).ruleFindings;
    expect(
      ok.map((f) => [
        f.severity,
        f.measured,
        f.notes.includes("driver_run_across_service_stops"),
      ])
    ).toEqual([["possible", 15500, true]]);
    const low = run([maxStint], pkg("low")).ruleFindings;
    expect(low[0]).toMatchObject({ severity: "info" });
  });

  it("minimum break: reliable and both bounds short -> possible; only the lower bound short -> info", () => {
    const pkg = (backEnd: number) =>
      makePkg({
        format: "wrl-website",
        cars: {
          "8": {
            class: "GP1",
            laps: [
              [1, 100, 100],
              [20, 2000, 100],
              [21, 2200, 100],
              [30, 3000, 100],
              [31, 3200, 100],
              [40, backEnd - 1000, 100],
              [41, backEnd, 100],
              [60, backEnd + 2000, 100],
            ],
          },
        },
        stints: [
          { car: "8", startLap: 1, endLap: 20, startReason: "race_start", driver: 1 },
          { car: "8", startLap: 21, endLap: 40, driver: 2 },
          { car: "8", startLap: 41, endLap: 60, driver: 1, endReason: "chequered" },
        ],
      });
    // break: out-lap 41 start (backEnd - 100) - in-lap 20 end (2000) .. out-lap 41 end - in-lap 20 start (1900)
    const short = run([minBreak], pkg(5000)).ruleFindings;
    expect(short.map((f) => [f.severity, f.measuredRange])).toEqual([
      ["possible", [2900, 3100]],
    ]);
    const edge = run([minBreak], pkg(5650)).ruleFindings;
    expect(edge.map((f) => [f.severity, f.measuredRange])).toEqual([
      ["info", [3550, 3750]],
    ]);
    expect(run([minBreak], pkg(7000)).ruleFindings).toHaveLength(0);
  });

  it("minimum break needs driver data", () => {
    const pkg = makePkg({
      format: "wrl-website",
      cars: { "8": { class: "GP1", laps: [[1, 100]] } },
      stints: [{ car: "8", startLap: 1, endLap: 1, driver: null }],
    });
    expect(run([minBreak], pkg).notCheckable[0]).toMatchObject({
      reason: "data_missing",
      detail: "no_driver_per_stint",
    });
  });
});

// ─── FCY pit closure ───────────────────────────────────────────────────────

describe("pits closed under FCY", () => {
  const closed = rule(
    "t.fcy.closed",
    "fcy_pit_procedure",
    { pits_closed_on: "fcy_announcement", grace_s_for_committed_cars: 10 },
    { severity: "possible" }
  );
  const order = rule(
    "t.fcy.order",
    "fcy_pit_procedure",
    { opening_sequence: [{ classes: ["GS"] }, { classes: ["TCR"] }, { classes: "all" }] },
    { severity: "possible" }
  );
  const short = rule(
    "t.fcy.short",
    "fcy_pit_procedure",
    { short_fcy_if: ["RC 'SHORT YELLOW'"] },
    { severity: "possible" }
  );
  const noStd = rule(
    "t.fcy.nostd",
    "fcy_pit_procedure",
    { no_standard_fcy_within_s_of_start: 1800, no_standard_fcy_within_s_of_finish: 1800 },
    { severity: "info" }
  );
  const dc = rule(
    "mpc.fcy.driver_change_in_closed_pit",
    "fcy_pit_procedure",
    {},
    { severity: "possible" }
  );
  const imsaFlags = [
    { type: "pits_open" as const, at: 3260, classes: ["GS"], message: "PITS OPEN GS" },
    { type: "pits_open" as const, at: 3360, classes: ["TCR"], message: "PITS OPEN TCR" },
    { type: "pits_open" as const, at: 3460, classes: [], message: "PITS OPEN ALL CARS" },
    { type: "message" as const, at: 6810, message: "SHORT YELLOW" },
  ];
  const pkg = makePkg({
    durationS: 7200,
    chequeredS: 7255,
    cars: {
      G1: { class: "GS" },
      G2: { class: "GS" },
      G3: { class: "GS" },
      T1: { class: "TCR" },
      T2: { class: "TCR" },
      R: { class: "TCR" },
      X: { class: "GS" },
      Y: { class: "GS" },
    },
    fcy: [
      { start: 3000, end: 3700 },
      { start: 6800, end: null },
    ],
    flags: imsaFlags,
    passages: [
      { car: "G1", pitIn: 2990, lane: 60, inLap: 30 }, // before the FCY: pass
      { car: "G2", pitIn: 3005, lane: 60, inLap: 30, driverIn: 1, driverOut: 2 }, // closed, within grace, driver change
      { car: "G3", pitIn: 3270, lane: 60, inLap: 31 }, // GS lap: pass
      { car: "T1", pitIn: 3280, lane: 60, inLap: 31 }, // TCR on the GS-only lap
      { car: "T2", pitIn: 3370, lane: 60, inLap: 32 }, // TCR lap: pass
      { car: "X", pitIn: 3380, lane: 60, inLap: 32 }, // GS on the TCR-only lap
      { car: "R", pitIn: 3100, kind: "retirement", outcome: "retired", inLap: 30 }, // closed but retired: info
      { car: "Y", pitIn: 6900, lane: 60, inLap: 70 }, // Short FCY (last 30 min) before the end
      { car: "G1", pitIn: 7300, lane: 30, inLap: 76, outcome: "finished_in_pit_lane" }, // after the chequered flag: excluded
    ],
  });
  const res = run([closed, order, noStd, short, dc], pkg);

  it("pit entry while closed; retirement info; grace noted", () => {
    expect(
      ids(res, "t.fcy.closed").map((f) => [f.car, f.severity, f.measured, f.threshold])
    ).toEqual([
      ["R", "info", 3100, 3260], // car order: R before G2
      ["G2", "possible", 3005, 3260],
    ]);
    expect(ids(res, "t.fcy.closed")[1].notes).toContain(
      "within_grace_of_fcy_announcement"
    );
    expect(ids(res, "t.fcy.closed")[1].evidence.map((e) => e.factId)).toEqual([
      "pit:G2:1",
      "fcy:1",
      "flag:1",
    ]);
  });

  it("class opening order (GS lap, TCR lap)", () => {
    expect(ids(res, "t.fcy.order").map((f) => [f.car, f.threshold])).toEqual([
      ["X", 3460],
      ["T1", 3360],
    ]);
  });

  it("Short FCY in the last 30 minutes: closed until the restart; post-chequer entries excluded", () => {
    expect(
      ids(res, "t.fcy.short").map((f) => [f.car, f.notes.includes("closure_short")])
    ).toEqual([["Y", true]]);
    expect(res.checksRun.find((c) => c.ruleId === "t.fcy.nostd")!.notes).toContain(
      "fcy:2:standard_not_in_effect"
    );
    // the Short FCY entry is not double-reported by the core rule
    expect(ids(res, "t.fcy.closed").some((f) => f.car === "Y")).toBe(false);
  });

  it("driver change in a closed pit", () => {
    expect(
      ids(res, "mpc.fcy.driver_change_in_closed_pit").map((f) => [f.car, f.measured])
    ).toEqual([["G2", "driver 1 -> 2"]]);
  });

  it("Emergency Service: a closed-pit entry with no follow-up passage after the pits open for TCR", () => {
    const es = rule(
      "t.fcy.es",
      "fcy_pit_procedure",
      { obligation: "drive_through", obligation_met_if_in_pit_lane_leader_laps: 2 },
      { severity: "possible" }
    );
    const p = makePkg({
      durationS: 7200,
      chequeredS: 7255,
      cars: {
        L: {
          class: "GS",
          leader: true,
          laps: [
            [30, 2950],
            [31, 3100],
            [32, 3250],
            [33, 3750],
            [34, 3850],
            [35, 3950],
          ],
        },
        A: { class: "GS" },
        B: { class: "GS" },
        C: { class: "GS" },
      },
      fcy: [{ start: 3000, end: 3700 }],
      flags: imsaFlags.slice(0, 3),
      passages: [
        { car: "A", pitIn: 3010, lane: 40 }, // no follow-up: finding
        { car: "B", pitIn: 3010, lane: 40 },
        { car: "B", pitIn: 3500, lane: 35, kind: "drive_through" }, // follow-up after TCR open, before restart + 1 lap
        { car: "C", pitIn: 3010, lane: 300 }, // two leader laps in the pit lane (3100, 3250): obligation met
      ],
    });
    const f = run([closed, order, es], p);
    expect(ids(f, "t.fcy.es").map((x) => [x.car, x.measured, x.threshold])).toEqual([
      ["A", "no_follow_up_passage", 3850],
    ]);
    expect(f.checksRun.find((c) => c.ruleId === "t.fcy.es")).toMatchObject({
      evaluated: 3,
      passed: 2,
    });
  });

  it("no flags file (reconstructed FCY) -> not checkable", () => {
    const recon = makePkg({
      cars: { A: { class: "GS" } },
      fcy: [{ start: 100, end: 200, source: "reconstructed" }],
      passages: [{ car: "A", pitIn: 150, lane: 60 }],
    });
    expect(run([closed], recon).notCheckable[0]).toMatchObject({
      reason: "data_missing",
      detail: "fcy_periods_not_from_flags_file",
    });
  });

  it("pits_closed_on TBD: entries before the RC 'PITS ARE CLOSED' message are info, after it possible", () => {
    const tbd = rule(
      "t.fcy.closed",
      "fcy_pit_procedure",
      { pits_closed_on: "TBD" },
      { severity: "possible", tbd: [{ field: "params.pits_closed_on", question: "?" }] }
    );
    const p = makePkg({
      cars: { A: { class: "GS" }, B: { class: "GS" }, C: { class: "GS" } },
      fcy: [{ start: 1000, end: 1500 }],
      flags: [
        { type: "pits_closed", at: 1020, message: "PITS ARE CLOSED", classes: [] },
        { type: "pits_open", at: 1200, message: "PITS ARE OPEN", classes: [] },
      ],
      passages: [
        { car: "A", pitIn: 1010, lane: 100 },
        { car: "B", pitIn: 1100, lane: 100 },
        { car: "C", pitIn: 1250, lane: 100 },
      ],
    });
    expect(run([tbd], p).ruleFindings.map((f) => [f.car, f.severity])).toEqual([
      ["A", "info"],
      ["B", "possible"],
    ]);
  });

  it("WRL Code 35: TBD -> not checkable; pits closed -> FCY passages", () => {
    const c35 = (v: unknown) =>
      rule(
        "t.fcy.code35",
        "fcy_pit_procedure",
        { pits_open_under_code35: v },
        {
          severity: "possible",
          tbd:
            v === "TBD"
              ? [{ field: "params.pits_open_under_code35", question: "?" }]
              : [],
        }
      );
    const w = makePkg({
      format: "speedhive",
      cars: { A: { class: "GP1", laps: [[5, 500]] } },
      fcy: [{ start: 400, end: 600, source: "reconstructed" }],
      passages: [
        { car: "A", inLap: 5, fcyContext: "fcy" },
        { car: "A", inLap: 9, fcyContext: "green" },
      ],
    });
    expect(run([c35("TBD")], w).notCheckable[0]).toMatchObject({
      reason: "tbd_value",
      detail: "params.pits_open_under_code35",
    });
    expect(run([c35(true)], w).ruleFindings).toHaveLength(0);
    const f = run([c35(false)], w).ruleFindings;
    expect(f.map((x) => [x.car, x.lap, x.raceControl.status])).toEqual([
      ["A", 5, "not_available"],
    ]);
    expect(f[0].notes).toContain(
      "fcy_periods_reconstructed_boundaries_plus_minus_one_lap"
    );
  });
});

// ─── penalty served within N green crossings ───────────────────────────────

describe("penalty served within N green crossings", () => {
  const r = rule(
    "t.pen.serve",
    "penalty_service",
    { serve_under: "green", max_green_crossings: 4 },
    { severity: "possible" }
  );
  const laps = Array.from(
    { length: 20 },
    (_, i) => [i + 1, (i + 1) * 100] as [number, number]
  );
  const mk = (pitIn: number, fcy: { start: number; end: number | null }[] = []) =>
    makePkg({
      cars: { "66": { class: "GS", laps } },
      fcy,
      passages: [
        {
          car: "66",
          pitIn,
          lane: 35,
          kind: "drive_through",
          inLap: Math.ceil(pitIn / 100),
        },
      ],
      penalties: [{ car: "66", type: "drive_through", issued: 150, servedBy: 1 }],
    });

  it("4 green crossings pass; a 5th is a finding", () => {
    expect(run([r], mk(550)).ruleFindings).toHaveLength(0); // 200, 300, 400, 500
    const f = run([r], mk(650)).ruleFindings; // 200 .. 600
    expect(f.map((x) => [x.car, x.measured, x.threshold, x.severity])).toEqual([
      ["66", 5, 4, "possible"],
    ]);
    expect(
      f[0].evidence.filter((e) => e.label === "green_crossing").map((e) => e.factId)
    ).toEqual(["lap:66:2", "lap:66:3", "lap:66:4", "lap:66:5", "lap:66:6"]);
    expect(f[0].raceControl).toEqual({ status: "served", penaltyIds: ["pen:66:1"] });
  });

  it("crossings under FCY are not counted", () => {
    expect(run([r], mk(650, [{ start: 250, end: 450 }])).ruleFindings).toHaveLength(0); // green: 200, 500, 600
  });

  it("an unserved penalty is info, with its race-control status", () => {
    const pkg = makePkg({
      cars: { "18": { class: "GS", laps } },
      penalties: [
        { car: "18", type: "drive_through", issued: 1950, status: "converted_post_race" },
      ],
    });
    const f = run([r], pkg).ruleFindings;
    expect(f.map((x) => [x.car, x.severity, x.raceControl.status])).toEqual([
      ["18", "info", "converted_post_race"],
    ]);
  });

  it("warnings and time penalties are not drive-through style penalties", () => {
    const pkg = makePkg({
      cars: { "1": { class: "GS", laps } },
      penalties: [
        { car: "1", type: "warning", issued: 100 },
        { car: "1", type: "post_race_time", issued: 100, amountS: 5 },
      ],
    });
    expect(run([r], pkg).checksRun[0]).toMatchObject({ evaluated: 0, findings: 0 });
  });
});

// ─── classification ────────────────────────────────────────────────────────

describe("classification minimum distance", () => {
  const r = rule(
    "t.class.min",
    "classification",
    {
      min_fraction: { of: "class_leader", measure: "laps", value: 0.5 },
      results_source: "official_results_file",
    },
    { severity: "info" }
  );
  const pkg = makePkg({
    cars: {
      L: { class: "GP1", result: { laps: 200 } },
      A: { class: "GP1", result: { laps: 100 } }, // exactly 50 %: pass
      B: { class: "GP1", result: { laps: 99, status: "dnf" } },
      C: { class: "GP2", result: { laps: 60 } },
      D: { class: "GP2", result: { laps: 0, status: "dns" } },
      E: { class: "GP2", result: { laps: 150 } },
    },
  });
  it("below the fraction of the class leader's laps (results file, never lap counting)", () => {
    const res = run([r], pkg);
    expect(
      res.ruleFindings.map((f) => [f.car, f.measured, f.severity, f.notes[0]])
    ).toEqual([
      ["B", 0.495, "info", "results_status_dnf"],
      ["C", 0.4, "info", "results_status_classified"],
    ]);
    expect(res.ruleFindings[1].notes).toContain(
      "listed_classified_below_minimum_distance"
    );
    expect(res.ruleFindings[1].evidence).toEqual([
      { label: "result", factId: "result:C" },
      { label: "leader_result", factId: "result:E" },
    ]);
    expect(res.checksRun[0].notEvaluated).toEqual([
      { car: "D", factId: "result:D", reason: "did_not_start" },
    ]);
  });

  it("TBD minimum -> not checkable", () => {
    const tbd = rule(
      "t.class.min",
      "classification",
      { min_fraction: "TBD" },
      {
        severity: "info",
        tbd: [{ field: "params.min_fraction", question: "minimum distance?" }],
      }
    );
    expect(run([tbd], pkg).notCheckable[0]).toMatchObject({
      reason: "tbd_value",
      tbd: [{ question: "minimum distance?" }],
    });
  });
});
