import { describe, it, expect } from "vitest";
import { groupSroLinks, parseApacheIndex, parseResultLinks, parseSelectOptions } from "../parse-alkamel.js";
import { eventsFromOrgResponse, sessionsFromEventResponse, sessionTypeOf } from "../parse-speedhive.js";
import { classifySession } from "../series.js";
import { fixture } from "./fake-http.js";

describe("Apache directory index (IMSA)", () => {
  it("reads the HTML-table layout: names from hrefs, dates, sizes; skips sort links and the parent", () => {
    const e = parseApacheIndex(fixture("imsa-mpc-race.html"));
    expect(e.map((x) => x.name)).toContain("23_Time Cards_Race.CSV");
    expect(e.find((x) => x.name.startsWith("?") || x.name.includes("Parent"))).toBeUndefined();
    const tc = e.find((x) => x.name === "23_Time Cards_Race.CSV")!;
    expect(tc).toMatchObject({ isDir: false, modified: "2026-10-02 14:05", size: "1.1M" });
    expect(e).toHaveLength(20);
  });

  it("reads folders with decoded names and no size", () => {
    const e = parseApacheIndex(fixture("imsa-event.html"));
    expect(e).toEqual([
      { name: "01_IMSA WeatherTech SportsCar Championship", href: "01_IMSA%20WeatherTech%20SportsCar%20Championship/", isDir: true, modified: "2026-10-04 22:10" },
      { name: "02_IMSA Michelin Pilot Challenge", href: "02_IMSA%20Michelin%20Pilot%20Challenge/", isDir: true, modified: "2026-10-02 16:30" },
      { name: "05_Mazda MX-5 Cup", href: "05_Mazda%20MX-5%20Cup/", isDir: true, modified: "2026-10-03 12:00" },
    ]);
  });

  it("reads the <pre> layout with dd-Mon-yyyy dates, UTF-8 escapes and entities", () => {
    const e = parseApacheIndex(fixture("imsa-pre-format.html"));
    expect(e.map((x) => [x.name, x.isDir, x.modified, x.size])).toEqual([
      ["01_Hour 1", true, "2026-10-04 13:15", undefined],
      ["03_Results_Race_Official.CSV", false, "2026-10-02 16:30", "9.1K"],
      ["23_Time Cards_Race.JSON", false, "2026-10-02 14:05", "2.3M"],
      ["Café & Notes.txt", false, "2026-10-02 14:05", "17"],
    ]);
  });

  it("returns nothing for a page that is not an index", () => {
    expect(parseApacheIndex("<html><body><h1>403 Forbidden</h1></body></html>")).toEqual([]);
  });
});

describe("SRO America page", () => {
  const html = fixture("sro-indy.html");

  it("reads the season and event dropdowns (Value= casing, SELECTED)", () => {
    expect(parseSelectOptions(html, "season").map((o) => [o.value, o.selected])).toEqual([
      ["24_2024", false],
      ["25_2025", false],
      ["26_2026", true],
    ]);
    const ev = parseSelectOptions(html, "evvent");
    expect(ev.map((o) => o.value)).toEqual(["", "02_Sonoma Raceway", "09_Indianapolis Motor Speedway RC"]);
    expect(ev[2]).toMatchObject({ label: "Indianapolis Motor Speedway RC", selected: true });
  });

  it("collects Results/ links with raw spaces or %20, ignoring other links", () => {
    const links = parseResultLinks(html);
    expect(links).toHaveLength(22);
    expect(links).toContain(
      "Results/06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1/23_AnalysisEnduranceWithSections_Race 1.CSV"
    );
    expect(links).toContain(
      "Results/06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610111330_Race 2/05_Provisional Results by Class_Race 2.CSV"
    );
    expect(links.some((l) => l.includes("sro-america") || l.includes("?"))).toBe(false);
  });

  it("accepts absolute and root-relative hrefs", () => {
    const l = parseResultLinks('<a href="https://usac.alkamelna.com/Results/06_SRO/x/y.CSV">a</a><a href=\'/Results/06_SRO/z.CSV\'>b</a>');
    expect(l).toEqual(["Results/06_SRO/x/y.CSV", "Results/06_SRO/z.CSV"]);
  });

  it("groups links into sessions by sub-series and session folder", () => {
    const g = groupSroLinks(parseResultLinks(html));
    expect(g.map((s) => `${s.subSeries} | ${s.sessionFolder} | ${s.files.length}`)).toEqual([
      "03_Pirelli GT4 America | 202610100815_Qualifying 1 | 2",
      "03_Pirelli GT4 America | 202610101000_Race 1 | 11",
      "03_Pirelli GT4 America | 202610111330_Race 2 | 3",
      "04_TGRNA GR Cup North America | 202610101415_Race 1 | 4",
      "01_GT World Challenge America powered by AWS | 202610111100_Race | 2",
    ]);
  });
});

describe("Speedhive API JSON", () => {
  it("reads organisation events from { rows } or a bare list", () => {
    const j = JSON.parse(fixture("speedhive-org-events.json"));
    expect(eventsFromOrgResponse(j).map((e) => e.id)).toEqual([3197001, 3100000]);
    expect(eventsFromOrgResponse(j.rows).map((e) => e.id)).toEqual([3197001, 3100000]);
    expect(eventsFromOrgResponse(null)).toEqual([]);
  });

  it("finds sessions inside groups and sub-groups, with group names", () => {
    const s = sessionsFromEventResponse(JSON.parse(fixture("speedhive-event.json")));
    expect(s.map((x) => [x.id, x.name, x.groupName])).toEqual([
      [11748900, "Practice 1", "Friday"],
      [11748960, "Qualifying", "Saturday"],
      [11748965, "Saturday 8 Hour", "Saturday"],
      [11748970, "Sunday 7 hour", "Sunday"],
    ]);
    expect(s.map(sessionTypeOf)).toEqual(["practice", "qualify", "race", "race"]);
  });

  it("reads the /events/{id}/sessions shape too", () => {
    const s = sessionsFromEventResponse({ sessions: [{ id: 1, name: "Race", type: "race" }], groups: [{ name: "G", sessions: [{ id: 2, name: "Sunday 7 hour", startTime: "x" }] }] });
    expect(s.map((x) => x.id)).toEqual([1, 2]);
  });
});

describe("session classification", () => {
  it.each([
    ["Race", "race"],
    ["Race 1", "race"],
    ["Qualifying Race", "race"],
    ["Saturday 8 Hour", "race"],
    ["Qualifying 1", "qualify"],
    ["Practice 2", "practice"],
    ["Warm Up", "practice"],
    ["Championship Points", "other"],
  ])("%s → %s", (name, type) => expect(classifySession(name)).toBe(type));
});
