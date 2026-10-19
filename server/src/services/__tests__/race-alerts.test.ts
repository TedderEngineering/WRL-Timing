import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { race: null as Row | null, cars: [] as Row[], drivers: [] as Row[], sends: [] as Row[], prefs: new Map<string, boolean>(), mail: [] as Row[] };
  const prisma: Row = {
    race: { findUnique: async () => state.race },
    userCar: {
      findMany: async () =>
        state.cars
          .filter((c) => state.prefs.get(c.userId) === true && c.alerts !== false)
          .map((c) => ({ ...c, user: { email: `${c.userId}@example.com` } })),
    },
    userDriver: {
      findMany: async () =>
        state.drivers
          .filter((d) => state.prefs.get(d.userId) === true && d.alerts !== false)
          .map((d) => ({ ...d, user: { email: `${d.userId}@example.com` } })),
    },
    raceAlertSend: {
      findMany: async ({ where }: Row) => state.sends.filter((s) => s.raceId === where.raceId),
      create: async ({ data }: Row) => {
        if (state.sends.some((s) => s.userId === data.userId && s.raceId === data.raceId)) throw Object.assign(new Error("unique"), { code: "P2002" });
        state.sends.push({ officialCheckedAt: null, ...data });
        return data;
      },
      updateMany: async ({ where, data }: Row) => {
        const rows = state.sends.filter(
          (s) => s.userId === where.userId && s.raceId === where.raceId && (!("officialCheckedAt" in where) || s.officialCheckedAt === where.officialCheckedAt)
        );
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    userPreferences: {
      upsert: async ({ where, create, update }: Row) => void state.prefs.set(where.userId, (update ?? create).raceAlerts),
      findUnique: async ({ where }: Row) => (state.prefs.has(where.userId) ? { raceAlerts: state.prefs.get(where.userId) } : null),
    },
  };
  return { state, prisma };
});
vi.mock("../../models/prisma.js", () => ({ prisma: fake.prisma }));
vi.mock("../email.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendRaceAlertEmail: async (m: Record<string, unknown>) => void fake.state.mail.push(m),
}));

import { alertSubject, factChanges, readUnsubscribeToken, sendRaceAlerts, setRaceAlerts, unsubscribeToken } from "../race-alerts.js";

const lap = (l: number, p: number, cp: number, pit = 0) => ({ l, p, cp, ltSec: 100, pit, flag: "GF", lt: "" });
const NOW = Date.UTC(2026, 9, 12);

beforeEach(() => {
  const s = fake.state;
  s.sends = [];
  s.mail = [];
  s.prefs = new Map([["u1", true], ["u2", false]]);
  s.drivers = [];
  s.cars = [
    { id: "c1", userId: "u1", number: "67", series: "imsa", teamName: null, season: null },
    { id: "c1b", userId: "u1", number: "8", series: "imsa", teamName: null, season: null },
    { id: "c2", userId: "u2", number: "67", series: "imsa", teamName: null, season: null },
  ];
  s.race = {
    id: "vir", name: "Pilot Challenge — Michelin GT Challenge at VIR", date: new Date(Date.UTC(2026, 9, 10)), track: "VIRginia International Raceway",
    series: "IMSA", subSeries: "Pilot Challenge", season: 2026, status: "PUBLISHED", resultsStatus: "official",
    entries: [
      { carNumber: "67", teamName: "Blackdog Racing", driverNames: "Lucas Weisenberg; Harrison Goodman" },
      { carNumber: "8", teamName: "X", driverNames: "Alex Rivera; Jamie Cole" },
    ],
    annotationData: { "67": { settles: [{ l: 4, p: 2, su: "Was P1 · Lost 1" }] } },
    chartData: {
      maxLap: 5, classCarCounts: { GS: 2 },
      cars: {
        "67": { num: 67, team: "Blackdog Racing", cls: "GS", finishPos: 2, finishPosClass: 2, laps: [lap(1, 1, 1), lap(2, 1, 1), lap(3, 2, 2, 1), lap(4, 2, 2), lap(5, 2, 2)] },
        "8": { num: 8, team: "X", cls: "GS", finishPos: 1, finishPosClass: 1, laps: [lap(1, 2, 2), lap(2, 2, 2), lap(3, 1, 1), lap(4, 1, 1), lap(5, 1, 1)] },
      },
    },
  };
});

describe("race-ready emails", () => {
  it("go once per race per opted-in follower, with a factual subject and one-click unsubscribe", async () => {
    const r = await sendRaceAlerts("vir", NOW);
    expect(r.sent).toBe(1); // u1 follows two cars in the race but gets one email; u2 has them off
    const m = fake.state.mail[0];
    expect(m.to).toBe("u1@example.com");
    expect(m.subject).toBe("#67 at VIRginia International Raceway: P2 in GS, lost 1 place in pit cycle 1");
    expect(m.unsubscribeUrl).toMatch(/\/api\/alerts\/unsubscribe\?t=/);
    expect(m.html).toContain("from=alert");
    // Laid out like the dashboard's car card: the car and its drivers, the result, the car's race, the cycles.
    expect(m.html).toContain("Blackdog Racing");
    expect(m.html).toContain("Lucas Weisenberg and Harrison Goodman");
    expect(m.html).toContain("Finished P2 in GS of 2 · P2 overall · 5 of 5 laps");
    expect(m.html).toMatch(/#67(&#39;|&#x27;|')s race/);
    expect(m.html).toContain("Pit cycles in GS");
    expect(m.html).toContain("1 · lap 3");
    expect(m.html).toContain("P1 → P2");
    expect(m.html).toContain("Lost 1");
    expect(m.html).not.toContain("Pit loss");
    // What went right, ranked: the class result first.
    expect(m.html).toContain("✓");
    expect(m.html).toContain("P2 in GS, P2 overall");
    expect(m.html).toContain("&car=67");
    // A second trigger (results turning official) repeats nothing.
    expect((await sendRaceAlerts("vir", NOW)).sent).toBe(0);
    expect(fake.state.mail).toHaveLength(1);
  });

  it("skip a car whose race emails are switched off, and use the user's other car", async () => {
    fake.state.cars[0].alerts = false; // u1's #67
    const r = await sendRaceAlerts("vir", NOW);
    expect(r.sent).toBe(1);
    expect(fake.state.mail[0].subject).toMatch(/^#8 at /);
    fake.state.sends = [];
    fake.state.mail = [];
    fake.state.cars[1].alerts = false; // and #8
    expect((await sendRaceAlerts("vir", NOW)).sent).toBe(0);
  });

  it("send nothing for a draft or an old race", async () => {
    fake.state.race!.status = "DRAFT";
    expect((await sendRaceAlerts("vir", NOW)).skipped).toBe("not published");
    fake.state.race!.status = "PUBLISHED";
    expect((await sendRaceAlerts("vir", NOW + 30 * 86_400_000)).skipped).toBe("not recent");
    expect(fake.state.mail).toEqual([]);
  });

  it("mark provisional results and state a gain", () => {
    const f: any = { number: "7", cls: "GTD", finishClass: 3, finishOverall: 9, status: null, pitCycles: [{ cycle: 2, net: 3 }, { cycle: 1, net: -1 }] };
    expect(alertSubject(f, "Road America", "provisional")).toBe("#7 at Road America: P3 in GTD, gained 3 places in pit cycle 2 (provisional)");
    expect(alertSubject({ ...f, finishClass: null, status: "dnf", pitCycles: [] }, "Road America", "official")).toBe("#7 at Road America: did not finish");
  });
});

describe("a second email when official results change the car's result", () => {
  const provisional = () => {
    fake.state.race!.resultsStatus = "provisional";
  };
  const official = () => {
    fake.state.race!.resultsStatus = "official";
  };

  it("follows only when the car's finish or pit cycles changed, once, listing the change", async () => {
    provisional();
    await sendRaceAlerts("vir", NOW);
    expect(fake.state.mail[0].subject).toMatch(/\(provisional\)$/);
    expect(fake.state.sends[0]).toMatchObject({ resultsStatus: "provisional", facts: { finishClass: 2, cls: "GS" } });

    // Official: #67 is now classified P1 (the other car penalised behind it).
    official();
    fake.state.race!.chartData.cars["67"].finishPosClass = 1;
    fake.state.race!.chartData.cars["8"].finishPosClass = 2;
    const r = await sendRaceAlerts("vir", NOW + 2 * 86_400_000);
    expect(r.sent).toBe(1);
    const m = fake.state.mail[1];
    expect(m.subject).toMatch(/^Official: #67 at VIRginia International Raceway: P1 in GS/);
    expect(m.html).toContain("Changed since the provisional results");
    expect(m.html).toContain("Finish: P2 in GS → P1 in GS");
    expect(fake.state.sends[0].officialSentAt).toBeInstanceOf(Date);

    // Never a third.
    expect((await sendRaceAlerts("vir", NOW + 3 * 86_400_000)).sent).toBe(0);
  });

  it("sends nothing when the official results change nothing for the car", async () => {
    provisional();
    await sendRaceAlerts("vir", NOW);
    official();
    expect((await sendRaceAlerts("vir", NOW + 86_400_000)).sent).toBe(0);
    expect(fake.state.mail).toHaveLength(1);
    expect(fake.state.sends[0].officialCheckedAt).toBeInstanceOf(Date);
  });

  it("sends no follow-up when the first email was already official, or kept no facts", async () => {
    await sendRaceAlerts("vir", NOW); // official from the start
    fake.state.race!.chartData.cars["67"].finishPosClass = 1;
    expect((await sendRaceAlerts("vir", NOW + 86_400_000)).sent).toBe(0);

    fake.state.sends = [{ userId: "u1", raceId: "vir", carId: "c1", resultsStatus: null, facts: null, officialCheckedAt: null }];
    expect((await sendRaceAlerts("vir", NOW + 86_400_000)).sent).toBe(0);
  });

  it("go to a user who follows a driver, naming the driver, and once when they also follow the car", async () => {
    fake.state.prefs.set("u3", true);
    fake.state.drivers = [
      { id: "d3", userId: "u3", name: "RIVERA Alex" },
      { id: "d1", userId: "u1", name: "Alex Rivera" },
    ];
    const r = await sendRaceAlerts("vir", NOW);
    expect(r.sent).toBe(2);
    const m = fake.state.mail.find((x) => x.to === "u3@example.com")!;
    expect(m.subject).toBe("RIVERA Alex in #8 at VIRginia International Raceway: P1 in GS");
    expect(m.html).toContain("your driver's race is up");
    expect(m.html).toContain("/settings/drivers");
    // u1 follows #67 and Alex Rivera (#8): one email, about the car.
    expect(fake.state.mail.filter((x) => x.to === "u1@example.com").map((x) => x.subject)).toEqual([
      "#67 at VIRginia International Raceway: P2 in GS, lost 1 place in pit cycle 1",
    ]);
    expect(fake.state.sends.find((x) => x.userId === "u3")).toMatchObject({ carId: null, facts: { carNumber: "8" } });
  });

  it("words pit-cycle and status changes as facts", () => {
    const base = { cls: "GS", finishClass: 4, finishOverall: 10, status: null, pitCycles: [{ cycle: 1, net: -2 }] };
    expect(factChanges(base, { ...base, pitCycles: [{ cycle: 1, net: 1 }] })).toEqual(["Pit cycle 1: lost 2 → gained 1"]);
    expect(factChanges(base, { ...base, finishClass: null, status: "dsq" })).toEqual(["Finish: P4 in GS → disqualified"]);
    expect(factChanges(base, { ...base, finishOverall: 11 })).toEqual(["Overall: P10 → P11"]);
    expect(factChanges(base, base)).toEqual([]);
  });
});

describe("unsubscribe links", () => {
  it("are signed for one user and turn only that user's emails off", async () => {
    const t = unsubscribeToken("u1");
    expect(readUnsubscribeToken(t)).toBe("u1");
    expect(readUnsubscribeToken(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(readUnsubscribeToken(`${Buffer.from("u2").toString("base64url")}.${t.split(".")[1]}`)).toBeNull();
    expect(readUnsubscribeToken("junk")).toBeNull();
    await setRaceAlerts("u1", false);
    expect(fake.state.prefs.get("u1")).toBe(false);
  });
});
