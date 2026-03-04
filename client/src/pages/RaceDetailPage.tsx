import { useParams, useSearchParams, Navigate, Link } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { useChartData } from "../hooks/useChartData";
import { LapChart } from "../features/chart/LapChart";
import { LapTimeChart } from "../features/chart/LapTimeChart";
import { StrategyTab } from "../features/chart/StrategyTab";
import { CHART_STYLE } from "../features/chart";
import { getVisibleCars } from "../features/chart/chart-renderer";
import { api, fetchEvents, fetchEvent } from "../lib/api";
import { hasTeamAccess } from "../lib/utils";
import EventSidebar from "../components/EventSidebar";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
// EmptyChartState no longer needed — auto-loads first event on mount

/** Redirect /races/:id → /chart?race=:id for bookmarked URLs */
export function RaceDetailRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/chart?race=${id}`} replace />;
}

export function RaceDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const id = searchParams.get("race") || undefined;
  const initialEventId = searchParams.get("event") || undefined;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const autoLoadAttempted = useRef(false);
  const { isAuthenticated, user } = useAuth();
  const { data, annotations, raceMeta, isLoading, error } = useChartData(id);
  const [isFavorited, setIsFavorited] = useState(false);
  const [activeTab, setActiveTab] = useState<"position" | "laptimes" | "strategy">("position");
  const [lockedMsg, setLockedMsg] = useState<string | null>(null);

  // ── Auto-load most recent event + first race when no URL params ──
  useEffect(() => {
    if (autoLoadAttempted.current || id || initialEventId) return;
    autoLoadAttempted.current = true;

    fetchEvents()
      .then((events) => {
        if (events.length === 0) return;
        const firstEvent = events[0];
        return fetchEvent(firstEvent.id).then((detail) => {
          if (detail.races.length > 0) {
            setSearchParams(
              { event: firstEvent.id, race: detail.races[0].id },
              { replace: true },
            );
          } else {
            setSearchParams({ event: firstEvent.id }, { replace: true });
          }
        });
      })
      .catch(() => {}); // fail silently — user sees empty state
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shared chart state (lifted from LapChart for cross-tab access) ──
  const [focusNum, setFocusNum] = useState(0);
  const [compSet, setCompSet] = useState<Set<number>>(new Set());
  const [classView, setClassView] = useState("");
  const [activeLap, setActiveLap] = useState<number | null>(null);

  // Initialize chart state when race data loads (or when race changes)
  const chartInitId = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !id || chartInitId.current === id) return;
    chartInitId.current = id;

    // Default: focus on race winner, compare against all cars
    let winner = 0;
    for (const [numStr, car] of Object.entries(data.cars)) {
      if (car.finishPos === 1) { winner = Number(numStr); break; }
    }
    winner = winner || Number(Object.keys(data.cars)[0]) || 0;

    setFocusNum(winner);
    setClassView("");
    setActiveLap(null);

    const allOthers = new Set<number>();
    Object.keys(data.cars).forEach((n) => {
      const num = Number(n);
      if (num !== winner) allOthers.add(num);
    });
    setCompSet(allOthers);
  }, [data, id]);

  // ── Derived data for dropdowns ──────────────────────────────
  const visibleCars = useMemo(
    () => (data ? getVisibleCars(data, classView).sort((a, b) => a - b) : []),
    [data, classView]
  );

  const handleClassChange = useCallback(
    (cls: string) => {
      if (!data) return;
      setClassView(cls);
      if (cls) {
        const focusCls = data.cars[String(focusNum)]?.cls;
        let newFocus = focusNum;
        if (focusCls !== cls) {
          newFocus = (data.classGroups[cls] || [])[0] || focusNum;
          setFocusNum(newFocus);
        }
        const newComp = new Set<number>();
        (data.classGroups[cls] || []).forEach((n) => {
          if (n !== newFocus) newComp.add(n);
        });
        setCompSet(newComp);
      }
      setActiveLap(null);
    },
    [data, focusNum]
  );

  const handleFocusChange = useCallback(
    (num: number) => {
      setFocusNum(num);
      setCompSet((prev) => {
        const next = new Set(prev);
        next.delete(num);
        return next;
      });
      setActiveLap(null);
    },
    []
  );

  // Fetch favorite status from race detail endpoint
  useEffect(() => {
    if (!id || !isAuthenticated) return;
    api
      .get<{ isFavorited: boolean }>(`/races/${id}`)
      .then((res) => setIsFavorited(res.isFavorited))
      .catch(() => {});
  }, [id, isAuthenticated]);

  const handleFavorite = async () => {
    if (!id || !isAuthenticated) return;
    try {
      const res = await api.post<{ isFavorited: boolean }>(`/races/${id}/favorite`);
      setIsFavorited(res.isFavorited);
    } catch {
      // ignore
    }
  };

  // ── Grid wrapper with sidebar ──────────────────────────────────
  const handleSelectRace = (raceId: string) => {
    const next: Record<string, string> = { race: raceId };
    if (initialEventId) next.event = initialEventId;
    setSearchParams(next);
  };

  const withSidebar = (content: React.ReactNode) => (
    <>
      {/* Mobile hamburger (below md) */}
      <button
        onClick={() => setMobileDrawerOpen(true)}
        className="fixed top-3 left-3 z-40 md:hidden p-2 rounded-lg bg-gray-900/90 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
        aria-label="Open event sidebar"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Desktop: CSS grid layout */}
      <div
        className="hidden md:grid transition-[grid-template-columns] duration-200 ease-in-out"
        style={{
          gridTemplateColumns: sidebarCollapsed ? "16px 1fr" : "280px 1fr",
        }}
      >
        <EventSidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((p) => !p)}
          onSelectRace={handleSelectRace}
          selectedRaceId={id || null}
          selectedEventId={initialEventId}
        />
        <div className="min-w-0 overflow-x-hidden">{content}</div>
      </div>

      {/* Mobile: full-width content + drawer overlay */}
      <div className="md:hidden min-w-0">{content}</div>
      <EventSidebar
        isCollapsed={false}
        onToggle={() => {}}
        onSelectRace={handleSelectRace}
        selectedRaceId={id || null}
        selectedEventId={initialEventId}
        mobileOpen={mobileDrawerOpen}
        onMobileClose={() => setMobileDrawerOpen(false)}
      />
    </>
  );

  // ── No race selected (auto-load in progress or no events) ────────
  if (!id) {
    return withSidebar(
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="h-10 w-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────
  if (isLoading) {
    return withSidebar(
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="h-10 w-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 dark:text-gray-400">Loading race data...</p>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────
  if (error || !data || !annotations || !raceMeta) {
    const cardClass = "bg-gray-800 border border-gray-700 rounded-xl p-8 text-center max-w-md mx-auto mt-12";

    let errorContent: React.ReactNode;

    if (error?.code === "AVAILABLE_SOON") {
      errorContent = (
        <div className={cardClass}>
          <svg className="h-12 w-12 text-indigo-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-xl font-semibold text-white">Almost there</h2>
          <p className="text-gray-400 mt-2">
            This race analysis is being prepared and will be available to free members shortly. Pro members get instant access to every race.
          </p>
          <Link
            to="/settings/billing"
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium mt-5 inline-block transition-colors"
          >
            Get Instant Access
          </Link>
          <div className="mt-3">
            <Link to="/races" className="text-sm text-gray-400 hover:text-gray-300 transition-colors">
              Browse available races
            </Link>
          </div>
        </div>
      );
    } else if (error?.code === "INSUFFICIENT_TIER" || error?.code === "SUBSCRIPTION_REQUIRED") {
      errorContent = (
        <div className={cardClass}>
          <svg className="h-12 w-12 text-indigo-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
          </svg>
          <h2 className="text-xl font-semibold text-white">
            Go deeper with {user?.subscription?.plan === "PRO" ? "Team" : "Pro"}
          </h2>
          <p className="text-gray-400 mt-2">
            Unlock this race and the entire library of race analytics. See position battles, pit strategy impact, and performance trends across full seasons.
          </p>
          <Link
            to="/settings/billing"
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium mt-5 inline-block transition-colors"
          >
            Upgrade to {user?.subscription?.plan === "PRO" ? "Team" : "Pro"}
          </Link>
          <div className="mt-3">
            <Link to="/races" className="text-sm text-gray-400 hover:text-gray-300 transition-colors">
              Browse free races
            </Link>
          </div>
        </div>
      );
    } else if (error?.code === "AUTH_REQUIRED" || (error?.status === 401 && !isAuthenticated)) {
      errorContent = (
        <div className={cardClass}>
          <svg className="h-12 w-12 text-gray-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h2 className="text-xl font-semibold text-white">Sign in to continue</h2>
          <p className="text-gray-400 mt-2">
            Create a free account to start exploring race analytics.
          </p>
          <Link
            to="/login"
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium mt-5 inline-block transition-colors"
          >
            Sign In
          </Link>
        </div>
      );
    } else {
      errorContent = (
        <div className="text-center mt-12">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-4">
            {error?.message === "Race not found" ? "Race Not Found" : "Error Loading Race"}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {error?.message || "The chart data could not be loaded."}
          </p>
          <Link
            to="/races"
            className="text-brand-600 dark:text-brand-400 hover:underline font-medium"
          >
            Back to races
          </Link>
        </div>
      );
    }

    return withSidebar(
      <div className="container-page py-20">
        {raceMeta && (
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
              {raceMeta.name}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {raceMeta.track} · {raceMeta.series} {raceMeta.season}
            </p>
          </div>
        )}
        {errorContent}
      </div>
    );
  }

  // ── Format date ────────────────────────────────────────────────
  const dateStr = new Date(raceMeta.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // ── Render ──────────────────────────────────────────────────────
  return withSidebar(
    <div className="max-w-[1600px] mx-auto px-2 sm:px-4 py-1 sm:py-1.5">
      {/* Header — single row: breadcrumb / title / track+date */}
      <div className="flex items-baseline flex-wrap gap-x-3 gap-y-0.5 py-2 mb-1">
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/races"
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            Events
          </Link>
          <span className="text-gray-300 dark:text-gray-600 text-xs">/</span>
          <span className="text-xs text-brand-600 dark:text-brand-400 font-medium">
            {raceMeta.series} {raceMeta.season}
          </span>
          <span className="text-gray-300 dark:text-gray-600 text-xs">/</span>
        </div>
        <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-50 tracking-tight leading-tight">
          {raceMeta.name}
        </h1>
        <span className="text-xs text-gray-500 dark:text-gray-500">
          {raceMeta.track} · {dateStr}
        </span>
      </div>

      {/* Tab bar + dropdowns on one row */}
      {(() => {
        const isTeam = hasTeamAccess(user);
        const showDropdowns = activeTab !== "strategy";

        const tabs = [
          { id: "position" as const, label: "Position Trace", locked: false },
          { id: "laptimes" as const, label: "Lap Times", locked: !isTeam },
          { id: "strategy" as const, label: "Strategy", locked: !isTeam },
        ];

        return (
          <>
            <div
              className="flex items-center gap-1 mb-0.5 border-b"
              style={{ borderColor: CHART_STYLE.border, padding: "2px 0" }}
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      if (tab.locked) {
                        setLockedMsg(tab.id);
                        return;
                      }
                      setLockedMsg(null);
                      setActiveTab(tab.id);
                    }}
                    className="relative px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-2 shrink-0"
                    style={{
                      color: isActive ? "#fff" : CHART_STYLE.muted,
                      borderBottom: isActive ? "2px solid #5c7cfa" : "2px solid transparent",
                      marginBottom: "-1px",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.color = CHART_STYLE.text;
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.color = CHART_STYLE.muted;
                    }}
                  >
                    {tab.label}
                    {tab.locked && (
                      <>
                        <svg className="h-3.5 w-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{ background: CHART_STYLE.border, color: CHART_STYLE.muted }}
                        >
                          Team
                        </span>
                      </>
                    )}
                  </button>
                );
              })}

              {/* Dropdowns — shown for Position Trace and Lap Times, hidden for Strategy */}
              {showDropdowns && (
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: "#cbd5e1" }}>
                      Class
                    </label>
                    <select
                      value={classView}
                      onChange={(e) => handleClassChange(e.target.value)}
                      className="px-2 py-1 rounded text-xs font-mono text-white border cursor-pointer appearance-none"
                      style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, minWidth: 130 }}
                    >
                      <option value="">All Classes ({data.totalCars})</option>
                      {Object.entries(data.classGroups)
                        .sort()
                        .map(([cls, cars]) => (
                          <option key={cls} value={cls}>
                            {cls} ({cars.length})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: "#cbd5e1" }}>
                      Focus
                    </label>
                    <select
                      value={focusNum}
                      onChange={(e) => handleFocusChange(Number(e.target.value))}
                      className="px-2 py-1 rounded text-xs font-mono text-white border cursor-pointer appearance-none"
                      style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, minWidth: 180 }}
                    >
                      {visibleCars.map((n) => {
                        const c = data.cars[String(n)];
                        const posLabel = classView ? `P${c.finishPosClass} in class` : `P${c.finishPos}`;
                        const tag = c.make || c.cls;
                        return (
                          <option key={n} value={n}>
                            #{n} {c.team} ({tag}) — {posLabel}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              )}

              {/* Save button pushed right */}
              <div className="ml-auto flex items-center">
                {isAuthenticated && (
                  <button
                    onClick={handleFavorite}
                    className="flex items-center gap-1.5 px-2.5 py-1 border border-gray-300 dark:border-gray-700 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <svg
                      className={`h-4 w-4 ${
                        isFavorited ? "text-yellow-500 fill-yellow-500" : "text-gray-400"
                      }`}
                      fill={isFavorited ? "currentColor" : "none"}
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                      />
                    </svg>
                    {isFavorited ? "Saved" : "Save"}
                  </button>
                )}
              </div>
            </div>

            {lockedMsg && (
              <div
                className="text-sm mb-3 px-3 py-2 rounded-lg inline-flex items-center gap-2"
                style={{ background: CHART_STYLE.card, border: `1px solid ${CHART_STYLE.border}`, color: CHART_STYLE.muted }}
              >
                Upgrade to Team to unlock.{" "}
                <Link to="/pricing" className="text-brand-400 hover:text-brand-300 underline">
                  View pricing
                </Link>
              </div>
            )}
          </>
        );
      })()}

      {/* Chart — kept mounted to preserve internal state (focusNum, compSet, classView) */}
      <div className={activeTab !== "position" ? "hidden" : undefined}>
        <LapChart
          data={data} annotations={annotations} watermarkEmail={user?.email}
          focusNum={focusNum} setFocusNum={setFocusNum}
          compSet={compSet} setCompSet={setCompSet}
          classView={classView} setClassView={setClassView}
          activeLap={activeLap} setActiveLap={setActiveLap}
        />
      </div>

      {activeTab === "laptimes" && (
        <LapTimeChart
          data={data} annotations={annotations} watermarkEmail={user?.email}
          focusNum={focusNum} setFocusNum={setFocusNum}
          compSet={compSet} setCompSet={setCompSet}
          classView={classView} setClassView={setClassView}
          activeLap={activeLap} setActiveLap={setActiveLap}
        />
      )}

      {activeTab === "strategy" && (
        <StrategyTab
          data={data} annotations={annotations}
          classView={classView} setClassView={setClassView}
          focusNum={focusNum} setFocusNum={setFocusNum}
          onSwitchToTrace={() => setActiveTab("position")}
        />
      )}
    </div>
  );
}

// ─── Standalone chart page (no sidebar) for /races route ─────────────────────

export function RaceChartPage() {
  return <RaceDetailPage />;
}
