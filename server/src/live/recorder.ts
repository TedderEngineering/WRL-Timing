/**
 * RaceTrace Live recorder: keeps what the timing feed says during a live WRL session, so a race can
 * be replayed later (the track map is built and tested against a recorded race).
 *
 * For each session the feed marks live (checked every CHECK_MS), it keeps:
 *   - every state read the session's poller makes (every 5 s; all of it, car GPS positions
 *     included). Recording keeps the poller running with no one watching.
 *   - the track map, once the feed has learned it (retried every TRACK_RETRY_MS until then).
 *   - the feed's push messages (car updates about once a second), when the push connection
 *     accepts us without a login; when it does not, that is recorded and the state reads stand.
 *
 * Records are JSON lines ({ t: ms, k: kind, ... }), uploaded gzipped every FLUSH_MS to the race
 * file bucket under live-recordings/<slug>/<UTC date>/, so a restart loses at most one interval
 * (and a shutdown flushes first). Never served to viewers: the files hold the feed's own ids.
 *
 * Off with LIVE_RECORD=0; also off when storage is not configured.
 */
import { gzipSync } from "node:zlib";
import { HttpTransportType, HubConnectionBuilder, LogLevel, type HubConnection } from "@microsoft/signalr";
import { createHttpClient, type HttpClient } from "../intake/http.js";
import { FEED_API, paced } from "./feed.js";
import { feedStates, listLiveSessions, subscribeLive, type LiveSessionRef } from "./poller.js";

export const CHECK_MS = Number(process.env.LIVE_RECORD_CHECK_MS || 60_000);
export const FLUSH_MS = Number(process.env.LIVE_RECORD_FLUSH_MS || 60_000);
const TRACK_RETRY_MS = 10 * 60_000;
/** Lines kept while uploads fail (about half an hour of state reads and push messages). */
const MAX_PENDING = 20_000;
/** The feed's push messages worth keeping (its hub's client methods). */
const HUB_METHODS = ["ReceiveSessionPatch", "ReceiveCarPatches", "ReceiveReset", "ReceiveControlLog", "ReceiveMessage", "ReceiveInCarUpdateV2"];

export interface RecordBucket {
  upload(path: string, body: Buffer, opts: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
}

type Line = Record<string, unknown> & { t: number; k: string };

/** JSON for any decoded value (a bigint as a string, so one odd field never loses a record). */
export function lineJson(x: unknown): string {
  return JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

export class Recording {
  private lines: Line[] = [];
  private seq = 0;
  private flushing: Promise<void> | null = null;
  private hub: HubConnection | null = null;
  private trackAt = 0;
  private haveTrack = false;
  private unsubscribe: (() => void) | null = null;
  dropped = 0;
  uploaded = 0;

  constructor(
    readonly ref: Pick<LiveSessionRef, "slug" | "eventId" | "sessionId">,
    private readonly bucket: RecordBucket,
    private readonly now: () => number = Date.now
  ) {}

  add(k: string, fields: Record<string, unknown>) {
    if (this.lines.length >= MAX_PENDING) {
      this.lines.shift();
      this.dropped++;
    }
    this.lines.push({ t: this.now(), k, ...fields });
  }

  /** Where a chunk goes: live-recordings/<slug>/<UTC date>/<UTC time>-<seq>.jsonl.gz */
  pathFor(ms: number, seq: number): string {
    const s = stamp(ms);
    return `live-recordings/${this.ref.slug}/${s.slice(0, 8)}/${s.slice(9)}-${String(seq).padStart(5, "0")}.jsonl.gz`;
  }

  /** Upload what has been kept since the last upload; on a refusal it stays for the next one. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.lines.length === 0) return Promise.resolve();
    const batch = this.lines;
    this.lines = [];
    const path = this.pathFor(this.now(), this.seq++);
    const body = gzipSync(Buffer.from(batch.map(lineJson).join("\n") + "\n", "utf8"));
    this.flushing = this.bucket
      .upload(path, body, { contentType: "application/gzip", upsert: false })
      .then(({ error }) => {
        if (error) throw new Error(error.message);
        this.uploaded += batch.length;
      })
      .catch((e: unknown) => {
        console.warn(`[live-record] ${this.ref.slug}: upload ${path} failed: ${e instanceof Error ? e.message : String(e)}`);
        this.lines = [...batch, ...this.lines].slice(-MAX_PENDING);
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  start(http: HttpClient) {
    this.add("start", { slug: this.ref.slug, eventId: this.ref.eventId, sessionId: this.ref.sessionId });
    // Keep the session's poller running (its state reads are recorded) with no one watching.
    this.unsubscribe = subscribeLive(this.ref.eventId, this.ref.sessionId, this.ref.slug, () => undefined);
    void this.loadTrack(http);
    void this.connectHub();
  }

  onState(eventId: number, sessionId: number, raw: unknown) {
    if (eventId === this.ref.eventId && sessionId === this.ref.sessionId) this.add("state", { d: raw });
  }

  async tick(http: HttpClient) {
    if (!this.haveTrack && this.now() - this.trackAt >= TRACK_RETRY_MS) await this.loadTrack(http);
  }

  private async loadTrack(http: HttpClient) {
    this.trackAt = this.now();
    try {
      const map = await http.getJson<unknown>(`${FEED_API}/v2/Events/LoadTrackMap?eventId=${this.ref.eventId}`);
      if (map && typeof map === "object") {
        this.haveTrack = true;
        this.add("track", { d: map });
      } else this.add("track-miss", { msg: "not learned yet" });
    } catch (e) {
      // 404 until the feed has learned the track from enough laps: try again later.
      this.add("track-miss", { msg: e instanceof Error ? e.message : String(e) });
    }
  }

  private async connectHub() {
    const hub = new HubConnectionBuilder()
      .withUrl(`${FEED_API}/event-status`, { skipNegotiation: true, transport: HttpTransportType.WebSockets })
      .withAutomaticReconnect([0, 2_000, 10_000, 30_000, 30_000, 60_000])
      .configureLogging(LogLevel.None)
      .build();
    for (const m of HUB_METHODS) hub.on(m, (...a: unknown[]) => this.add("hub", { m, a }));
    hub.onreconnected(() => {
      this.add("hub-reconnected", {});
      void hub.invoke("SubscribeToEventV2", this.ref.eventId).catch((e: unknown) => this.add("hub-error", { msg: String(e) }));
    });
    hub.onclose((e) => this.add("hub-closed", { msg: e ? String(e) : null }));
    this.hub = hub;
    try {
      await hub.start();
      await hub.invoke("SubscribeToEventV2", this.ref.eventId);
      this.add("hub-subscribed", {});
      console.log(`[live-record] ${this.ref.slug}: push connection subscribed`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.add("hub-error", { msg });
      console.warn(`[live-record] ${this.ref.slug}: push connection refused (state reads still recorded): ${msg}`);
      await hub.stop().catch(() => undefined);
      this.hub = null;
    }
  }

  async stop() {
    this.add("stop", {});
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.hub?.stop().catch(() => undefined);
    this.hub = null;
    await this.flush();
    if (this.lines.length) await this.flush();
  }
}

const recordings = new Map<string, Recording>();
let timers: NodeJS.Timeout[] = [];
let detach: (() => void) | null = null;

/** Start recording live WRL sessions (server start-up). Returns false when it stays off. */
export function startLiveRecorder(bucket: RecordBucket | null): boolean {
  if (process.env.LIVE_RECORD === "0" || !bucket) return false;
  const http = paced(createHttpClient({ delayMs: 0, attempts: 2, timeoutMs: 45_000 }));
  const onState = (eventId: number, sessionId: number, raw: unknown) => {
    for (const r of recordings.values()) r.onState(eventId, sessionId, raw);
  };
  feedStates.on("state", onState);
  detach = () => feedStates.off("state", onState);

  const check = async () => {
    try {
      const live = await listLiveSessions();
      const keys = new Set(live.map((s) => s.slug));
      for (const s of live) {
        if (recordings.has(s.slug)) continue;
        const r = new Recording(s, bucket);
        recordings.set(s.slug, r);
        r.start(http);
        console.log(`[live-record] recording ${s.slug}`);
      }
      for (const [slug, r] of recordings) {
        if (keys.has(slug)) await r.tick(http);
        else {
          recordings.delete(slug);
          await r.stop();
          console.log(`[live-record] stopped ${slug} (no longer live)`);
        }
      }
    } catch (e) {
      console.warn(`[live-record] live session check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  void check();
  const c = setInterval(() => void check(), CHECK_MS);
  const f = setInterval(() => {
    for (const r of recordings.values()) void r.flush();
  }, FLUSH_MS);
  c.unref?.();
  f.unref?.();
  timers = [c, f];
  return true;
}

/** Shutdown: upload what is kept (a redeploy loses nothing). */
export async function stopLiveRecorder(): Promise<void> {
  for (const t of timers) clearInterval(t);
  timers = [];
  detach?.();
  detach = null;
  await Promise.all([...recordings.values()].map((r) => r.stop()));
  recordings.clear();
}
