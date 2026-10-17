import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { RecapCard } from "../RecapCard";
import { SeasonPanel, shortRaceLabel } from "../SeasonPanel";
import { formatDayRange, whenLabel } from "../format";
import type { LatestEvent, SeasonResponse } from "../types";

const html = (node: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, "");
const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

// Values from the GT4 America Indianapolis Race 1 example package.
const EVENT: LatestEvent = {
  key: "ev1",
  series: "SRO",
  subSeries: null,
  seriesLabel: "Pirelli GT4 America",
  round: { number: 7, of: 7, name: "Indianapolis" },
  track: "Indianapolis Motor Speedway",
  startDate: "2026-10-10",
  endDate: "2026-10-11",
  isNew: true,
  races: [
    {
      id: "r1",
      name: "Pirelli GT4 Race 1 — Indianapolis Motor Speedway",
      session: "Race 1",
      date: "2026-10-10",
      totalCars: 34,
      maxLap: 34,
      resultsStatus: "provisional",
      locked: false,
      lockReason: null,
      recap: {
        packageId: "gt4-indy-r1",
        session: "Race 1",
        resultsStatus: "provisional",
        totalLaps: 34,
        headline: {
          text: "{car:68} won Race 1, finishing {0} overall on the provisional results, {1} ahead of {car:131}.",
          refs: [
            { value: 1, factId: "result:68", field: "positionOverall", unit: "pos" },
            { value: "+3.518", factId: "result:131", field: "gapFirst", unit: "text" },
          ],
        },
        paragraphs: [{ text: "A Full Course Yellow covered leader laps {0} to {1}.", refs: [
          { value: 2, factId: "fcy:1", field: "leaderLaps[0]", unit: "lap" },
          { value: 9, factId: "fcy:1", field: "leaderLaps[1]", unit: "lap" },
        ] }],
        classWinners: [
          { class: "Silver", className: "Silver", car: "68", team: "RAFA Racing Team", make: "Toyota", drivers: ["Westin Workman", "Tyler Gonzalez"], summary: null },
          { class: "Pro-Am", className: "Pro-Am", car: "33", team: "Blackdog Racing", make: "McLaren", drivers: ["Tony Gaples", "Michael Cooper"], summary: null },
          { class: "Am", className: "Am", car: "21", team: "ACI Motorsports", make: "BMW", drivers: ["Michael Garcia", "Alex Garcia"], summary: null },
        ],
        moments: [
          { id: "moment:1", lap: 2, lapEnd: 9, causes: ["fcy"], title: { text: "Full Course Yellow for {0}", refs: [{ value: 1093.35, factId: "fcy:1", field: "durationS", unit: "s", display: "18:13.350" }] }, text: null, cars: [] },
          { id: "moment:6", lap: 34, lapEnd: null, causes: ["on_track"], title: { text: "{car:33} takes the {class:Pro-Am} lead on the last lap", refs: [] }, text: null, cars: ["33", "77"] },
        ],
        bands: [{ kind: "fcy", fromLap: 2, toLap: 9, label: "Full Course Yellow" }, { kind: "pit_cycle", fromLap: 10, toLap: 18, label: "Pit cycles" }],
        postRace: [{ car: "77", class: "Pro-Am", penaltyS: 14.018, before: 2, after: 7 }],
        cars: {},
        classes: { Silver: "Silver", "Pro-Am": "Pro-Am", Am: "Am" },
      },
    },
    { id: "r2", name: "Pirelli GT4 Race 2 — Indianapolis Motor Speedway", session: "Race 2", date: "2026-10-11", totalCars: 34, maxLap: 37, resultsStatus: "provisional", locked: false, lockReason: null, recap: null },
  ],
};

describe("RecapCard", () => {
  const out = text(html(<RecapCard event={EVENT} variant="hero" />));

  it("shows the series, round, track and weekend, with the results status", () => {
    expect(out).toContain("Pirelli GT4 America · Round 7 of 7 · Indianapolis Motor Speedway · Oct 10–11, 2026");
    expect(out).toContain("Provisional");
    expect(out).toContain("NEW");
  });

  it("renders the package headline and one winner per class", () => {
    expect(out).toContain("#68 won Race 1, finishing P1 overall on the provisional results, +3.518 ahead of #131.");
    expect(out).toContain("Silver · winner#68 RAFA Racing TeamToyota · Workman / Gonzalez");
    expect(out).toContain("Am · winner#21 ACI MotorsportsBMW · Garcia / Garcia");
  });

  it("lists key moments by lap and the post-race penalty", () => {
    expect(out).toContain("L2–9Full Course Yellow for 18:13.350");
    expect(out).toContain("L34#33 takes the Pro-Am lead on the last lap");
    expect(out).toContain("After the race: #77 given a 0:14.018 time penalty, P2 → P7 in Pro-Am");
  });

  it("has one tab per race that shows its summary here (not a link away), and links into the chart pages", () => {
    const h = html(<RecapCard event={EVENT} variant="hero" />);
    const tabs = h.match(/<button [^>]*role="tab"[^>]*>[^<]*<\/button>/g) ?? [];
    expect(tabs.length).toBe(EVENT.races.length);
    expect(tabs.find((a) => a.includes('aria-selected="true"'))).toMatch(/>Race 1</);
    expect(tabs.some((a) => a.includes("href"))).toBe(false);
    expect(h).toContain('role="tabpanel"');
    expect(h).toContain('href="/chart?race=r1&amp;tab=pitanalysis"');
  });

  it("the small card for earlier weekends keeps the race tabs, links and size, without the recap", () => {
    const h = html(<RecapCard event={EVENT} variant="mini" />);
    const t = text(h);
    expect(t).toContain("Indianapolis Motor Speedway");
    expect(t).toContain("Oct 10–11");
    expect(t).toContain("34 cars · 34 laps");
    expect(t).not.toContain("RAFA");
    const tabs = h.match(/<button [^>]*role="tab"[^>]*>[^<]*<\/button>/g) ?? [];
    expect(tabs.map((a) => a.replace(/<[^>]+>/g, ""))).toEqual(["Race 1", "Race 2"]);
    expect(h).toContain('href="/chart?race=r1"');
    expect(h).toContain(">Position Trace →<");
  });

  it("says when a race has no recap yet", () => {
    const ev = { ...EVENT, races: [EVENT.races[1]] };
    expect(text(html(<RecapCard event={ev} variant="compact" />))).toContain("Chart only · recap coming");
  });

  it("locks a race the member's plan does not open", () => {
    const ev = { ...EVENT, races: [{ ...EVENT.races[0], locked: true, lockReason: "pro_required", recap: null }] };
    const t = text(html(<RecapCard event={ev} variant="hero" />));
    expect(t).toContain("Upgrade to Pro to read this race.");
    expect(t).not.toContain("RAFA");
  });
});

describe("SeasonPanel", () => {
  const round = (n: number, name: string, start: string, end: string, status: any, isNext = false) => ({
    round: n, name, track: name, start, end, status, isNext, races: status === "on_site" ? [{ id: `x${n}`, name: "Saturday 8-Hour", date: start }] : [],
  });
  const wrl = {
    id: "wrl", label: "WRL", shortLabel: "WRL", badge: "WRL",
    source: { title: "WRL 2026", url: "https://example.org/wrl", checked: "2026-10-13" },
    rounds: [
      round(6, "Road Atlanta", "2026-07-24", "2026-07-26", "on_site"),
      round(7, "Watkins Glen", "2026-08-28", "2026-08-30", "missing"),
      round(8, "Utah (UMC)", "2026-09-25", "2026-09-27", "missing"),
      { ...round(9, "Sebring", "2026-10-16", "2026-10-18", "upcoming", true), note: "Eastern finale" },
      round(10, "COTA", "2026-12-04", "2026-12-06", "upcoming"),
    ],
    counts: { total: 10, run: 8, onSite: 6 }, complete: false, latestOnSite: null, next: null as any,
  };
  wrl.next = { ...wrl.rounds[3] };
  const data: SeasonResponse = {
    season: 2026, seasons: [2026], today: "2026-10-13", series: [wrl], suggested: ["wrl"],
    next: { ...wrl.rounds[3], seriesId: "wrl", seriesLabel: "WRL" },
    upcoming: [{ ...wrl.rounds[3], seriesId: "wrl", seriesLabel: "WRL" }],
  };
  const out = text(html(<SeasonPanel data={data} />));

  it("leads with the next round and when it is", () => {
    expect(out).toContain("Next up · in 3 days");
    expect(out).toContain("WRL Sebring · Eastern finale");
  });

  it("collapsed, it lists the rounds around the next one even when `next` is a copy", () => {
    expect(out).toContain("R6Road Atlanta");
    expect(out).toContain("R10COTA");
  });

  it("shortens race names for round links", () => {
    expect(shortRaceLabel("Saturday 8-Hour")).toBe("Sat");
    expect(shortRaceLabel("Pirelli GT4 Race 1 — Sonoma Raceway")).toBe("Race 1");
    // The standard names (intake "names").
    expect(shortRaceLabel("WRL Saturday 8 Hour — Michelin Raceway Road Atlanta")).toBe("Sat");
    expect(shortRaceLabel("GT4 America Race 2 — Sonoma Raceway")).toBe("Race 2");
  });

  it("links each round on RaceTrace, bar and name, to its weekend", () => {
    const markup = html(<SeasonPanel data={data} />);
    const links = markup.match(/<a [^>]*>/g) ?? [];
    expect(links.some((a) => a.includes('href="/chart?race=x6"') && /aria-label="Round 6 [^"]*Open"/.test(a))).toBe(true);
    // Rounds not on RaceTrace are not links.
    expect(links.some((a) => a.includes("Round 7"))).toBe(false);
  });

  it("shows run and on-site counts and each round's state", () => {
    expect(out).toContain("8 of 10 run · 6 on RaceTrace");
    expect(out).toContain("R7Watkins GlenAug 28–30 · not on RaceTrace yet");
    expect(out).toContain("R9Sebring · Eastern finaleOct 16–18 · next");
  });
});

describe("dates", () => {
  it("formats weekends and countdowns", () => {
    expect(formatDayRange("2026-02-27", "2026-03-01")).toBe("Feb 27–Mar 1, 2026");
    expect(formatDayRange("2026-08-22", "2026-08-22", false)).toBe("Aug 22");
    expect(whenLabel("2026-10-16", "2026-10-18", "2026-10-13")).toBe("in 3 days");
    expect(whenLabel("2026-10-16", "2026-10-18", "2026-10-17")).toBe("this weekend");
  });
});
