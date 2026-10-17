/**
 * RaceTrace Live wire format (pure): a compact full chart, and deltas that
 * carry only what changed since a version the phone already holds.
 *
 * Lap rows travel as arrays, not objects. Each payload describes its own rows
 * in `enc`:
 *   - cols:    the keys of each row array, in order;
 *   - dict:    string columns sent as an index into a list ("GREEN" → 0);
 *   - consts:  columns with one value on every row (speed 0 from this feed);
 *   - derived: columns the phone rebuilds (`lt` = lapTimeText(ltSec)), sent only
 *              when every row's text matches that rebuild exactly.
 * client/src/features/live/wire.ts reverses this; the two share LAP_TIME_CASES.
 *
 * A delta works per car: the version the phone holds is remembered as each
 * car's lap count and a hash of those laps, plus a hash every CHECKPOINT laps.
 * When the car's first laps still hash the same, only the newer laps are sent.
 * When an earlier lap changed (the timing marks an in-lap as a pit lap after
 * the fact), the car is resent from the last checkpoint that still matches,
 * not from lap 1. Car details and pit markers are sent only when their hash
 * changed.
 */
import { createHash } from "node:crypto";
import type { RaceDataJson } from "../utils/race-validators.js";

type Lap = RaceDataJson["cars"][string]["laps"][number];
type Car = RaceDataJson["cars"][string];
type Row = (string | number | boolean | null)[];

/** Seconds → "2:19.637" / "1:02:03.456" (the lap-time text the feed's CSVs carry). The phone has the same function. */
export function lapTimeText(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(3).padStart(6, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Shared with the client's tests, so both sides rebuild `lt` the same way. */
export const LAP_TIME_CASES: [number, string][] = [
  [139.637, "2:19.637"],
  [59.9995, "1:00.000"],
  [0.001, "0:00.001"],
  [3723.456, "1:02:03.456"],
  [600, "10:00.000"],
];

export interface RowEncoding {
  cols: string[];
  dict: Record<string, string[]>;
  consts: Record<string, string | number | boolean | null>;
  derived: string[];
}

export interface WireCar {
  /** Car fields except laps (absent in a delta when unchanged). */
  h?: Omit<Car, "laps">;
  /** In a delta: the laps the phone keeps (0 = replace them all). */
  from?: number;
  /** Lap rows (arrays, see `enc`). */
  L: Row[];
}

export type WireTop = Omit<RaceDataJson, "cars">;

export interface WireFull {
  kind: "full";
  v: number;
  enc: RowEncoding;
  top: WireTop;
  cars: Record<string, WireCar>;
  annotations: Record<string, unknown>;
  /** Lap rows in the whole chart, for the phone's check. */
  total: number;
}

export interface WireDelta {
  kind: "delta";
  base: number;
  v: number;
  enc: RowEncoding;
  top: WireTop;
  cars: Record<string, WireCar>;
  removed: string[];
  ann: Record<string, unknown>;
  annRemoved: string[];
  total: number;
}

/** Laps between remembered hashes of a car's laps. */
export const CHECKPOINT = 10;

/** What a phone holding this version has, per car: [lap count, hash of those laps, hash at every CHECKPOINT laps], plus detail and marker hashes. */
export interface VersionSummary {
  laps: Record<string, [number, string, string[]]>;
  heads: Record<string, string>;
  anns: Record<string, string>;
}

const h16 = (s: string) => createHash("sha1").update(s).digest("base64").slice(0, 16);

/** Chained hash of each car's laps: prefix[k] covers its first k laps. */
export function lapPrefixes(data: RaceDataJson): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [num, car] of Object.entries(data.cars)) {
    const p = [""];
    for (const lap of car.laps) p.push(h16(p[p.length - 1] + JSON.stringify(lap)));
    out[num] = p;
  }
  return out;
}

function headOf(car: Car): Omit<Car, "laps"> {
  const { laps: _laps, ...head } = car;
  return head;
}

export function summarize(data: RaceDataJson, annotations: Record<string, unknown>, prefixes = lapPrefixes(data)): VersionSummary {
  const s: VersionSummary = { laps: {}, heads: {}, anns: {} };
  for (const [num, car] of Object.entries(data.cars)) {
    const p = prefixes[num];
    const cps: string[] = [];
    for (let k = CHECKPOINT; k <= car.laps.length; k += CHECKPOINT) cps.push(p[k]);
    s.laps[num] = [car.laps.length, p[car.laps.length], cps];
    s.heads[num] = h16(JSON.stringify(headOf(car)));
  }
  for (const [k, a] of Object.entries(annotations)) s.anns[k] = h16(JSON.stringify(a));
  return s;
}

/** The encoding for a set of lap rows. */
export function rowEncoding(laps: Lap[]): RowEncoding {
  const cols: string[] = [];
  for (const l of laps) for (const k of Object.keys(l)) if (!cols.includes(k)) cols.push(k);
  const rows = laps as unknown as Record<string, unknown>[];
  const has = (k: string) => rows.every((r) => k in r);
  const consts: RowEncoding["consts"] = {};
  const derived: string[] = [];
  const dict: RowEncoding["dict"] = {};
  if (has("lt") && has("ltSec") && rows.every((r) => typeof r.ltSec === "number" && r.lt === lapTimeText(r.ltSec as number))) derived.push("lt");
  for (const k of cols) {
    if (derived.includes(k) || !has(k) || rows.length === 0) continue;
    const v0 = rows[0][k];
    if ((v0 === null || typeof v0 !== "object") && rows.every((r) => r[k] === v0)) consts[k] = v0 as string | number | boolean | null;
  }
  for (const k of cols) {
    if (derived.includes(k) || k in consts || !rows.every((r) => typeof r[k] === "string")) continue;
    const vals = [...new Set(rows.map((r) => r[k] as string))];
    if (vals.length <= 32) dict[k] = vals;
  }
  // A column some rows lack stays a plain column (null where missing) only if no row holds null itself.
  return { cols: cols.filter((k) => !derived.includes(k) && !(k in consts)), dict, consts, derived };
}

export function encodeRows(laps: Lap[], enc: RowEncoding): Row[] {
  return (laps as unknown as Record<string, unknown>[]).map((r) =>
    enc.cols.map((k) => {
      const v = k in r ? r[k] : null;
      return enc.dict[k] ? enc.dict[k].indexOf(v as string) : (v as Row[number]);
    })
  );
}

const totalLaps = (data: RaceDataJson) => Object.values(data.cars).reduce((n, c) => n + c.laps.length, 0);

const topOf = (data: RaceDataJson): WireTop => {
  const { cars: _cars, ...top } = data;
  return top;
};

export function encodeFull(v: number, data: RaceDataJson, annotations: Record<string, unknown>): WireFull {
  const all = Object.values(data.cars).flatMap((c) => c.laps);
  const enc = rowEncoding(all);
  const cars: Record<string, WireCar> = {};
  for (const [num, car] of Object.entries(data.cars)) cars[num] = { h: headOf(car), L: encodeRows(car.laps, enc) };
  return { kind: "full", v, enc, top: topOf(data), cars, annotations, total: totalLaps(data) };
}

export function encodeDelta(
  base: number,
  baseSummary: VersionSummary,
  v: number,
  data: RaceDataJson,
  annotations: Record<string, unknown>,
  prefixes = lapPrefixes(data)
): WireDelta {
  const plan: { num: string; car: Car; from: number; head: boolean }[] = [];
  for (const [num, car] of Object.entries(data.cars)) {
    const had = baseSummary.laps[num];
    const keep = had ? keptLaps(had, prefixes[num], car.laps.length) : 0;
    const head = baseSummary.heads[num] !== summarizeHead(car);
    if (keep === car.laps.length && !head && had) continue;
    plan.push({ num, car, from: keep, head: head || !had });
  }
  const enc = rowEncoding(plan.flatMap((p) => p.car.laps.slice(p.from)));
  const cars: Record<string, WireCar> = {};
  for (const p of plan) cars[p.num] = { ...(p.head ? { h: headOf(p.car) } : {}), from: p.from, L: encodeRows(p.car.laps.slice(p.from), enc) };
  const ann: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(annotations)) if (baseSummary.anns[k] !== h16(JSON.stringify(a))) ann[k] = a;
  return {
    kind: "delta",
    base,
    v,
    enc,
    top: topOf(data),
    cars,
    removed: Object.keys(baseSummary.laps).filter((n) => !data.cars[n]),
    ann,
    annRemoved: Object.keys(baseSummary.anns).filter((k) => !(k in annotations)),
    total: totalLaps(data),
  };
}

const summarizeHead = (car: Car) => h16(JSON.stringify(headOf(car)));

/** How many of a car's first laps the phone already has right: all it had, else the last matching checkpoint. */
export function keptLaps(had: [number, string, string[]], prefix: string[], nowLaps: number): number {
  const [count, hash, cps] = had;
  if (count <= nowLaps && prefix[count] === hash) return count;
  for (let j = Math.min(cps.length, Math.floor(nowLaps / CHECKPOINT)); j >= 1; j--) if (prefix[j * CHECKPOINT] === cps[j - 1]) return j * CHECKPOINT;
  return 0;
}
