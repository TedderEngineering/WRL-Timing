/**
 * RaceTrace Live replays: a finished WRL race played again on a live race page, for demos.
 *
 * A replay is an ordinary live poller (poller.ts) reading from this module instead of the timing
 * feed. It answers the poller's feed requests as the feed answered them at one moment of the race:
 *   - the session list (the session shown as running), the event, the track map;
 *   - the full lap list, flags and race-control log, cut to what had happened by then;
 *   - the session state: the one the recorder kept at that moment (recorder.ts: every car's GPS
 *     place and speed every 5 s), or, with no recording, one made from the laps (each car placed
 *     on the track map at its lap's pace).
 * The race clock runs in real time from `fromS` (race seconds) to the finish, holds at the finish
 * for HOLD_S, then starts again; every server agrees where in the race it is (it runs from the
 * Unix epoch). Each new run is a new poller epoch, so open pages load the race afresh.
 *
 * Replays are open to everyone (no sign-in, no live key) and never listed with the live races.
 */
import { gunzipSync } from "node:zlib";
import { decode, encode } from "@msgpack/msgpack";
import { createHttpClient, type HttpClient, type HttpGetOptions, type HttpResponse } from "../intake/http.js";
import { eventDisplayName, feedUrls, paced, parseSpan, plausibleDate, sessionClock, type FeedControlEntry, type FeedFlag, type FeedLap, type FeedResults, type FeedSession } from "./feed.js";
import { liveSlug, liveUrls } from "./poller.js";
import { trackFromFeed, type TrackGeometry } from "./track.js";
import { fixTwelveHour } from "./control-times.js";

export interface ReplayDef {
  /** The replay's address: /live/<slug>. Always starts "replay-". */
  slug: string;
  /** The live address the race had (its recording is kept under it). */
  source: string;
  /** The timing feed's event (its session is found by the live address). */
  eventId: number;
  /** Race time the replay starts at (s). */
  fromS: number;
}

export const REPLAYS: ReplayDef[] = [
  {
    slug: "replay-sebring-international-raceway-2026-sunday-7-hour",
    source: "sebring-international-raceway-2026-sunday-7-hour",
    eventId: 485,
    fromS: 5 * 3600,
  },
];

/** The replay holds at the finish this long before it starts again. */
export const HOLD_S = 5 * 60;
/** If loading fails (feed or storage down), try again after this long. */
const RETRY_MS = 60_000;

export const isReplaySlug = (slug: string): boolean => slug.startsWith("replay-");
export const replayDef = (slug: string): ReplayDef | undefined => REPLAYS.find((r) => r.slug === slug);

/** Where recordings are kept (the race file bucket). */
export interface ReplayStore {
  /** Names directly under a folder. */
  list(prefix: string): Promise<string[]>;
  download(path: string): Promise<Buffer | null>;
}

/** A recorded state: race second, and the state as the feed sent it (msgpack). */
interface Frame {
  r: number;
  body: Uint8Array;
}

/** A lap row with its race second (the lap's total time). */
interface TimedLap {
  lap: FeedLap;
  r: number;
}

/** The fields of a feed state array (build.ts SS / CP, track.ts CP). */
const SS = { sessionId: 2, timeToGo: 5, localTimeOfDay: 6, runningRaceTime: 7, entries: 13, cars: 14, flag: 15 } as const;
const CP = { number: 2, class: 4, ttm: 13, ltm: 14, llp: 15, ovp: 20, clp: 21, inPit: 34, lip: 35, flg: 38, dn: 44, lat: 47, lon: 48, mph: 54, lapPct: 66 } as const;

const span = (s: number): string => {
  const x = Math.max(0, s);
  const h = Math.floor(x / 3600);
  const m = Math.floor((x % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${(x % 60).toFixed(3).padStart(6, "0")}`;
};
/** A feed local time ("2026-10-18T09:05:00") → ms, read as UTC (only compared with others like it). */
const localMs = (s: string | null | undefined): number | null => {
  if (!s || !plausibleDate(s)) return null;
  const ms = Date.parse(`${String(s).slice(0, 23)}Z`);
  return Number.isFinite(ms) ? ms : null;
};
const localText = (ms: number) => new Date(ms).toISOString().slice(0, 19);

export class ReplaySource {
  sessionId = 0;
  private session: FeedSession | null = null;
  private event: unknown = null;
  private trackMap: unknown = null;
  private track: TrackGeometry | null = null;
  private laps: TimedLap[] = [];
  /** Each car's laps in order, and its typical lap time (s), for states made from the laps. */
  private cars = new Map<string, { laps: TimedLap[]; typical: number }>();
  private flags: FeedFlag[] = [];
  private control: FeedControlEntry[] = [];
  private frames: Frame[] = [];
  private entries: unknown[] = [];
  /** Track-local time at race second 0 (ms, read as UTC), and the track's UTC offset (h). */
  private localZero = 0;
  private tz = 0;
  /** The race's last crossing (s). */
  endS = 0;
  private hours = 0;
  private loading: Promise<void> | null = null;
  private failedAt = 0;
  loaded = false;

  constructor(
    readonly def: ReplayDef,
    private readonly feed: () => HttpClient,
    private readonly store: ReplayStore | null,
    /** Wall clock (tests). */
    readonly clock: () => number = Date.now
  ) {}

  /** Load the race (once; again after a failure, at most every RETRY_MS). */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    if (this.failedAt && this.clock() - this.failedAt < RETRY_MS) return Promise.reject(new Error("The replay could not be loaded"));
    this.loading = this.loadOnce()
      .then(() => {
        this.loaded = true;
      })
      .catch((e: unknown) => {
        this.failedAt = this.clock();
        console.warn(`[live-replay] ${this.def.slug}: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async loadOnce() {
    const h = this.feed();
    const { eventId } = this.def;
    this.event = await h.getJson<Record<string, unknown>>(feedUrls.event(eventId));
    const eventName = eventDisplayName(String((this.event as { n?: unknown } | null)?.n ?? ""), eventId);
    const sessions = (await h.getJson<FeedSession[]>(feedUrls.sessions(eventId))) ?? [];
    const s = (Array.isArray(sessions) ? sessions : []).find((x) => liveSlug(eventName, (x.n ?? `Session ${x.sid}`).trim()) === this.def.source);
    if (!s) throw new Error(`no session of event ${eventId} is ${this.def.source}`);
    this.session = s;
    this.sessionId = Number(s.sid);
    this.tz = typeof s.tz === "number" ? s.tz : 0;
    this.hours = Number((s.n ?? "").match(/(\d{1,2})\s*-?\s*h(?:ou)?r/i)?.[1] ?? 0);

    let laps = await h.getJson<FeedLap[]>(liveUrls.sessionLaps(eventId, this.sessionId)).catch(() => null);
    if (!Array.isArray(laps) || laps.length === 0) {
      const doc = await h.getJson<{ laps?: FeedLap[] }>(feedUrls.laps(eventId, this.sessionId));
      laps = Array.isArray(doc?.laps) ? doc.laps : [];
    }
    if (!laps.length) throw new Error("the feed has no laps for the session");
    this.laps = laps
      .map((lap) => ({ lap, r: parseSpan(lap.ttm) ?? NaN }))
      .filter((x) => Number.isFinite(x.r) && Number(x.lap.llp) >= 1)
      .sort((a, b) => a.r - b.r);
    this.endS = this.laps[this.laps.length - 1].r;
    for (const x of this.laps) {
      const n = String(x.lap.n ?? "");
      if (!this.cars.has(n)) this.cars.set(n, { laps: [], typical: 0 });
      this.cars.get(n)!.laps.push(x);
    }
    for (const c of this.cars.values()) {
      const xs = c.laps.map((x) => parseSpan(x.lap.ltm) ?? 0).filter((x) => x > 0).sort((p, q) => p - q);
      c.typical = xs.length ? xs[Math.floor(xs.length / 4)] : 120;
    }
    const flags = await h.getJson<FeedFlag[]>(feedUrls.flags(eventId, this.sessionId)).catch(() => null);
    this.flags = Array.isArray(flags) ? flags : [];
    const control = await h.getJson<FeedControlEntry[]>(feedUrls.control(eventId, this.sessionId)).catch(() => null);
    this.control = Array.isArray(control) ? control : [];

    await this.loadRecording().catch((e: unknown) => {
      console.warn(`[live-replay] ${this.def.slug}: no recording used (${e instanceof Error ? e.message : String(e)})`);
      this.frames = [];
    });
    if (!this.trackMap) this.trackMap = await h.getJson<unknown>(liveUrls.trackMap(eventId)).catch(() => null);
    this.track = trackFromFeed(this.trackMap);
    if (!this.frames.length) {
      // No recording: the entry list from the event's last state (its sessions share the entries).
      try {
        const res = await h.get(liveUrls.state(eventId), { headers: { Accept: "application/x-msgpack" } });
        const raw = decode(res.body) as unknown[];
        if (Array.isArray(raw) && Array.isArray(raw[SS.entries])) this.entries = raw[SS.entries] as unknown[];
      } catch {
        // entries from the laps below
      }
      if (!this.entries.length) {
        const seen = new Map<string, string>();
        for (const { lap } of this.laps) if (lap.n) seen.set(String(lap.n), String(lap.class ?? ""));
        this.entries = [...seen].map(([n, c]) => [n, "", "", c]);
      }
    }
    // Race second → track-local time: from a recorded state's clock, else the flags.
    const first = this.frames[0] ? (decode(this.frames[0].body) as unknown[]) : null;
    const results: FeedResults | null = first ? { localTimeOfDay: String(first[SS.localTimeOfDay] ?? ""), runningRaceTime: String(first[SS.runningRaceTime] ?? "") } : null;
    const clock = sessionClock(
      this.laps.map((x) => x.lap),
      results,
      this.flags,
      plausibleDate(s.st) ?? null
    );
    // With neither, the session's start (UTC) in track time.
    const opened = Date.parse(`${String(s.st ?? "").slice(0, 23)}Z`) + this.tz * 3_600_000;
    if (!clock && !Number.isFinite(opened)) throw new Error("the race clock could not be placed");
    this.localZero = clock ? Date.parse(`${clock.date}T00:00:00Z`) + clock.startSec * 1000 : opened;
    // Race control on a 24-hour clock (control-times.ts), so it is cut at the right moment.
    this.control = fixTwelveHour(this.control, this.localZero);
    console.log(
      `[live-replay] ${this.def.slug}: ${this.laps.length} laps, ${this.frames.length ? `${this.frames.length} recorded states` : "no recording (cars placed from the laps)"}, finish at ${span(this.endS)}`
    );
  }

  /** The recorder's states of the source session from fromS on, and its track map. */
  private async loadRecording() {
    if (!this.store) throw new Error("storage is not configured");
    const root = `live-recordings/${this.def.source}`;
    const days = (await this.store.list(root)).filter((d) => /^\d{8}$/.test(d)).sort();
    const frames: Frame[] = [];
    for (const day of days) {
      const files = (await this.store.list(`${root}/${day}`)).filter((f) => f.endsWith(".jsonl.gz")).sort();
      for (let i = 0; i < files.length; i += 4) {
        const bodies = await Promise.all(files.slice(i, i + 4).map((f) => this.store!.download(`${root}/${day}/${f}`)));
        for (const gz of bodies) {
          if (!gz) continue;
          for (const line of gunzipSync(gz).toString("utf8").split("\n")) {
            if (!line.startsWith('{"t":')) continue;
            // Only the kinds kept here are parsed (push messages are most of the lines).
            const kind = line.slice(line.indexOf('"k":"') + 5, line.indexOf('"', line.indexOf('"k":"') + 5));
            if (kind === "track" && !this.trackMap) this.trackMap = (JSON.parse(line) as { d?: unknown }).d ?? null;
            if (kind !== "state") continue;
            const d = (JSON.parse(line) as { d?: unknown }).d;
            if (!Array.isArray(d) || Number(d[SS.sessionId]) !== this.sessionId) continue;
            const r = parseSpan(String(d[SS.runningRaceTime] ?? ""));
            if (r === null || r < this.def.fromS - 30) continue;
            frames.push({ r, body: encode(d) });
          }
        }
      }
    }
    frames.sort((a, b) => a.r - b.r);
    this.frames = frames;
  }

  // ─── the replay clock ──────────────────────────────────────────────────────

  /** Seconds in one run: start to finish, then the hold. */
  private cycleS(): number {
    return Math.max(60, this.endS - this.def.fromS) + HOLD_S;
  }

  /** Which run this is (a new one starts the race again). */
  cycle(now = this.clock()): number {
    return Math.floor(now / 1000 / this.cycleS());
  }

  /** The race second being shown now. */
  raceSecond(now = this.clock()): number {
    const into = (now / 1000) % this.cycleS();
    return Math.min(this.endS, this.def.fromS + into);
  }

  /** The race's own wall clock (UTC ms) at the race second shown now: for closing the open flag. */
  wallNow(now = this.clock()): number {
    return this.localZero + this.raceSecond(now) * 1000 - this.tz * 3_600_000;
  }

  // ─── what the feed would have said ─────────────────────────────────────────

  private frameAt(r: number): Frame | null {
    let lo = 0;
    let hi = this.frames.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].r <= r) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best >= 0 ? this.frames[best] : (this.frames[0] ?? null);
  }

  /** Each car's last completed lap at race second r: the recorded state's, else from the lap times. */
  private lastLaps(r: number): Map<string, number> {
    const fromState = new Map<string, number>();
    const f = this.frames.length ? this.frameAt(r) : null;
    if (f) {
      const st = decode(f.body) as unknown[];
      for (const c of (st[SS.cars] as unknown[]) ?? []) {
        if (!Array.isArray(c)) continue;
        const n = typeof c[CP.number] === "string" ? c[CP.number] : null;
        const l = Number(c[CP.llp]);
        if (n && l >= 1) fromState.set(n, l);
      }
    }
    const out = new Map(fromState);
    for (const { lap, r: t } of this.laps) {
      if (t > r) break;
      const n = String(lap.n ?? "");
      if (!fromState.has(n)) out.set(n, Math.max(out.get(n) ?? 0, Number(lap.llp)));
    }
    return out;
  }

  /** The lap list at race second r. */
  lapsAt(r: number): FeedLap[] {
    const last = this.lastLaps(r);
    return this.laps.filter(({ lap }) => Number(lap.llp) <= (last.get(String(lap.n ?? "")) ?? 0)).map((x) => x.lap);
  }

  flagsAt(r: number): FeedFlag[] {
    const now = this.localZero + r * 1000;
    return this.flags
      .filter((f) => (localMs(f.s) ?? Infinity) <= now)
      .map((f) => {
        const e = localMs(f.e);
        return e === null || e > now ? { ...f, e: null } : f;
      });
  }

  controlAt(r: number): FeedControlEntry[] {
    const now = this.localZero + r * 1000;
    return this.control.filter((c) => (localMs(c.t) ?? Infinity) <= now);
  }

  /** The session state at race second r (msgpack, as the feed sends it). */
  stateAt(r: number): Uint8Array {
    if (this.frames.length) return this.frameAt(r)!.body;
    return encode(this.madeState(r));
  }

  /** A state made from the laps: each car placed on the track map at its current lap's pace. */
  private madeState(r: number): unknown[] {
    const a: unknown[] = new Array(36).fill(null);
    a[SS.sessionId] = this.sessionId;
    a[SS.timeToGo] = span(this.hours ? this.hours * 3600 - r : 0);
    a[SS.localTimeOfDay] = localText(this.localZero + r * 1000).slice(11);
    a[SS.runningRaceTime] = span(r);
    a[SS.entries] = this.entries;
    const flags = this.flagsAt(r);
    a[SS.flag] = flags.length ? Number(flags[flags.length - 1].f) : 1;
    const len = this.track?.len ?? 0;
    a[SS.cars] = [...this.cars].map(([n, { laps: ls, typical }]) => {
      const x: unknown[] = new Array(70).fill(null);
      x[CP.number] = n;
      x[CP.class] = ls[0].lap.class ?? "";
      let i = -1;
      while (i + 1 < ls.length && ls[i + 1].r <= r) i++;
      const done = i >= 0 ? ls[i] : null;
      if (done) {
        const l = done.lap;
        x[CP.ttm] = l.ttm;
        x[CP.ltm] = l.ltm;
        x[CP.llp] = l.llp;
        x[CP.ovp] = l.ovp;
        x[CP.clp] = l.clp;
        x[CP.lip] = l.lip ?? false;
        x[CP.flg] = l.flg;
        x[CP.dn] = l.dn;
      }
      const next = ls[i + 1];
      if (!next || !len) {
        // Finished or retired: parked (in the pits).
        x[CP.inPit] = true;
        return x;
      }
      const lt = parseSpan(next.lap.ltm) ?? next.r - (done?.r ?? 0);
      const into = Math.max(0, r - (next.r - lt));
      // The feed flags the lap that starts with a stop: the car waits in the pits for what the
      // lap took over its usual time, then drives the lap. Any other lap is driven at its pace.
      const stopS = next.lap.lip ? Math.max(0, lt - typical) : 0;
      const inPit = !!next.lap.lip && into < stopS + 0.08 * typical;
      const drive = Math.max(1, lt - stopS);
      const d = into < stopS ? 0 : Math.min(1, (into - stopS) / drive) * len;
      const [lat, lon] = this.gpsAt(d);
      x[CP.inPit] = inPit;
      x[CP.lat] = lat;
      x[CP.lon] = lon;
      x[CP.mph] = into < stopS ? 0 : inPit ? 35 : Math.round((len / drive) * 2.23694);
      x[CP.lapPct] = Math.round((d / len) * 100);
      return x;
    });
    return a;
  }

  /** lat/lon `d` metres past the line, on the track map. */
  private gpsAt(d: number): [number, number] {
    const g = this.track!;
    const pts = g.pts;
    const at = (((d + g.sfD) % g.len) + g.len) % g.len;
    let i = 0;
    for (let k = 0; k < pts.length; k++) if (pts[k].d <= at) i = k;
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const end = i + 1 < pts.length ? q.d : g.len;
    const t = end > p.d ? (at - p.d) / (end - p.d) : 0;
    return [p.lat + t * (q.lat - p.lat), p.lon + t * (q.lon - p.lon)];
  }

  /** The feed, as it was at the race second shown now. */
  client(): HttpClient {
    const json = (url: string, body: unknown): HttpResponse => ({ status: 200, url, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(body)) });
    const get = async (url: string): Promise<HttpResponse> => {
      await this.load();
      const { eventId } = this.def;
      const sid = this.sessionId;
      const r = this.raceSecond();
      if (url === feedUrls.sessions(eventId)) return json(url, [{ ...this.session, il: true, et: null }]);
      if (url === feedUrls.event(eventId)) return json(url, this.event);
      if (url === liveUrls.trackMap(eventId)) return this.trackMap ? json(url, this.trackMap) : { status: 404, url, headers: {}, body: Buffer.alloc(0) };
      if (url === liveUrls.sessionLaps(eventId, sid)) return json(url, this.lapsAt(r));
      if (url === feedUrls.flags(eventId, sid)) return json(url, this.flagsAt(r));
      if (url === feedUrls.control(eventId, sid)) return json(url, this.controlAt(r));
      if (url === liveUrls.state(eventId)) return { status: 200, url, headers: { "content-type": "application/x-msgpack" }, body: Buffer.from(this.stateAt(r)) };
      return { status: 404, url, headers: {}, body: Buffer.alloc(0) };
    };
    return {
      get: (url: string, _o?: HttpGetOptions) => get(url),
      getText: async (url: string) => (await get(url)).body.toString("utf8"),
      getJson: async <T>(url: string) => {
        const res = await get(url);
        if (res.status === 404) return null;
        return JSON.parse(res.body.toString("utf8")) as T;
      },
    };
  }
}

let feedHttp: HttpClient | null = null;
const defaultFeed = () => (feedHttp ??= paced(createHttpClient({ delayMs: 0, attempts: 2, timeoutMs: 45_000 })));

let store: ReplayStore | null = null;
const sources = new Map<string, ReplaySource>();

/** The replay at an address (loading it starts on first use), or undefined. */
export function replaySource(slug: string): ReplaySource | undefined {
  const def = replayDef(slug);
  if (!def) return undefined;
  let s = sources.get(slug);
  if (!s) sources.set(slug, (s = new ReplaySource(def, defaultFeed, store)));
  return s;
}

/** Server start-up: where recordings are kept, and load every replay ahead of its first viewer. */
export function startReplays(bucket: ReplayStore | null): void {
  store = bucket;
  sources.clear();
  for (const r of REPLAYS) void replaySource(r.slug)!.load().catch(() => undefined);
}

/** Tests: replace the feed and the store. */
export function setReplayFeed(h: HttpClient | null, s: ReplayStore | null = null, clock?: () => number) {
  feedHttp = h;
  store = s;
  sources.clear();
  if (clock) for (const r of REPLAYS) sources.set(r.slug, new ReplaySource(r, defaultFeed, s, clock));
}

/** For the admin page: each replay's address, where it starts, and whether it is ready. */
export function listReplays(): { slug: string; fromS: number; ready: boolean; endS: number | null }[] {
  return REPLAYS.map((r) => {
    const s = sources.get(r.slug);
    return { slug: r.slug, fromS: r.fromS, ready: !!s?.loaded, endS: s?.loaded ? s.endS : null };
  });
}

/** A Supabase storage bucket as a replay store. */
export function bucketStore(bucket: {
  list(path: string, opts: { limit: number; offset: number; sortBy: { column: string; order: string } }): Promise<{ data: { name: string }[] | null; error: { message: string } | null }>;
  download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
}): ReplayStore {
  return {
    async list(prefix) {
      const out: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await bucket.list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
        if (error) throw new Error(error.message);
        out.push(...(data ?? []).map((x) => x.name));
        if (!data || data.length < 1000) return out;
      }
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
  };
}
