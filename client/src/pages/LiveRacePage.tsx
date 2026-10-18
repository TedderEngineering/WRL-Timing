/**
 * RaceTrace Live: a WRL session still running, drawn with the same
 * Position Trace and Lap Times as a finished race and refreshed as laps
 * complete. Public, no login. Nothing here is stored as a race.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { LapChart } from "../features/chart/LapChart";
import { LapTimeChart } from "../features/chart/LapTimeChart";
import { PitAnalysisTab } from "../features/chart/PitAnalysisTab";
import { TrackMap } from "../features/chart/TrackMap";
import { TraceControls } from "../features/chart/TraceControls";
import { pitAnalysisFromChart } from "../features/chart/live-pit-analysis";
import { useTraceView } from "../features/chart/trace-view";
import { useChartDefaults } from "../features/chart/chart-defaults";
import { carKey, carNo } from "../features/chart/car-number";
import { gapClock, lapsAndSeconds, leaderGaps, type LeaderGap } from "../features/chart/live-gaps";
import { LiveClockContext, LiveRaceContext } from "../features/chart/live-zoom";
import { hasTeamAccess } from "../lib/utils";
import { fetchLiveSessions, getPublic, useLiveChartData, type LiveListing, type LiveSessionListing, type UpcomingListed } from "../hooks/useLiveChartData";
import { countdownText, goesLiveText, sessionFor } from "../features/live/banner";
import { readLiveCar, saveLiveCar } from "../features/live/my-car";

const RT = { line: "#1e1e38", border: "#3a3a5c", card: "#12122a", text: "#e0e0e8", soft: "#cbd5e1", muted: "#9a9ab4", accent: "#F48C34", live: "#ef4444" };

const FLAG_COLORS: Record<string, string> = {
  Green: "#22c55e",
  Yellow: "#facc15",
  "Code 35": "#a855f7",
  "Code 60": "#a855f7",
  Red: "#ef4444",
  White: "#e5e7eb",
  Checkered: "#e5e7eb",
  Black: "#9ca3af",
};

function ago(ms: number | null, now: number): string {
  if (ms === null) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
}

/** "7:35:12"-style span → seconds. */
function spanSec(s: string | null | undefined): number | null {
  const m = String(s ?? "").match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]) : null;
}

function hms(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Race time and time to go, counting every second between updates from the last values the
 * timing gave (`at` = when they were true on this device's clock). Frozen under a red flag, at
 * the finish, or when `frozen`. Its own timer, so the charts do not re-render each second.
 */
function RaceClock({ run, ttg, at, frozen }: { run: string | null | undefined; ttg: string | null | undefined; at: number | null; frozen: boolean }) {
  const now = useNow(1000);
  const runSec = spanSec(run);
  const ttgSec = spanSec(ttg);
  const elapsed = !frozen && at !== null ? Math.max(0, (now - at) / 1000) : 0;
  return (
    <>
      {runSec !== null && <span style={{ color: RT.soft }}>Race time {hms(runSec + elapsed)}</span>}
      {ttgSec !== null && <span style={{ color: RT.soft }}>{hms(ttgSec - elapsed)} to go</span>}
    </>
  );
}

function useNow(every = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-24 text-center" style={{ background: "#0b0b18", color: RT.text }}>
      {children}
    </div>
  );
}

/** Flags under which the gap to the leader matters most (the field bunches; the gap is time to make up at the restart). */
const CAUTION_FLAGS = new Set(["Yellow", "Code 35", "Code 60", "Red"]);

function gapPart(g: LeaderGap, label: string) {
  // "54.1 (+1L)": whole laps at the car's average lap, and the rest in seconds.
  const text = g.pace !== null ? lapsAndSeconds(g.laps, g.pace) : g.sec !== null ? gapClock(g.sec) : `${g.laps.toFixed(1)} L`;
  return (
    <span className="whitespace-nowrap">
      <b>{text}</b> behind {label}
    </span>
  );
}

/**
 * The focus car's gap to the overall and class leaders, in laps and seconds of its recent green
 * pace. Under a caution it stands out: the gap is what the car has to make up at the restart.
 */
function LeaderGapBadge({ data, focusNum, flag, drift }: { data: Parameters<typeof leaderGaps>[0]; focusNum: number; flag: string | null; drift: () => number | null }) {
  useNow(1000); // moves on every second between updates
  if (!focusNum || !data.cars[String(focusNum)]) return null;
  const g = leaderGaps(data, focusNum, drift());
  const caution = !!flag && CAUTION_FLAGS.has(flag);
  const num = carNo(data, focusNum);
  const parts = [g.overall && gapPart(g.overall, "the leader"), g.cls && gapPart(g.cls, `the ${g.clsName} leader`)].filter(Boolean);
  return (
    <span
      className={caution ? "flex flex-wrap items-center gap-x-2 rounded-md border px-2 py-0.5 text-[15px] font-medium" : "flex flex-wrap items-center gap-x-2"}
      style={caution ? { borderColor: "#facc15", background: "rgba(250,204,21,0.12)", color: "#fde68a" } : { color: RT.soft }}
      title="Behind the leader: whole laps at the car's average lap (its last 5 green laps), and the rest in seconds; 54.1 (+1L) = a lap and 54.1 s. Under a caution it is the time to make up once racing resumes. Between updates it moves on at each car's pace (an estimate); under a caution it holds the last timed gap."
    >
      <span className="font-mono font-semibold" style={{ color: caution ? "#fde68a" : RT.accent }}>
        #{num}
      </span>
      {parts.length ? parts.map((x, i) => <span key={i}>{i > 0 ? "· " : ""}{x}</span>) : <span>leads the race</span>}
    </span>
  );
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: RT.live }} />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: RT.live }} />
    </span>
  );
}

// ─── /live/next/:id ───────────────────────────────────────────────────────────

/**
 * A scheduled race before its timing opens: what it is, when it starts, a countdown, and what the
 * page will show. Checks every 30 s and turns into the live race page as soon as the timing has the
 * session (usually an hour or two before the start).
 */
export function UpcomingRacePage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [list, setList] = useState<LiveListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<UpcomingListed | null>(null);
  const now = useNow(1000);
  const [entries, setEntries] = useState<{ car: string; team: string; cls: string }[]>([]);
  const [eventName, setEventName] = useState<string | null>(null);
  const [myCar, setMyCar] = useState<string | null>(null);
  const myCarRef = useRef<string | null>(null);
  myCarRef.current = myCar;
  // The session and the event's entry list (to pick a car before the start).
  useEffect(() => {
    let alive = true;
    getPublic<{ session: UpcomingListed; entries: { car: string; team: string; cls: string }[] }>(`/live/next/${encodeURIComponent(id)}`)
      .then(({ body }) => {
        if (!alive) return;
        known.current ??= body.session;
        setEntries(body.entries);
        setEventName(body.session.eventName);
        setMyCar(readLiveCar(body.session.eventName));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchLiveSessions()
        .then((r) => {
          if (!alive) return;
          setList(r);
          setError(null);
          const u = (r.upcoming ?? []).find((x) => x.id === id);
          if (u) known.current = u;
          const live = known.current ? sessionFor(known.current, r) : null;
          if (live) navigate(`/live/${live.slug}${myCarRef.current ? `?car=${encodeURIComponent(myCarRef.current)}` : ""}`, { replace: true });
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not check the timing"));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, navigate]);

  const u = known.current ?? (list?.upcoming ?? []).find((x) => x.id === id) ?? null;
  return (
    <div className="min-h-full overflow-y-auto px-4 py-10 sm:px-8" style={{ background: "#0b0b18", color: RT.text }}>
      <div className="mx-auto max-w-2xl">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-wider" style={{ color: RT.accent }}>
          <LiveDot /> RACETRACE LIVE
        </p>
        {!list && !error && <p className="mt-6 text-sm" style={{ color: RT.muted }}>Checking the timing…</p>}
        {error && <p className="mt-6 text-sm" style={{ color: RT.soft }}>{error}</p>}
        {list && !u && (
          <p className="mt-6 text-sm" style={{ color: RT.soft }}>
            This session is not on the schedule any more. <Link to="/live" className="underline" style={{ color: RT.accent }}>See what is live</Link>.
          </p>
        )}
        {u && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="m-0 text-3xl font-semibold">{u.sessionName}</h1>
              <span className="rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider" style={{ borderColor: RT.accent, color: RT.accent }}>
                Not live yet
              </span>
            </div>
            <p className="mt-1" style={{ color: RT.soft }}>
              {u.series} · {u.eventName}
            </p>
            <div className="mt-6 rounded-lg border p-5" style={{ background: RT.card, borderColor: RT.border }}>
              <div className="text-xs uppercase tracking-[0.06em]" style={{ color: RT.muted }}>
                Green flag
              </div>
              <div className="mt-1 text-xl font-semibold">
                {new Date(u.startsAt).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
              </div>
              <div className="mt-3 text-3xl font-semibold tabular-nums" style={{ color: RT.accent }}>
                {countdownText(u.startsAt, now)}
              </div>
            </div>
            {entries.length > 0 && (
              <div className="mt-6 rounded-lg border p-5" style={{ background: RT.card, borderColor: RT.border }}>
                <label htmlFor="my-car" className="text-xs uppercase tracking-[0.06em]" style={{ color: RT.muted }}>
                  Your car
                </label>
                <select
                  id="my-car"
                  value={myCar ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setMyCar(v);
                    saveLiveCar(eventName, v);
                  }}
                  className="mt-2 block w-full rounded-md border px-3 py-2 text-base"
                  style={{ background: "#0b0b18", borderColor: RT.border, color: RT.text }}
                >
                  <option value="">The race leader</option>
                  {[...new Set(entries.map((e) => e.cls))].map((cls) => (
                    <optgroup key={cls} label={cls || "Other"}>
                      {entries
                        .filter((e) => e.cls === cls)
                        .map((e) => (
                          <option key={e.car} value={e.car}>
                            #{e.car} {e.team}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <p className="mt-2 text-xs" style={{ color: RT.muted }}>
                  {myCar ? `Live timing will open on #${myCar}: its position trace, gaps and pit stops, highlighted on the track map.` : "Pick your car and live timing will open on it."}
                </p>
              </div>
            )}
            <p className="mt-6 text-sm leading-relaxed" style={{ color: RT.soft }}>
              This page turns into live timing as soon as the session opens on the timing, usually an hour or two before the start:
              the position trace lap by lap, the track map with every car moving round the circuit, gaps to the cars around you,
              pit stops and lap times. Keep it open; it checks every 30 seconds.
            </p>
            {(list?.sessions.length ?? 0) > 0 && (
              <p className="mt-4 text-sm" style={{ color: RT.soft }}>
                On track now:{" "}
                {list!.sessions.map((s, i) => (
                  <span key={s.slug}>
                    {i ? ", " : ""}
                    <Link to={`/live/${s.slug}`} className="underline" style={{ color: RT.accent }}>
                      {s.sessionName}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── /live ────────────────────────────────────────────────────────────────────

export function LiveListPage() {
  const [list, setList] = useState<LiveListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchLiveSessions()
        .then((r) => alive && setList(r))
        .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load live sessions"));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const sessions = list?.sessions ?? null;
  const upcoming = list?.upcoming ?? [];
  const recent = list?.recent ?? [];

  if (sessions && sessions.length === 1 && upcoming.length === 0) {
    const s = sessions[0];
    return <Navigate to={`/live/${s.slug}`} replace />;
  }
  const kindLabel = (k: LiveSessionListing["kind"]) => (k === "qualify" ? "Qualifying" : k === "practice" ? "Practice" : "Race");
  const card = "flex items-center justify-between gap-3 rounded-lg border px-4 py-3";
  return (
    <div className="min-h-full px-4 py-10 sm:px-8" style={{ background: "#0b0b18", color: RT.text }}>
      <div className="mx-auto max-w-2xl">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <LiveDot /> RaceTrace Live
        </h1>
        <p className="mt-1 text-sm" style={{ color: RT.muted }}>
          WRL sessions lap by lap from the timing: races, qualifying and practice.
        </p>
        {error && <p className="mt-6 text-sm" style={{ color: RT.soft }}>{error}</p>}
        {!list && !error && <p className="mt-6 text-sm" style={{ color: RT.muted }}>Looking for live sessions…</p>}
        {list && sessions?.length === 0 && upcoming.length === 0 && (
          <p className="mt-6 text-sm" style={{ color: RT.soft }}>
            Nothing is running right now. <Link to="/races" className="underline" style={{ color: RT.accent }}>Browse finished races</Link>.
          </p>
        )}
        <ul className="mt-6 space-y-2">
          {(sessions ?? []).map((s) => (
            <li key={s.slug}>
              <Link to={`/live/${s.slug}`} className={`${card} hover:brightness-125`} style={{ background: RT.card, borderColor: RT.border }}>
                <span>
                  <span className="block font-medium">{s.sessionName}</span>
                  <span className="block text-sm" style={{ color: RT.muted }}>
                    {kindLabel(s.kind)} · {s.eventName}
                    {s.status?.leaderLap ? ` · Lap ${s.status.leaderLap}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs font-semibold tracking-wider" style={{ color: RT.live }}>
                  <LiveDot /> LIVE
                </span>
              </Link>
            </li>
          ))}
          {upcoming.map((u) => (
            <li key={u.id}>
              <Link to={`/live/next/${encodeURIComponent(u.id)}`} className={`${card} hover:brightness-125`} style={{ background: RT.card, borderColor: RT.border }}>
                <span>
                  <span className="block font-medium">{u.sessionName}</span>
                  <span className="block text-sm" style={{ color: RT.muted }}>
                    {u.series} · {u.eventName} · {new Date(u.startsAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
                  </span>
                  <span className="mt-1 block text-xs" style={{ color: RT.muted }}>
                    Live timing opens here when the session starts.
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold tracking-wider" style={{ color: RT.accent }}>
                  {goesLiveText(u.startsAt, now)} ›
                </span>
              </Link>
            </li>
          ))}
          {recent.map((s) => (
            <li key={s.slug}>
              <Link to={`/live/${s.slug}`} className={`${card} hover:brightness-125`} style={{ background: RT.card, borderColor: RT.border }}>
                <span>
                  <span className="block font-medium">{s.sessionName}</span>
                  <span className="block text-sm" style={{ color: RT.muted }}>
                    {kindLabel(s.kind)} · {s.eventName}
                  </span>
                </span>
                <span className="text-xs font-semibold tracking-wider" style={{ color: RT.muted }}>
                  FINISHED
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── /live/:slug ──────────────────────────────────────────────────────────────

export function LiveRacePage() {
  const { slug } = useParams<{ slug: string }>();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const chartDefaults = useChartDefaults(isAuthenticated, authLoading);
  const { data, annotations, race, live, checkedAt, clockAt, error, isLoading, saver } = useLiveChartData(slug);
  const now = useNow();
  const [tab, setTab] = useState<"position" | "map" | "pitanalysis" | "laptimes">("position");
  /** The tab row's slot for the focus car and class picker (TraceControls, wider than a phone). */
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);

  const [focusNum, setFocusNum] = useState(0);
  const [compSet, setCompSet] = useState<Set<number>>(new Set());
  const [classView, setClassView] = useState("");
  const [activeLap, setActiveLap] = useState<number | null>(null);
  /** The first chart sets focus and compare; later updates keep the viewer's choices. */
  const initialised = useRef(false);
  /** The car the page opened on (the leader, ?car= or the saved car). */
  const openedOn = useRef(0);

  useEffect(() => {
    if (!data) return;
    const nums = Object.keys(data.cars).map(Number);
    if (!initialised.current) {
      initialised.current = true;
      // First chart: focus on the leader (or ?car=), compare against the field.
      let lead = 0;
      for (const [n, c] of Object.entries(data.cars)) if (c.finishPos === 1) lead = Number(n);
      lead = lead || nums[0] || 0;
      const param = new URLSearchParams(window.location.search).get("car") ?? readLiveCar(live?.eventName);
      const named = param ? carKey(data, param) : null;
      if (named !== null && named > 0 && data.cars[String(named)]) lead = named;
      setFocusNum(lead);
      openedOn.current = lead;
      setClassView(chartDefaults.classView === "focus_class" ? (data.cars[String(lead)]?.cls ?? "") : "");
      setCompSet(new Set(nums.filter((n) => n !== lead)));
      return;
    }
    // A car can drop out of the data (its laps re-scored): keep the focus on a car that exists.
    if (focusNum && !data.cars[String(focusNum)]) setFocusNum(nums[0] ?? 0);
    // Compare keeps the viewer's picks; "All cars" (trace-view) takes in cars that appear mid-race.
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The car the viewer follows at this event, for the next visit (and its next race's pre-race
  // page): only a car they chose, not the leader the page opened on.
  useEffect(() => {
    if (initialised.current && focusNum && focusNum !== openedOn.current && data?.cars[String(focusNum)]) saveLiveCar(live?.eventName, carNo(data, focusNum));
  }, [focusNum]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFocusChange = useCallback((num: number) => {
    setFocusNum(num);
    setCompSet((prev) => {
      const next = new Set(prev);
      next.delete(num);
      return next;
    });
    setActiveLap(null);
  }, []);

  // ── Moving gaps on between updates ──────────────────────────────
  // Seconds since this data arrived: each pair of cars is moved on at their paces from the later of
  // their last crossings (live-gaps.ts). Held under a caution, red or at the finish (the field
  // bunches in ways green pace does not predict), and never more than 90 s past the data.
  const dataAt = useMemo(() => Date.now(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pit Stops: the live chart's own stops, rebuilt on each update while the tab is open.
  const pitAnalysis = useMemo(
    () => (tab === "pitanalysis" && data ? pitAnalysisFromChart(data, annotations, race?.track ?? "") : null),
    [tab, data, annotations, race?.track]
  );
  const flagNow = live?.status?.flag ?? null;
  const holdGaps = !!live?.ended || (!!flagNow && CAUTION_FLAGS.has(flagNow));
  const drift = useCallback(() => (holdGaps || !data ? null : Math.min(90, (Date.now() - dataAt) / 1000)), [holdGaps, data, dataAt]);

  const traceView = useTraceView({ data: data ?? null, focusNum, setFocusNum: handleFocusChange, setCompSet, classView, setClassView, raceKey: slug });

  if (!slug) return <Navigate to="/live" replace />;

  if (isLoading && !data) {
    return (
      <Centered>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: RT.accent, borderTopColor: "transparent" }} />
        <p style={{ color: RT.muted }}>Connecting to the live timing…</p>
      </Centered>
    );
  }

  if (!data || !annotations || !race) {
    return (
      <Centered>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <LiveDot /> {live?.sessionName ?? "Live race"}
        </h1>
        {live?.eventName && <p style={{ color: RT.soft }}>{[live.eventName, live.track].filter(Boolean).join(" · ")}</p>}
        <p className="max-w-md" style={{ color: RT.muted }}>
          {error ?? live?.waiting ?? "Waiting for the timing."} This page checks again every few seconds.
        </p>
      </Centered>
    );
  }

  const st = live?.status;
  const flag = st?.flag ?? null;
  const serverAge = live?.updatedAt ? now - Date.parse(live.updatedAt) : 0;
  const delayed = !!live?.delayed || !!error || serverAge > 3 * 60_000;
  const isTeam = hasTeamAccess(user);
  const tabs = [
    { id: "position" as const, label: "Position Trace", locked: false },
    { id: "map" as const, label: "Track Map", locked: false },
    { id: "pitanalysis" as const, label: "Pit Stops", locked: !isTeam },
    { id: "laptimes" as const, label: "Lap Times", locked: !isTeam },
  ];

  return (
    // No RaceMetaContext: the race-card share image describes a finished result.
    <LiveRaceContext.Provider value={!live?.ended}>
    <LiveClockContext.Provider value={drift}>
      <div className="flex h-full flex-col overflow-y-auto custom-scroll md:overflow-hidden" style={{ background: "#0b0b18", color: RT.text }}>
        {/* One line: series, race, event, then the live status (wraps on a phone). */}
        <section
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-1.5 pt-2.5 text-sm sm:px-6 sm:pt-3"
          role="status"
          aria-live="polite"
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="self-center rounded border px-1.5 text-[11px] font-semibold tracking-[0.04em]" style={{ borderColor: RT.border, color: RT.text }}>
              WRL
            </span>
            <h1 className="m-0 text-xl font-semibold sm:text-2xl">{live?.sessionName ?? race.name}</h1>
            <span style={{ color: RT.soft }}>
              {[live?.eventName, live?.eventName?.includes(race.track) ? null : race.track].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Link
            to="/live"
            className="flex items-center gap-2 font-semibold tracking-wider"
            style={{ color: live?.ended ? RT.muted : RT.live }}
            title="Positions are as of each completed lap and may change when results are official. The full race analysis follows after the finish."
          >
            {!live?.ended && <LiveDot />}
            {live?.ended ? "FINISHED" : "LIVE"}
          </Link>
          <span>
            Lap <b>{st?.leaderLap ?? data.maxLap}</b>
          </span>
          {flag && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: FLAG_COLORS[flag] ?? RT.muted }} aria-hidden />
              {flag}
            </span>
          )}
          <RaceClock run={st?.runningRaceTime} ttg={live?.ended ? null : st?.timeToGo} at={clockAt} frozen={!!live?.ended || flag === "Red" || flag === "Checkered"} />
          <span>{st?.carCount ?? Object.keys(data.cars).length} cars</span>
          <LeaderGapBadge data={data} focusNum={focusNum} flag={flag} drift={drift} />
          <span className="flex-1" />
          <span className="text-xs" style={{ color: delayed ? "#fab219" : RT.muted }}>
            {delayed ? "Timing feed delayed · " : ""}
            {saver ? <span title="Your phone is saving data, so this page checks every 30 seconds instead of every 5.">Data saver · </span> : null}
            checked {ago(checkedAt, now)}
          </span>
        </section>

        {/* The tabs, and (wider than a phone) the focus car and class picker on the same row. */}
        <div className="mt-0.5 flex shrink-0 flex-wrap items-stretch gap-x-4 border-b px-2 sm:px-6" style={{ borderColor: RT.line }}>
        <nav aria-label="Race views" className="no-scrollbar flex min-w-0 items-end gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-current={active ? "page" : undefined}
                disabled={t.locked}
                onClick={() => setTab(t.id)}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-60"
                style={{ color: active ? RT.text : RT.muted, fontWeight: active ? 600 : 400, borderBottom: `2px solid ${active ? RT.accent : "transparent"}`, marginBottom: -1 }}
              >
                {t.label}
                {t.locked && (
                  <span className="rounded px-1 text-[10px] font-semibold uppercase tracking-wider" style={{ background: RT.line, color: RT.muted }}>
                    Team
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div ref={setHeadSlot} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1.5 empty:hidden" />
        </div>

        <div className={tab !== "position" ? "hidden" : "flex flex-col md:min-h-0 md:flex-1"}>
          <LapChart
            data={data}
            annotations={annotations}
            watermarkEmail={user?.email}
            focusNum={focusNum}
            setFocusNum={setFocusNum}
            compSet={compSet}
            setCompSet={setCompSet}
            classView={classView}
            setClassView={setClassView}
            activeLap={activeLap}
            setActiveLap={setActiveLap}
            view={traceView}
            // Race time: every running car's trace reaches now. By lap, the leader's runs furthest
            // and each car's stops at its own lap count.
            defaultAxis="hours"
            live
            headSlot={tab === "position" ? headSlot : null}
          />
        </div>
        {tab === "map" && (
          <div className="flex flex-col md:min-h-0 md:flex-1">
            <TraceControls data={data} focusNum={focusNum} onFocus={setFocusNum} classView={classView} compSet={compSet} view={traceView} headSlot={headSlot} />
            <TrackMap slug={slug} data={data} focusNum={focusNum} setFocusNum={setFocusNum} compSet={compSet} classView={classView} />
          </div>
        )}
        {tab === "pitanalysis" && (
          <div className="custom-scroll px-2 py-3 sm:px-6 md:min-h-0 md:flex-1 md:overflow-y-auto">
            <PitAnalysisTab analysis={pitAnalysis} chart={data} focusNum={focusNum} setFocusNum={setFocusNum} onSwitchToTrace={() => setTab("position")} />
          </div>
        )}
        {tab === "laptimes" && (
          <div className="flex flex-col md:min-h-0 md:flex-1">
            <LapTimeChart
              data={data}
              annotations={annotations}
              watermarkEmail={user?.email}
              focusNum={focusNum}
              setFocusNum={handleFocusChange}
              compSet={compSet}
              classView={classView}
              activeLap={activeLap}
              setActiveLap={setActiveLap}
              view={traceView}
              live
              headSlot={headSlot}
            />
          </div>
        )}
      </div>
    </LiveClockContext.Provider>
    </LiveRaceContext.Provider>
  );
}
