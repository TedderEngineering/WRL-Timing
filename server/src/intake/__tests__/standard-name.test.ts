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

  it("fixes the names the October plan got wrong, and gives the same answer twice", () => {
    const cases: [SessionIdentity, ReturnType<typeof cur>, string][] = [
      [sess("redmist", "WRL", "Mid-Ohio - Sunday - 7 hour", "Mid-Ohio"), cur("WRL - Mid-Ohio - 8+7 — Mid-Ohio - Sunday - 7 hour", "WRL", "Mid-Ohio Sports Car Course"), "WRL Sunday 7 Hour — Mid-Ohio Sports Car Course"],
      [sess("redmist", "WRL", "Barber - Saturday - 8 Hour", "Barber Motorsports Park"), cur("WRL - Barber Motorsports Park - 8+7 — Barber - Saturday - 8 Hour", "WRL", "Barber Motorsports Park"), "WRL Saturday 8 Hour — Barber Motorsports Park"],
      [sess("redmist", "WRL", "WRL - High Plains - 13 Hour", "High Plains Raceway"), cur("WRL - High Plains Raceway - 13 — WRL - High Plains - 13 Hour", "WRL", "High Plains Raceway"), "WRL 13 Hour — High Plains Raceway"],
      [sess("imsa", "11_Historic Sportscar Racing", "Race", "Daytona International Speedway"), cur("Historic Sportscar Racing Race — Daytona International Speedway", "IMSA", "Daytona International Speedway"), "HSR — Daytona International Speedway"],
      [sess("sro", "07_IGTC Indianapolis 8 Hour", "Race", "Indianapolis Motor Speedway RC"), cur("IGTC Indianapolis 8 Hour Race — Indianapolis Motor Speedway RC", "SRO", "Indianapolis Motor Speedway RC"), "Indianapolis 8 Hour — Indianapolis Motor Speedway"],
      [sess("sro", "07_IGTC Indianapolis 8 Hour", "8 Hour Race", "Indianapolis Motor Speedway RC"), cur("IGTC Indianapolis 8 Hour 8 Hour Race — Indianapolis Motor Speedway RC", "SRO", "Indianapolis Motor Speedway RC"), "Indianapolis 8 Hour — Indianapolis Motor Speedway"],
      [sess("sro", "09_Skip Barber Racing Series", "Race 1", "Sebring International Raceway"), cur("Skip Barber Race 1 — Sebring International Raceway", "SRO", "Sebring International Raceway"), "Skip Barber Race 1 — Sebring International Raceway"],
      // A championship with no label keeps the site's folder name rather than losing it.
      [sess("sro", "12_Radical Cup North America", "Race 2", "Sebring International Raceway"), cur("Race 2 — Sebring International Raceway", "SRO", "Sebring International Raceway"), "Radical Cup North America Race 2 — Sebring International Raceway"],
    ];
    for (const [s, c, want] of cases) {
      const once = standardRaceName(s, c);
      expect(once).toBe(want);
      expect(standardRaceName(s, { ...c, name: once })).toBe(want);
    }
  });

  it("handles the odd names in the live list", () => {
    expect(standardRaceName(sess("imsa", "05_IMSA Airbnb Endurance Challenge", "Race", "Sebring International Raceway"), cur("IMSA Airbnb Endurance Challenge — Sebring International Raceway", "IMSA", "Sebring International Raceway"))).toBe(
      "Airbnb Endurance Challenge — Sebring International Raceway"
    );
    expect(standardRaceName(sess("redmist", "WRL", "Sunday 7 Hour", "Circut Of The Americas"), cur("Sunday 7-Hour", "WRL", "COTA"))).toBe("WRL Sunday 7 Hour — Circuit of the Americas");
    expect(standardRaceName(sess("speedhive", "WRL", "Barber - Sunday - 7 hour", "Barber Motorsports Park"), cur("Sunday 7 Hour", "WRL", "Barber Motorsports Park"))).toBe("WRL Sunday 7 Hour — Barber Motorsports Park");
    expect(standardRaceName(sess("redmist", "WRL", "Saturday 8", "Utah Motorsports Campus"), cur("Saturday 8 Hour", "WRL", "Utah Motorsports Campus"))).toBe("WRL Saturday 8 Hour — Utah Motorsports Campus");
    expect(standardRaceName(sess("imsa", "02_IMSA Michelin Pilot Challenge", "Race", "Mid-Ohio"), cur("IMSA MPC — O^RReilly Auto Parts 4 Hours Of Mid-Ohio", "IMSA", "Mid-Ohio"))).toBe("Pilot Challenge — O'Reilly Auto Parts 4 Hours Of Mid-Ohio");
    expect(standardRaceName(sess("imsa", "02_IMSA Michelin Pilot Challenge", "Race", "Mid-Ohio"), cur("IMSA MPC — O\u0092Reilly Auto Parts 4 Hours Of Mid-Ohio", "IMSA", "Mid-Ohio"))).toBe("Pilot Challenge — O'Reilly Auto Parts 4 Hours Of Mid-Ohio");
    expect(standardRaceName(sess("imsa", "02_IMSA Michelin Pilot Challenge", "Race", "VIR"), cur("Virgina is For Racing Lovers Grand Prix", "IMSA", "VIR"))).toBe("Pilot Challenge — Virginia is For Racing Lovers Grand Prix");
  });

  it("gives the same name when run again on its own output", () => {
    const cases: [SessionIdentity, ReturnType<typeof cur>][] = [
      [sess("sro", "48_TGRNA GR Cup North America", "Race 1", "Circuit of the Americas"), cur("GR Cup Race 1", "GR CUP", "COTA")],
      [sess("sro", "16_Pirelli GT4 America", "Race 1", "Sebring International Raceway"), cur("Pirelli GT4 Race 1 — Sebring International Raceway", "SRO", "Sebring International Raceway")],
      [sess("sro", "16_Pirelli GT4 America", "Road America Race 1 Make-Up", "Barber Motorsports Park"), cur("Pirelli GT4 — Barber Motorsports Park", "SRO", "Barber Motorsports Park")],
      [sess("imsa", "02_IMSA Michelin Pilot Challenge", "Race", "Road Atlanta"), cur("Fox Factory 120", "IMSA", "Road Atlanta")],
      [sess("imsa", "03_IMSA VP Racing SportsCar Challenge", "Race 1", "VIR"), cur("IMSA VPRC Race 1 — Michelin GT Challenge at VIR", "IMSA", "VIR")],
      [sess("imsa", "01_IMSA WeatherTech SportsCar Championship", "Race", "Indianapolis Motor Speedway RC"), cur("IMSA Race — Indianapolis Motor Speedway RC", "IMSA", "Indianapolis Motor Speedway RC")],
      [sess("redmist", "WRL", "Saturday - 8 Hour", "Road Atlanta"), cur("Saturday 8-Hour", "WRL", "Road Atlanta")],
      [sess("speedhive", "WRL", "Barber - Sunday - 7 hour", "Barber Motorsports Park"), cur("Sunday 7 Hour", "WRL", "Barber Motorsports Park")],
      [sess("imsa", "05_IMSA Airbnb Endurance Challenge", "Race", "Sebring International Raceway"), cur("IMSA Airbnb Endurance Challenge — Sebring International Raceway", "IMSA", "Sebring International Raceway")],
    ];
    for (const [s, c] of cases) {
      const once = standardRaceName(s, c);
      expect(standardRaceName(s, { ...c, name: once }), once).toBe(once);
    }
    expect(standardRaceName(cases[2][0], cases[2][1])).toBe("GT4 America Road America Race 1 Make-Up — Barber Motorsports Park");
  });

  it("puts right the names a non-repeatable first version produced", () => {
    expect(standardRaceName(sess("redmist", "WRL", "Saturday 8 Hour", "Road Atlanta"), cur("WRL Saturday 8 Hour — WRL Saturday 8 Hour", "WRL", "Road Atlanta"))).toBe("WRL Saturday 8 Hour — Michelin Raceway Road Atlanta");
    expect(standardRaceName(sess("sro", "16_Pirelli GT4 America", "Race 2", "Sonoma Raceway"), cur("GT4 America Race 2 — America Race 2", "SRO", "Sonoma Raceway"))).toBe("GT4 America Race 2 — Sonoma Raceway");
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
