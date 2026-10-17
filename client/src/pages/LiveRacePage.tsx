/**
 * RaceTrace Live: a WRL session still running on RedMist, drawn with the same
 * Position Trace and Lap Times as a finished race and refreshed as laps
 * complete. Public, no login. Nothing here is stored as a race.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { LapChart } from "../features/chart/LapChart";
import { LapTimeChart } from "../features/chart/LapTimeChart";
import { useTraceView } from "../features/chart/trace-view";
import { useChartDefaults } from "../features/chart/chart-defaults";
import { carKey } from "../features/chart/car-number";
import { LiveRaceContext } from "../features/chart/live-zoom";
import { hasTeamAccess } from "../lib/utils";
import { fetchLiveSessions, useLiveChartData, type LiveSessionListing } from "../hooks/useLiveChartData";

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

/** "07:35:12.000" → "7:35:12". */
function clock(s: string | null | undefined): string | null {
  const m = String(s ?? "").match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1] ?? 0) * 24 + Number(m[2]);
  return `${h}:${m[3]}:${m[4]}`;
}

function ago(ms: number | null, now: number): string {
  if (ms === null) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
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

function LiveDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: RT.live }} />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: RT.live }} />
    </span>
  );
}

// ─── /live ────────────────────────────────────────────────────────────────────

export function LiveListPage() {
  const [sessions, setSessions] = useState<LiveSessionListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchLiveSessions()
      .then((r) => setSessions(r.sessions))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load live sessions"));
  }, []);

  if (sessions && sessions.length === 1) {
    const s = sessions[0];
    return <Navigate to={`/live/${s.eventId}/${s.sessionId}`} replace />;
  }
  return (
    <div className="min-h-full px-4 py-10 sm:px-8" style={{ background: "#0b0b18", color: RT.text }}>
      <div className="mx-auto max-w-2xl">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <LiveDot /> RaceTrace Live
        </h1>
        <p className="mt-1 text-sm" style={{ color: RT.muted }}>
          WRL races that are running right now, lap by lap from the timing.
        </p>
        {error && <p className="mt-6 text-sm" style={{ color: RT.soft }}>{error}</p>}
        {!sessions && !error && <p className="mt-6 text-sm" style={{ color: RT.muted }}>Looking for live races…</p>}
        {sessions && sessions.length === 0 && (
          <p className="mt-6 text-sm" style={{ color: RT.soft }}>
            No WRL race is running right now. <Link to="/races" className="underline" style={{ color: RT.accent }}>Browse finished races</Link>.
          </p>
        )}
        <ul className="mt-6 space-y-2">
          {(sessions ?? []).map((s) => (
            <li key={`${s.eventId}/${s.sessionId}`}>
              <Link
                to={`/live/${s.eventId}/${s.sessionId}`}
                className="flex items-center justify-between rounded-lg border px-4 py-3 hover:brightness-125"
                style={{ background: RT.card, borderColor: RT.border }}
              >
                <span>
                  <span className="block font-medium">{s.sessionName}</span>
                  <span className="block text-sm" style={{ color: RT.muted }}>
                    {s.eventName}
                    {s.track ? ` · ${s.track}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs font-semibold tracking-wider" style={{ color: RT.live }}>
                  <LiveDot /> LIVE
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── /live/:eventId/:sessionId ────────────────────────────────────────────────

export function LiveRacePage() {
  const { eventId, sessionId } = useParams<{ eventId: string; sessionId: string }>();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const chartDefaults = useChartDefaults(isAuthenticated, authLoading);
  const { data, annotations, race, live, checkedAt, error, isLoading } = useLiveChartData(eventId, sessionId);
  const now = useNow();
  const [tab, setTab] = useState<"position" | "laptimes">("position");

  const [focusNum, setFocusNum] = useState(0);
  const [compSet, setCompSet] = useState<Set<number>>(new Set());
  const [classView, setClassView] = useState("");
  const [activeLap, setActiveLap] = useState<number | null>(null);
  /** Cars already placed in compSet, so a car that appears mid-race joins the comparison once. */
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!data) return;
    const nums = Object.keys(data.cars).map(Number);
    if (seen.current.size === 0) {
      // First chart: focus on the leader (or ?car=), compare against the field.
      let lead = 0;
      for (const [n, c] of Object.entries(data.cars)) if (c.finishPos === 1) lead = Number(n);
      lead = lead || nums[0] || 0;
      const param = new URLSearchParams(window.location.search).get("car");
      const named = param ? carKey(data, param) : null;
      if (named !== null && named > 0 && data.cars[String(named)]) lead = named;
      setFocusNum(lead);
      setClassView(chartDefaults.classView === "focus_class" ? (data.cars[String(lead)]?.cls ?? "") : "");
      setCompSet(new Set(nums.filter((n) => n !== lead)));
      nums.forEach((n) => seen.current.add(n));
      return;
    }
    const fresh = nums.filter((n) => !seen.current.has(n));
    if (fresh.length) {
      fresh.forEach((n) => seen.current.add(n));
      setCompSet((prev) => new Set([...prev, ...fresh.filter((n) => n !== focusNum)]));
    }
    // A car can drop out of the data (its laps re-scored): keep the focus on a car that exists.
    if (focusNum && !data.cars[String(focusNum)]) setFocusNum(nums[0] ?? 0);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFocusChange = useCallback((num: number) => {
    setFocusNum(num);
    setCompSet((prev) => {
      const next = new Set(prev);
      next.delete(num);
      return next;
    });
    setActiveLap(null);
  }, []);

  const traceView = useTraceView({ data: data ?? null, focusNum, setFocusNum: handleFocusChange, setCompSet, classView, setClassView });

  if (!eventId || !sessionId) return <Navigate to="/live" replace />;

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
          {error ?? live?.waiting ?? "Waiting for the timing."} This page checks again every 30 seconds.
        </p>
      </Centered>
    );
  }

  const st = live?.status;
  const flag = st?.flag ?? null;
  const ttg = clock(st?.timeToGo);
  const run = clock(st?.runningRaceTime);
  const serverAge = live?.updatedAt ? now - Date.parse(live.updatedAt) : 0;
  const delayed = !!live?.lastError || !!error || serverAge > 3 * 60_000;
  const isTeam = hasTeamAccess(user);
  const tabs = [
    { id: "position" as const, label: "Position Trace", locked: false },
    { id: "laptimes" as const, label: "Lap Times", locked: !isTeam },
  ];

  return (
    // No RaceMetaContext: the race-card share image describes a finished result.
    <LiveRaceContext.Provider value={!live?.ended}>
      <div className="flex h-full flex-col overflow-y-auto custom-scroll md:overflow-hidden" style={{ background: "#0b0b18", color: RT.text }}>
        <section className="flex shrink-0 flex-col gap-1.5 px-3 pt-2.5 sm:px-6 sm:pt-3">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: RT.muted }}>
            <Link to="/live" className="hover:underline" style={{ color: RT.muted }}>
              Live
            </Link>
            <span aria-hidden>/</span>
            <span className="rounded border px-1.5 text-[11px] font-semibold tracking-[0.04em]" style={{ borderColor: RT.border, color: RT.text }}>
              WRL
            </span>
            <span>{race.season}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="m-0 text-xl font-semibold sm:text-2xl">{live?.sessionName ?? race.name}</h1>
            <span className="text-sm" style={{ color: RT.soft }}>
              {[live?.eventName, live?.eventName?.includes(race.track) ? null : race.track].filter(Boolean).join(" · ")}
            </span>
          </div>
          {/* Live status bar */}
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-sm"
            style={{ background: RT.card, borderColor: RT.line }}
            role="status"
            aria-live="polite"
          >
            <span className="flex items-center gap-2 font-semibold tracking-wider" style={{ color: live?.ended ? RT.muted : RT.live }}>
              {!live?.ended && <LiveDot />}
              {live?.ended ? "FINISHED" : "LIVE"}
            </span>
            <span>
              Lap <b>{st?.leaderLap ?? data.maxLap}</b>
            </span>
            {flag && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: FLAG_COLORS[flag] ?? RT.muted }} aria-hidden />
                {flag}
              </span>
            )}
            {run && <span style={{ color: RT.soft }}>Race time {run}</span>}
            {ttg && !live?.ended && <span style={{ color: RT.soft }}>{ttg} to go</span>}
            <span>{st?.carCount ?? Object.keys(data.cars).length} cars</span>
            <span className="flex-1" />
            <span style={{ color: delayed ? "#fab219" : RT.muted }}>
              {delayed ? "Timing feed delayed · " : ""}checked {ago(checkedAt, now)}
            </span>
          </div>
          <p className="text-xs" style={{ color: RT.muted }}>
            Positions are as of each completed lap and may change when results are official. The full race analysis follows after the finish.
          </p>
        </section>

        <nav aria-label="Race views" className="no-scrollbar mt-0.5 flex shrink-0 gap-1 overflow-x-auto border-b px-2 sm:px-6" style={{ borderColor: RT.line }}>
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
            defaultAxis={chartDefaults.axis}
            live
          />
        </div>
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
            />
          </div>
        )}
      </div>
    </LiveRaceContext.Provider>
  );
}
