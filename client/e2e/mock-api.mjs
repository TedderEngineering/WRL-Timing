/**
 * A stand-in for the RaceTrace API, for layout checks in a browser (phone-check.mjs).
 *
 * It answers every /api request from fixtures in the repo: the seeded WRL race in
 * server/prisma/seed-data.json and seed-annotations.json, and a signed-in Team test user,
 * so every race tab opens. Nothing here reaches a real server or database.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(here, "../../server/prisma");

export const RACE_ID = "e2e-race";
const EVENT_ID = "e2e-event";

let cache = null;
function fixtures() {
  if (cache) return cache;
  cache = {
    data: JSON.parse(fs.readFileSync(path.join(seedDir, "seed-data.json"), "utf8")),
    annotations: JSON.parse(fs.readFileSync(path.join(seedDir, "seed-annotations.json"), "utf8")),
    pitAnalysis: null,
  };
  return cache;
}

/**
 * Builds the Pit Stops tab's analysis for the seeded race with the app's own code
 * (live-pit-analysis.ts, loaded through Vite so its imports resolve). Call once before mockApi.
 */
export async function preparePitAnalysis() {
  const { createServer } = await import("vite");
  const vite = await createServer({ root: path.resolve(here, ".."), server: { middlewareMode: true }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const mod = await vite.ssrLoadModule("/src/features/chart/live-pit-analysis.ts");
    const f = fixtures();
    f.pitAnalysis = mod.pitAnalysisFromChart(f.data, f.annotations, race.track);
  } finally {
    await vite.close();
  }
}

const user = {
  id: "e2e-user",
  email: "phone-check@example.test",
  displayName: "Phone Check",
  avatarUrl: null,
  role: "USER",
  emailVerified: true,
  onboardingDone: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  subscription: { plan: "TEAM", status: "ACTIVE", currentPeriodEnd: null, cancelAtPeriodEnd: false },
};

const race = {
  id: RACE_ID,
  name: "Saturday 8 Hour",
  date: "2026-02-21",
  track: "Barber Motorsports Park",
  series: "WRL",
  season: 2026,
  eventId: EVENT_ID,
};

/** The answer for one request, or null when this stand-in does not know the route. */
function answer(method, route) {
  if (method === "POST" && route === "/auth/refresh") return { accessToken: "e2e-token", expiresIn: 900, user };
  if (route === "/auth/me") return { user };
  if (route === "/site-config")
    return { freeMode: true, support: { enabled: false, checkout: false, paymentLinkUrl: null, coffeeCents: 500, options: [1, 3, 20] } };
  if (route === `/races/${RACE_ID}/chart-data`) {
    const { data, annotations } = fixtures();
    return { race, data, annotations, pitFacts: null };
  }
  if (route === `/races/${RACE_ID}/pit-analysis`) return fixtures().pitAnalysis;
  if (route === `/races/${RACE_ID}`) return { ...race, isFavorited: false, resultsStatus: "official", hasPackage: false };
  if (route === "/landing") return {};
  if (route.startsWith("/events/weekends")) return { weekends: [], total: 0 };
  if (route === `/events/${EVENT_ID}`)
    return { id: EVENT_ID, name: "WRL Barber", track: race.track, series: "WRL", season: 2026, startDate: race.date, endDate: race.date, races: [{ ...race, raceName: race.name }] };
  if (route.startsWith("/events")) return { events: [], total: 0 };
  if (route.startsWith("/me/chart-defaults")) return {};
  if (route.startsWith("/me/cars/in-race/")) return { followed: [] };
  if (route.startsWith("/me/cars")) return { cars: [] };
  if (route.startsWith("/me/drivers")) return { drivers: [] };
  if (route.startsWith("/me/alerts")) return { on: false };
  if (route === "/live") return { sessions: [], upcoming: [], recent: [], demo: null };
  return null;
}

/** Answers every /api request on this page from the fixtures. Returns the routes it did not know. */
export async function mockApi(page) {
  const unknown = new Set();
  await page.route("**/api/**", async (r) => {
    const url = new URL(r.request().url());
    const route = url.pathname.replace(/^\/api/, "");
    const body = answer(r.request().method(), route);
    if (body === null) {
      unknown.add(`${r.request().method()} ${route}`);
      return r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { message: "Not in the e2e stand-in" } }) });
    }
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return unknown;
}
