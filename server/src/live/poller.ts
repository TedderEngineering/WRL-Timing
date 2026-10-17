/**
 * RaceTrace Live: one timing-feed poller per live session, shared by every viewer.
 *
 * A poller starts on the first request for a session and stops once nobody
 * has asked for it for IDLE_MS. Each tick (TICK_MS, 5 s) reads the session
 * state, the same cheap read the feed's own viewer pages make every 5 s, and
 * adds each car's newly completed lap from it. The full lap list is re-read
 * every LAPS_MS (or at once when a lap was missed), and the flags,
 * race-control log and session list every SLOW_MS. The chart is rebuilt only
 * when something in it changed; otherwise only the live status moves.
 *
 * Each rebuild is a version. A small summary of every recent version (per car:
 * lap count and a hash of those laps) lets the route send a phone only what
 * changed since the version it holds (wire.ts). Viewers only ever read the
 * last build, so the timing feed sees one caller however many people watch.
 *
 * The feed asks anonymous callers for about one request per 1.1 s; every call
 * here goes through the intake's `paced` client (1.6 s between calls).
 */
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { decode } from "@msgpack/msgpack";
import { createHttpClient, type HttpClient } from "../intake/http.js";
import {
  FEED_API,
  KNOWN_EVENTS,
  eventDisplayName,
  eventsFromResponse,
  feedUrls,
  isWrlEvent,
  paced,
  plausibleDate,
  type FeedControlEntry,
  type FeedFlag,
  type FeedLap,
  type FeedSession,
} from "./feed.js";
import type { SessionKind } from "./schedule.js";
import { buildLiveChart, FLAG_NAMES, LiveNoLapsError, resultsFromState, type LiveChart, type LiveSessionMeta, type LiveState } from "./build.js";
import { encodeDelta, lapPrefixes, summarize, type VersionSummary } from "./wire.js";

/** How often a poller wakes (session state). */
export const TICK_MS = Number(process.env.LIVE_TICK_MS || 5_000);
/** How often the full lap list is re-read (it grows to several MB over an enduro); laps arrive from the state in between. */
export const LAPS_MS = Number(process.env.LIVE_LAPS_MS || 120_000);
/** Versions a phone can still get a delta from (15 min at 5 s). */
export const KEEP_VERSIONS = 180;
/**
 * New laps alone wait this many times the last rebuild's duration since it (at least TICK_MS):
 * a rebuild of a full enduro takes ~0.3 s of the server's one thread, so late in the race laps
 * are batched into a rebuild every ~7 s rather than every tick. Flag and entry changes rebuild
 * at once; batched laps are kept and go into the next rebuild.
 */
export const REBUILD_COST_FACTOR = 25;
/** Charts kept for full copies of recent versions (a phone told about version v a few seconds ago). */
export const KEEP_CHARTS = 3;
export const SLOW_MS = Number(process.env.LIVE_SLOW_MS || 60_000);
export const IDLE_MS = Number(process.env.LIVE_IDLE_MS || 10 * 60_000);
const LIST_MS = 60_000;
const MAX_POLLERS = 4;

export const liveUrls = {
  sessionLaps: (eventId: number, sessionId: number) => `${FEED_API}/v1/Events/LoadSessionLaps?eventId=${eventId}&sessionId=${sessionId}`,
  state: (eventId: number) => `${FEED_API}/v2/Events/GetCurrentSessionState?eventId=${eventId}`,
};

export interface LiveSnapshot {
  chart: LiveChart | null;
  /** Chart version (rises on every rebuild; status-only updates keep it). */
  v: number;
  /** Chained hashes of each car's laps in this version (wire.ts lapPrefixes). */
  prefixes: Record<string, string[]> | null;
  /** Why there is no chart yet ("waiting" before the first lap). */
  waiting: string | null;
  updatedAt: string | null;
  lastError: string | null;
  etag: string | null;
  /** The session has ended on the timing feed. */
  ended: boolean;
}

/** What viewers see of a live session: RaceTrace's name for it, no timing-system ids. */
export interface LiveSessionListing {
  slug: string;
  eventName: string;
  sessionName: string;
  track: string;
  /** When the session's timing opened (ISO, UTC). */
  startedAt: string | null;
  /** When it ended on the timing feed (ISO, UTC); null while it runs. */
  endedAt: string | null;
  kind: SessionKind;
}

/** The feed's session times are UTC with no zone suffix ("2026-10-17T11:18:13.345"). */
export function feedUtc(t: string | null | undefined): string | null {
  if (!t) return null;
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Practice and qualifying sessions are marked by the feed; anything else is a race. */
export function sessionKind(s: { pq?: boolean; n?: string }): SessionKind {
  return s.pq ? (/qual/i.test(s.n ?? "") ? "qualify" : "practice") : "race";
}

/** A live session with the timing feed's ids behind its slug (server side only). */
export interface LiveSessionRef extends LiveSessionListing {
  eventId: number;
  sessionId: number;
}

/** "Sebring International Raceway 2026" + "Saturday 8 Hour" → "sebring-international-raceway-2026-saturday-8-hour". */
export function liveSlug(eventName: string, sessionName: string): string {
  return `${eventName} ${sessionName}`
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/, "");
}

export function publicListing(r: LiveSessionRef): LiveSessionListing {
  return { slug: r.slug, eventName: r.eventName, sessionName: r.sessionName, track: r.track, startedAt: r.startedAt, endedAt: r.endedAt, kind: r.kind };
}

/** Every slug handed out since start-up → its feed session, so a page keeps working after its session leaves the live list. */
const slugIndex = new Map<string, { eventId: number; sessionId: number }>();

let sharedHttp: HttpClient | null = null;
function http(): HttpClient {
  if (!sharedHttp) sharedHttp = paced(createHttpClient({ delayMs: 0, attempts: 2, timeoutMs: 45_000 }));
  return sharedHttp;
}

/** For tests. */
export function setLiveHttp(h: HttpClient | null) {
  sharedHttp = h;
  for (const p of pollers.values()) p.stop();
  pollers.clear();
  listCache = null;
  slugIndex.clear();
}

/**
 * Every state read of a session, as decoded (all of it, positions included): the recorder keeps
 * them (recorder.ts). Emits ("state", eventId, sessionId, decoded).
 */
export const feedStates = new EventEmitter();

async function loadState(h: HttpClient, eventId: number, sessionId: number): Promise<LiveState | null> {
  try {
    const res = await h.get(liveUrls.state(eventId), { headers: { Accept: "application/x-msgpack" } });
    const raw = decode(res.body);
    const s = resultsFromState(raw);
    // The state is the event's current session: ignore it when another session is running.
    if (!s || (s.sessionId !== null && s.sessionId !== sessionId)) return null;
    feedStates.emit("state", eventId, sessionId, raw);
    return s;
  } catch {
    return null;
  }
}

class Poller {
  meta: LiveSessionMeta | null = null;
  snap: LiveSnapshot = { chart: null, v: 0, prefixes: null, waiting: "Connecting to the timing", updatedAt: null, lastError: null, etag: null, ended: false };
  /** Recent versions a phone may hold → what it holds (for deltas). */
  readonly versions = new Map<number, VersionSummary>();
  /** Step deltas: v → JSON of the changes from v − 1 to v (wire.ts), made once at rebuild and shared by every phone. */
  readonly steps = new Map<number, string>();
  /** The last few charts by version, for full copies of a version a phone was just told about. */
  readonly charts = new Map<number, LiveChart>();
  /** "update" after every tick that changed the chart or the live status (push streams listen). */
  readonly events = new EventEmitter();
  /** Open push streams on this session (they keep the poller alive). */
  streams = 0;
  /**
   * This poller's run. Versions restart at 1 with every poller (a deploy, or an idle stop), and
   * the CDN keeps update files forever, so every cacheable URL names the epoch too.
   */
  readonly epoch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  lastView = Date.now();
  private laps: FeedLap[] = [];
  private flags: FeedFlag[] | null = null;
  private control: FeedControlEntry[] | null = null;
  private lastSlow = 0;
  private lastLaps = 0;
  /** A lap went missing between state reads: re-read the full list on the next tick. */
  private needFull = false;
  /** What the last build was made from (rebuild only when one of these changed). */
  private builtFrom = "";
  /** Laps merged since the last rebuild (waiting for the next one). */
  private lapsPending = false;
  private lastBuildAt = 0;
  private lastBuildMs = 0;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    readonly eventId: number,
    readonly sessionId: number,
    readonly slug: string,
    private onStop: () => void
  ) {}

  start() {
    this.running = this.tick();
    return this.running;
  }

  /** First chart, or whatever the first tick produced (a viewer waits at most one tick). */
  ready() {
    return this.running ?? Promise.resolve();
  }

  private schedule() {
    this.timer = setTimeout(() => {
      if ((this.streams === 0 && Date.now() - this.lastView > IDLE_MS) || this.snap.ended) {
        this.onStop();
        return;
      }
      this.running = this.tick();
    }, TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  private async loadMeta(h: HttpClient): Promise<void> {
    const sessions = (await h.getJson<FeedSession[]>(feedUrls.sessions(this.eventId))) ?? [];
    const s = (Array.isArray(sessions) ? sessions : []).find((x) => Number(x.sid) === this.sessionId);
    if (!s) throw new Error(`The timing feed has no session ${this.eventId}/${this.sessionId}`);
    let eventName = `Event ${this.eventId}`;
    let track = KNOWN_EVENTS.find((k) => k.eventId === this.eventId)?.track ?? "";
    try {
      const e = await h.getJson<Record<string, unknown>>(feedUrls.event(this.eventId));
      if (e && typeof e.n === "string") eventName = e.n;
      if (!track && e && typeof e.t === "string") track = e.t;
    } catch {
      // name stays generic
    }
    this.meta = {
      eventId: this.eventId,
      sessionId: this.sessionId,
      slug: this.slug,
      eventName: eventDisplayName(eventName, this.eventId),
      sessionName: (s.n ?? `Session ${this.sessionId}`).trim(),
      track: track || "Unknown track",
      tzOffsetHours: typeof s.tz === "number" ? s.tz : null,
      date: plausibleDate(s.st),
    };
    this.snap.ended = !!s.et && s.il === false;
  }

  private async tick(): Promise<void> {
    const h = http();
    try {
      if (!this.meta || Date.now() - this.lastSlow >= SLOW_MS) await this.loadMeta(h);
      const state = await loadState(h, this.eventId, this.sessionId);
      let lapsChanged = false;
      if (this.laps.length === 0 || this.needFull || Date.now() - this.lastLaps >= LAPS_MS) {
        const laps = await h.getJson<FeedLap[]>(liveUrls.sessionLaps(this.eventId, this.sessionId));
        if (Array.isArray(laps)) {
          this.laps = laps;
          this.lastLaps = Date.now();
          this.needFull = false;
          lapsChanged = true;
        }
      } else if (state) {
        const m = mergeStateLaps(this.laps, state.laps);
        if (m.added) {
          this.laps = m.laps;
          lapsChanged = true;
        }
        if (m.gap) this.needFull = true;
      }
      if (Date.now() - this.lastSlow >= SLOW_MS) {
        this.lastSlow = Date.now();
        const flags = await h.getJson<FeedFlag[]>(feedUrls.flags(this.eventId, this.sessionId)).catch(() => null);
        if (Array.isArray(flags)) this.flags = flags;
        const control = await h.getJson<FeedControlEntry[]>(feedUrls.control(this.eventId, this.sessionId)).catch(() => null);
        if (Array.isArray(control)) this.control = control;
      }
      // What else goes into the chart: flags and race control (FCY bands), entry names, and the
      // current flag (an open flag's band runs to "now").
      const inputs = [
        hashOf(JSON.stringify(this.flags) + JSON.stringify(this.control)),
        hashOf(JSON.stringify(state?.results.eventEntries ?? null)),
        state?.currentFlag ?? "",
      ].join("|");
      if (lapsChanged) this.lapsPending = true;
      const lapsDue = this.lapsPending && Date.now() - this.lastBuildAt >= Math.max(TICK_MS, this.lastBuildMs * REBUILD_COST_FACTOR) - 50;
      const rebuild = !this.snap.chart || inputs !== this.builtFrom || lapsDue;
      const t0 = Date.now();
      const chart = !rebuild
        ? withStatus(this.snap.chart!, state)
        : await buildLiveChart({
            meta: this.meta!,
            laps: this.laps,
            results: state?.results ?? null,
            flags: this.flags,
            control: this.control,
            currentFlag: state?.currentFlag ?? null,
            timeToGo: state?.timeToGo ?? null,
          });
      const rebuilt = rebuild;
      if (rebuild) {
        this.builtFrom = inputs;
        this.lapsPending = false;
        this.lastBuildAt = Date.now();
        this.lastBuildMs = Date.now() - t0;
      }
      let { v, prefixes } = this.snap;
      if (rebuilt) {
        v += 1;
        prefixes = lapPrefixes(chart.data);
        this.versions.set(v, summarize(chart.data, chart.annotations, prefixes));
        const prev = this.charts.get(v - 1);
        const prevSummary = this.versions.get(v - 1);
        if (prev && prevSummary) {
          this.steps.set(v, JSON.stringify(encodeDelta(v - 1, prevSummary, v, chart.data, chart.annotations, prefixes, prev.annotations)));
        }
        this.charts.set(v, chart);
        for (const k of this.versions.keys()) if (k <= v - KEEP_VERSIONS) this.versions.delete(k);
        for (const k of this.steps.keys()) if (k <= v - KEEP_VERSIONS) this.steps.delete(k);
        for (const k of this.charts.keys()) if (k <= v - KEEP_CHARTS) this.charts.delete(k);
      } else if (this.charts.has(v)) {
        this.charts.set(v, chart); // same version, newer live status
      }
      this.snap = {
        chart,
        v,
        prefixes,
        waiting: null,
        updatedAt: new Date().toISOString(),
        lastError: null,
        etag: `"${hashOf(`${v}|${JSON.stringify(chart.status)}`)}"`,
        ended: this.snap.ended,
      };
      this.events.emit("update");
    } catch (e) {
      if (e instanceof LiveNoLapsError) this.snap = { ...this.snap, waiting: "Waiting for the first completed lap", lastError: null };
      // Keep the last good chart; say what went wrong.
      else {
        const msg = (e as Error).message;
        if (msg !== this.snap.lastError) console.warn(`[live] ${this.slug} (feed ${this.eventId}/${this.sessionId}): ${msg}`);
        this.snap = { ...this.snap, lastError: msg, waiting: this.snap.chart ? null : "The timing is not answering yet" };
      }
    } finally {
      this.schedule();
    }
  }
}

const hashOf = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 20);

/** The last chart with the state's flag, race time and time to go (no rebuild). */
function withStatus(chart: LiveChart, state: LiveState | null): LiveChart {
  if (!state) return chart;
  return {
    ...chart,
    status: {
      ...chart.status,
      flag: state.currentFlag != null ? (FLAG_NAMES[state.currentFlag] ?? null) : chart.status.flag,
      runningRaceTime: typeof state.results.runningRaceTime === "string" ? state.results.runningRaceTime : chart.status.runningRaceTime,
      timeToGo: state.timeToGo ?? chart.status.timeToGo,
    },
  };
}

/**
 * Add each car's newly completed lap from the session state. Only the next lap
 * of a car is added; a car that skipped ahead (a missed read) sets `gap`, and
 * the full lap list is re-read instead.
 */
export function mergeStateLaps(laps: FeedLap[], fresh: FeedLap[]): { laps: FeedLap[]; added: number; gap: boolean } {
  const last = new Map<string, number>();
  for (const l of laps) {
    const n = l.n ? String(l.n) : "";
    const lap = Number(l.llp);
    if (n && lap > (last.get(n) ?? 0)) last.set(n, lap);
  }
  const add: FeedLap[] = [];
  let gap = false;
  for (const f of fresh) {
    const n = String(f.n);
    const lap = Number(f.llp);
    const prev = last.get(n) ?? 0;
    if (lap === prev + 1) {
      add.push(f);
      last.set(n, lap);
    } else if (lap > prev + 1) gap = true;
  }
  return { laps: add.length ? laps.concat(add) : laps, added: add.length, gap };
}

const pollers = new Map<string, Poller>();

const sameIds = (a: { eventId: number; sessionId: number }, b: { eventId: number; sessionId: number }) => a.eventId === b.eventId && a.sessionId === b.sessionId;

/** The feed session behind a slug: one handed out before, or one live now. Null when there is none. */
export async function resolveLiveSlug(slug: string): Promise<{ eventId: number; sessionId: number } | null> {
  const known = slugIndex.get(slug);
  if (known) return known;
  await listLiveSessions();
  return slugIndex.get(slug) ?? null;
}

/** The current live chart for a feed session, starting its poller if needed. */
export async function getLiveSnapshot(
  eventId: number,
  sessionId: number,
  slug: string
): Promise<
  LiveSnapshot & {
    meta: LiveSessionMeta | null;
    versions: ReadonlyMap<number, VersionSummary>;
    steps: ReadonlyMap<number, string>;
    charts: ReadonlyMap<number, LiveChart>;
    epoch: string;
  }
> {
  const p = pollerFor(eventId, sessionId, slug);
  p.lastView = Date.now();
  await p.ready();
  return { ...p.snap, meta: p.meta, versions: p.versions, steps: p.steps, charts: p.charts, epoch: p.epoch };
}

/**
 * Follow a session's updates (push streams). `onUpdate` runs after every tick that changed the
 * chart or the live status. The poller keeps running while anyone listens. Returns unsubscribe.
 */
export function subscribeLive(eventId: number, sessionId: number, slug: string, onUpdate: () => void): () => void {
  const p = pollerFor(eventId, sessionId, slug);
  p.streams += 1;
  p.events.on("update", onUpdate);
  return () => {
    p.events.off("update", onUpdate);
    p.streams = Math.max(0, p.streams - 1);
    p.lastView = Date.now();
  };
}

function pollerFor(eventId: number, sessionId: number, slug: string): Poller {
  const key = `${eventId}/${sessionId}`;
  let p = pollers.get(key);
  if (!p) {
    if (pollers.size >= MAX_POLLERS) {
      // Drop the least recently viewed session.
      const oldest = [...pollers.entries()].sort((a, b) => a[1].streams - b[1].streams || a[1].lastView - b[1].lastView)[0];
      oldest[1].stop();
      pollers.delete(oldest[0]);
    }
    const created = new Poller(eventId, sessionId, slug, () => {
      pollers.delete(key);
    });
    pollers.set(key, created);
    p = created;
    p.start();
  }
  return p;
}

let listCache: { at: number; sessions: LiveSessionRef[]; recent: LiveSessionRef[] } | null = null;

/** Sessions that ended this recently are listed as just finished (the banner's "See how it ended"). */
export const RECENT_MS = 2 * 3600_000;
/** Events this recent keep their sessions' addresses working (after a restart too). */
const INDEX_DAYS = 3;

/**
 * WRL sessions on the timing feed: the ones it marks live, and the ones of its recent events that
 * ended within RECENT_MS. Every session of a recent event gets its slug indexed, so a live page's
 * address keeps working after the session ends or the server restarts.
 */
async function scanSessions(): Promise<{ sessions: LiveSessionRef[]; recent: LiveSessionRef[] }> {
  if (listCache && Date.now() - listCache.at < LIST_MS) return listCache;
  const h = http();
  const now = Date.now();
  const since = new Date(now - INDEX_DAYS * 86_400_000).toISOString().slice(0, 10);
  const events = eventsFromResponse(await h.getJson(feedUrls.liveAndRecent())).filter(
    (e) => isWrlEvent(e) && (e.l === true || (typeof e.ed === "string" && e.ed.slice(0, 10) >= since))
  );
  const live: LiveSessionRef[] = [];
  const recent: LiveSessionRef[] = [];
  for (const e of events.slice(0, 5)) {
    const sessions = (await h.getJson<FeedSession[]>(feedUrls.sessions(e.eid))) ?? [];
    // Oldest first, so a re-run session with the same name is the one that gets "-2".
    const ordered = (Array.isArray(sessions) ? sessions : []).slice().sort((a, b) => String(a.st ?? "").localeCompare(String(b.st ?? "")));
    for (const s of ordered) {
      const eventName = eventDisplayName(e.en, e.eid);
      const sessionName = (s.n ?? `Session ${s.sid}`).trim();
      const ids = { eventId: e.eid, sessionId: Number(s.sid) };
      // The same name twice (a rare re-run session) gets "-2", never the ids.
      let slug = [...slugIndex.entries()].find(([, v]) => sameIds(v, ids))?.[0] ?? liveSlug(eventName, sessionName);
      for (let k = 2; slugIndex.has(slug) && !sameIds(slugIndex.get(slug)!, ids); k++) slug = `${liveSlug(eventName, sessionName)}-${k}`;
      slugIndex.set(slug, ids);
      const endedAt = s.il ? null : feedUtc(s.et);
      const ref: LiveSessionRef = {
        slug,
        ...ids,
        eventName,
        sessionName,
        track: KNOWN_EVENTS.find((k) => k.eventId === e.eid)?.track ?? e.t ?? "",
        startedAt: feedUtc(s.st),
        endedAt,
        kind: sessionKind(s),
      };
      if (s.il && e.l === true) live.push(ref);
      else if (endedAt && now - Date.parse(endedAt) <= RECENT_MS) recent.push(ref);
    }
  }
  listCache = { at: Date.now(), sessions: live, recent };
  return listCache;
}

/** WRL sessions the timing feed marks live right now (with the feed's ids: server side only). */
export async function listLiveSessions(): Promise<LiveSessionRef[]> {
  return (await scanSessions()).sessions;
}

/** WRL sessions that ended within RECENT_MS. */
export async function listRecentSessions(): Promise<LiveSessionRef[]> {
  return (await scanSessions()).recent;
}

/** A running poller's view of its session (no extra feed reads): leader's lap and flag. */
export function liveStatusOf(eventId: number, sessionId: number): { leaderLap: number; flag: string | null } | null {
  const st = pollers.get(`${eventId}/${sessionId}`)?.snap.chart?.status;
  return st ? { leaderLap: st.leaderLap, flag: st.flag } : null;
}
