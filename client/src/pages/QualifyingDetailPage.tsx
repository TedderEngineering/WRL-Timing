import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { CHART_STYLE } from "../features/chart/constants";
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

        // Default: all cars selected
        const allNums = new Set(res.data.cars.map((c) => c.num));
        setCompSet(allNums);
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

  // ── When class filter changes, reset compSet to all in class ────
  useEffect(() => {
    if (!data) return;
    const cars = classView
      ? data.cars.filter((c) => c.cls === classView)
      : data.cars;
    setCompSet(new Set(cars.map((c) => c.num)));
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
  });

  const tabs = [
    { id: "stats" as const, label: "Stats Table" },
    { id: "trace" as const, label: "Sector Trace" },
  ];

  return (
    <div className="px-2 sm:px-4 py-1 sm:py-1.5 overflow-y-auto" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text, minHeight: "calc(100vh - 4rem)" }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-baseline flex-wrap gap-x-3 gap-y-0.5 py-2 mb-1">
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/qualifying"
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            Qualifying
          </Link>
          <span className="text-gray-600 text-xs">/</span>
          <span className="text-xs text-brand-400 font-medium">
            {meta.series} {meta.season}
          </span>
          <span className="text-gray-600 text-xs">/</span>
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
        {visibleCars.map((car) => {
          const isOn = compSet.has(car.num);
          return (
            <button
              key={car.num}
              onClick={() => toggleCar(car.num)}
              className="px-2 py-0.5 rounded-lg text-[11px] font-mono border transition-all cursor-pointer"
              style={{
                borderColor: isOn ? CHART_STYLE.text : CHART_STYLE.border,
                background: isOn ? "rgba(255,255,255,0.08)" : "transparent",
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
