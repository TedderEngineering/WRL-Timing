import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RaceAnalysisPackage } from "@shared/race-analysis-package/types";
import { finishLabel, matchesFilter, storiesByClass, storyContext } from "../analysis-review";
import { StoryPreview } from "../StoryPreview";

const text = (s: string) => s.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const p = (t: string, refs: unknown[] = []) => ({ text: t, refs }) as never;

function entry(car: string, cls: string, posClass: number | null, status = "classified", team = `Team ${car}`) {
  return {
    id: `car:${car}`,
    car,
    class: cls,
    team,
    make: "BMW",
    makeBasis: "none",
    vehicle: "TBD",
    drivers: [
      { number: 1, name: `Ann ${car}` },
      { number: 2, name: `Bo ${car}` },
    ],
    result: { id: `result:${car}`, status, positionOverall: null, positionClass: posClass, laps: 10 },
  };
}

function pkg(over: Partial<Record<string, unknown>> = {}): RaceAnalysisPackage {
  return {
    metadata: {
      classes: [
        { id: "GTD", name: "GT Daytona", order: 2 },
        { id: "GTP", name: "Grand Touring Prototype", order: 1 },
      ],
    },
    entries: [entry("57", "GTD", 2), entry("12", "GTD", 1), entry("8", "GTD", null, "dnf"), entry("7", "GTP", 1)],
    carStories: [
      { id: "story:12", car: "12", headline: p("{car:12} won {class:GTD}"), paragraphs: [p("{driver:12:2} pitted on lap {0}.", [{ value: 40, factId: "pit:12:1", field: "lap", unit: "lap" }])], keyFactIds: [] },
      { id: "story:57", car: "57", headline: p("Second for {car:57}"), paragraphs: [], keyFactIds: [] },
      { id: "story:7", car: "7", headline: p("{car:7} led overall"), paragraphs: [], keyFactIds: [] },
    ],
    raceSummary: { id: "summary", headline: p("A clean race"), paragraphs: [p("Nothing went wrong.")] },
    ruleFindings: [],
    ...over,
  } as unknown as RaceAnalysisPackage;
}

describe("storiesByClass", () => {
  it("orders classes by the package's order and cars by class finish, unclassified last", () => {
    const g = storiesByClass(pkg());
    expect(g.map((x) => x.name)).toEqual(["Grand Touring Prototype", "GT Daytona"]);
    expect(g[1].rows.map((r) => r.car)).toEqual(["12", "57", "8"]);
    expect(g[1].rows[2].story).toBeNull();
  });

  it("keeps a story whose car is not in the entry list", () => {
    const x = pkg();
    x.carStories.push({ id: "story:99", car: "99", headline: p("Ghost"), paragraphs: [], keyFactIds: [] } as never);
    const g = storiesByClass(x);
    expect(g[g.length - 1].name).toBe("Not in the entry list");
    expect(g[g.length - 1].rows[0].car).toBe("99");
  });
});

describe("helpers", () => {
  it("labels the finish from the package result", () => {
    expect(finishLabel(entry("1", "GTD", 3) as never)).toBe("P3 in class");
    expect(finishLabel(entry("1", "GTD", null, "dnf") as never)).toBe("DNF");
    expect(finishLabel(null)).toBeNull();
  });

  it("finds a car by number, team or driver", () => {
    const row = { car: "12", entry: entry("12", "GTD", 1, "classified", "Turner Motorsport") as never, story: null };
    expect(matchesFilter(row, "#12")).toBe(true);
    expect(matchesFilter(row, "1")).toBe(false);
    expect(matchesFilter(row, "turner")).toBe(true);
    expect(matchesFilter(row, "bo 12")).toBe(true);
  });

  it("builds the prose context with driver numbers and class names", () => {
    const ctx = storyContext(pkg());
    expect(ctx.cars?.["12"]).toEqual({ team: "Team 12", drivers: ["Ann 12", "Bo 12"], driverNumbers: [1, 2] });
    expect(ctx.classes?.GTD).toBe("GT Daytona");
  });
});

describe("StoryPreview", () => {
  it("shows the summary and every story with tokens filled in, and names cars with no story", () => {
    const out = text(renderToStaticMarkup(<StoryPreview pkg={pkg()} />));
    expect(out).toContain("A clean race");
    expect(out).toContain("#12 won GT Daytona");
    expect(out).toContain("Bo 12 pitted on lap 40");
    expect(out).toContain("Car stories · 3");
    expect(out).toContain("No story for 1 car: #8");
    expect(out.indexOf("#7 led overall")).toBeLessThan(out.indexOf("#12 won"));
  });

  it("says when a version has facts only", () => {
    const out = text(renderToStaticMarkup(<StoryPreview pkg={pkg({ raceSummary: null, carStories: [] })} />));
    expect(out).toContain("No stories in this version yet");
  });
});
