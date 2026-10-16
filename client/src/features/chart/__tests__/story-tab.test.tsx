import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RaceChartData } from "@shared/types";
import { StoryView, orderStories, storyCarFor, type RaceStories } from "../StoryTab";

const P = (text: string, refs: { value: number | string; unit?: string; display?: string }[] = []) => ({
  text,
  refs: refs.map((r, i) => ({ factId: `f:${i}`, field: "x", ...r })),
});

const stories: RaceStories = {
  version: 3,
  publishedAt: "2026-10-16T15:00:00.000Z",
  recap: {
    packageId: "p",
    session: "Race",
    resultsStatus: "official",
    totalLaps: 30,
    headline: P("{car:7} won {class:GS} and finished {0} overall.", [{ value: 1, unit: "pos" }]),
    paragraphs: [P("A full-course yellow covered leader laps {0} to {1}.", [{ value: 3, unit: "lap" }, { value: 6, unit: "lap" }])],
    classWinners: [{ class: "GS", className: "GS", car: "7", team: "Seven Racing", make: "BMW", drivers: ["A One"], summary: P("{car:7} won {class:GS}.") }],
    moments: [{ id: "moment:1", lap: 12, lapEnd: null, causes: ["on_track"], title: P("New leader in GS"), text: P("{car:7} passed {car:007} on lap {0}.", [{ value: 12, unit: "lap" }]), cars: ["7", "007"] }],
    bands: [],
    postRace: [],
    cars: {
      "7": { team: "Seven Racing", make: "BMW", drivers: ["A One", "B Two"], driverNumbers: [1, 2] },
      "007": { team: "Double O", make: "Aston Martin", drivers: ["C Three"], driverNumbers: [1] },
      "20": { team: "Twenty", make: "Hyundai", drivers: ["D Four"], driverNumbers: [1] },
    },
    classes: { GS: "GS", TCR: "TCR" },
  },
  stories: [
    { car: "20", cls: "TCR", headline: P("{car:20} won {class:TCR}."), paragraphs: [], positionClass: 1, positionOverall: 3 },
    { car: "007", cls: "GS", headline: P("{car:007} finished {0} in class.", [{ value: 2, unit: "pos" }]), paragraphs: [P("{driver:007:1} drove the whole race.")], positionClass: 2, positionOverall: 2 },
    { car: "7", cls: "GS", headline: P("{car:7} won {class:GS}."), paragraphs: [P("{driver:7:1} started and {driver:7:2} finished.")], positionClass: 1, positionOverall: 1 },
  ],
};

// The chart keys "007" with a stand-in integer and its published number as the label.
const chart = { cars: { "7": { num: 7 }, "1007": { num: 1007, label: "007" }, "20": { num: 20 } } } as unknown as RaceChartData;

const text = (node: React.ReactNode) =>
  renderToStaticMarkup(node).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Story tab", () => {
  it("finds the focus car's story by its published number", () => {
    expect(storyCarFor(chart, 1007, stories.stories)).toBe("007");
    expect(storyCarFor(chart, 7, stories.stories)).toBe("7");
    expect(storyCarFor(chart, 99, stories.stories)).toBeNull();
    expect(storyCarFor(chart, 0, stories.stories)).toBeNull();
  });

  it("lists cars class by class in finishing order", () => {
    expect(orderStories(stories.stories, ["GS", "TCR"]).map((s) => s.car)).toEqual(["7", "007", "20"]);
  });

  it("shows the race summary, key moments, class results and the focus car's story", () => {
    const t = text(<StoryView stories={stories} data={chart} focusNum={1007} onCar={() => {}} onOpenTab={() => {}} />);
    expect(t).toContain("#7 won GS and finished P1 overall.");
    expect(t).toContain("A full-course yellow covered leader laps 3 to 6");
    expect(t).toContain("New leader in GS");
    expect(t).toContain("Class by class");
    expect(t).toContain("#007 finished P2 in class.");
    expect(t).toContain("C Three drove the whole race.");
    expect(t).toContain("Position Trace →");
  });

  it("asks for a car when the focus car has no story", () => {
    const t = text(<StoryView stories={stories} data={chart} focusNum={99} onCar={() => {}} onOpenTab={() => {}} />);
    expect(t).toContain("There's no story for this car in this race.");
  });
});
