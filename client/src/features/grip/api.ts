import { api } from "@/lib/api";
import type { Units } from "./units";

export type Weather = "DRY" | "WET";
export interface Corners<T = number> {
  lf: T;
  rf: T;
  lr: T;
  rr: T;
}
export const CORNER_KEYS = ["lf", "rf", "lr", "rr"] as const;
export type CornerKey = (typeof CORNER_KEYS)[number];

export interface GripAccount {
  plan: "FREE" | "PRO";
  status: string;
  isPro: boolean;
  /** True when Finding Grip is free for every account (no plans, no limits). */
  freeForAll: boolean;
  units: Units;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  calculationsUsed: number;
  freeCalculationLimit: number;
  freeCalculationsLeft: number | null;
}

export interface GripMe {
  account: GripAccount;
  checkoutAvailable: boolean;
  calculatorAvailable: boolean;
}

export interface Track {
  id: string;
  name: string;
  shortName: string;
  country: string | null;
  logoUrl: string | null;
  isActive: boolean;
}

export interface ReferenceSession {
  id: string;
  name: string;
  track: Track;
  sessionDate: string;
  weather: Weather;
  trackTemp: number;
  ambientTemp: number;
  durationMin: number;
  cold: Corners;
  hot: Corners<number | null>;
  wheel: Corners;
  notes: string | null;
  useCount: number;
  ready: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInput {
  name: string;
  trackId: string;
  weather: Weather;
  trackTemp: number;
  ambientTemp: number;
  durationMin: number;
  cold: Corners;
  hot?: Corners<number | null>;
  wheel: Corners;
  notes?: string | null;
}

export interface Calculation {
  id: string;
  name: string;
  referenceSessionId: string | null;
  referenceName: string;
  track: Track;
  sessionDate: string;
  weather: Weather;
  trackTemp: number;
  ambientTemp: number;
  durationMin: number;
  wheel: Corners;
  target: Corners;
  result: Corners;
  referenceCold: Corners;
  convertedToRef: boolean;
  createdAt: string;
}

export interface CalculationInput {
  referenceSessionId: string;
  name: string;
  weather: Weather;
  trackTemp: number;
  ambientTemp: number;
  durationMin: number;
  wheel: Corners;
  target: Corners;
}

export interface DamperQuery {
  type: "rebound_only" | "two_way";
  direction: "left" | "right";
  over_under: "oversteer" | "understeer";
  segment: "braking" | "turn_in" | "mid_corner" | "corner_exit";
  speed: "low" | "mid" | "high";
}

export interface DamperResult {
  scenarioNumber: number;
  options: string[];
  scenarioCount: number;
}

export interface AdminOverview {
  counts: {
    accounts: number;
    pro: number;
    sessions: number;
    calculations: number;
    tracks: number;
  };
  setup: {
    access: "off" | "admin" | "testers" | "public";
    pricing: "free" | "paid";
    ownAddress: { url: string | null; problem: string | null };
    testerCount: number;
    calcModel: {
      ready: boolean;
      version: string | number | null;
      problem: string | null;
    };
    damperTable: { rows: number; expected: number; ready: boolean };
    stripePrice: { ready: boolean };
  };
}

export const gripApi = {
  status: () =>
    api.get<{ open: boolean; free: boolean; siteUrl?: string | null }>("/grip/status"),
  me: () => api.get<GripMe>("/grip/me"),
  setUnits: (units: Units) => api.put<{ account: GripAccount }>("/grip/me", { units }),
  tracks: () => api.get<{ tracks: Track[] }>("/grip/tracks").then((r) => r.tracks),

  sessions: () =>
    api.get<{ sessions: ReferenceSession[] }>("/grip/sessions").then((r) => r.sessions),
  session: (id: string) =>
    api.get<{ session: ReferenceSession }>(`/grip/sessions/${id}`).then((r) => r.session),
  createSession: (input: SessionInput) =>
    api
      .post<{ session: ReferenceSession }>("/grip/sessions", input)
      .then((r) => r.session),
  updateSession: (id: string, input: SessionInput) =>
    api
      .put<{ session: ReferenceSession }>(`/grip/sessions/${id}`, input)
      .then((r) => r.session),
  deleteSession: (id: string) => api.delete<void>(`/grip/sessions/${id}`),

  calculations: () =>
    api
      .get<{ calculations: Calculation[] }>("/grip/calculations")
      .then((r) => r.calculations),
  calculation: (id: string) =>
    api
      .get<{ calculation: Calculation }>(`/grip/calculations/${id}`)
      .then((r) => r.calculation),
  calculate: (input: CalculationInput) =>
    api.post<{ calculation: Calculation; account: GripAccount }>(
      "/grip/calculations",
      input
    ),
  deleteCalculation: (id: string) => api.delete<void>(`/grip/calculations/${id}`),
  convert: (id: string, input: { name: string; hot: Corners; notes?: string | null }) =>
    api
      .post<{ session: ReferenceSession }>(`/grip/calculations/${id}/convert`, input)
      .then((r) => r.session),

  damper: (q: DamperQuery) =>
    api.get<DamperResult>(`/grip/damper?${new URLSearchParams({ ...q }).toString()}`),

  checkout: () => api.post<{ url: string }>("/grip/billing/checkout"),
  portal: () => api.post<{ url: string }>("/grip/billing/portal"),

  admin: {
    overview: () => api.get<AdminOverview>("/grip/admin/overview"),
    tracks: () =>
      api.get<{ tracks: Track[] }>("/grip/admin/tracks").then((r) => r.tracks),
    addTrack: (input: { name: string; shortName: string }) =>
      api.post<{ track: Track }>("/grip/admin/tracks", input).then((r) => r.track),
    updateTrack: (
      id: string,
      input: { name: string; shortName: string; isActive?: boolean }
    ) =>
      api.put<{ track: Track }>(`/grip/admin/tracks/${id}`, input).then((r) => r.track),
    replaceDamperTable: (body: unknown) =>
      api.put<{ rows: number }>("/grip/admin/damper-scenarios", body),
  },
};

/** Download the user's data. Uses fetch directly because the response is a file, not JSON. */
export async function downloadExport(): Promise<void> {
  // Reading the response as text drops the byte-order mark, so put it back:
  // Excel needs it to read accented names correctly.
  const text = await api.getText("/grip/export");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "finding-grip-export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
