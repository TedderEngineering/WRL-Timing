/**
 * RaceTrace Live: one RedMist poller per live session, shared by every viewer.
 *
 * A poller starts on the first request for a session and stops once nobody
 * has asked for it for IDLE_MS. Each tick (TICK_MS) reads the session state;
 * the completed laps are re-read every LAPS_MS and the flags, race-control log
 * and session list every SLOW_MS. Then the chart is rebuilt. Viewers only ever read the last built
 * chart, so RedMist sees one caller however many people watch.
 *
 * RedMist asks anonymous callers for about one request per 1.1 s; every call
 * here goes through the intake's `paced` client (REDMIST_GAP_MS, 1.6 s).
 */
import { createHash } from "node:crypto";
import { decode } from "@msgpack/msgpack";
import { createHttpClient, type HttpClient } from "../intake/http.js";
import {
  REDMIST_API,
  eventDisplayName,
  eventsFromResponse,
  isWrlEvent,
  plausibleDate,
  type RmControlEntry,
  type RmFlag,
  type RmLap,
  type RmSession,
} from "../intake/parse-redmist.js";
import { REDMIST_KNOWN_EVENTS } from "../intake/sources/redmist-events.js";
import { paced, redmistUrls } from "../intake/sources/redmist.js";
import { buildLiveChart, LiveNoLapsError, resultsFromState, type LiveChart, type LiveSessionMeta, type LiveState } from "./build.js";

/** How often a poller wakes (session state). */
export const TICK_MS = Number(process.env.LIVE_TICK_MS || 30_000);
/** How often the full lap list is re-read (it grows to several MB over an enduro). */
export const LAPS_MS = Number(process.env.LIVE_LAPS_MS || 60_000);
export const SLOW_MS = Number(process.env.LIVE_SLOW_MS || 60_000);
export const IDLE_MS = Number(process.env.LIVE_IDLE_MS || 10 * 60_000);
const LIST_MS = 60_000;
const MAX_POLLERS = 4;

export const liveUrls = {
  sessionLaps: (eventId: number, sessionId: number) => `${REDMIST_API}/v1/Events/LoadSessionLaps?eventId=${eventId}&sessionId=${sessionId}`,
  state: (eventId: number) => `${REDMIST_API}/v2/Events/GetCurrentSessionState?eventId=${eventId}`,
};

export interface LiveSnapshot {
  chart: LiveChart | null;
  /** Why there is no chart yet ("waiting" before the first lap). */
  waiting: string | null;
  updatedAt: string | null;
  lastError: string | null;
  etag: string | null;
  /** The session has ended on RedMist. */
  ended: boolean;
}

export interface LiveSessionListing {
  eventId: number;
  sessionId: number;
  eventName: string;
  sessionName: string;
  track: string;
  startedAt: string | null;
}

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
}

async function loadState(h: HttpClient, eventId: number, sessionId: number): Promise<LiveState | null> {
  try {
    const res = await h.get(liveUrls.state(eventId), { headers: { Accept: "application/x-msgpack" } });
    const s = resultsFromState(decode(res.body));
    // The state is the event's current session: ignore it when another session is running.
    return s && (s.sessionId === null || s.sessionId === sessionId) ? s : null;
  } catch {
    return null;
  }
}

class Poller {
  meta: LiveSessionMeta | null = null;
  snap: LiveSnapshot = { chart: null, waiting: "Connecting to RedMist", updatedAt: null, lastError: null, etag: null, ended: false };
  lastView = Date.now();
  private laps: RmLap[] = [];
  private flags: RmFlag[] | null = null;
  private control: RmControlEntry[] | null = null;
  private lastSlow = 0;
  private lastLaps = 0;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    readonly eventId: number,
    readonly sessionId: number,
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
      if (Date.now() - this.lastView > IDLE_MS || this.snap.ended) {
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
    const sessions = (await h.getJson<RmSession[]>(redmistUrls.sessions(this.eventId))) ?? [];
    const s = (Array.isArray(sessions) ? sessions : []).find((x) => Number(x.sid) === this.sessionId);
    if (!s) throw new Error(`RedMist has no session ${this.eventId}/${this.sessionId}`);
    let eventName = `RedMist event ${this.eventId}`;
    let track = REDMIST_KNOWN_EVENTS.find((k) => k.eventId === this.eventId)?.track ?? "";
    try {
      const e = await h.getJson<Record<string, unknown>>(redmistUrls.event(this.eventId));
      if (e && typeof e.n === "string") eventName = e.n;
      if (!track && e && typeof e.t === "string") track = e.t;
    } catch {
      // name stays generic
    }
    this.meta = {
      eventId: this.eventId,
      sessionId: this.sessionId,
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
      if (this.laps.length === 0 || Date.now() - this.lastLaps >= LAPS_MS) {
        const laps = await h.getJson<RmLap[]>(liveUrls.sessionLaps(this.eventId, this.sessionId));
        if (Array.isArray(laps)) {
          this.laps = laps;
          this.lastLaps = Date.now();
        }
      }
      if (Date.now() - this.lastSlow >= SLOW_MS) {
        this.lastSlow = Date.now();
        const flags = await h.getJson<RmFlag[]>(redmistUrls.flags(this.eventId, this.sessionId)).catch(() => null);
        if (Array.isArray(flags)) this.flags = flags;
        const control = await h.getJson<RmControlEntry[]>(redmistUrls.control(this.eventId, this.sessionId)).catch(() => null);
        if (Array.isArray(control)) this.control = control;
      }
      const chart = await buildLiveChart({
        meta: this.meta!,
        laps: this.laps,
        results: state?.results ?? null,
        flags: this.flags,
        control: this.control,
        currentFlag: state?.currentFlag ?? null,
        timeToGo: state?.timeToGo ?? null,
      });
      const body = JSON.stringify(chart.data);
      this.snap = {
        chart,
        waiting: null,
        updatedAt: new Date().toISOString(),
        lastError: null,
        etag: `"${createHash("sha1").update(body).update(JSON.stringify(chart.status)).digest("hex").slice(0, 20)}"`,
        ended: this.snap.ended,
      };
    } catch (e) {
      if (e instanceof LiveNoLapsError) this.snap = { ...this.snap, waiting: "Waiting for the first completed lap", lastError: null };
      // Keep the last good chart; say what went wrong.
      else this.snap = { ...this.snap, lastError: (e as Error).message, waiting: this.snap.chart ? null : "RedMist is not answering yet" };
    } finally {
      this.schedule();
    }
  }
}

const pollers = new Map<string, Poller>();

/** The current live chart for a RedMist session, starting its poller if needed. */
export async function getLiveSnapshot(eventId: number, sessionId: number): Promise<LiveSnapshot & { meta: LiveSessionMeta | null }> {
  const key = `${eventId}/${sessionId}`;
  let p = pollers.get(key);
  if (!p) {
    if (pollers.size >= MAX_POLLERS) {
      // Drop the least recently viewed session.
      const oldest = [...pollers.entries()].sort((a, b) => a[1].lastView - b[1].lastView)[0];
      oldest[1].stop();
      pollers.delete(oldest[0]);
    }
    const created = new Poller(eventId, sessionId, () => {
      pollers.delete(key);
    });
    pollers.set(key, created);
    p = created;
    p.start();
  }
  p.lastView = Date.now();
  await p.ready();
  return { ...p.snap, meta: p.meta };
}

let listCache: { at: number; sessions: LiveSessionListing[] } | null = null;

/** WRL sessions RedMist marks live right now. */
export async function listLiveSessions(): Promise<LiveSessionListing[]> {
  if (listCache && Date.now() - listCache.at < LIST_MS) return listCache.sessions;
  const h = http();
  const events = eventsFromResponse(await h.getJson(redmistUrls.liveAndRecent())).filter((e) => isWrlEvent(e) && e.l === true);
  const out: LiveSessionListing[] = [];
  for (const e of events.slice(0, 5)) {
    const sessions = (await h.getJson<RmSession[]>(redmistUrls.sessions(e.eid))) ?? [];
    for (const s of Array.isArray(sessions) ? sessions : []) {
      if (!s.il) continue;
      out.push({
        eventId: e.eid,
        sessionId: Number(s.sid),
        eventName: eventDisplayName(e.en, e.eid),
        sessionName: (s.n ?? `Session ${s.sid}`).trim(),
        track: REDMIST_KNOWN_EVENTS.find((k) => k.eventId === e.eid)?.track ?? e.t ?? "",
        startedAt: s.st ?? null,
      });
    }
  }
  listCache = { at: Date.now(), sessions: out };
  return out;
}
