import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { race: null as Row | null, cars: [] as Row[], sends: [] as Row[], prefs: new Map<string, boolean>(), mail: [] as Row[] };
  const prisma: Row = {
    race: { findUnique: async () => state.race },
    userCar: {
      findMany: async () =>
        state.cars.filter((c) => state.prefs.get(c.userId) === true).map((c) => ({ ...c, user: { email: `${c.userId}@example.com` } })),
    },
    raceAlertSend: {
      findMany: async ({ where }: Row) => state.sends.filter((s) => s.raceId === where.raceId),
      create: async ({ data }: Row) => {
        if (state.sends.some((s) => s.userId === data.userId && s.raceId === data.raceId)) throw Object.assign(new Error("unique"), { code: "P2002" });
        state.sends.push(data);
        return data;
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

import { alertSubject, readUnsubscribeToken, sendRaceAlerts, setRaceAlerts, unsubscribeToken } from "../race-alerts.js";

const lap = (l: number, p: number, cp: number, pit = 0) => ({ l, p, cp, ltSec: 100, pit, flag: "GF", lt: "" });
const NOW = Date.UTC(2026, 9, 12);

beforeEach(() => {
  const s = fake.state;
  s.sends = [];
  s.mail = [];
  s.prefs = new Map([["u1", true], ["u2", false]]);
  s.cars = [
    { id: "c1", userId: "u1", number: "67", series: "imsa", teamName: null, season: null },
    { id: "c1b", userId: "u1", number: "8", series: "imsa", teamName: null, season: null },
    { id: "c2", userId: "u2", number: "67", series: "imsa", teamName: null, season: null },
  ];
  s.race = {
    id: "vir", name: "Pilot Challenge — Michelin GT Challenge at VIR", date: new Date(Date.UTC(2026, 9, 10)), track: "VIRginia International Raceway",
    series: "IMSA", subSeries: "Pilot Challenge", season: 2026, status: "PUBLISHED", resultsStatus: "official",
    entries: [{ carNumber: "67", teamName: "Blackdog Racing" }, { carNumber: "8", teamName: "X" }],
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
    // A second trigger (results turning official) repeats nothing.
    expect((await sendRaceAlerts("vir", NOW)).sent).toBe(0);
    expect(fake.state.mail).toHaveLength(1);
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
