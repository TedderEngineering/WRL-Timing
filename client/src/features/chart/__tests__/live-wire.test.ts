import { describe, expect, it } from "vitest";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { applyDelta, applyFull, lapTimeText, type WireDelta, type WireFull } from "../live-wire";
import fixture from "./fixtures/live-wire.json";

/** Written by the server's wire test from its encoder (server/src/live/__tests__/wire.test.ts). */
const f = fixture as unknown as {
  lapTimeCases: [number, string][];
  base: RaceChartData;
  baseAnnotations: AnnotationData;
  full: WireFull;
  delta: WireDelta;
  next: RaceChartData;
  nextAnnotations: AnnotationData;
};

/** Key order does not matter to the charts. */
const sorted = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted((x as Record<string, unknown>)[k])])) : x;

describe("live wire (phone side)", () => {
  it("rebuilds lap-time text the same way as the server", () => {
    for (const [sec, text] of f.lapTimeCases) expect(lapTimeText(sec)).toBe(text);
  });

  it("rebuilds the server's chart from a full copy", () => {
    const { data, annotations } = applyFull(f.full);
    expect(sorted(data)).toEqual(sorted(f.base));
    expect(annotations).toEqual(f.baseAnnotations);
  });

  it("applies a delta to give the server's next chart", () => {
    const { data, annotations } = applyFull(f.full);
    const out = applyDelta(data, annotations, f.delta)!;
    expect(sorted(out.data)).toEqual(sorted(f.next));
    expect(out.annotations).toEqual(f.nextAnnotations);
  });

  it("keeps the objects of cars a delta did not touch", () => {
    const { data, annotations } = applyFull(f.full);
    const untouched = Object.keys(data.cars).find((n) => !f.delta.cars[n]);
    const out = applyDelta(data, annotations, f.delta)!;
    if (untouched) expect(out.data.cars[untouched]).toBe(data.cars[untouched]);
  });

  it("refuses a delta that does not fit the chart held", () => {
    const { data, annotations } = applyFull(f.full);
    expect(applyDelta(data, annotations, { ...f.delta, total: f.delta.total + 1 })).toBeNull();
    const short = { ...data, cars: { ...data.cars, "7": { ...data.cars["7"], laps: [] } } };
    expect(applyDelta(short, annotations, f.delta)).toBeNull();
  });
});
