import { useEffect, useState } from "react";
import type { ChartDefaults } from "@shared/types";
import { api } from "../../lib/api";

/**
 * Chart defaults (Settings → Preferences): how a race page opens for a signed-in user. The
 * server keeps them (GET/PUT /api/me/chart-defaults); this browser keeps a copy so the race page
 * can open the right way before the request returns. Signed out, the built-in defaults apply.
 */
export const CHART_DEFAULTS: ChartDefaults = { openOn: "my_car", classView: "all", axis: "laps", tab: "position" };

const KEY = "rt.chartDefaults.v1";
const ALLOWED: { [K in keyof ChartDefaults]: ChartDefaults[K][] } = {
  openOn: ["my_car", "winner"],
  classView: ["all", "focus_class"],
  axis: ["laps", "hours", "both"],
  tab: ["position", "pitanalysis", "laptimes", "strategy"],
};

/** Any value, read field by field: unknown fields and values become the default. */
export function normaliseChartDefaults(raw: unknown): ChartDefaults {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...CHART_DEFAULTS };
  for (const k of Object.keys(ALLOWED) as (keyof ChartDefaults)[]) {
    if ((ALLOWED[k] as unknown[]).includes(obj[k])) out[k] = obj[k];
  }
  return out as unknown as ChartDefaults;
}

/** This browser's copy (the built-in defaults when there is none). */
export function readChartDefaults(): ChartDefaults {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normaliseChartDefaults(JSON.parse(raw)) : CHART_DEFAULTS;
  } catch {
    return CHART_DEFAULTS;
  }
}

function keep(d: ChartDefaults | null) {
  try {
    if (d) localStorage.setItem(KEY, JSON.stringify(d));
    else localStorage.removeItem(KEY);
  } catch {
    /* private window: the server copy still applies once loaded */
  }
}

export async function loadChartDefaults(): Promise<ChartDefaults> {
  const d = normaliseChartDefaults(await api.get<unknown>("/me/chart-defaults"));
  keep(d);
  return d;
}

export async function saveChartDefaults(patch: Partial<ChartDefaults>): Promise<ChartDefaults> {
  const d = normaliseChartDefaults(await api.put<unknown>("/me/chart-defaults", patch));
  keep(d);
  return d;
}

/**
 * The chart defaults for whoever is here: this browser's copy straight away, then the server's
 * once signed in. Signed out (and after logging out) the built-in defaults, and the copy is dropped.
 */
export function useChartDefaults(signedIn: boolean, authLoading: boolean): ChartDefaults {
  const [d, setD] = useState<ChartDefaults>(readChartDefaults);
  useEffect(() => {
    if (authLoading) return;
    if (!signedIn) {
      keep(null);
      setD(CHART_DEFAULTS);
      return;
    }
    let alive = true;
    loadChartDefaults()
      .then((x) => alive && setD(x))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [signedIn, authLoading]);
  return d;
}
