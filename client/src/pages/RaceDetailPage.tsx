import { carKey } from "../features/chart/car-number";
import { useChartDefaults } from "../features/chart/chart-defaults";
import { useParams, useSearchParams, useNavigate, Navigate, Link } from "react-router-dom";
import { FollowCarButton } from "../features/my-cars/FollowCarButton";
import { ShareRaceButton } from "../features/share/ShareRaceButton";
import { RaceMetaContext } from "../features/chart/raceCard";
import { useAuth } from "../features/auth/AuthContext";
import { useChartData } from "../hooks/useChartData";
import { LapChart } from "../features/chart/LapChart";
import { LapTimeChart } from "../features/chart/LapTimeChart";
import { useTraceView } from "../features/chart/trace-view";
import { StrategyTab } from "../features/chart/StrategyTab";
import { DriverReportTab } from "../features/chart/DriverReportTab";
import { DownloadPdfButton } from "../features/chart/pdf/DownloadPdfButton";
import { PitAnalysisTab } from "../features/chart/PitAnalysisTab";
import { StoryTab } from "../features/chart/StoryTab";

import { api, fetchEvents, fetchEvent } from "../lib/api";
import { hasTeamAccess } from "../lib/utils";
import EventSidebar from "../components/EventSidebar";
import { Sheet } from "../components/Sheet";
import { PhoneViewTabs } from "../components/PhoneViewTabs";
import { ChartGestureSheet } from "../features/chart/ChartGestureHelp";
import { PhoneAnalysisTab } from "../features/chart/PhoneAnalysisTab";
import { RaceCardsView } from "../features/share/RaceCardsView";
import { RaceCardsContext } from "../features/share/raceCardsContext";
import { ChromeHiddenContext, CollapsingBars, useHideOnScroll } from "../lib/hideOnScroll";
import { useIsCompact, useIsLandscapePhone } from "../lib/breakpoint";
import { useState, useEffect, useRef, useCallback } from "react";
// EmptyChartState no longer needed — auto-loads first event on mount

/** A full-width, 48 px row in the phone race menu. */
const phoneRow = "flex min-h-[48px] w-full items-center gap-2 rounded-lg border px-4 text-[15px]";

/** Redirect /races/:id → /chart?race=:id for bookmarked URLs */
export function RaceDetailRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/chart?race=${id}`} replace />;
}

export function RaceDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlRaceId = searchParams.get("race") || undefined;
  const urlEventId = searchParams.get("event") || undefined;

  // Track selected race in state — setSearchParams alone may not trigger
  // a re-render in React Router v7 / React 19, so state guarantees it.
  const [selectedRaceId, setSelectedRaceId] = useState(urlRaceId);
  useEffect(() => { setSelectedRaceId(urlRaceId); }, [urlRaceId]);
  const id = selectedRaceId;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const autoLoadAttempted = useRef(false);
  const { isAuthenticated, user, isLoading: authLoading } = useAuth();
  // How races open for this user (Settings → Preferences → Chart defaults).
  const chartDefaults = useChartDefaults(isAuthenticated, authLoading);
  const defaultsRef = useRef(chartDefaults);
  defaultsRef.current = chartDefaults;
  const { data, annotations, raceMeta, pitFacts, isLoading, error } = useChartData(id);
  // Derive event ID from URL param or from the loaded race metadata
  const effectiveEventId = urlEventId || raceMeta?.eventId;
  const [isFavorited, setIsFavorited] = useState(false);
  const [resultsStatus, setResultsStatus] = useState<"official" | "provisional" | null>(null);
  // A published analysis package (it always carries the race summary and car stories): the Story tab.
  // null while the race detail loads.
  const [hasStories, setHasStories] = useState<boolean | null>(null);
  // `?tab=` opens a tab directly (dashboard links: tab=pitanalysis); otherwise the user's default tab.
  // Gaps and Head-to-head are views of their own on a phone only (PhoneAnalysisTab).
  const [activeTab, setActiveTab] = useState<"position" | "story" | "laptimes" | "strategy" | "pitanalysis" | "drivers" | "gaps" | "h2h" | "cycle" | "cards">(() => {
    const t = searchParams.get("tab");
    if (t === "laptimes" || t === "strategy" || t === "pitanalysis" || t === "position" || t === "story" || t === "drivers" || t === "gaps" || t === "h2h" || t === "cycle" || t === "cards") return t;
    return chartDefaults.tab;
  });
  const [lockedMsg, setLockedMsg] = useState<string | null>(null);
  // Phones (mobile redesign, PR 2): one-line header with a race menu, and a row of views.
  const compact = useIsCompact();
  // A phone held sideways: back, views, car pill and menu share one top row, so the chart keeps the height.
  const landscape = useIsLandscapePhone() && compact;
  const [carSlot, setCarSlot] = useState<HTMLElement | null>(null);
  const { hidden: chromeHidden, onScrollCapture: onChromeScroll, show: showChrome } = useHideOnScroll();
  // A new view starts with the bars in view.
  useEffect(() => showChrome(), [activeTab, showChrome]);
  const navigate = useNavigate();
  const [raceMenuOpen, setRaceMenuOpen] = useState(false);
  const [gesturesOpen, setGesturesOpen] = useState(false);
  const [h2hRival, setH2hRival] = useState<number | undefined>(undefined);
  // Race cards: the card to open on (a driver's Share button in the lap details).
  const [cardStart, setCardStart] = useState<string | null>(null);
  // Wider than a phone, Gaps and Head-to-head open beside the chart instead.
  useEffect(() => {
    if (!compact && (activeTab === "gaps" || activeTab === "h2h" || activeTab === "cycle" || activeTab === "cards")) setActiveTab("position");
  }, [compact, activeTab]);
  // A view the person asked for (?tab= in the link, or a tap) is never replaced by a default.
  const tabChosen = useRef(!!searchParams.get("tab"));

  // ── Auto-load most recent event + first race when no URL params ──
  useEffect(() => {
    if (autoLoadAttempted.current || id || urlEventId) return;
    autoLoadAttempted.current = true;

    fetchEvents()
      .then((res) => {
        const events = res.events;
        if (events.length === 0) return;
        const firstEvent = events[0];
        return fetchEvent(firstEvent.id).then((detail) => {
          if (detail.races.length > 0) {
            setSelectedRaceId(detail.races[0].id);
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

  // ── Auto-select first race when navigating with ?event but no ?race ──
  const eventAutoSelectAttempted = useRef<string | null>(null);
  useEffect(() => {
    if (!urlEventId || id) return;
    if (eventAutoSelectAttempted.current === urlEventId) return;
    eventAutoSelectAttempted.current = urlEventId;

    fetchEvent(urlEventId)
      .then((detail) => {
        if (detail.races.length > 0) {
          setSelectedRaceId(detail.races[0].id);
          setSearchParams(
            { event: urlEventId, race: detail.races[0].id },
            { replace: true },
          );
        }
      })
      .catch(() => {});
  }, [urlEventId, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dispatch resize after sidebar transition so charts redraw ──
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 220); // 200ms CSS transition + 20ms buffer
    return () => clearTimeout(timer);
  }, [sidebarCollapsed]);

  // ── Shared chart state (lifted from LapChart for cross-tab access) ──
  const [focusNum, setFocusNum] = useState(0);
  const [compSet, setCompSet] = useState<Set<number>>(new Set());
  const [classView, setClassView] = useState("");
  const [activeLap, setActiveLap] = useState<number | null>(null);

  // Reset chart init tracking when race changes so the init effect
  // re-runs when the NEW race's data arrives (prevents stale init).
  const chartInitId = useRef<string | null>(null);
  useEffect(() => { chartInitId.current = null; }, [id]);

  // Initialize chart state when race data loads (or when race changes)
  useEffect(() => {
    if (!data || !id || chartInitId.current === id) return;
    chartInitId.current = id;

    // Default: focus on race winner, compare against all cars
    let winner = 0;
    for (const [numStr, car] of Object.entries(data.cars)) {
      if (car.finishPos === 1) { winner = Number(numStr); break; }
    }
    winner = winner || Number(Object.keys(data.cars)[0]) || 0;

    // A shared link can name the car (?car=67): open on it instead of the winner.
    // ?car= takes the published number ("007") or the chart key (car-number.ts).
    const param = new URLSearchParams(window.location.search).get("car");
    const named = param ? carKey(data, param) : null;
    if (named !== null && named > 0 && data.cars[String(named)]) winner = named;

    setFocusNum(winner);
    // Chart defaults: just the focus car's class, or the whole field.
    setClassView(defaultsRef.current.classView === "focus_class" ? data.cars[String(winner)]?.cls ?? "" : "");
    setActiveLap(null);

    const allOthers = new Set<number>();
    Object.keys(data.cars).forEach((n) => {
      const num = Number(n);
      if (num !== winner) allOthers.add(num);
    });
    setCompSet(allOthers);
  }, [data, id]);

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

  // Class, makes and compare, the same on Position Trace and Lap Times.
  // A phone compares the focus car with its class rivals by default; a laptop with every car in view.
  const traceView = useTraceView({ data: data ?? null, focusNum, setFocusNum: handleFocusChange, setCompSet, classView, setClassView, defaultCompare: compact ? "rivals" : "all" });

  // Favorite and results status from the race detail endpoint
  useEffect(() => {
    if (!id) return;
    setResultsStatus(null);
    setHasStories(null);
    api
      .get<{ isFavorited: boolean; resultsStatus?: "official" | "provisional" | null; hasPackage?: boolean }>(`/races/${id}`)
      .then((res) => {
        setIsFavorited(!!res.isFavorited);
        setResultsStatus(res.resultsStatus ?? null);
        setHasStories(!!res.hasPackage);
      })
      .catch(() => setHasStories(false));
  }, [id, isAuthenticated]);

  // A race without published stories has no Story tab: fall back to Position Trace.
  useEffect(() => {
    if (hasStories === false && activeTab === "story") setActiveTab("position");
  }, [hasStories, activeTab]);

  // Phones open on the race's story when it has one (plan decision M2): it answers "how did my
  // car do, and why" in words. A view chosen in Settings → Chart defaults, a ?tab= link or a tap wins.
  useEffect(() => {
    if (!compact || tabChosen.current || hasStories !== true || chartDefaults.tab !== "position") return;
    tabChosen.current = true;
    setActiveTab("story");
  }, [compact, hasStories, chartDefaults.tab]);

  // Open on the user's own car rather than the winner, once per race (the user's later picks win),
  // unless their chart defaults say to always open on the winner.
  const followFocused = useRef<string | null>(null);
  const focusFollowed = useCallback(
    (nums: string[]) => {
      if (!data || !id || followFocused.current === id || nums.length === 0) return;
      followFocused.current = id;
      if (defaultsRef.current.openOn === "winner") return;
      const n = Number(nums[0]);
      if (Number.isFinite(n) && data.cars[String(n)]) {
        setFocusNum(n);
        if (defaultsRef.current.classView === "focus_class") setClassView(data.cars[String(n)].cls ?? "");
      }
    },
    [data, id]
  );

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
  // Sidebar race items are <Link> elements that handle URL navigation
  // directly. This callback updates local state for immediate re-render.
  const handleSelectRace = useCallback(
    (raceId: string) => {
      setSelectedRaceId(raceId);
    },
    [],
  );

  // The page is built once for every width: the sidebar is its own rail from md up
  // (`hidden md:flex` inside EventSidebar) and a drawer below md. Building the content
  // twice, once per width, drew two charts on every visit (mobile redesign, PR 1).
  const withSidebar = (content: React.ReactNode) => (
    <div className="flex h-full overflow-hidden">
      <EventSidebar
        isCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((p) => !p)}
        onSelectRace={handleSelectRace}
        selectedRaceId={id || null}
        selectedEventId={effectiveEventId}
        mobileOpen={mobileDrawerOpen}
        onMobileClose={() => setMobileDrawerOpen(false)}
      />
      <main className="h-full min-w-0 flex-1 overflow-hidden">{content}</main>
    </div>
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
              Browse available events
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
              Browse free events
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
            Back to events
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
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC", // a race date is a calendar day (F5)
  });

  const isTeam = hasTeamAccess(user);
  const tabs = [
    { id: "position" as const, label: "Position Trace", locked: false },
    ...(hasStories ? [{ id: "story" as const, label: "Story", locked: false }] : []),
    // Phones: the car's and its drivers' share cards, early in the row (mobile redesign).
    ...(compact ? [{ id: "cards" as const, label: "Race cards", locked: false }] : []),
    { id: "pitanalysis" as const, label: "Pit Stops", locked: !isTeam },
    ...(compact ? [{ id: "cycle" as const, label: "Pit cycle", locked: !isTeam }] : []),
    { id: "laptimes" as const, label: "Lap Times", locked: !isTeam },
    ...(compact
      ? [
          { id: "gaps" as const, label: "Gaps", locked: !isTeam },
          { id: "h2h" as const, label: "Head-to-head", locked: !isTeam },
        ]
      : []),
    { id: "strategy" as const, label: "Strategy", locked: !isTeam },
    { id: "drivers" as const, label: "Driver Report", locked: !isTeam },
  ];
  const RT = { line: "#1e1e38", border: "#3a3a5c", card: "#12122a", text: "#e0e0e8", soft: "#cbd5e1", muted: "#9a9ab4", accent: "#F48C34" };

  type TabId = (typeof tabs)[number]["id"];
  /** Opens a view, or says it is part of the Team plan. */
  const selectTab = (tabId: TabId) => {
    if (tabs.find((t) => t.id === tabId)?.locked) {
      setLockedMsg(tabId);
      return;
    }
    tabChosen.current = true;
    setLockedMsg(null);
    setActiveTab(tabId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tabId === "position") next.delete("tab");
      else next.set("tab", tabId);
      return next;
    }, { replace: true });
  };

  // Phone views: every view in one row that scrolls sideways (Trace · Story · Pits · Pit cycle · Laps ·
  // Gaps · Head-to-head · Strategy · Drivers), with short names; the row nudges once on a first visit.
  const PHONE_LABEL: Partial<Record<TabId, string>> = { position: "Trace", pitanalysis: "Pits", laptimes: "Times", drivers: "Drivers" };
  const phoneTabs = tabs.map((t) => ({ ...t, label: PHONE_LABEL[t.id] ?? t.label }));

  /** A Share button in the lap details: the Race cards view, on that driver's card. */
  const openRaceCards = (driver?: string) => {
    setCardStart(driver ?? null);
    selectTab("cards");
  };

  /** Back to where the person came from in RaceTrace, or to the event list on a fresh visit. */
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/races");
  };

  // Share, PDF, Follow and Star: a row in the laptop header, the race menu's rows on a phone.
  const actionClass = compact ? phoneRow : "flex min-h-[36px] items-center gap-1.5 rounded-md border px-3 text-sm";
  const actionStyle = { borderColor: RT.border, background: RT.card, color: RT.text };
  const raceActions = (
    <>
      <ShareRaceButton raceId={id!} raceName={raceMeta.name} className={actionClass} style={actionStyle} />
      {/* The open tab as a PDF; a Team tab only for those who can open it. */}
      {/* Gaps and Head-to-head (phone views) have no PDF of their own. */}
      {!tabs.find((t) => t.id === activeTab)?.locked && (activeTab !== "story" || hasStories) && activeTab !== "gaps" && activeTab !== "h2h" && activeTab !== "cycle" && activeTab !== "cards" && (
        <DownloadPdfButton
          tab={activeTab}
          input={{
            raceId: id!,
            data,
            annotations,
            focusNum,
            meta: { raceName: raceMeta.name, track: raceMeta.track, date: String(raceMeta.date), preparedFor: user?.email ?? null },
          }}
          choices={
            activeTab === "story" && focusNum > 0 && data.cars[String(focusNum)]
              ? [
                  { scope: "race", label: "Whole race" },
                  { scope: "focus", label: `#${data.cars[String(focusNum)].label ?? focusNum} only` },
                ]
              : undefined
          }
          className={actionClass}
          style={actionStyle}
        />
      )}
      {focusNum > 0 && data.cars[String(focusNum)] && (
        <FollowCarButton
          raceId={id!}
          carNumber={data.cars[String(focusNum)].label ?? String(data.cars[String(focusNum)].num ?? focusNum)}
          onFollowed={focusFollowed}
          className={compact ? `${phoneRow} disabled:opacity-60` : undefined}
          style={actionStyle}
        />
      )}
      {isAuthenticated && (
        <button type="button" onClick={handleFavorite} aria-pressed={isFavorited} className={actionClass} style={actionStyle}>
          <span style={{ color: isFavorited ? "#fab219" : RT.muted }}>{isFavorited ? "★" : "☆"}</span>
          {isFavorited ? "Starred" : "Star race"}
        </button>
      )}
    </>
  );

  // ── Render ──────────────────────────────────────────────────────
  return withSidebar(
    // The race's name, track and date for share images drawn from inside the chart panels.
    <RaceMetaContext.Provider value={{ id: id!, name: raceMeta.name, track: raceMeta.track, date: String(raceMeta.date) }}>
    <RaceCardsContext.Provider value={compact ? openRaceCards : null}>
    {/* Fills the window: on a phone the page scrolls as one; from md up nothing scrolls but the
        parts that hold lists (side panel, Pit Stops, Strategy), each without a visible scrollbar. */}
    <ChromeHiddenContext.Provider value={compact && chromeHidden}>
    <div
      className={compact ? "flex h-full flex-col overflow-hidden" : "flex h-full flex-col overflow-y-auto custom-scroll md:overflow-hidden"}
      style={{ background: "#0b0b18", color: RT.text }}
      onScrollCapture={compact ? onChromeScroll : undefined}
    >
      {compact ? (
        <>
          {/* Phone header (mobile redesign, PR 2): one line. Back, the race, its results status,
              and the race menu (Share, PDF, Follow, Star, this weekend's other races). */}
          {/* Phones: the header and the views row slide away while you scroll down a view, and come
              back as you scroll up (lib/hideOnScroll.tsx). */}
          <CollapsingBars hidden={chromeHidden}>
          <section data-phone-shell="race-header" className="flex min-h-[48px] shrink-0 items-center gap-1 pl-1 pr-1" style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <button type="button" onClick={goBack} aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: RT.text }}>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {landscape ? (
              <>
                <h1 className="sr-only">{raceMeta.name}</h1>
                <div className="min-w-0 flex-1">
                  <PhoneViewTabs tabs={phoneTabs} active={activeTab} onSelect={selectTab} />
                </div>
                {/* The chart views' car pill is portalled here (TraceControls phoneSlot) */}
                <div ref={setCarSlot} className="flex min-w-0 max-w-[38%] shrink-0 items-center" />
              </>
            ) : (
              <h1 className="m-0 min-w-0 flex-1 truncate text-base font-semibold">{raceMeta.name}</h1>
            )}
            {resultsStatus && (
              <span
                className="flex shrink-0 items-center gap-1 text-xs"
                style={{ color: resultsStatus === "provisional" ? "#fab219" : "#4ade80" }}
                title={resultsStatus === "provisional" ? "Provisional results" : "Official results"}
              >
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "currentColor" }} />
                <span className={landscape ? "sr-only" : undefined}>{resultsStatus === "provisional" ? "Provisional" : "Official"}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => setRaceMenuOpen(true)}
              aria-label="Race menu: share, PDF, follow, star"
              aria-haspopup="dialog"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              style={{ color: RT.text }}
            >
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
          </section>
          </CollapsingBars>

          {/* Kept mounted while closed: the Follow button opens the race on the user's own car. */}
          <Sheet open={raceMenuOpen} onClose={() => setRaceMenuOpen(false)} title={raceMeta.name} keepMounted>
            <p className="m-0 text-sm" style={{ color: RT.soft }}>
              {raceMeta.track} · {dateStr}
            </p>
            <p className="m-0 mt-0.5 text-sm" style={{ color: RT.muted }}>
              {raceMeta.series.replace(/_/g, " ")} {raceMeta.season}
              {resultsStatus ? ` · ${resultsStatus === "provisional" ? "Provisional results" : "Official results"}` : ""}
            </p>
            <div className="mt-4 flex flex-col gap-2">{raceActions}</div>
            <button
              type="button"
              onClick={() => {
                setRaceMenuOpen(false);
                setMobileDrawerOpen(true);
              }}
              className={phoneRow}
              style={{ borderColor: RT.border, background: RT.card, color: RT.text }}
            >
              Other races this weekend
            </button>
            <Link to="/races" className={phoneRow} style={{ borderColor: RT.border, background: RT.card, color: RT.text }}>
              All events
            </Link>
            <button
              type="button"
              onClick={() => {
                setRaceMenuOpen(false);
                setGesturesOpen(true);
              }}
              className={phoneRow}
              style={{ borderColor: RT.border, background: RT.card, color: RT.text }}
            >
              Chart gestures
            </button>
          </Sheet>
          <ChartGestureSheet open={gesturesOpen} onClose={() => setGesturesOpen(false)} />

          {!landscape && (
            <CollapsingBars hidden={chromeHidden}>
              <PhoneViewTabs tabs={phoneTabs} active={activeTab} onSelect={selectTab} />
            </CollapsingBars>
          )}
        </>
      ) : (
        <>
        {/* Header (mockup F1): breadcrumb, race, status, star */}
        <section className="flex shrink-0 flex-col gap-1.5 px-3 pt-2.5 sm:px-6 sm:pt-3">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: RT.muted }}>
            {/* Phone: the event list opens as a drawer */}
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="-ml-1 flex min-h-[32px] items-center gap-1 rounded px-1 md:hidden"
              style={{ color: RT.soft }}
              aria-label="Open the event list"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Races
            </button>
            <span aria-hidden className="md:hidden">·</span>
            <Link to="/races" className="hover:underline" style={{ color: RT.muted }}>
              Events
            </Link>
            <span aria-hidden>/</span>
            <span className="rounded border px-1.5 text-[11px] font-semibold tracking-[0.04em]" style={{ borderColor: RT.border, color: RT.text }}>
              {raceMeta.series.replace(/_/g, " ")}
            </span>
            <span>{raceMeta.season}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="m-0 text-xl font-semibold sm:text-2xl">{raceMeta.name}</h1>
            <span className="text-sm" style={{ color: RT.soft }}>
              {raceMeta.track} · {dateStr}
            </span>
            {resultsStatus && (
              <span
                className="rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                style={resultsStatus === "provisional" ? { borderColor: "#fab219", color: "#fab219" } : { borderColor: "#4ade80", color: "#4ade80" }}
                title={resultsStatus === "provisional" ? "Finishing positions may still change." : "Official results."}
              >
                {resultsStatus === "provisional" ? "Provisional" : "Official"}
              </span>
            )}
            <span className="flex-1" />
            {raceActions}
          </div>
        </section>

        {/* Race views */}
        <nav aria-label="Race views" className="no-scrollbar mt-0.5 flex shrink-0 gap-1 overflow-x-auto border-b px-2 sm:px-6" style={{ borderColor: RT.line }}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => selectTab(tab.id)}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm"
                style={{
                  color: isActive ? RT.text : RT.muted,
                  fontWeight: isActive ? 600 : 400,
                  borderBottom: `2px solid ${isActive ? RT.accent : "transparent"}`,
                  marginBottom: -1,
                }}
              >
                {tab.label}
                {tab.locked && (
                  <span className="rounded px-1 text-[10px] font-semibold uppercase tracking-wider" style={{ background: RT.line, color: RT.muted }}>
                    Team
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        </>
      )}

      {pitFacts && user?.role === "ADMIN" && searchParams.get("facts") && (
        <div className="mx-3 mt-3 inline-flex shrink-0 items-center gap-2 self-start rounded-lg border px-3 py-2 text-sm sm:mx-6" style={{ background: RT.card, borderColor: RT.line, color: RT.muted }}>
          Admin preview: pit facts from analysis package v{pitFacts.version} ({pitFacts.status}), {pitFacts.matched} cars matched. Visitors see the
          published package, or the import's own pit analysis when there is none.
        </div>
      )}
      {lockedMsg && (
        <div className="mx-3 mt-3 inline-flex shrink-0 items-center gap-2 self-start rounded-lg border px-3 py-2 text-sm sm:mx-6" style={{ background: RT.card, borderColor: RT.line, color: RT.muted }}>
          This view is part of the Team plan.{" "}
          <Link to="/pricing" className="underline" style={{ color: RT.accent }}>
            See plans
          </Link>
        </div>
      )}

      {/* Chart — kept mounted to preserve internal state (focusNum, compSet, classView) */}
      <div className={activeTab !== "position" ? "hidden" : compact ? "flex min-h-0 flex-1 flex-col" : "flex flex-col md:min-h-0 md:flex-1"}>
        <LapChart
          data={data} annotations={annotations} watermarkEmail={user?.email}
          focusNum={focusNum} setFocusNum={setFocusNum}
          compSet={compSet} setCompSet={setCompSet}
          classView={classView} setClassView={setClassView}
          activeLap={activeLap} setActiveLap={setActiveLap}
          view={traceView}
          defaultAxis={chartDefaults.axis}
          phoneSlot={landscape && activeTab === "position" ? carSlot : null}
          onOpenView={(v, rival) => {
            setH2hRival(rival);
            selectTab(v);
          }}
        />
      </div>

      {activeTab === "story" && hasStories && (
        <div className={compact ? "custom-scroll min-h-0 flex-1 overflow-y-auto" : "custom-scroll md:min-h-0 md:flex-1 md:overflow-y-auto"}>
          <StoryTab
            raceId={id!}
            data={data}
            focusNum={focusNum}
            setFocusNum={handleFocusChange}
            onOpenTab={(t) => {
              if (t === "pitanalysis" && !isTeam) {
                setLockedMsg(t);
                return;
              }
              setActiveTab(t);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (t === "position") next.delete("tab");
                else next.set("tab", t);
                return next;
              }, { replace: true });
            }}
          />
        </div>
      )}

      {activeTab === "laptimes" && (
        <div className={compact ? "flex min-h-0 flex-1 flex-col" : "flex flex-col md:min-h-0 md:flex-1"}>
          <LapTimeChart
            data={data} annotations={annotations} watermarkEmail={user?.email}
            focusNum={focusNum} setFocusNum={handleFocusChange}
            compSet={compSet}
            classView={classView}
            activeLap={activeLap} setActiveLap={setActiveLap}
            view={traceView}
            phoneSlot={landscape ? carSlot : null}
          />
        </div>
      )}

      {compact && activeTab === "cards" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <RaceCardsView
            raceId={id!}
            raceName={raceMeta.name}
            data={data}
            annotations={annotations}
            focusNum={focusNum}
            setFocusNum={handleFocusChange}
            classView={classView}
            compSet={compSet}
            view={traceView}
            phoneSlot={landscape ? carSlot : null}
            landscape={landscape}
            startAt={cardStart}
          />
        </div>
      )}

      {compact && (activeTab === "gaps" || activeTab === "h2h" || activeTab === "cycle") && (
        <div className="flex min-h-0 flex-1 flex-col">
          <PhoneAnalysisTab
            kind={activeTab}
            data={data} annotations={annotations}
            focusNum={focusNum} setFocusNum={handleFocusChange}
            compSet={compSet} classView={classView} view={traceView}
            activeLap={activeLap} setActiveLap={setActiveLap}
            h2hRival={activeTab === "h2h" ? h2hRival : undefined}
            phoneSlot={landscape ? carSlot : null}
          />
        </div>
      )}

      {activeTab === "pitanalysis" && (
        <div className={compact ? "custom-scroll min-h-0 flex-1 overflow-y-auto px-2 py-3" : "custom-scroll px-2 py-3 sm:px-6 md:min-h-0 md:flex-1 md:overflow-y-auto"}>
          <PitAnalysisTab raceId={id} chart={data} focusNum={focusNum} setFocusNum={setFocusNum} onSwitchToTrace={() => setActiveTab("position")} />
        </div>
      )}

      {activeTab === "strategy" && (
        <div className={compact ? "custom-scroll min-h-0 flex-1 overflow-y-auto" : "custom-scroll md:min-h-0 md:flex-1 md:overflow-y-auto"}>
          <StrategyTab
            data={data} annotations={annotations}
            classView={classView} setClassView={setClassView}
            focusNum={focusNum} setFocusNum={setFocusNum}
            onSwitchToTrace={() => setActiveTab("position")}
          />
        </div>
      )}

      {activeTab === "drivers" && (
        <div className={compact ? "custom-scroll min-h-0 flex-1 overflow-y-auto" : "custom-scroll md:min-h-0 md:flex-1 md:overflow-y-auto"}>
          <DriverReportTab data={data} annotations={annotations} focusNum={focusNum} setFocusNum={handleFocusChange} />
        </div>
      )}

    </div>
    </ChromeHiddenContext.Provider>
    </RaceCardsContext.Provider>
    </RaceMetaContext.Provider>
  );
}

// ─── Standalone chart page (no sidebar) for /races route ─────────────────────

export function RaceChartPage() {
  return <RaceDetailPage />;
}
