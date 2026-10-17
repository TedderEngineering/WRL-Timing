/**
 * RaceTrace Live wire format, phone side: rebuilds the chart from a compact
 * full payload, and applies a delta to the chart the page already holds.
 * The server half (and the format's description) is server/src/live/wire.ts.
 */
import type { AnnotationData, RaceChartData } from "@shared/types";

type Lap = RaceChartData["cars"][string]["laps"][number];
type Car = RaceChartData["cars"][string];
type Row = (string | number | boolean | null)[];

export interface RowEncoding {
  cols: string[];
  dict: Record<string, string[]>;
  consts: Record<string, string | number | boolean | null>;
  derived: string[];
}

export interface WireCar {
  h?: Omit<Car, "laps">;
  from?: number;
  L: Row[];
}

type WireTop = Omit<RaceChartData, "cars">;

export interface WireFull {
  kind: "full";
  v: number;
  enc: RowEncoding;
  top: WireTop;
  cars: Record<string, WireCar>;
  annotations: Record<string, unknown>;
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
  /** Changed pit markers as patches ([path, value], or [path] to delete). */
  annPatch?: Record<string, AnnPatch[]>;
  annRemoved: string[];
  total: number;
}

export type AnnPatch = [(string | number)[]] | [(string | number)[], unknown];

/** A copy of `obj` with the patches applied (the original is not changed). */
export function applyAnnPatch(obj: unknown, patches: AnnPatch[]): unknown {
  const out = structuredClone(obj) as Record<string | number, unknown>;
  for (const p of patches) {
    const path = p[0];
    if (path.length === 0) return p.length === 2 ? structuredClone(p[1]) : undefined;
    let node = out as Record<string | number, unknown>;
    for (let i = 0; i < path.length - 1; i++) {
      const next = node[path[i]];
      if (next === null || typeof next !== "object") return null; // does not fit: caller asks for a full copy
      node = next as Record<string | number, unknown>;
    }
    const last = path[path.length - 1];
    if (p.length === 2) node[last] = structuredClone(p[1]);
    else delete node[last];
  }
  return out;
}

/** Seconds → "2:19.637" / "1:02:03.456": must match the server's lapTimeText exactly. */
export function lapTimeText(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(3).padStart(6, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function decodeRows(rows: Row[], enc: RowEncoding): Lap[] {
  return rows.map((r) => {
    const o: Record<string, unknown> = { ...enc.consts };
    enc.cols.forEach((k, i) => {
      const v = r[i];
      if (enc.dict[k]) o[k] = enc.dict[k][v as number];
      else if (v !== null) o[k] = v;
    });
    if (enc.derived.includes("lt") && typeof o.ltSec === "number") o.lt = lapTimeText(o.ltSec);
    return o as unknown as Lap;
  });
}

const totalLaps = (cars: RaceChartData["cars"]) => Object.values(cars).reduce((n, c) => n + c.laps.length, 0);

export function applyFull(full: WireFull): { data: RaceChartData; annotations: AnnotationData } {
  const cars: RaceChartData["cars"] = {};
  for (const [num, c] of Object.entries(full.cars)) cars[num] = { ...(c.h as Omit<Car, "laps">), laps: decodeRows(c.L, full.enc) } as Car;
  return { data: { ...full.top, cars } as RaceChartData, annotations: full.annotations as AnnotationData };
}

/**
 * The chart after a delta, or null when the delta does not fit the chart held
 * (the page then asks for a full copy). Cars and pit markers that did not
 * change keep their objects.
 */
export function applyDelta(
  data: RaceChartData,
  annotations: AnnotationData,
  delta: WireDelta
): { data: RaceChartData; annotations: AnnotationData } | null {
  const cars: RaceChartData["cars"] = { ...data.cars };
  for (const n of delta.removed) delete cars[n];
  for (const [num, c] of Object.entries(delta.cars)) {
    const prev = data.cars[num];
    const from = c.from ?? 0;
    if (!prev && !c.h) return null;
    if (from > (prev?.laps.length ?? 0)) return null;
    const head = c.h ?? (({ laps: _laps, ...rest }) => rest)(prev!);
    const kept = from > 0 && prev ? prev.laps.slice(0, from) : [];
    cars[num] = { ...head, laps: kept.concat(decodeRows(c.L, delta.enc)) } as Car;
  }
  if (totalLaps(cars) !== delta.total) return null;
  const ann: Record<string, unknown> = { ...(annotations as Record<string, unknown>) };
  for (const k of delta.annRemoved) delete ann[k];
  Object.assign(ann, delta.ann);
  for (const [k, patches] of Object.entries(delta.annPatch ?? {})) {
    if (!(k in ann)) return null;
    const next = applyAnnPatch(ann[k], patches);
    if (next === null) return null;
    ann[k] = next;
  }
  return { data: { ...delta.top, cars } as RaceChartData, annotations: ann as AnnotationData };
}
