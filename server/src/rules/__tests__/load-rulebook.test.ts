import { describe, expect, it } from "vitest";
import {
  loadAllRulebooks,
  resolveRulebook,
  resolveRulesForClass,
  rulebookClassFor,
  RulebookError,
  selectEvent,
  selectRulebook,
  selectSession,
  validateRulebook,
} from "../load-rulebook.js";
import { makeRulebook, rule } from "./helpers.js";

describe("bundled rulebooks", () => {
  it("all three load and validate", () => {
    expect(loadAllRulebooks().map((r) => r.id)).toEqual([
      "imsa-mpc-2026",
      "sro-gt4-america-2026",
      "wrl-2026",
    ]);
  });

  it("calendar dates stay strings (YAML core schema)", () => {
    const rb = selectRulebook("imsa-mpc", 2026)!;
    expect(rb.documents[0].date).toBe("2025-12-03");
    expect(rb.events!["road-atlanta-2026-10"].dates).toEqual([
      "2026-09-29",
      "2026-10-02",
    ]);
  });

  it("selects by rulebook id prefix, series id or series name; null when none", () => {
    expect(selectRulebook("imsa-mpc", 2026)!.id).toBe("imsa-mpc-2026");
    expect(selectRulebook("IMSA Michelin Pilot Challenge", 2026)!.id).toBe(
      "imsa-mpc-2026"
    );
    expect(selectRulebook("Pirelli GT4 America", 2026)!.id).toBe("sro-gt4-america-2026");
    expect(selectRulebook("wrl", 2026)!.id).toBe("wrl-2026");
    expect(selectRulebook("wrl", 2025)).toBeNull();
    expect(selectRulebook("GR Cup", 2026)).toBeNull();
  });

  it("selects the event by track and race date, or by explicit key", () => {
    const gt4 = selectRulebook("sro-gt4-america", 2026)!;
    expect(
      selectEvent(gt4, { track: "indianapolis-road-course", date: "2026-10-10" })
    ).toBe("indianapolis-2026-10");
    expect(selectEvent(gt4, { track: "road-atlanta", date: "2026-10-10" })).toBeNull();
    expect(selectEvent(gt4, { eventKey: "sonoma-2026-03" })).toBe("sonoma-2026-03");
    expect(() => selectEvent(gt4, { eventKey: "nowhere" })).toThrow(RulebookError);
    const mpc = selectRulebook("imsa-mpc", 2026)!;
    expect(
      selectSession(mpc.events!["road-atlanta-2026-10"], { date: "2026-10-02" })
        ?.duration_s
    ).toBe(7200);
  });

  it("resolves event overrides with provenance (Road Atlanta drive time from the SR)", () => {
    const mpc = selectRulebook("imsa-mpc", 2026)!;
    const r = resolveRulebook(mpc, { eventKey: "road-atlanta-2026-10" })
      .byClass.get("GS")!
      .get("mpc.drive_time.max_per_driver")!;
    expect(r.params.value_s).toBe(4800);
    expect(r.provenance.map((p) => p.layer)).toEqual(["series", "event"]);
    expect(r.provenance[1].source[0].doc).toBe("SR-MPLM-2026-OFF");
    expect(r.verified).toBe(false);
    expect(r.tbd.map((t) => t.field)).not.toContain("params.value_s");
  });

  it("keeps TBD questions open while the value is still TBD (GT4 Indianapolis minimum pit time)", () => {
    const gt4 = selectRulebook("sro-gt4-america", 2026)!;
    const r = resolveRulebook(gt4, { eventKey: "indianapolis-2026-10" })
      .byClass.get("Am")!
      .get("gt4.pit.min_stop_time")!;
    expect(r.params.value_s).toBe("TBD");
    expect(
      r.tbd.some((t) => t.field === "params.value_s" && /108\.000/.test(t.question))
    ).toBe(true);
  });

  it("Mid-Ohio maximum drive time by driver count", () => {
    const mpc = selectRulebook("imsa-mpc", 2026)!;
    const r = resolveRulebook(mpc, { eventKey: "mid-ohio-2026-06" })
      .byClass.get("TCR")!
      .get("mpc.drive_time.max_per_driver")!;
    expect(r.params.by_driver_count).toEqual({ "2": 12000, "3": 9600 });
  });

  it("maps class labels and aliases", () => {
    const rb = makeRulebook([], {
      classes: [{ id: "Pro-Am", aliases: ["PA", "ProAm"] }],
    });
    expect(rulebookClassFor(rb, "pro-am")).toBe("Pro-Am");
    expect(rulebookClassFor(rb, "PA")).toBe("Pro-Am");
    expect(rulebookClassFor(rb, "Silver")).toBeNull();
  });
});

describe("layering series -> class -> event -> event-class", () => {
  const src = (section: string) => ({ doc: "DOC", section, page: 1 });
  const rb = makeRulebook(
    [
      rule("t.pit.min", "min_pit_time", {
        value_s: 60,
        measure: "pit_lane_loop_to_loop",
        nested: { a: 1, b: 2 },
      }),
    ],
    {
      class_overrides: {
        TCR: [
          {
            rule: "t.pit.min",
            params: { value_s: 70 },
            source: src("C1"),
            quote: "class value",
            verified: true,
          },
        ],
      },
      events: {
        "ev-2026": {
          name: "Ev",
          track: "t",
          dates: ["2026-05-01", "2026-05-02"],
          sessions: [{ key: "race", date: "2026-05-01", duration_s: 3600 }],
          overrides: [
            {
              rule: "t.pit.min",
              params: { value_s: 80, nested: { b: 3 } },
              severity: "possible",
              source: src("E1"),
              quote: "event value",
              verified: false,
            },
          ],
          class_overrides: {
            TCR: [
              {
                rule: "t.pit.min",
                params: { value_s: 90 },
                source: src("EC1"),
                quote: "event class value",
                verified: true,
              },
            ],
          },
        },
      },
    }
  );

  it("later layers win field by field; maps merge", () => {
    expect(resolveRulesForClass(rb, null, "GS").get("t.pit.min")!.params.value_s).toBe(
      60
    );
    expect(resolveRulesForClass(rb, null, "TCR").get("t.pit.min")!.params.value_s).toBe(
      70
    );
    const gs = resolveRulesForClass(rb, "ev-2026", "GS").get("t.pit.min")!;
    expect(gs.params).toMatchObject({ value_s: 80, nested: { a: 1, b: 3 } });
    expect(gs.severity).toBe("possible");
    const tcr = resolveRulesForClass(rb, "ev-2026", "TCR").get("t.pit.min")!;
    expect(tcr.params.value_s).toBe(90);
    expect(tcr.provenance.map((p) => p.layer)).toEqual([
      "series",
      "class",
      "event",
      "event-class",
    ]);
    expect(tcr.verified).toBe(false); // event layer unverified
  });

  it("the hash changes with the resolved rule set", () => {
    expect(resolveRulebook(rb, {}).hash).not.toBe(
      resolveRulebook(rb, { eventKey: "ev-2026" }).hash
    );
    expect(resolveRulebook(rb, {}).hash).toBe(resolveRulebook(rb, {}).hash);
  });
});

describe("validation", () => {
  const base = () =>
    structuredClone(
      makeRulebook([rule("t.a.b", "advisory", { x: 1 }, { severity: "info" })])
    );

  it("rejects quotes over 25 words, unknown documents, unexplained TBDs and raised severities", () => {
    const rb = base();
    rb.rules[0].quote = Array(26).fill("word").join(" ");
    rb.rules[0].source = { doc: "NOPE", section: "1", page: 1 };
    rb.rules[0].params = { x: "TBD" };
    rb.class_overrides = {
      GS: [
        {
          rule: "t.a.b",
          severity: "likely",
          source: { doc: "DOC", section: "2", page: 1 },
          quote: "q q q",
          verified: false,
        },
      ],
    };
    const errs = validateRulebook(rb).join("\n");
    expect(errs).toMatch(/26 words/);
    expect(errs).toMatch(/source doc 'NOPE'/);
    expect(errs).toMatch(/params.x is TBD but has no tbd/);
    expect(errs).toMatch(/raises severity info -> likely/);
  });

  it("rejects schema violations", () => {
    const rb = base() as unknown as Record<string, unknown>;
    rb.status = "final";
    expect(validateRulebook(rb)[0]).toMatch(/^schema:/);
  });
});
