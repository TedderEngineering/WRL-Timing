import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLiveChart } from "../build.js";
import type { FeedLap } from "../feed.js";
import { currentDrivers, nameDriverChanges } from "../drivers.js";

const lap = (n: string, llp: number, dn: string) => ({ n, llp, dn });
const ann = (...laps: number[]) => ({ pits: laps.map((l) => ({ l })) as { l: number; inDriver?: string; outDriver?: string; driverChanged?: boolean }[] });

describe("who drove each stint, from the laps' driver names", () => {
  // #119 on Sunday at Sebring: stops on laps 12, 33 and 60, Schubert taking over at the third.
  const laps = [
    ...Array.from({ length: 60 }, (_, i) => lap("119", i + 1, "Ashley Freiberg")),
    ...Array.from({ length: 5 }, (_, i) => lap("119", 61 + i, "Brenna  Schubert ")),
  ];

  it("names each stop's driver in (the in-lap) and out (the lap after), and marks a change", () => {
    const a: Record<string, unknown> = { "119": ann(12, 33, 60) };
    nameDriverChanges(a, { cars: { "119": {} } }, laps);
    expect((a["119"] as ReturnType<typeof ann>).pits).toEqual([
      { l: 12, inDriver: "Ashley Freiberg", outDriver: "Ashley Freiberg", driverChanged: false },
      { l: 33, inDriver: "Ashley Freiberg", outDriver: "Ashley Freiberg", driverChanged: false },
      { l: 60, inDriver: "Ashley Freiberg", outDriver: "Brenna Schubert", driverChanged: true },
    ]);
  });

  it("before the out-lap is done, takes the driver out from who is in the car now", () => {
    // In at the end of lap 65 (Schubert's stint 61-65); no lap after it done yet.
    const a: Record<string, unknown> = { "119": ann(60, 65) };
    nameDriverChanges(a, { cars: { "119": {} } }, laps, { "119": "Sarah Montgomery" });
    expect((a["119"] as ReturnType<typeof ann>).pits[1]).toEqual({ l: 65, inDriver: "Brenna Schubert", outDriver: "Sarah Montgomery", driverChanged: true });
  });

  it("finds a car by its published number (a stand-in key with a label) and leaves stops already named", () => {
    const a: Record<string, unknown> = { "1216": { pits: [{ l: 3, inDriver: "Kept", outDriver: "As is" }, { l: 5 }] } };
    nameDriverChanges(a, { cars: { "1216": { label: "216x" } } }, [lap("216x", 3, "A B"), lap("216x", 5, "A B"), lap("216x", 6, "C D")]);
    expect((a["1216"] as ReturnType<typeof ann>).pits).toEqual([
      { l: 3, inDriver: "Kept", outDriver: "As is" },
      { l: 5, inDriver: "A B", outDriver: "C D", driverChanged: true },
    ]);
  });

  it("names nobody when the laps carry no driver", () => {
    const a: Record<string, unknown> = { "7": ann(4) };
    nameDriverChanges(a, { cars: { "7": {} } }, [{ n: "7", llp: 4, dn: "" }, { n: "7", llp: 5 }]);
    expect((a["7"] as ReturnType<typeof ann>).pits).toEqual([{ l: 4 }]);
  });

  it("reads who is in each car now from the state's lap rows", () => {
    expect(currentDrivers([lap("119", 70, " Sarah  Montgomery"), lap("5", 60, ""), { n: "9", llp: 3 }])).toEqual({ "119": "Sarah Montgomery" });
  });
});

describe("the live chart names its stops' drivers", () => {
  it("through the live build, from the feed's laps", async () => {
    const doc = JSON.parse(readFileSync(new URL("./fixtures/laps.json", import.meta.url), "utf8"));
    const meta = { slug: "t", eventName: "E", sessionName: "S", track: "T", date: "2026-10-18", tzOffsetHours: -6 };
    const chart = await buildLiveChart({ meta: meta as never, laps: doc.laps as FeedLap[], results: null, flags: null, control: null });
    const pits = Object.values(chart.annotations).flatMap((a) => ((a as { pits?: { inDriver?: string; outDriver?: string }[] }).pits ?? []));
    expect(pits.length).toBeGreaterThan(0);
    expect(pits.some((p) => p.inDriver === "Alex Synth" && p.outDriver === "Blake Synth")).toBe(true);
  });
});

describe("a lap at the end of a stint carrying the next driver's name", () => {
  it("does not move the stint: each stint is the driver on most of its laps", () => {
    // The in-lap (60) already says Schubert: the stint 34-60 is still Freiberg's.
    const laps = [
      ...Array.from({ length: 59 }, (_, i) => lap("119", i + 1, "Ashley Freiberg")),
      lap("119", 60, "Brenna Schubert"),
      ...Array.from({ length: 5 }, (_, i) => lap("119", 61 + i, "Brenna Schubert")),
    ];
    const a: Record<string, unknown> = { "119": ann(33, 60) };
    nameDriverChanges(a, { cars: { "119": {} } }, laps);
    expect((a["119"] as ReturnType<typeof ann>).pits.map((p) => [p.l, p.inDriver, p.outDriver])).toEqual([
      [33, "Ashley Freiberg", "Ashley Freiberg"],
      [60, "Ashley Freiberg", "Brenna Schubert"],
    ]);
  });
});
