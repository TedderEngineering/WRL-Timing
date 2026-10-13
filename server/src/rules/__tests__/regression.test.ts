/**
 * Regression against the Stage 2 rulebook dry runs (stage2/rules/dryrun/out, RULES_CHECKABILITY.md §0, §5),
 * expressed as schema 1.1.0 rule checks (one per rule and subject, passes included) and rule coverage.
 * Fixtures are small fact-package subsets derived from those outputs (see each fixture's `_fixture` note);
 * no raw timing file is in the repo.
 */
import { describe, expect, it } from "vitest";
import { selectRulebook, validateRulebook } from "../load-rulebook.js";
import { runRuleChecks } from "../run-rule-checks.js";
import { stintBounds } from "../checks/max-stint.js";
import { RaceCtx } from "../checks/context.js";
import type { Rulebook } from "../rulebook-types.js";
import { loadFixture } from "./helpers.js";

type Res = ReturnType<typeof runRuleChecks>;
/** Non-pass checks whose ceiling allows more than info: the dry runs' "possible or likely" findings. */
const aboveInfo = (r: Res) =>
  r.ruleChecks.filter((c) => c.status !== "pass" && c.severityCeiling !== "info");
const checksOf = (r: Res, id: string) => r.ruleChecks.filter((c) => c.ruleKey === id);
/** Non-pass checks of a rule (fail / unknown / not_applicable). */
const byRule = (r: Res, id: string) => checksOf(r, id).filter((c) => c.status !== "pass");
const nc = (r: Res, id: string) => r.ruleCoverage.notCheckable.find((n) => n.ruleId === id);
const run = (r: Res, id: string) => r.ruleCoverage.run.find((c) => c.ruleId === id);
const statuses = (r: Res, id: string) => {
  const out: Record<string, number> = {};
  for (const c of checksOf(r, id)) out[c.status] = (out[c.status] ?? 0) + 1;
  return out;
};

describe("IMSA MPC Road Atlanta 2026 (dry run: no possible or likely findings; info items are checks)", () => {
  const res = runRuleChecks(
    loadFixture("mpc-road-atlanta-2026.facts.json"),
    selectRulebook("imsa-mpc", 2026)!
  );

  it("selects the Road Atlanta event layer and session", () => {
    expect(res.rulebook).toMatchObject({
      id: "imsa-mpc-2026",
      eventKey: "road-atlanta-2026-10",
      sessionKey: "race",
      verifiedRuleCount: 0,
    });
    expect(res.ruleCoverage).toMatchObject({
      rulebookId: "imsa-mpc-2026",
      rulebookHash: res.rulebook.sha256,
      event: "road-atlanta-2026-10",
      session: "race",
    });
  });

  it("no check whose ceiling is above info", () => {
    expect(aboveInfo(res)).toEqual([]);
    expect(res.ruleChecks.every((c) => c.verified === false)).toBe(true);
  });

  it("drive time: 90 drivers by number, 0 over 80 min, under 40 min only on the 5 retired cars (not applicable, info)", () => {
    expect(run(res, "mpc.drive_time.max_per_driver")).toMatchObject({ checks: 90 });
    expect(statuses(res, "mpc.drive_time.max_per_driver")).toEqual({ pass: 90 });
    expect(run(res, "mpc.drive_time.min_per_driver")).toMatchObject({ checks: 90 });
    expect(statuses(res, "mpc.drive_time.min_per_driver")).toEqual({
      pass: 85,
      not_applicable: 5,
    });
    const min = byRule(res, "mpc.drive_time.min_per_driver");
    expect(min.map((f) => [f.car, f.status, f.severityCeiling, f.measured, f.notes![0]])).toEqual([
      ["23", "not_applicable", "info", 2091.676, "driver_number_1"],
      ["52", "not_applicable", "info", 1842.403, "driver_number_2"],
      ["53", "not_applicable", "info", 1555.249, "driver_number_1"],
      ["57", "not_applicable", "info", 867.727, "driver_number_2"],
      ["77", "not_applicable", "info", 100.04, "driver_number_1"],
    ]);
    expect(
      min.every((f) => f.severityNotes!.includes("car_below_race_time_fraction_exempt"))
    ).toBe(true);
    expect(min[0].rulebookRef).toMatchObject({
      field: "rules[mpc.drive_time.min_per_driver].params.value_s",
      doc: "SR-MPLM-2026-OFF",
      eventOverride: "road-atlanta-2026-10",
      quote: "12.13 - Minimum Drive-Time: Forty (40) minutes",
    });
  });

  it("#55's two drivers (same abbreviated name in the Drive Time CSV) are not summed", () => {
    expect(
      checksOf(res, "mpc.drive_time.max_per_driver")
        .filter((f) => f.car === "55")
        .map((f) => [f.status, f.notes])
    ).toEqual([
      ["pass", ["driver_number_1"]],
      ["pass", ["driver_number_2"]],
    ]);
  });

  it("no pit entry while closed (#19 before FCY 1; #12 after the chequered flag is excluded)", () => {
    for (const id of [
      "mpc.fcy.pits_closed_on_announcement",
      "mpc.fcy.standard_open_gs_first",
      "mpc.fcy.short_fcy_pits_closed_until_restart",
    ]) {
      expect(byRule(res, id)).toEqual([]);
      expect(run(res, id)!.checks).toBe(checksOf(res, id).length);
    }
    expect(checksOf(res, "mpc.fcy.pits_closed_on_announcement").length).toBeGreaterThan(0);
    expect(run(res, "mpc.fcy.no_standard_fcy_first_last_30min")).toMatchObject({
      checks: 0,
      notes: ["classifier_only", "fcy:1:standard_allowed", "fcy:2:standard_not_in_effect"],
    });
  });

  it("penalties: the 5 unserved ones fail with ceiling info, linked to their race-control penalty", () => {
    const f = byRule(res, "mpc.penalty.serve_within_4_green_crossings");
    const rc = (x: (typeof f)[number]) =>
      x.notes!.find((n) => n.startsWith("race_control_"))!.replace("race_control_", "");
    expect(f.map((x) => [x.car, x.status, x.severityCeiling, rc(x), x.margin])).toEqual([
      ["12", "fail", "info", "converted_post_race", null],
      ["18", "fail", "info", "converted_post_race", null],
      ["61", "fail", "info", "converted_post_race", null],
      ["77", "fail", "info", "unserved", null],
      ["77", "fail", "info", "unserved", null],
    ]);
    for (const x of f) {
      expect(x.officialAction).toHaveLength(1);
      expect(x.officialAction![0]).toMatch(new RegExp(`^pen:${x.car}:`));
      expect(x.subjectFactIds[0]).toBe(x.officialAction![0]);
    }
    // served penalties need lap crossings, which the dry-run outputs do not carry
    expect(
      run(res, "mpc.penalty.serve_within_4_green_crossings")!.notEvaluated!.map(
        (n) => n.reason
      )
    ).toEqual(Array(4).fill("no_lap_crossings"));
  });

  it("not checkable: pit speed limit (pit-lane length TBD) and data the timing files lack", () => {
    expect(nc(res, "mpc.pit.speed_limit")).toMatchObject({
      reason: "tbd_value",
      detail: "params.pit_lane_length_m",
    });
    expect(nc(res, "mpc.refuel.min_full_fill_time")!.reason).toBe("format_not_checkable");
    expect(nc(res, "mpc.fcy.standard_open_tcr_second")).toMatchObject({
      reason: "evaluated_by_other_rule",
      detail: "mpc.fcy.standard_open_gs_first",
    });
  });
});

function gt4With108(): Rulebook {
  // Fixture rulebook: the Indianapolis minimum set to the 108.000 s INFERENCE (RULES_CHECKABILITY §5.2.1). Test only.
  const rb = structuredClone(selectRulebook("sro-gt4-america", 2026)!);
  const o = rb.events!["indianapolis-2026-10"].overrides.find(
    (x) => x.rule === "gt4.pit.min_stop_time"
  )!;
  o.params = { value_s: 108.0 };
  o.quote = "FIXTURE: inferred minimum, not a published value";
  o.tbd = [{ field: "source.page", question: "Page." }];
  expect(validateRulebook(rb)).toEqual([]);
  return rb;
}

describe("Pirelli GT4 America Indianapolis 2026", () => {
  const r1 = loadFixture("gt4-indy-2026-r1.facts.json");
  const r2 = loadFixture("gt4-indy-2026-r2.facts.json");
  const real = selectRulebook("sro-gt4-america", 2026)!;

  it("with the real rulebook the minimum pit time stays not checkable (108.000 s is an inference, not a rule)", () => {
    for (const pkg of [r1, r2]) {
      const res = runRuleChecks(pkg, real);
      expect(res.rulebook.eventKey).toBe("indianapolis-2026-10");
      const n = nc(res, "gt4.pit.min_stop_time")!;
      expect(n).toMatchObject({ reason: "tbd_value", detail: "params.value_s" });
      expect(n.tbd!.some((t) => /108\.000/.test(t.question))).toBe(true);
      expect(checksOf(res, "gt4.pit.min_stop_time")).toEqual([]);
      expect(res.ruleChecks.filter((c) => c.status !== "pass")).toEqual([]);
      for (const id of [
        "gt4.pit.window",
        "gt4.pit.mandatory_stop_count",
        "gt4.classification.min_distance",
        "gt4.driver.change_at_mandatory_stop",
      ]) {
        expect(nc(res, id)!.reason).toBe("tbd_value");
      }
      expect(res.ruleMarkers).toEqual([]);
    }
  });

  it("pits closed under FCY: no entries (R1 #72, R2 #028/#131/#98 pitted before the FCY)", () => {
    const a = runRuleChecks(r1, real);
    const b = runRuleChecks(r2, real);
    expect(run(a, "gt4.fcy.pits_closed")).toMatchObject({ checks: 36 });
    expect(statuses(a, "gt4.fcy.pits_closed")).toEqual({ pass: 36 });
    expect(run(b, "gt4.fcy.pits_closed")).toMatchObject({ checks: 34 });
    expect(statuses(b, "gt4.fcy.pits_closed")).toEqual({ pass: 34 });
  });

  it("with a fixture rulebook at 108.000 s: R1 #11 and #77 fail (ceiling possible), both penalised by race control", () => {
    const res = runRuleChecks(r1, gt4With108());
    const f = byRule(res, "gt4.pit.min_stop_time");
    expect(
      f.map((x) => [
        x.id,
        x.status,
        x.measured,
        x.limit,
        x.margin,
        x.severityCeiling,
        x.officialAction,
      ])
    ).toEqual([
      ["rule:gt4.pit.min_stop_time:11:1", "fail", 105.793, 108, -2.207, "possible", ["pen:11:1"]],
      ["rule:gt4.pit.min_stop_time:77:1", "fail", 106.582, 108, -1.418, "possible", ["pen:77:1"]],
    ]);
    expect(f[0]).toMatchObject({
      lap: 16,
      at: { clock: "2026-10-10T10:33:12.010-04:00" },
      verified: false,
    });
    // the rule's own severity is possible, so the unverified cap does not lower it further
    expect(f[0].severityNotes).toBeUndefined();
    expect(f[0].notes).toContain("race_control_penalised");
    expect(f[0]).not.toHaveProperty("statement");
    expect(f[0].rulebookRef).toMatchObject({
      doc: "SRO-BUL-INDY-2026",
      eventOverride: "indianapolis-2026-10",
      quote: "FIXTURE: inferred minimum, not a published value",
    });
    // 31 normal stops; #24 and #92 carry a 10 s time penalty (required 118.000 s) and pass
    expect(run(res, "gt4.pit.min_stop_time")).toMatchObject({ checks: 31 });
    expect(statuses(res, "gt4.pit.min_stop_time")).toEqual({ pass: 29, fail: 2 });
    expect(
      checksOf(res, "gt4.pit.min_stop_time")
        .filter((c) => c.car === "24" || c.car === "92")
        .map((c) => [c.car, c.status, c.limit, c.subjectFactIds.some((s) => s.startsWith("pen:"))])
    ).toEqual([
      ["24", "pass", 118, true],
      ["92", "pass", 118, true],
    ]);
    expect(aboveInfo(res).map((x) => x.car)).toEqual(["11", "77"]);
  });

  it("with the fixture rulebook R2 has no stop below 108.000 s (#33's 5 + 5 s penalties -> 118.000 s)", () => {
    const res = runRuleChecks(r2, gt4With108());
    expect(run(res, "gt4.pit.min_stop_time")).toMatchObject({ checks: 29 });
    expect(statuses(res, "gt4.pit.min_stop_time")).toEqual({ pass: 29 });
    expect(res.ruleChecks.filter((c) => c.status !== "pass")).toEqual([]);
  });
});

describe("WRL 2026 rulebook on Barber, COTA Saturday and Sunday 7 h (dry run: no possible findings)", () => {
  const races = [
    {
      file: "wrl-barber.facts.json",
      stints: 42,
      below: ["17", "69", "150", "214", "247", "316", "369", "616", "851"],
    },
    {
      file: "wrl-cota-sat.facts.json",
      stints: 70,
      below: ["40", "41", "55", "90", "247", "333", "669", "678", "999"],
    },
    {
      file: "wrl-sunday7.facts.json",
      stints: 67,
      below: [
        "6",
        "38",
        "82",
        "85",
        "118",
        "141",
        "163",
        "237",
        "247",
        "411",
        "417",
        "522",
        "550",
        "851",
      ],
    },
  ];
  const rb = selectRulebook("wrl", 2026)!;

  for (const race of races) {
    describe(race.file, () => {
      const pkg = loadFixture(race.file);
      const res = runRuleChecks(pkg, rb);

      it("no check whose ceiling is above info", () => {
        expect(aboveInfo(res)).toEqual([]);
      });

      it("longest on-track run of every car is under 4 h; bounds equal the dry run's", () => {
        expect(run(res, "wrl.drive.max_stint")).toMatchObject({ checks: race.stints });
        expect(statuses(res, "wrl.drive.max_stint")).toEqual({ pass: race.stints });
        // lap-crossing bounds: every pass carries [lower, upper]
        expect(
          checksOf(res, "wrl.drive.max_stint").every((c) => c.measuredRange?.length === 2)
        ).toBe(true);
        const ctx = new RaceCtx(pkg, rb);
        for (const s of pkg.stints as ((typeof pkg.stints)[number] & {
          _dryRunBounds: [number, number];
        })[]) {
          const b = stintBounds(ctx, s);
          if (typeof b === "string") throw new Error(b);
          expect(b.lower).toBeCloseTo(s._dryRunBounds[0], 1);
          expect(b.upper).toBeCloseTo(s._dryRunBounds[1], 1);
        }
      });

      it("cars below 50 % of the class leader's laps fail with ceiling info, as in the dry run", () => {
        const f = byRule(res, "wrl.classification.official_finish");
        expect(f.map((x) => x.car)).toEqual(race.below);
        expect(
          f.every(
            (x) =>
              x.status === "fail" &&
              x.severityCeiling === "info" &&
              x.notes!.includes("race_control_not_available") &&
              x.officialAction === undefined
          )
        ).toBe(true);
        expect(f.every((x) => x.notes!.includes("rule_season_not_confirmed"))).toBe(true);
      });

      it("minimum pit time and Code 35 pit rule are TBD; pit-lane facts are not in WRL files", () => {
        expect(nc(res, "wrl.pit.min_stop_time")).toMatchObject({
          reason: "tbd_value",
          detail: "params.value_s,params.measure",
        });
        expect(nc(res, "wrl.fcy.code35")).toMatchObject({
          reason: "tbd_value",
          detail: "params.pits_open_under_code35",
        });
        expect(nc(res, "wrl.pit.speed_limit")!.reason).toBe("format_not_checkable");
      });
    });
  }
});

describe("merge into the package (CLI)", () => {
  it("writes checks, markers, coverage and the rulebook reference; never ruleFindings", async () => {
    const { mergeRuleChecks, markRuleChecksAbsent } =
      await import("../merge-rule-checks.js");
    const pkg = loadFixture("mpc-road-atlanta-2026.facts.json");
    const rb = selectRulebook("imsa-mpc", 2026)!;
    const res = runRuleChecks(pkg, rb);
    const stale = { ...structuredClone(pkg), ruleChecksRun: [], rulesNotCheckable: [] };
    const merged = mergeRuleChecks(stale, res, rb);
    expect(merged.ruleChecks).toEqual(res.ruleChecks);
    expect(merged.ruleChecks.filter((c) => c.status !== "pass")).toHaveLength(10);
    expect(merged.ruleMarkers).toEqual(res.ruleMarkers);
    expect(merged.ruleCoverage).toEqual(res.ruleCoverage);
    expect(merged.ruleFindings).toEqual(pkg.ruleFindings);
    expect(merged).not.toHaveProperty("ruleChecksRun");
    expect(merged).not.toHaveProperty("rulesNotCheckable");
    expect(merged.rulebook).toMatchObject({
      status: "partial",
      fileId: "imsa-mpc-2026",
      eventOverrides: ["road-atlanta-2026-10"],
      missingFields: ["mpc.pit.speed_limit:params.pit_lane_length_m"],
    });
    expect(merged.rulebookVersion).toBe(
      `imsa-mpc-2026@sha256:${res.rulebook.sha256.slice(0, 12)}`
    );
    expect(merged.entries).toEqual(pkg.entries); // facts untouched
    const absent = markRuleChecksAbsent(structuredClone(merged));
    expect(absent.rulebook).toEqual({ status: "absent" });
    expect(absent.ruleChecks).toEqual([]);
    expect(absent).not.toHaveProperty("ruleMarkers");
    expect(absent).not.toHaveProperty("ruleCoverage");
  });
});
