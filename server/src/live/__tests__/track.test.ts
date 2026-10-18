import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IN_PIT, NO_GPS, OFF_TRACK, placeOnTrack, positionsFromState, publicTrack, toXY, trackFromFeed } from "../track.js";

const feedMap = JSON.parse(readFileSync(new URL("./fixtures/sebring-track.json", import.meta.url), "utf8"));
const g = trackFromFeed(feedMap)!;
const pt = (i: number) => feedMap.pts[i] as { lat: number; lon: number; d: number };
/** A distance along the path → metres past the start/finish line. */
const pastLine = (d: number) => (d - feedMap.sf.d + g.len) % g.len;

describe("track geometry (Sebring, as the timing feed learned it)", () => {
  it("reads the map: 93 points, 5,734 m, an outline about 1.2 km by 1 km", () => {
    expect(g.pts.length).toBe(93);
    expect(g.len).toBeCloseTo(5734.36, 1);
    expect(g.w).toBeGreaterThan(1000);
    expect(g.w).toBeLessThan(1400);
    expect(g.h).toBeGreaterThan(900);
    expect(g.h).toBeLessThan(1100);
  });
  it("draws from the start/finish line round the lap, without coordinates", () => {
    const t = publicTrack(g);
    expect(t.pts.length).toBe(93);
    expect(t.ds[0]).toBeGreaterThanOrEqual(0);
    expect(t.ds[0]).toBeLessThan(50);
    expect([...t.ds].sort((a, b) => a - b)).toEqual(t.ds);
    expect(JSON.stringify(t)).not.toMatch(/lat|lon|27\.45|-81\.3/);
  });
  it("places a GPS point on the lap as metres past the line", () => {
    for (const i of [0, 10, 33, 52, 70, 90]) {
      const p = placeOnTrack(g, pt(i).lat, pt(i).lon);
      expect(p.off).toBeLessThan(0.5);
      expect(p.d).toBeCloseTo(pastLine(pt(i).d), 0);
    }
    // Halfway along a stretch.
    const a = pt(40);
    const b = pt(41);
    const mid = placeOnTrack(g, (a.lat + b.lat) / 2, (a.lon + b.lon) / 2);
    expect(mid.d).toBeCloseTo(pastLine((a.d + b.d) / 2), 0);
  });
  it("tells a hairpin's two sides apart by where the car was", () => {
    // A made-up circuit: two 1,000 m straights 12 m apart, joined at both ends.
    const m = 1 / 111_000;
    const lat0 = 27.45;
    const lonM = 1 / (111_000 * Math.cos((lat0 * Math.PI) / 180));
    const ptsXY: [number, number][] = [];
    for (let x = 0; x <= 1000; x += 50) ptsXY.push([x, 0]);
    for (let x = 1000; x >= 0; x -= 50) ptsXY.push([x, 12]);
    let d = 0;
    const pts = ptsXY.map(([x, y], i) => {
      if (i) d += Math.hypot(x - ptsXY[i - 1][0], y - ptsXY[i - 1][1]);
      return { lat: lat0 - y * m, lon: -81.35 + x * lonM, d };
    });
    const hairpin = trackFromFeed({ pts, len: d + 12, sf: { d: 0 } })!;
    // A point on the first straight at 500 m, nudged 5 m towards the other side.
    const lat = lat0 - 5 * m;
    const lon = -81.35 + 500 * lonM;
    const outward = placeOnTrack(hairpin, lat, lon, 480); // coming down the first straight
    const back = placeOnTrack(hairpin, lat, lon, 1500); // coming back up the second
    expect(outward.d).toBeGreaterThan(490);
    expect(outward.d).toBeLessThan(510);
    expect(back.d).toBeGreaterThan(1500);
    expect(back.d).toBeLessThan(1530);
    // On one stretch, the previous distance changes nothing (no pull back to a neighbouring segment).
    const a = pt(84);
    const b = pt(85);
    const free = placeOnTrack(g, (a.lat + b.lat) / 2, (a.lon + b.lon) / 2);
    expect(placeOnTrack(g, (a.lat + b.lat) / 2, (a.lon + b.lon) / 2, free.d - 20).d).toBeCloseTo(free.d, 3);
  });
});

/** A state array with car records at the feed's field positions. */
function state(cars: { n: string; lat?: number; lon?: number; mph?: number; pit?: boolean; pct?: number; stale?: boolean }[]) {
  const recs = cars.map((c) => {
    const r: unknown[] = new Array(70).fill(null);
    r[2] = c.n;
    r[34] = !!c.pit;
    r[37] = !!c.stale;
    r[47] = c.lat ?? null;
    r[48] = c.lon ?? null;
    r[54] = c.mph ?? null;
    r[66] = c.pct ?? null;
    return r;
  });
  const s: unknown[] = new Array(20).fill(null);
  s[14] = recs;
  return s;
}

describe("positionsFromState", () => {
  it("places every car, flags the pit lane, and falls back to the lap share without GPS", () => {
    const pos = positionsFromState(
      state([
        { n: "119", lat: pt(10).lat, lon: pt(10).lon, mph: 104 },
        { n: "87", lat: pt(0).lat, lon: pt(0).lon, mph: 31, pit: true },
        { n: "282", pct: 50 },
        { n: "5" },
        { n: "99", lat: 27.46, lon: -81.36 }, // far off the circuit
      ]),
      g,
      1000
    )!;
    const by = Object.fromEntries(pos.cars.map((c) => [c[0], c]));
    expect(by["119"][1]).toBeCloseTo(pastLine(pt(10).d), -1);
    expect(by["119"][2]).toBe(104);
    expect(by["119"][3]).toBe(0);
    expect(by["87"][3] & IN_PIT).toBe(IN_PIT);
    expect(by["282"]).toEqual(["282", Math.round(g.len / 2), null, NO_GPS]);
    expect(by["5"]).toEqual(["5", null, null, NO_GPS]);
    expect(by["99"][1]).toBeNull();
    expect(pos.t).toBe(1000);
  });
  it("is null for anything that is not a state", () => {
    expect(positionsFromState({}, g, 0)).toBeNull();
  });
});

/** A GPS point `m` metres to the side of the centreline, halfway between points i and i + 1. */
function beside(i: number, m: number): { lat: number; lon: number } {
  const a = toXY(g.frame, pt(i).lat, pt(i).lon);
  const b = toXY(g.frame, pt(i + 1).lat, pt(i + 1).lon);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const x = (a.x + b.x) / 2 + (-(b.y - a.y) / len) * m;
  const y = (a.y + b.y) / 2 + ((b.x - a.x) / len) * m;
  return { lat: g.frame.lat0 - y / g.frame.mLat, lon: g.frame.lon0 + x / g.frame.mLon };
}

describe("cars off the track", () => {
  it("sends a car well off the centreline with its own point, and its nearest place on the lap", () => {
    const off = beside(40, 45);
    const pos = positionsFromState(state([{ n: "555", ...off }, { n: "87", ...beside(40, 6) }]), g, 0)!;
    const by = Object.fromEntries(pos.cars.map((c) => [c[0], c]));
    expect(by["555"][3] & OFF_TRACK).toBe(OFF_TRACK);
    const xy = toXY(g.frame, off.lat, off.lon);
    expect(by["555"][4]).toEqual([Math.round(xy.x), Math.round(xy.y)]);
    expect(by["555"][1]).not.toBeNull();
    // A car on the edge of the track stays on it.
    expect(by["87"][3] & OFF_TRACK).toBe(0);
    expect(by["87"]).toHaveLength(4);
  });

  it("now places a car towed across the infield (over 60 m off) where it is, not by the lap share", () => {
    const pos = positionsFromState(state([{ n: "555", ...beside(40, 150), pct: 90 }]), g, 0)!;
    expect(pos.cars[0][3] & (OFF_TRACK | NO_GPS)).toBe(OFF_TRACK);
    expect(pos.cars[0][4]).toBeDefined();
  });

  it("does not flicker on the edge: once off, back on only within 15 m", () => {
    const wasOff = new Set<string>();
    const at = (m: number) => positionsFromState(state([{ n: "5", ...beside(40, m) }]), g, 0, undefined, wasOff)!.cars[0][3] & OFF_TRACK;
    expect(at(20)).toBe(0);
    expect(at(30)).toBe(OFF_TRACK);
    expect(at(20)).toBe(OFF_TRACK);
    expect(at(10)).toBe(0);
    expect(at(20)).toBe(0);
  });

  it("leaves pit-lane cars and stale fixes as they were", () => {
    const pos = positionsFromState(
      state([
        { n: "1", ...beside(40, 45), pit: true },
        { n: "2", ...beside(40, 45), stale: true },
      ]),
      g,
      0
    )!;
    for (const c of pos.cars) {
      expect(c[3] & OFF_TRACK).toBe(0);
      expect(c).toHaveLength(4);
    }
  });

  it("gives no point for a fix far beyond the map (GPS garbage)", () => {
    const pos = positionsFromState(state([{ n: "9", lat: g.frame.lat0 + 0.05, lon: g.frame.lon0 - 0.05 }]), g, 0)!;
    expect(pos.cars[0][3] & OFF_TRACK).toBe(0);
    expect(pos.cars[0][1]).toBeNull();
  });
});
