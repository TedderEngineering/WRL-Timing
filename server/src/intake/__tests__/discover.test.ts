import { describe, it, expect } from "vitest";
import { discover, resolve } from "../index.js";
import { resolveSeries } from "../series.js";
import { discoverImsa } from "../sources/imsa.js";
import { sessionsFromEventPage } from "../sources/sro.js";
import { fakeHttp, fixture } from "./fake-http.js";

const IMSA = "https://imsa.results.alkamelcloud.com/Results";
const RA = `${IMSA}/26_2026/21_Road Atlanta`;
const MPC = `${RA}/02_IMSA Michelin Pilot Challenge`;
const WTSC = `${RA}/01_IMSA WeatherTech SportsCar Championship`;

const imsaRoutes = {
  [`${IMSA}/`]: fixture("imsa-root.html"),
  [`${IMSA}/26_2026/`]: fixture("imsa-season.html"),
  [`${IMSA}/26_2026/01_Daytona International Speedway/`]: "<html><body>Index of</body></html>",
  [`${RA}/`]: fixture("imsa-event.html"),
  [`${MPC}/`]: fixture("imsa-mpc.html"),
  [`${MPC}/202610021140_Race/`]: fixture("imsa-mpc-race.html"),
  [`${MPC}/202610011015_Qualifying/`]: fixture("imsa-pre-format.html"),
  [`${WTSC}/`]: fixture("imsa-wtsc.html"),
  [`${WTSC}/202610041210_Race/`]: fixture("imsa-wtsc-race.html"),
  [`${WTSC}/202610041210_Race/01_Hour 1/`]: fixture("imsa-wtsc-hour1.html"),
  [`${WTSC}/202610041210_Race/10_Hour 10/`]: fixture("imsa-wtsc-hour10.html"),
};

describe("IMSA discovery (Apache index crawl)", () => {
  it("finds the MPC race (not qualifying) with official results and a stable source key", async () => {
    const http = fakeHttp(imsaRoutes);
    const s = await discover(http, { series: ["imsa-mpc"], season: 2026 });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      sourceKey: "imsa:26_2026/21_Road Atlanta/02_IMSA Michelin Pilot Challenge/202610021140_Race",
      site: "imsa",
      seriesId: "imsa-mpc",
      event: "Road Atlanta",
      sessionName: "Race",
      sessionType: "race",
      raceDate: "2026-10-02",
      startTime: "2026-10-02T11:40",
      resultsStatus: "official",
      legacyFormat: "imsa",
      factFormat: "alkamel-imsa",
    });
    expect(s[0].version).toMatch(/^[0-9a-f]{16}$/);
    // Championships outside the selection are never listed (no request for WeatherTech or MX-5).
    expect(http.calls.some((c) => decodeURIComponent(c.url).includes("WeatherTech"))).toBe(false);
    expect(http.calls.some((c) => decodeURIComponent(c.url).includes("Qualifying"))).toBe(false);
  });

  it("imsa-* takes every championship; endurance races use the last hour folder only", async () => {
    const http = fakeHttp(imsaRoutes);
    const s = await discover(http, { series: ["imsa-*"], season: 2026 });
    expect(s.map((x) => x.seriesId)).toEqual(["imsa-mpc", "imsa-wtsc"]);
    const wtsc = s[1];
    expect(wtsc.resultsStatus).toBe("provisional");
    expect(http.calls.some((c) => decodeURIComponent(c.url).includes("01_Hour 1"))).toBe(false);
    expect(wtsc.files.filter((f) => f.subdir).every((f) => f.subdir === "10_Hour 10")).toBe(true);
    expect(wtsc.files.map((f) => f.name)).toContain("25_FlagsAnalysisWithRCMessages_Race.JSON");
  });

  it("--all-sessions includes qualifying; --since filters by session date", async () => {
    const all = await discover(fakeHttp(imsaRoutes), { series: ["imsa-mpc"], season: 2026, allSessions: true });
    expect(all.map((x) => x.sessionName)).toEqual(["Qualifying", "Race"]);
    const late = await discover(fakeHttp(imsaRoutes), { series: ["imsa-*"], season: 2026, since: "2026-10-03" });
    expect(late.map((x) => x.seriesId)).toEqual(["imsa-wtsc"]);
  });

  it("a missing season returns no sessions", async () => {
    const sel = resolveSeries(["imsa-mpc"])[0];
    expect(await discoverImsa(fakeHttp(imsaRoutes), sel, { season: 2019 })).toEqual([]);
  });

  it("resolve(sourceKey) rebuilds the same session without a crawl", async () => {
    const found = (await discover(fakeHttp(imsaRoutes), { series: ["imsa-mpc"], season: 2026 }))[0];
    const http = fakeHttp(imsaRoutes);
    const r = await resolve(http, found.sourceKey);
    expect(r).toEqual(found);
    expect(http.calls).toHaveLength(1);
  });
});

const SRO = "https://usac.alkamelna.com/";
const sroRoutes = {
  [`${SRO}?series=06_SRO`]: fixture("sro-season.html"),
  [`${SRO}?series=06_SRO&season=26_2026&evvent=`]: fixture("sro-season.html"),
  [`${SRO}?series=06_SRO&season=26_2026&evvent=02_Sonoma Raceway`]: fixture("sro-sonoma.html"),
  [`${SRO}?series=06_SRO&season=26_2026&evvent=09_Indianapolis Motor Speedway RC`]: fixture("sro-indy.html"),
};

describe("SRO America discovery (event page links)", () => {
  it("GT4: races only, official results preferred, source keys from the link path", async () => {
    const s = await discover(fakeHttp(sroRoutes), { series: ["sro-gt4"], season: 2026 });
    expect(s.map((x) => [x.sourceKey, x.resultsStatus])).toEqual([
      ["sro:06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1", "official"],
      ["sro:06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610111330_Race 2", "provisional"],
    ]);
    expect(s[0]).toMatchObject({ legacyFormat: "sro", factFormat: "alkamel-sro", raceDate: "2026-10-10", event: "Indianapolis Motor Speedway RC" });
    expect(s[0].files[0].url).toMatch(/^https:\/\/usac\.alkamelna\.com\/Results\/06_SRO\/26_2026\/09_Indianapolis%20Motor%20Speedway%20RC\//);
  });

  it("GR Cup uses the GR Cup parser; sro-* finds every sub-series", async () => {
    const gr = await discover(fakeHttp(sroRoutes), { series: ["sro-grcup"], season: 2026 });
    expect(gr.map((x) => [x.seriesId, x.legacyFormat, x.factFormat, x.resultsStatus])).toEqual([["sro-grcup", "grcup", "alkamel-grcup", "provisional"]]);
    const all = await discover(fakeHttp(sroRoutes), { series: ["sro-*"], season: 2026 });
    expect(all.map((x) => x.seriesId).sort()).toEqual(["sro-grcup", "sro-gt4", "sro-gt4", "sro-gtwca"]);
  });

  it("resolve(sourceKey) finds the same session from the event page", async () => {
    const found = (await discover(fakeHttp(sroRoutes), { series: ["sro-gt4"], season: 2026 }))[1];
    const http = fakeHttp(sroRoutes);
    expect(await resolve(http, found.sourceKey)).toEqual(found);
    expect(http.calls).toHaveLength(1);
  });

  it("a page with no links gives no sessions", () => {
    expect(sessionsFromEventPage(fixture("sro-sonoma.html"), null, {})).toEqual([]);
  });
});

const SH = "https://eventresults-api.speedhive.com/api/v0.2.3/eventresults";
const shRoutes = {
  [`${SH}/organizations/90001/events?count=100&offset=0`]: fixture("speedhive-org-events.json"),
  [`${SH}/events/3197001?sessions=true`]: fixture("speedhive-event.json"),
  [`${SH}/events/3197001`]: fixture("speedhive-event.json"),
  [`${SH}/sessions/11748965`]: fixture("speedhive-session.json"),
};

describe("WRL discovery (Speedhive organisation events)", () => {
  it("lists the season's race sessions only", async () => {
    const http = fakeHttp(shRoutes);
    const s = await discover(http, { series: ["wrl"], season: 2026, speedhiveOrgId: 90001 });
    expect(s.map((x) => [x.sourceKey, x.sessionName, x.raceDate])).toEqual([
      ["speedhive:session:11748965", "Saturday 8 Hour", "2026-02-28"],
      ["speedhive:session:11748970", "Sunday 7 hour", "2026-03-01"],
    ]);
    expect(s[0]).toMatchObject({ track: "Barber Motorsports Park", event: "WRL @ Barber #87", resultsStatus: "unknown", legacyFormat: "speedhive" });
    // The 2025 event is never opened.
    expect(http.calls.some((c) => c.url.includes("3100000"))).toBe(false);
  });

  it("works from an event URL without the organisation id", async () => {
    const s = await discover(fakeHttp(shRoutes), { series: ["wrl"], season: 2026, speedhiveRefs: ["https://speedhive.mylaps.com/events/3197001"] });
    expect(s.map((x) => x.sourceKey)).toEqual(["speedhive:session:11748965", "speedhive:session:11748970"]);
  });

  it("refuses WRL discovery with neither an organisation id nor a URL", async () => {
    await expect(discover(fakeHttp(shRoutes), { series: ["wrl"], season: 2026 })).rejects.toThrow(/organisation id/);
  });

  it("resolve(speedhive:session:<id>) matches discovery", async () => {
    const found = (await discover(fakeHttp(shRoutes), { series: ["wrl"], season: 2026, speedhiveOrgId: 90001 }))[0];
    const r = await resolve(fakeHttp(shRoutes), "speedhive:session:11748965");
    expect(r.sourceKey).toBe(found.sourceKey);
    expect(r.version).toBe(found.version);
    expect(r.raceDate).toBe(found.raceDate);
  });
});
