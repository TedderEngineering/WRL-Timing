import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recentEvents } from "../../../lib/analytics";
import { __resetAlertArrivalForTests, noteAlertArrival } from "../alerts";

afterEach(() => vi.unstubAllGlobals());

describe("arrival from a race-ready email", () => {
  let replaced: string[];
  beforeEach(() => {
    __resetAlertArrivalForTests();
    replaced = [];
  });
  const at = (href: string) =>
    vi.stubGlobal("window", { location: { href }, history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => replaced.push(u) } });

  it("sends alert_open with the race once and removes the tag", () => {
    at("https://racetrace.tedderengineering.com/chart?race=r1&from=alert");
    noteAlertArrival();
    const last = recentEvents()[recentEvents().length - 1];
    expect(last).toMatchObject({ event: "alert_open", details: { raceId: "r1" } });
    expect(replaced).toEqual(["/chart?race=r1"]);
    const n = recentEvents().length;
    noteAlertArrival();
    expect(recentEvents().length).toBe(n);
  });

  it("ignores other visits", () => {
    at("https://racetrace.tedderengineering.com/chart?race=r1&from=share");
    const n = recentEvents().length;
    noteAlertArrival();
    expect(recentEvents().length).toBe(n);
  });
});
