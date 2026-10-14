import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProseText, formatDuration, formatRef, proseToText, type Prose } from "../prose";

const ctx = {
  cars: { "68": { team: "RAFA Racing Team", drivers: ["Westin Workman", "Tyler Gonzalez"], driverNumbers: [1, 2] } },
  classes: { "Pro-Am": "Pro-Am" },
};

const p: Prose = {
  text: "{car:68} won by {0} after a {1} caution from lap {2}; {driver:68:2} started from {3} in {class:Pro-Am}.",
  refs: [
    { value: "+3.518", factId: "result:131", field: "gapFirst", unit: "text" },
    { value: 1093.35, factId: "fcy:1", field: "durationS", unit: "s", display: "18:13.350" },
    { value: 2, factId: "fcy:1", field: "leaderLaps[0]", unit: "lap" },
    { value: 3, factId: "car:68", field: "startPosition", unit: "pos" },
  ],
};

describe("prose rendering", () => {
  it("fills every token from the package, never computing a number", () => {
    expect(proseToText(p, ctx)).toBe("#68 won by +3.518 after a 18:13.350 caution from lap 2; Tyler Gonzalez started from P3 in Pro-Am.");
  });

  it("formats seconds as m:ss.sss without rounding when no display is given", () => {
    expect(formatDuration(62)).toBe("1:02.000");
    expect(formatDuration(1093.35)).toBe("18:13.350");
    expect(formatDuration(3634.129)).toBe("1:00:34.129");
    expect(formatRef({ value: -14.018, factId: "x", field: "y", unit: "s", transform: "abs" })).toBe("0:14.018");
  });

  it("renders numbers and car numbers in tabular figures", () => {
    const html = renderToStaticMarkup(<ProseText prose={p} ctx={ctx} />);
    expect(html).toContain('<span class="font-mono tabular-nums font-semibold">#68</span>');
    expect(html).toContain('<span class="font-mono tabular-nums">18:13.350</span>');
  });
});
