import { describe, expect, it } from "vitest";
import { identityChange, standardRaceName, tidySession, type SessionIdentity } from "../standard-name.js";

const sess = (site: string, championship: string, sessionName: string, track: string, raceDate = "2026-04-25", season = 2026): SessionIdentity => ({
  site, championship, sessionName, track, raceDate, season,
});
const cur = (name: string, series: string, track: string, sourceKey = "x:y") => ({ name, series, track, sourceKey });

describe("standard race names", () => {
  it("names every race '<championship> <session> — <event or track>'", () => {
    expect(standardRaceName(sess("sro", "48_TGRNA GR Cup North America", "Race 1", "Circuit of the Americas"), cur("GR Cup Race 1", "GR CUP", "COTA"))).toBe(
      "GR Cup Race 1 — Circuit of the Americas"
    );
    expect(
      standardRaceName(sess("imsa", "03_IMSA VP Racing SportsCar Challenge", "Race 1", "VIRginia International Raceway"), cur("IMSA VPRC Race 1 — Michelin GT Challenge at VIR", "IMSA", "VIRginia International Raceway"))
    ).toBe("VP Racing Challenge Race 1 — Michelin GT Challenge at VIR");
    // A championship's only race keeps the race's own title.
    expect(standardRaceName(sess("imsa", "02_IMSA Michelin Pilot Challenge", "Race", "Road Atlanta"), cur("Fox Factory 120", "IMSA", "Road Atlanta"))).toBe("Pilot Challenge — Fox Factory 120");
    expect(standardRaceName(sess("imsa", "01_IMSA WeatherTech SportsCar Championship", "Race", "Daytona"), cur("IMSA WeatherTech — Rolex 24 at Daytona", "IMSA", "Daytona International Speedway"))).toBe(
      "WeatherTech — Rolex 24 at Daytona"
    );
    // WRL: the session decides the day ("Saturday 7 Hour" typed by hand was the Sunday race).
    expect(standardRaceName(sess("speedhive", "WRL", "Sunday 7 Hour", "Road America"), cur("Saturday 7 Hour", "WRL", "Road America"))).toBe("WRL Sunday 7 Hour — Road America");
    expect(standardRaceName(sess("redmist", "World Racing League", "Saturday - 8 Hour", "Road Atlanta"), cur("Saturday 8-Hour", "WRL", "Road Atlanta"))).toBe(
      "WRL Saturday 8 Hour — Michelin Raceway Road Atlanta"
    );
  });

  it("tidies session names", () => {
    expect(tidySession("Saturday - 8 Hour")).toBe("Saturday 8 Hour");
    expect(tidySession("Sunday 7 hour")).toBe("Sunday 7 Hour");
    expect(tidySession("Race1")).toBe("Race 1");
  });

  it("reports only races that differ from their session, with the session's day and season", () => {
    const race = { raceId: "r", name: "GR Cup Race 1", series: "GR CUP", track: "COTA", sourceKey: "sro:x", date: "2025-09-06", season: 2026 };
    const s = sess("sro", "48_TGRNA GR Cup North America", "Race 1", "Barber Motorsports Park", "2025-09-06", 2025);
    expect(identityChange(race, s)?.to).toEqual({ name: "GR Cup Race 1 — Barber Motorsports Park", date: "2025-09-06", season: 2025 });
    const done = { ...race, name: "GR Cup Race 1 — Barber Motorsports Park", season: 2025 };
    expect(identityChange(done, s)).toBeNull();
  });
});
