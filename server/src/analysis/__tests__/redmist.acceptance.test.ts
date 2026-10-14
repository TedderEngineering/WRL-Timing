/**
 * RedMist acceptance on real races (skipped without RACETRACE_FIXTURE_DATA; the files are third-party
 * data and are not in the repo):
 *   $RACETRACE_FIXTURE_DATA/redmist_wd_sat/      WRL West Desert 2026, Saturday 8 Hour (with the Flagtronics pit report)
 *   $RACETRACE_FIXTURE_DATA/redmist_barber_sat/  WRL Barber 2026, Saturday 8 Hour (laps only)
 *   $RACETRACE_FIXTURE_DATA/barber/              the same Barber race from Speedhive (cross-check)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFacts, type FactsPackage } from "../buildFacts.js";
import { validatePackage } from "../validate-package.js";
import { median } from "../util.js";
import { FIXTURE_RACES, fixtureAvailable, loadFixtureInputs, type FixtureRace } from "./fixture-races.js";

const GEN = "2026-10-14T00:00:00Z";

export const REDMIST_RACES: FixtureRace[] = [
  {
    race: "redmist_wd_sat",
    format: "redmist",
    files: [/_laps\.json$/, /_pits\.json$/, /_results\.json$/, /_flags\.json$/, /_control\.json$/],
    options: {
      series: "World Racing League",
      event: "West Desert 2026",
      session: "Saturday 8 Hour",
      track: { id: "utah-motorsports-campus", name: "Utah Motorsports Campus", timezone: "America/Denver" },
      rulebook: { id: "wrl-2026", version: "0.1.0", pitCycleModel: "windows" },
      packageId: "wrl-2026-west-desert-sat-8h-redmist",
      generatedAt: GEN,
    },
  },
  {
    race: "redmist_barber_sat",
    format: "redmist",
    files: [/_laps\.json$/, /_results\.json$/, /_flags\.json$/, /_control\.json$/],
    options: {
      series: "World Racing League",
      event: "Barber 8 Hour",
      session: "Saturday 8 Hour",
      track: { id: "barber-motorsports-park", name: "Barber Motorsports Park", timezone: "America/Chicago" },
      rulebook: { id: "wrl-2026", version: "0.1.0", pitCycleModel: "windows" },
      packageId: "wrl-2026-barber-sat-8h-redmist",
      generatedAt: GEN,
    },
  },
];

const wd = REDMIST_RACES[0];
const barberRm = REDMIST_RACES[1];
const barberSh = FIXTURE_RACES.find((r) => r.race === "barber")!;

async function build(fr: FixtureRace): Promise<{ pkg: FactsPackage; files: Awaited<ReturnType<typeof loadFixtureInputs>> }> {
  const files = await loadFixtureInputs(fr);
  return { pkg: buildFacts({ format: fr.format, files, options: fr.options }), files };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

describe("RedMist West Desert 2026 Saturday 8 Hour (RACETRACE_FIXTURE_DATA)", () => {
  it.skipIf(!fixtureAvailable(wd.race))("every pit-report stop is exactly one passage with its laps and pit-lane time; package validates", async () => {
    const { pkg, files } = await build(wd);
    expect(validatePackage(pkg, { publish: false }).errors).toEqual([]);
    const pitFile = files.findIndex((f) => f.role === "pit_cards_json");
    const fileId = `f${pitFile + 1}`;
    const report = JSON.parse(files[pitFile].text!).pitStops as { carNumber: string; stopNumber: number; startLap: number; endLap: number; pitEntryTime: string | null; pitDurationMs: number | null }[];
    const pp = pkg.events.pitPassages;
    const corrected: string[] = [];
    for (const s of report) {
      const ref = `${fileId}:stop:${s.carNumber}:${s.stopNumber}`;
      const hits = pp.filter((p) => p.source.refs?.includes(ref));
      expect(hits, ref).toHaveLength(1);
      const p = hits[0];
      expect(p.car).toBe(s.carNumber);
      if (p.kind === "pit_lane_start" || p.outcome === "retired") expect(p.officialPitLaneTimeS).toBeNull();
      else expect(p.officialPitLaneTimeS).toBe(s.pitDurationMs === null ? null : r3(s.pitDurationMs / 1000));
      if (s.pitEntryTime) expect(p.pitIn).not.toBeNull();
      else expect(p.pitIn).toBeNull();
      if (p.inLap !== s.startLap || p.outLap !== s.endLap) {
        corrected.push(`${s.carNumber} ${s.startLap}-${s.endLap}→${p.inLap}-${p.outLap}`);
        expect(p.confidenceNotes).toContain("pit_report_laps_corrected");
        // the correction moves the in-lap earlier, or the out-lap later / to none - never the other way
        expect(p.inLap).toBeLessThanOrEqual(s.startLap);
        if (p.outLap !== null) expect(p.outLap).toBeGreaterThanOrEqual(s.endLap);
      }
    }
    const fromReport = pp.filter((p) => p.source.kind === "official");
    const extra = pp.filter((p) => p.source.kind !== "official");
    expect(fromReport).toHaveLength(report.length);
    expect(corrected.length).toBeLessThanOrEqual(10);

    const green = pp.filter((p) => p.kind === "stop" && p.fcyContext === "green" && p.officialPitLaneTimeS !== null && p.pitLaneTimeReliable && p.timeLost.valueS !== null);
    const fcy = pp.filter((p) => p.kind === "stop" && p.fcyContext !== "green");
    const medPl = median(green.map((p) => p.officialPitLaneTimeS!))!;
    const medTl = median(green.map((p) => p.timeLost.valueS!))!;
    const medFcy = median(fcy.filter((p) => p.timeLost.valueS !== null).map((p) => p.timeLost.valueS!))!;
    // Sanity: a WRL green stop loses about its pit-lane time (the in/out-lap effect roughly cancels the
    // track distance the pit lane replaces); a stop under caution loses less.
    expect(medTl).toBeGreaterThan(60);
    expect(medTl).toBeLessThan(220);
    expect(Math.abs(medTl - medPl)).toBeLessThan(40);
    expect(medFcy).toBeLessThan(medTl);
    console.log(
      `[redmist WD] cars ${pkg.entries.length} (with laps ${Object.keys(pkg.laps.cars).length}), laps ${Object.values(pkg.laps.cars).reduce((a, c) => a + c.lap.length, 0)}, ` +
        `passages ${pp.length} (report ${fromReport.length}, lap flags only ${extra.length}), with pit-in/out clocks ${pp.filter((p) => p.pitIn).length}, duration only ${fromReport.filter((p) => !p.pitIn && p.officialPitLaneTimeS !== null).length}, ` +
        `kinds ${JSON.stringify(pp.reduce<Record<string, number>>((a, p) => ((a[p.kind] = (a[p.kind] ?? 0) + 1), a), {}))}, ` +
        `green stops ${green.length}: median pit lane ${medPl} s, median time lost ${r3(medTl)} s; FCY/mixed stops ${fcy.length}: median time lost ${r3(medFcy)} s; ` +
        `unreliable pit-lane times ${pp.filter((p) => p.pitLaneTimeReliable === false).length}; re-anchored ${corrected.join(", ")}`,
    );
    // T12 determinism
    expect(JSON.stringify(buildFacts({ format: wd.format, files, options: wd.options }))).toEqual(JSON.stringify(pkg));

    // The lap-flag fallback (no pit report, as Barber) against the report on the same race.
    const noRep = buildFacts({ format: wd.format, files: files.filter((f) => f.role !== "pit_cards_json"), options: wd.options });
    expect(validatePackage(noRep, { publish: false }).errors).toEqual([]);
    const key = (p: { car: string; inLap: number; outLap: number | null }) => `${p.car} ${p.inLap}-${p.outLap ?? "none"}`;
    const withRep = new Set(pp.filter((p) => p.kind !== "pit_lane_start").map(key));
    const fb = new Set(noRep.events.pitPassages.map(key));
    const both = [...fb].filter((k) => withRep.has(k));
    expect(both.length / withRep.size).toBeGreaterThan(0.95);
    console.log(
      `[redmist WD fallback] lap flags only: ${fb.size} passages; same car+in+out laps as the report-anchored passages: ${both.length} of ${withRep.size}; ` +
        `report-only ${[...withRep].filter((k) => !fb.has(k)).join(", ")}; flags-only ${[...fb].filter((k) => !withRep.has(k)).join(", ")}`,
    );
  }, 120_000);
});

/** Crossing instants (epoch ms) → lap number, per car, from a package. */
function crossings(pkg: FactsPackage): Map<string, { byT: Map<number, number>; t: Map<number, number>; lt: Map<number, number | null> }> {
  const origin = Date.parse(pkg.metadata.timeOrigin);
  const out = new Map<string, { byT: Map<number, number>; t: Map<number, number>; lt: Map<number, number | null> }>();
  for (const [car, c] of Object.entries(pkg.laps.cars)) {
    const byT = new Map<number, number>();
    const t = new Map<number, number>();
    const lt = new Map<number, number | null>();
    c.lap.forEach((lap, i) => {
      const ms = Math.round(origin + c.endS[i] * 1000);
      byT.set(ms, lap);
      t.set(lap, ms);
      lt.set(lap, c.lapTimeS[i]);
    });
    out.set(car, { byT, t, lt });
  }
  return out;
}

function shLapAt(x: { byT: Map<number, number> } | undefined, ms: number | undefined): number | null {
  if (!x || ms === undefined) return null;
  // Same crossing: within 20 ms (two Barber cars run about 9 ms apart on the two systems, another transponder).
  for (let k = 0; k <= 20; k++) {
    for (const d of k ? [-k, k] : [0]) {
      const v = x.byT.get(ms + d);
      if (v !== undefined) return v;
    }
  }
  return null;
}

describe("RedMist Barber 2026 Saturday 8 Hour vs Speedhive (RACETRACE_FIXTURE_DATA)", () => {
  it.skipIf(!fixtureAvailable(barberRm.race) || !fixtureAvailable(barberSh.race))("same crossings and lap times; lap-flag passages match Speedhive's In Pit passages", async () => {
    const { pkg: rm } = await build(barberRm);
    const { pkg: sh } = await build(barberSh);
    expect(validatePackage(rm, { publish: false }).errors).toEqual([]);
    const xr = crossings(rm);
    const xs = crossings(sh);
    expect([...xr.keys()].sort()).toEqual([...xs.keys()].sort());

    // Lap times on the same crossing (matched by time of day to the millisecond).
    let matched = 0;
    let same = 0;
    let rmRows = 0;
    const renumbered: string[] = [];
    const diffs: string[] = [];
    for (const [car, r] of xr) {
      const s = xs.get(car)!;
      for (const [lap, ms] of r.t) {
        rmRows++;
        const shLap = shLapAt(s, ms);
        if (shLap === null) continue;
        matched++;
        const a = r.lt.get(lap);
        const b = s.lt.get(shLap);
        if (a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) < 0.0005) same++;
        else if (diffs.length < 8) diffs.push(`${car} L${lap}: ${a} vs ${b}`);
        if (shLap !== lap && !renumbered.includes(car)) renumbered.push(car);
      }
    }
    expect(matched / rmRows).toBeGreaterThan(0.98);
    // Identical to the millisecond except cars 669 and 678 (another transponder, 9-18 ms apart) and a
    // handful of laps RedMist recorded without a lap time.
    expect(same / matched).toBeGreaterThan(0.95);

    // Passages: RedMist in-lap translated to Speedhive's lap number through the crossing time.
    const shIn = new Map<string, Set<number>>();
    for (const p of sh.events.pitPassages) {
      if (!shIn.has(p.car)) shIn.set(p.car, new Set());
      shIn.get(p.car)!.add(p.inLap);
    }
    const rmMapped: { car: string; rmLap: number; shLap: number | null }[] = rm.events.pitPassages.map((p) => ({ car: p.car, rmLap: p.inLap, shLap: shLapAt(xs.get(p.car), xr.get(p.car)?.t.get(p.inLap)) }));
    const hit = rmMapped.filter((m) => m.shLap !== null && shIn.get(m.car)?.has(m.shLap));
    const used = new Set(hit.map((m) => `${m.car}:${m.shLap}`));
    const rmOnly = rmMapped.filter((m) => !(m.shLap !== null && shIn.get(m.car)?.has(m.shLap)));
    const shOnly = sh.events.pitPassages.filter((p) => !used.has(`${p.car}:${p.inLap}`));
    const offByOne = rmOnly.filter((m) => m.shLap !== null && shOnly.some((p) => p.car === m.car && Math.abs(p.inLap - m.shLap!) === 1));
    const rate = hit.length / sh.events.pitPassages.length;
    expect(rate).toBeGreaterThan(0.93);
    console.log(
      `[redmist Barber] laps: ${rmRows} RedMist rows, ${matched} on the same crossing as Speedhive, ${same} with an identical lap time (e.g. ${diffs.join("; ")}); RedMist lap numbers differ from Speedhive's (penalty laps) for car ${renumbered.join(", ")}. ` +
        `Passages: RedMist ${rm.events.pitPassages.length}, Speedhive ${sh.events.pitPassages.length}, same car+in-lap ${hit.length} (${(rate * 100).toFixed(1)} %); ` +
        `RedMist-only ${rmOnly.map((m) => `${m.car} L${m.shLap ?? `rm${m.rmLap}`}`).join(", ")}; Speedhive-only ${shOnly.map((p) => `${p.car} L${p.inLap}`).join(", ")}; ` +
        `of which in-lap one lap apart: ${offByOne.length}`,
    );
  }, 180_000);
});
