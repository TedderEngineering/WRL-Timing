import { useState, useEffect, useMemo } from "react";
import { useIsCompact } from "../lib/breakpoint";
import { PhoneViewTabs } from "../components/PhoneViewTabs";
import { Sheet } from "../components/Sheet";
import { CollapsingBars, useHideOnScroll } from "../lib/hideOnScroll";
import { ChipRow } from "../features/chart/phone-cards";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { CHART_STYLE, COMP_PALETTE } from "../features/chart/constants";
import { StatsTable } from "../features/qualifying/StatsTable";
import { SectorTrace } from "../features/qualifying/SectorTrace";
import type { QualifyingChartData } from "@shared/types";

interface SessionMeta {
  id: string;
  name: string;
  sessionName: string;
  date: string;
  track: string;
  series: string;
  season: number;
  eventId?: string;
  eventName?: string;
}

export function QualifyingDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [data, setData] = useState<QualifyingChartData | null>(null);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Shared chart state ──────────────────────────────────────────
  const [classView, setClassView] = useState("");
  const [compSet, setCompSet] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"trace" | "stats">("stats");
  // Phones (mobile redesign, step 7): the race page's shell, class chips, and the cars to compare
  // in a sheet instead of a wall of chips.
  const compact = useIsCompact();
  const navigate = useNavigate();
  const [carsOpen, setCarsOpen] = useState(false);
  const { hidden: chromeHidden, onScrollCapture: onChromeScroll } = useHideOnScroll();

  // ── Fetch data ──────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);

    api
      .get<{ session: SessionMeta; data: QualifyingChartData }>(
        `/qualifying/${id}/chart-data`
      )
      .then((res) => {
        setMeta(res.session);
        setData(res.data);

        // Default: top 5 cars by bestLap (cars are already sorted by bestLap)
        const top5 = new Set(res.data.cars.slice(0, 5).map((c) => c.num));
        setCompSet(top5);
        setClassView("");
      })
      .catch(() => setError("Failed to load qualifying data"))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Visible cars based on class filter ──────────────────────────
  const visibleCars = useMemo(() => {
    if (!data) return [];
    if (!classView) return data.cars;
    return data.cars.filter((c) => c.cls === classView);
  }, [data, classView]);

  // ── When class filter changes, reset compSet to top 5 in class ──
  useEffect(() => {
    if (!data) return;
    const cars = classView
      ? data.cars.filter((c) => c.cls === classView)
      : data.cars;
    setCompSet(new Set(cars.slice(0, 5).map((c) => c.num)));
  }, [classView, data]);

  // ── Toggle a single car in compSet ──────────────────────────────
  const toggleCar = (num: string) => {
    setCompSet((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  };

  // ── Loading / Error states ──────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="h-10 w-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 dark:text-gray-400">Loading qualifying data...</p>
      </div>
    );
  }

  if (error || !data || !meta) {
    return (
      <div className="container-page py-20 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-4">
          Error Loading Session
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {error || "The qualifying data could not be loaded."}
        </p>
        <Link
          to="/qualifying"
          className="text-brand-600 dark:text-brand-400 hover:underline font-medium"
        >
          Back to qualifying sessions
        </Link>
      </div>
    );
  }

  const dateStr = new Date(meta.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC", // a race date is a calendar day (F5)
  });

  const tabs = [
    { id: "stats" as const, label: "Stats Table" },
    { id: "trace" as const, label: "Sector Trace" },
  ];

  if (compact) {
    const carChip = (car: (typeof visibleCars)[number], idx: number) => {
      const isOn = compSet.has(car.num);
      const col = isOn ? COMP_PALETTE[idx % COMP_PALETTE.length] : undefined;
      return (
        <button
          key={car.num}
          type="button"
          onClick={() => toggleCar(car.num)}
          aria-pressed={isOn}
          className="min-h-[44px] min-w-[56px] rounded-lg border px-2.5 font-mono text-[13px]"
          style={{ borderColor: col || CHART_STYLE.border, background: col ? `${col}33` : "transparent", color: isOn ? "#fff" : CHART_STYLE.muted }}
          title={`${car.team} · ${car.driver} (${car.cls})`}
        >
          #{car.num}
        </button>
      );
    };
    return (
      <div className="flex h-full flex-col overflow-hidden" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }} onScrollCapture={onChromeScroll}>
        <CollapsingBars hidden={chromeHidden}>
        <section data-phone-shell="race-header" className="flex min-h-[48px] shrink-0 items-center gap-1 pl-1 pr-3" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <button
            type="button"
            onClick={() => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate("/races"))}
            aria-label="Back"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="m-0 min-w-0 flex-1 truncate text-base font-semibold">{meta.name}</h1>
          <span className="shrink-0 text-[12px]" style={{ color: CHART_STYLE.muted }}>
            {data.cars.length} cars
          </span>
        </section>
        <PhoneViewTabs
          tabs={[
            { id: "stats", label: "Stats", locked: false },
            { id: "trace", label: "Sector trace", locked: false },
          ]}
          active={activeTab}
          onSelect={(t) => setActiveTab(t as "stats" | "trace")}
        />
        </CollapsingBars>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-2">
          <p className="m-0 mb-2 text-[13px]" style={{ color: CHART_STYLE.muted }}>
            {meta.track} · {dateStr}
          </p>
          {data.classes.length > 1 && (
            <ChipRow
              label="Class"
              items={[{ key: "", label: `All (${data.cars.length})` }, ...data.classes.map((c) => ({ key: c, label: `${c} (${data.cars.filter((x) => x.cls === c).length})` }))]}
              value={classView}
              onChange={setClassView}
            />
          )}
          <button
            type="button"
            onClick={() => setCarsOpen(true)}
            aria-haspopup="dialog"
            className="mt-2 flex min-h-[44px] w-full items-center justify-between rounded-full border px-4 text-[14px]"
            style={{ borderColor: "#F48C34", background: CHART_STYLE.card }}
          >
            <span>Cars compared</span>
            <span style={{ color: CHART_STYLE.muted }}>{compSet.size} ▾</span>
          </button>
          <div className="mt-3">
            {activeTab === "stats" && <StatsTable data={data} compSet={compSet} classView={classView} />}
            {activeTab === "trace" && <SectorTrace data={data} compSet={compSet} classView={classView} />}
          </div>
        </div>
        <Sheet open={carsOpen} onClose={() => setCarsOpen(false)} title="Cars compared">
          <button type="button" onClick={() => setCompSet(new Set())} className="mb-2 min-h-[44px] text-[14px]" style={{ color: "#F48C34" }}>
            Clear all
          </button>
          <div className="flex flex-wrap gap-1.5">{visibleCars.map(carChip)}</div>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="h-full px-2 sm:px-4 py-1 sm:py-1.5 overflow-y-auto custom-scroll" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-baseline flex-wrap gap-x-3 gap-y-0.5 py-2 mb-1">
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/races"
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            Events
          </Link>
          <span className="text-gray-300 dark:text-gray-600 text-xs">/</span>
          {meta.eventName ? (
            <>
              <Link
                to={`/chart?event=${meta.eventId}`}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                {meta.eventName}
              </Link>
              <span className="text-gray-300 dark:text-gray-600 text-xs">/</span>
            </>
          ) : (
            <>
              <span className="text-xs text-brand-400 font-medium">
                {meta.series} {meta.season}
              </span>
              <span className="text-gray-300 dark:text-gray-600 text-xs">/</span>
            </>
          )}
        </div>
        <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-tight">
          {meta.name}
        </h1>
        <span className="text-xs text-gray-500">
          {meta.track} · {dateStr}
        </span>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-1 mb-0.5 border-b"
        style={{ borderColor: CHART_STYLE.border, padding: "2px 0" }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1.5 text-sm font-medium transition-colors shrink-0"
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
            </button>
          );
        })}

        <span className="ml-auto text-xs" style={{ color: CHART_STYLE.muted }}>
          {data.cars.length} cars · {data.totalLaps} laps
        </span>
      </div>

      {/* ── Class filter pills ──────────────────────────────────── */}
      {data.classes.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 mt-2 px-1">
          <span
            className="text-[11px] uppercase tracking-wider font-semibold shrink-0 mr-1"
            style={{ color: "#cbd5e1" }}
          >
            Class
          </span>
          <button
            onClick={() => setClassView("")}
            className="px-2.5 py-0.5 rounded-xl text-[11px] border transition-all cursor-pointer"
            style={{
              background: !classView ? "#4472C4" : CHART_STYLE.card,
              borderColor: !classView ? "#4472C4" : CHART_STYLE.border,
              color: !classView ? "#fff" : CHART_STYLE.muted,
            }}
          >
            All ({data.cars.length})
          </button>
          {data.classes.map((cls) => {
            const count = data.cars.filter((c) => c.cls === cls).length;
            return (
              <button
                key={cls}
                onClick={() => setClassView(classView === cls ? "" : cls)}
                className="px-2.5 py-0.5 rounded-xl text-[11px] border transition-all cursor-pointer"
                style={{
                  background: classView === cls ? "#4472C4" : CHART_STYLE.card,
                  borderColor: classView === cls ? "#4472C4" : CHART_STYLE.border,
                  color: classView === cls ? "#fff" : CHART_STYLE.muted,
                }}
              >
                {cls} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* ── Car toggle chips ────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 mt-1 px-1">
        {/* Clear chip */}
        <button
          onClick={() => setCompSet(new Set())}
          className="px-2 py-0.5 rounded-lg text-[11px] font-mono border transition-all cursor-pointer"
          style={{
            borderColor: compSet.size === 0 ? "#4472C4" : CHART_STYLE.border,
            background: compSet.size === 0 ? "rgba(68,114,196,0.2)" : "transparent",
            color: compSet.size === 0 ? "#fff" : CHART_STYLE.dim,
          }}
        >
          Clear
        </button>
        {visibleCars.map((car, idx) => {
          const isOn = compSet.has(car.num);
          const col = isOn ? COMP_PALETTE[idx % COMP_PALETTE.length] : undefined;
          return (
            <button
              key={car.num}
              onClick={() => toggleCar(car.num)}
              className="px-2 py-0.5 rounded-lg text-[11px] font-mono border transition-all cursor-pointer"
              style={{
                borderColor: col || CHART_STYLE.border,
                background: col ? `${col}33` : "transparent",
                color: isOn ? "#fff" : CHART_STYLE.dim,
              }}
              title={`${car.team} · ${car.driver} (${car.cls})`}
            >
              #{car.num}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      <div className="mt-3">
        {activeTab === "stats" && (
          <StatsTable data={data} compSet={compSet} classView={classView} />
        )}
        {activeTab === "trace" && (
          <SectorTrace data={data} compSet={compSet} classView={classView} />
        )}
      </div>
    </div>
  );
}
