/**
 * Chart defaults (Settings → Preferences): how a race page opens for this user. Stored as JSON in
 * user_preferences.default_chart_settings; anything missing or unknown falls back to the default,
 * so an old or hand-edited value never breaks the race page.
 */
import { z } from "zod";
import { prisma } from "../models/prisma.js";

const fields = {
  openOn: z.enum(["my_car", "winner"]),
  classView: z.enum(["all", "focus_class"]),
  axis: z.enum(["laps", "hours", "both"]),
  tab: z.enum(["position", "pitanalysis", "laptimes", "strategy"]),
};

/** Same shape as ChartDefaults in shared/types.ts (the client's copy; the server builds from src only). */
export type ChartDefaults = { [K in keyof typeof fields]: z.infer<(typeof fields)[K]> };

export const CHART_DEFAULTS: ChartDefaults = { openOn: "my_car", classView: "all", axis: "laps", tab: "position" };

/** A change from the settings page: any of the fields, each one a known value. */
export const chartDefaultsPatch = z.object(fields).partial().strict();

/** The stored value with every field filled in; unknown or missing values become the default. */
export function normaliseChartDefaults(raw: unknown): ChartDefaults {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...CHART_DEFAULTS } as Record<string, unknown>;
  for (const [k, schema] of Object.entries(fields)) {
    const r = schema.safeParse(obj[k]);
    if (r.success) out[k] = r.data;
  }
  return out as unknown as ChartDefaults;
}

export async function getChartDefaults(userId: string): Promise<ChartDefaults> {
  const p = await prisma.userPreferences.findUnique({ where: { userId }, select: { defaultChartSettings: true } });
  return normaliseChartDefaults(p?.defaultChartSettings);
}

export async function setChartDefaults(userId: string, patch: z.infer<typeof chartDefaultsPatch>): Promise<ChartDefaults> {
  const next = normaliseChartDefaults({ ...(await getChartDefaults(userId)), ...patch });
  await prisma.userPreferences.upsert({
    where: { userId },
    create: { userId, defaultChartSettings: next },
    update: { defaultChartSettings: next },
  });
  return next;
}
