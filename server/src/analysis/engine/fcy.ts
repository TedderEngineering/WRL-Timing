/**
 * M3 FCY periods (D-FCY-SOURCE, D-FCY-RECON) and M4 per-lap FCY state (D-FCY-LAP).
 */
import type { FcyPeriod, FlagEvent, Source } from "../schema/package-types.js";
import type { Issue } from "../types.js";
import { rd } from "../util.js";
import { tp, type Ctx, type LapRows } from "./context.js";

export interface Period {
  start: number;
  end: number;
  type: FcyPeriod["type"];
  endsAtFinish: boolean;
  rank: 1 | 2 | 3;
  refs: string[];
  files: string[];
  recon?: { lastGreen: number | null; firstFcy: number; lastFcy: number; firstGreen: number | null; crossings: number; startInLap1: boolean };
  confidence: "high" | "medium" | "low";
  notes: string[];
}

const START_TYPES: Record<string, FcyPeriod["type"]> = { FCY: "fcy", SC: "safety_car", RF: "red", RED: "red", CODE60: "code_60" };

/** D-FCY-RECON: hybrid reconstruction from the flag at the line of every crossing. */
export function reconstructFcy(laps: LapRows, origin: number, raceEnd: number): Period[] {
  const xs: { t: number; code: string; flag: string }[] = [];
  for (const rows of Object.values(laps)) {
    for (const r of rows) {
      if (!r.flag) continue;
      const code = r.flag === "Y" || r.flag === "R" || r.flag === "S" ? "FCY" : r.flag === "G" ? "GF" : "C";
      xs.push({ t: r.endT, code, flag: r.flag });
    }
  }
  // Same tie order as the Stage 1 tools: by time, then code ('C' < 'FCY' < 'GF').
  xs.sort((a, b) => a.t - b.t || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const out: Period[] = [];
  let cur: Period | null = null;
  let lastG: number | null = null;
  let n = 0;
  let red = false;
  let sc = false;
  for (const x of xs) {
    if (x.code === "FCY") {
      if (!cur) {
        const lg = lastG ?? origin;
        cur = {
          start: (lg + x.t) / 2,
          end: NaN,
          type: "fcy",
          endsAtFinish: false,
          rank: 3,
          refs: [],
          files: [],
          recon: { lastGreen: lastG ?? origin, firstFcy: x.t, lastFcy: x.t, firstGreen: null, crossings: 0, startInLap1: lastG === null },
          confidence: "medium",
          notes: ["fcy_reconstructed"],
        };
        n = 0;
        red = false;
        sc = false;
      }
      cur.recon!.lastFcy = x.t;
      n++;
      if (x.flag === "R") red = true;
      if (x.flag === "S") sc = true;
    } else if (x.code === "GF") {
      if (cur) {
        cur.end = x.t;
        cur.recon!.firstGreen = x.t;
        finish(cur, n, red, sc);
        out.push(cur);
        cur = null;
      }
      lastG = x.t;
    }
  }
  if (cur) {
    cur.end = raceEnd;
    cur.endsAtFinish = true;
    finish(cur, n, red, sc);
    out.push(cur);
  }
  return out;
}

function finish(p: Period, n: number, red: boolean, sc: boolean): void {
  p.recon!.crossings = n;
  p.type = red ? "red" : sc ? "safety_car" : "fcy";
  if (p.recon!.startInLap1) p.notes.push("fcy_start_in_lap_1");
  if (n < 10) {
    p.confidence = "low";
    p.notes.push("fewer_than_10_crossings");
  }
}

export interface FcyResult {
  periods: Period[];
  /** Raw records for events.flags. */
  flags: FlagEvent[];
  source: "flags" | "race_control" | "reconstruction";
}

/** A caution record shorter than this, starting within START_BLIP_WINDOW_S of the green, is the start signal. */
export const START_BLIP_S = 20;
export const START_BLIP_WINDOW_S = 5;

export function buildFcyPeriods(ctx: Ctx): FcyResult {
  const { race, laps, issues } = ctx;
  const recon = reconstructFcy(laps, ctx.axis.origin, ctx.raceEndT);
  let official: Period[] = [];
  let source: FcyResult["source"] = "reconstruction";

  // Rank 1: flags file records.
  const recs = [...race.flagRecords].sort((a, b) => a.tS - b.tS);
  const hasFlagRecords = recs.some((r) => ["GF", "FCY", "SC", "FF"].includes(r.recType.toUpperCase()));
  if (hasFlagRecords) {
    source = "flags";
    let cur: Period | null = null;
    for (const r of recs) {
      const typ = START_TYPES[r.recType.toUpperCase()];
      if (typ && !cur) {
        cur = { start: r.tS, end: NaN, type: typ, endsAtFinish: false, rank: 1, refs: [`${r.fileId}:L${r.row}`], files: [r.fileId], confidence: "high", notes: [] };
      } else if (typ && cur && typ === "red") {
        cur.type = "red";
      } else if (r.recType.toUpperCase() === "GF" && cur) {
        cur.end = r.tS;
        cur.refs.push(`${r.fileId}:L${r.row}`);
        official.push(cur);
        cur = null;
      }
      // FF (chequered) does not end an FCY (D-FCY-SOURCE).
    }
    if (cur) {
      cur.end = ctx.raceEndT;
      cur.endsAtFinish = true;
      official.push(cur);
    }
    // A caution record a few seconds long right at the green is the start signal, not a caution (no
    // full-course caution lasts that long): Mustang COTA 2026 Race 1, FCY 0.001-10.053 s.
    const blips = official.filter((p) => p.type !== "red" && p.end - p.start < START_BLIP_S && p.start - ctx.axis.origin <= START_BLIP_WINDOW_S);
    if (blips.length) {
      official = official.filter((p) => !blips.includes(p));
      issues.push({
        severity: "note",
        code: "FCY-START-BLIP",
        message: `${blips.length} caution record(s) under ${START_BLIP_S} s at the start (${blips.map((p) => `${rd(p.start - ctx.axis.origin, 3)}-${rd(p.end - ctx.axis.origin, 3)} s`).join(", ")}) are the start signal, not a caution period; not counted.`,
      });
    }
  } else {
    // Rank 2: race-control texts.
    const msgs = race.raceControl.filter((m) => m.tS !== null).sort((a, b) => a.tS! - b.tS!);
    let cur: Period | null = null;
    let any = false;
    for (const m of msgs) {
      const t = m.text.toUpperCase();
      if (/FULL COURSE YELLOW|\bFCY\b|SAFETY CAR|CODE 35|CODE 60/.test(t) && !/END|WITHDRAWN|IN THIS LAP/.test(t)) {
        any = true;
        if (!cur) {
          cur = {
            start: m.tS!,
            end: NaN,
            type: /SAFETY CAR/.test(t) ? "safety_car" : /CODE 60/.test(t) ? "code_60" : "fcy",
            endsAtFinish: false,
            rank: 2,
            refs: [`${m.fileId}:L${m.row}`],
            files: [m.fileId],
            confidence: "medium",
            notes: ["fcy_rank2_race_control"],
          };
        }
      } else if (/^GREEN FLAG|GREEN GREEN|RESTART/.test(t) && cur) {
        cur.end = m.tS!;
        cur.refs.push(`${m.fileId}:L${m.row}`);
        official.push(cur);
        cur = null;
      }
    }
    if (cur) {
      cur.end = ctx.raceEndT;
      cur.endsAtFinish = true;
      official.push(cur);
    }
    if (any) source = "race_control";
    else official = [];
  }

  let periods: Period[];
  if (source === "reconstruction") {
    periods = recon;
    if (recon.length) {
      issues.push({ severity: "note", code: "FCY-RECONSTRUCTED", message: `No flags file or race-control log: ${recon.length} FCY period(s) reconstructed from the flag at the line (D-FCY-RECON, confidence medium).` });
    }
  } else {
    periods = official;
    // Cross-check against the reconstruction (> 30 s → warning); reconstruction-only periods are added at low confidence.
    for (const p of official) {
      const r = recon.find((q) => q.start < p.end && q.end > p.start);
      if (!r) continue;
      const ds = Math.abs(r.start - p.start);
      const de = Math.abs(r.end - p.end);
      if (ds > 30 || de > 30) {
        issues.push({
          severity: "warning",
          code: "FCY-SOURCE-DISAGREE",
          message: `FCY at ${rd(p.start - ctx.axis.origin)} s: the reconstruction from the flag at the line differs by ${rd(ds, 1)} s (start) / ${rd(de, 1)} s (end).`,
        });
      }
    }
    for (const r of recon) {
      if (official.some((p) => r.start < p.end && r.end > p.start)) continue;
      const q: Period = { ...r, confidence: "low", notes: [...r.notes, "fcy_only_in_reconstruction"] };
      periods.push(q);
      issues.push({
        severity: "warning",
        code: "FCY-SOURCE-DISAGREE",
        message: `A caution seen only in the flag at the line (${rd(r.start - ctx.axis.origin)}–${rd(r.end - ctx.axis.origin)} s, ${r.recon!.crossings} crossings) is not in the ${source === "flags" ? "flags file" : "race-control log"}; added at confidence low.`,
      });
    }
    periods.sort((a, b) => a.start - b.start);
  }

  // events.flags
  const flags: FlagEvent[] = [];
  const leaderLapAt = leaderLapFinder(ctx);
  const pushFlag = (type: FlagEvent["type"], t: number, src: Source, message?: string, classes?: string[]) => {
    const fe: FlagEvent = { id: `flag:${flags.length + 1}`, type, at: tp(ctx, t), leaderLap: leaderLapAt(t), source: src };
    if (message) fe.message = message;
    if (classes) fe.classes = classes;
    flags.push(fe);
  };
  const flagLike: { t: number; type: FlagEvent["type"]; src: Source; msg?: string; classes?: string[] }[] = [];
  for (const r of recs) {
    const rt = r.recType.toUpperCase();
    const type: FlagEvent["type"] | null = rt === "GF" ? "green" : rt === "FCY" ? "fcy" : rt === "SC" ? "safety_car" : rt === "FF" ? "chequered" : rt === "RF" || rt === "RED" ? "red" : null;
    if (type) flagLike.push({ t: r.tS, type, src: { kind: "official", files: [r.fileId], refs: [`${r.fileId}:L${r.row}`] }, msg: r.flag || r.message || undefined });
  }
  for (const m of race.raceControl) {
    if (m.tS === null) continue;
    const t = m.text.trim();
    const open = t.match(/^PITS?\s+(?:ARE\s+)?OPEN(?:\s+(.*))?$/i);
    const closed = t.match(/^PITS?\s+(?:ARE\s+)?CLOSED(?:\s+(.*))?$/i);
    if (open || closed) {
      const scope = ((open ?? closed)![1] ?? "").trim();
      const classes = !scope || /ALL CARS|ALL CLASSES/i.test(scope) ? [] : scope.split(/[,/&]|\s+AND\s+/i).map((s) => s.trim()).filter(Boolean);
      flagLike.push({ t: m.tS, type: open ? "pits_open" : "pits_closed", src: { kind: "official", files: [m.fileId], refs: [`${m.fileId}:L${m.row}`] }, msg: t, classes });
    }
  }
  flagLike.sort((a, b) => a.t - b.t);
  for (const f of flagLike) pushFlag(f.type, f.t, f.src, f.msg, f.type === "pits_open" || f.type === "pits_closed" ? f.classes ?? [] : undefined);
  return { periods, flags, source };
}

export function leaderLapFinder(ctx: Ctx): (t: number) => number | null {
  const lead = leaderCrossings(ctx);
  return (t: number) => {
    for (const x of lead) if (x.start <= t && t < x.end + 0.001) return x.lap;
    return null;
  };
}

/** Overall leader's lap L = the earliest crossing of lap L, with that row's interval. */
export function leaderCrossings(ctx: Ctx): { lap: number; start: number; end: number }[] {
  const best = new Map<number, { start: number; end: number }>();
  for (const rows of Object.values(ctx.laps)) {
    for (const r of rows) {
      const b = best.get(r.lap);
      if (!b || r.endT < b.end) best.set(r.lap, { start: r.startT, end: r.endT });
    }
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([lap, v]) => ({ lap, ...v }));
}

/** M4: fcyFrac and fcy state per lap. */
export function classifyLapFcy(laps: LapRows, periods: Period[]): void {
  for (const rows of Object.values(laps)) {
    for (const r of rows) {
      const dur = r.endT - r.startT;
      let o = 0;
      for (const p of periods) o += Math.max(0, Math.min(r.endT, p.end) - Math.max(r.startT, p.start));
      r.fcyFrac = dur > 0 ? Math.min(1, rd(o / dur)) : 0;
      r.fcy = o <= 0 ? 0 : o >= dur - 0.001 ? 2 : 1;
    }
  }
}

export function toFcyPeriods(ctx: Ctx, periods: Period[], flags: FlagEvent[]): FcyPeriod[] {
  const lead = leaderCrossings(ctx);
  return periods.map((p, i) => {
    const ll = lead.filter((x) => x.start < p.end && x.end > p.start).map((x) => x.lap);
    const src: Source = {
      kind: p.rank === 3 ? "reconstructed" : "official",
      method: p.rank === 3 ? "D-FCY-RECON" : "D-FCY-SOURCE",
    };
    if (p.files.length) src.files = p.files;
    if (p.refs.length) src.refs = p.refs;
    if (p.rank === 3) src.files = [...new Set(Object.values(ctx.laps).flatMap((rs) => rs.slice(0, 1).map((r) => r.fileId)))];
    const fp: FcyPeriod = {
      id: `fcy:${i + 1}`,
      type: p.type,
      start: tp(ctx, p.start),
      end: tp(ctx, p.end),
      endsAtFinish: p.endsAtFinish,
      leaderLaps: ll.length ? [ll[0], ll[ll.length - 1]] : [1, 1],
      durationS: rd(p.end - p.start),
      source: src,
      confidence: p.confidence,
    };
    if (p.notes.length) fp.confidenceNotes = [...new Set(p.notes)];
    const po = flags.filter((f) => f.type === "pits_open" && f.at.raceTimeS >= rd(p.start - ctx.axis.origin) && f.at.raceTimeS <= rd(p.end - ctx.axis.origin));
    if (po.length) fp.pitsOpen = po.map((f) => ({ flagId: f.id, classes: f.classes ?? [] }));
    if (p.recon) {
      fp.reconstruction = {
        lastGreenCrossingS: p.recon.lastGreen === null ? null : rd(p.recon.lastGreen - ctx.axis.origin),
        firstFcyCrossingS: rd(p.recon.firstFcy - ctx.axis.origin),
        lastFcyCrossingS: rd(p.recon.lastFcy - ctx.axis.origin),
        firstGreenCrossingS: p.recon.firstGreen === null ? null : rd(p.recon.firstGreen - ctx.axis.origin),
      };
    }
    return fp;
  });
}

export function periodIdsTouching(periods: Period[], a: number, b: number): string[] {
  const out: string[] = [];
  periods.forEach((p, i) => {
    if (a < p.end && b > p.start) out.push(`fcy:${i + 1}`);
  });
  return out;
}

export type { Issue };
