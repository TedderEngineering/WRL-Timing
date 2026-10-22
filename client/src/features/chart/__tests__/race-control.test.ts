import { describe, expect, it } from "vitest";
import { isPenalty } from "../RaceControl";

describe("race control actions", () => {
  it("marks a penalty, not a no-action or a warning", () => {
    expect(isPenalty("Drive Through")).toBe(true);
    expect(isPenalty("Stop + 60")).toBe(true);
    expect(isPenalty("No Penalty")).toBe(false);
    expect(isPenalty("No Action Needed")).toBe(false);
    expect(isPenalty("Warning")).toBe(false);
    expect(isPenalty(null)).toBe(false);
  });
});

describe("race control messages about the viewer's cars", () => {
  it("knows the focus car, the cars followed on the map and the cars on the account", async () => {
    const { viewerCars } = await import("../RaceControl");
    const data = {
      cars: {
        "119": { team: "AE Victory Racing", cls: "GTO" },
        "678": { team: "STAK Racing", cls: "GTO" },
        "62": { team: "Open Throttle Racing", cls: "GP1" },
        "5": { team: "All Star Racing", cls: "GP1" },
      },
    } as never;
    const mine = viewerCars(data, 119, new Set([678]), [{ id: "c", label: null, number: "62", series: "wrl", teamName: "Open Throttle", carClass: null, season: 2026 }]);
    expect([...mine]).toEqual([
      [62, "my car"],
      [678, "following"],
      [119, "focus"],
    ]);
    expect(viewerCars(data, 0, new Set(), null).size).toBe(0);
  });
});
