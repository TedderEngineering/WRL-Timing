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
export const LIVE_SLUG = "e2e-live";
export const QUAL_ID = "e2e-qual";
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
    // RaceTrace Live: the seeded race as a live session, encoded by the server's own wire code.
    const wire = await vite.ssrLoadModule(path.resolve(here, "../../server/src/live/wire.ts"));
    f.liveFull = wire.encodeFull(1, f.data, f.annotations);
  } finally {
    await vite.close();
  }
  addPitTiming(fixtures());
}

/**
 * The seed has stops but no pit timing (an import adds it). For the Pit cycle view, give each
 * stop a stand-in timing from its in- and out-lap against the car's typical green lap.
 */
function addPitTiming({ data, annotations }) {
  for (const [key, ann] of Object.entries(annotations)) {
    const car = data.cars[key];
    if (!car || !ann?.pits) continue;
    const green = car.laps.filter((l) => l.pit === 0 && l.flag !== "FCY" && l.ltSec > 0).map((l) => l.ltSec).sort((a, b) => a - b);
    const avg = green.length ? green[Math.floor(green.length / 2)] : null;
    for (const p of ann.pits) {
      if (p.pitTiming) continue;
      const inLap = car.laps.find((l) => l.l === p.l)?.ltSec ?? null;
      const outLap = car.laps.find((l) => l.l === p.l + 1)?.ltSec ?? null;
      if (!inLap || !outLap || !avg) continue;
      p.pitTiming = {
        pitInTime: null, pitRoadTime: null, pitOutTime: null, isDriveThrough: false,
        totalPitLoss: inLap + outLap - 2 * avg, inLapTime: inLap, outLapTime: outLap, avgGreenLapTime: avg,
      };
    }
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

/** The test user's two followed cars (Home and Events "My cars"). */
const myCars = [
  { id: "car-60", label: null, number: "60", series: "wrl", teamName: "Stratus 60", carClass: "GTU", season: 2026, alerts: true },
  { id: "car-58", label: null, number: "58", series: "wrl", teamName: "Stratus 58", carClass: "GTU", season: 2026, alerts: true },
];

/** Thirty race weekends, newest first, the seeded race among them (the Events list's length). */
function weekends() {
  const tracks = ["Sebring", "Road Atlanta", "COTA", "Barber Motorsports Park", "VIR", "Watkins Glen", "Laguna Seca", "Mid-Ohio", "Road America", "Daytona"];
  const out = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(2026, 9, 18) - i * 12 * 864e5).toISOString().slice(0, 10);
    const seeded = i === 6;
    const family = seeded ? "WRL" : ["IMSA", "SRO", "GR Cup", "WRL"][i % 4];
    const races = seeded
      ? [{ id: RACE_ID, eventId: EVENT_ID, name: race.name, championship: null, title: race.name, family, date: race.date, cars: 57, laps: 249, status: "PUBLISHED", resultsStatus: "official", hasStory: false }]
      : [1, 2].map((n) => ({ id: `w${i}-r${n}`, eventId: null, name: `Race ${n}`, championship: null, title: `Race ${n}`, family, date: d, cars: 30 + n, laps: 80, status: "PUBLISHED", resultsStatus: "official", hasStory: false }));
    out.push({ key: `w${i}`, track: seeded ? race.track : tracks[i % tracks.length], title: null, startDate: seeded ? race.date : d, endDate: seeded ? race.date : d, season: (seeded ? race.date : d).slice(0, 4), families: [family], races });
  }
  return out;
}

/** "Your car's latest race" for one followed car, from the seeded race. */
function myCar(id) {
  const car = myCars.find((c) => c.id === id) ?? myCars[0];
  const ch = fixtures().data.cars[car.number];
  const cycles = [
    { cycle: 1, lap: 24, before: 3, after: 2, net: 1, stopLap: 18 },
    { cycle: 2, lap: 80, before: 2, after: 1, net: 1, stopLap: 74 },
    { cycle: 3, lap: 150, before: 1, after: 1, net: 0, stopLap: 141 },
    { cycle: 4, lap: 225, before: 2, after: 1, net: 1, stopLap: 220 },
  ];
  return {
    carCount: myCars.length,
    car: { id: car.id, label: null, number: car.number, series: "WRL", teamName: car.teamName },
    race: { id: RACE_ID, name: race.name, date: race.date, track: race.track, series: "WRL", resultsStatus: "official", locked: false, lockReason: null },
    facts: {
      carKey: car.number, number: car.number, team: ch.team, cls: ch.cls, vehicle: null,
      finishClass: ch.finishPosClass, finishOverall: ch.finishPos, classSize: 10, status: "running", finished: true,
      laps: ch.laps.length, raceLaps: 249, bestLap: { sec: 91.54, lap: 210 }, bestLapClassRank: 1,
      pitCycles: cycles, stops: 12, stopLaps: cycles.map((c) => c.stopLap),
      benchmarks: ["Fastest lap in GTU"],
      highlights: [{ kind: "best_lap", text: "Fastest lap in GTU, 1:31.540 on lap 210", score: 9 }, { kind: "cycles", text: "Gained 3 places over the pit cycles", score: 7 }],
    },
    drivers: ["Alana Carter", "Michele Abbate", "Hannah Grisham"],
    drive: null,
    story: null,
    viewed: false,
    alerts: true,
    cars: myCars.map(({ id, number, label, teamName }) => ({ id, number, label, series: "wrl", teamName })),
    recent: [{ raceId: RACE_ID, raceName: race.name, date: race.date, track: race.track, series: "WRL", subSeries: null, carNumber: car.number, carClass: ch.cls, finishPos: ch.finishPos, finishPosClass: ch.finishPosClass }],
    totalRaces: 1,
    isLatest: true,
  };
}

const liveInfo = {
  slug: LIVE_SLUG, updatedAt: new Date().toISOString(), waiting: null, delayed: false, ended: false,
  eventName: "WRL Barber", sessionName: "Saturday 8 Hour", track: race.track,
  status: { leaderLap: 249, carCount: 57, flag: "Green", runningRaceTime: "07:12:30", timeToGo: "00:47:30", warnings: [] },
};

/** A qualifying session from the seed: each car's first laps, split into three sectors. */
function qualifying() {
  const { data } = fixtures();
  const cars = Object.entries(data.cars).map(([num, c]) => {
    const laps = c.laps.slice(1, 9).filter((l) => l.ltSec > 0).map((l, i) => {
      const s1 = +(l.ltSec * 0.31).toFixed(3), s2 = +(l.ltSec * 0.37).toFixed(3), s3 = +(l.ltSec - s1 - s2).toFixed(3);
      const f = (x) => `0:${x.toFixed(3).padStart(6, "0")}`;
      return { l: i + 1, lt: l.lt, ltSec: l.ltSec, s1, s2, s3, s1f: f(s1), s2f: f(s2), s3f: f(s3), s1imp: 0, s2imp: 0, s3imp: 0, flag: "GF", pit: false, lapImp: 0 };
    });
    const best = laps.reduce((b, l) => (l.ltSec < b.ltSec ? l : b), laps[0] ?? { ltSec: 0, l: 0 });
    const min = (k) => Math.min(...laps.map((l) => l[k]));
    return { num, team: c.team, driver: `Driver ${num}`, cls: c.cls, mfr: "", laps, bestLap: best.ltSec, bestLapNum: best.l, theoreticalBest: min("s1") + min("s2") + min("s3"), bestS1: min("s1"), bestS2: min("s2"), bestS3: min("s3") };
  }).filter((c) => c.laps.length).sort((a, b) => a.bestLap - b.bestLap);
  return {
    session: { id: QUAL_ID, name: "Qualifying", track: race.track, series: "WRL", date: race.date, carCount: cars.length },
    data: { sessionName: "Qualifying", track: race.track, series: "WRL", date: race.date, cars, classes: [...new Set(cars.map((c) => c.cls))].sort(), totalLaps: cars.reduce((n, c) => n + c.laps.length, 0) },
  };
}

/** The answer for one request, or null when this stand-in does not know the route. */
function answer(method, route, search = new URLSearchParams()) {
  if (route === "/live/key") return { k: "e2e-key", renewAt: new Date(Date.now() + 3600e3).toISOString() };
  if (route === `/live/${LIVE_SLUG}/head`) return { epoch: "e1", v: 1, ageMs: 0, live: liveInfo };
  if (route.startsWith(`/live/${LIVE_SLUG}/full/`)) return { race: { id: "live-race", name: race.name, date: race.date, track: race.track, series: "WRL", season: 2026 }, full: fixtures().liveFull };
  if (route === `/live/${LIVE_SLUG}/events`) return { events: [] };
  if (route === `/qualifying/${QUAL_ID}/chart-data`) return qualifying();
  if (route === "/dashboard/my-car") return myCar(search.get("car"));
  if (route === `/races/${RACE_ID}/car-card` || route === `/races/${RACE_ID}/driver-card`) {
    const num = search.get("car") ?? "60";
    const ch = fixtures().data.cars[num];
    if (!ch) return null;
    const m = myCar(myCars.find((c) => c.number === num)?.id ?? "car-60");
    const facts = { ...m.facts, number: num, team: ch.team, cls: ch.cls, carKey: num, finishClass: ch.finishPosClass, finishOverall: ch.finishPos, laps: ch.laps.length };
    const raceInfo = { id: RACE_ID, name: race.name, date: race.date, track: race.track, series: "WRL", resultsStatus: "official", locked: false, lockReason: null };
    if (route.endsWith("car-card")) return { race: raceInfo, car: { number: num, team: ch.team, cls: ch.cls }, drivers: m.drivers, facts, drive: null };
    return { race: raceInfo, car: { number: num, team: ch.team, cls: ch.cls, coDrivers: m.drivers.filter((d) => d !== search.get("driver")) }, facts, driverFacts: null, driverHighlights: [] };
  }
  if (route === "/dashboard/my-driver") return { driverCount: 0, driver: null, drivers: [], race: null };
  if (route === "/dashboard/latest")
    return { events: weekends().slice(0, 4).map((w) => ({ key: w.key, series: w.families[0], subSeries: null, seriesLabel: w.families[0], round: null, track: w.track, startDate: w.startDate, endDate: w.endDate, isNew: false, races: w.races.map((r) => ({ id: r.id, name: r.name, session: r.title, date: r.date, totalCars: r.cars, maxLap: r.laps, resultsStatus: "official", locked: false, lockReason: null, recap: null })) })) };
  if (route === "/dashboard/season")
    return { season: 2026, seasons: [2026], today: "2026-10-24", series: [], suggested: [], next: { round: 9, name: "WRL Sebring", track: "Sebring", start: "2026-11-14", end: "2026-11-15", status: "upcoming", isNext: true, races: [], seriesId: "wrl", seriesLabel: "WRL" }, upcoming: [] };
  if (route === "/dashboard/season-recap") return { recaps: [] };
  if (route === "/races/recently-viewed") return { races: [{ id: RACE_ID, name: race.name, date: race.date, track: race.track, series: "WRL" }] };
  if (route === "/races/favorites") return { races: [] };
  if (route === "/search/cars") {
    const q = (search.get("q") ?? "").replace("#", "");
    return { query: q, cars: myCars.filter((c) => c.number === q).map((c) => ({ series: "wrl", number: c.number, team: c.teamName, carClass: c.carClass, races: [{ raceId: RACE_ID, raceName: race.name, date: race.date, track: race.track, series: "WRL", carNumber: c.number, teamName: c.teamName, carClass: c.carClass, finishPos: 1, finishPosClass: 1 }] })) };
  }
  if (route === "/search/drivers") return { drivers: [] };
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
  if (route.startsWith("/events/weekends")) return { weekends: weekends(), emptyEvents: [] };
  if (route === `/events/${EVENT_ID}`)
    return { id: EVENT_ID, name: "WRL Barber", track: race.track, series: "WRL", season: 2026, startDate: race.date, endDate: race.date, races: [{ ...race, raceName: race.name }] };
  if (route.startsWith("/events")) return { events: [], total: 0 };
  if (route.startsWith("/me/chart-defaults")) return {};
  if (route.startsWith("/me/cars/in-race/")) return { followed: [] };
  if (route.startsWith("/me/cars")) return { cars: myCars, max: 5 };
  if (route.startsWith("/me/drivers")) return { drivers: [] };
  if (route.startsWith("/me/alerts")) return { on: false };
  if (route === "/live") return { sessions: [{ slug: LIVE_SLUG, sessionName: liveInfo.sessionName, eventName: liveInfo.eventName, track: race.track, updatedAt: liveInfo.updatedAt }], upcoming: [], recent: [], demo: null };
  return null;
}

/** Answers every /api request on this page from the fixtures. Returns the routes it did not know. */
export async function mockApi(page) {
  const unknown = new Set();
  await page.route("**/api/**", async (r) => {
    const url = new URL(r.request().url());
    const route = url.pathname.replace(/^\/api/, "");
    const body = answer(r.request().method(), route, url.searchParams);
    if (body === null) {
      unknown.add(`${r.request().method()} ${route}`);
      return r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { message: "Not in the e2e stand-in" } }) });
    }
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return unknown;
}
