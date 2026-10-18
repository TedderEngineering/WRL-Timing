import { describe, expect, it, vi } from "vitest";

vi.mock("../poller.js", () => ({ listRecentSessions: async () => [] }));

import { SETTLE_MS, dispatchImport, dispatchInputs, dueRaces, startAfterRaceImport } from "../after-race.js";

const ref = (o: Partial<Record<string, unknown>> = {}) =>
  ({
    slug: "sebring-international-raceway-2026-sunday-7-hour",
    eventId: 485,
    sessionId: 20,
    eventName: "Sebring International Raceway 2026",
    sessionName: "Sunday 7 Hour",
    track: "Sebring International Raceway",
    startedAt: "2026-10-18T12:00:00Z",
    endedAt: "2026-10-18T19:00:00Z",
    kind: "race",
    ...o,
  }) as any;

describe("after a WRL race: start the intake import", () => {
  it("imports that one session, from the day before its start", () => {
    expect(dispatchInputs(ref())).toEqual({ mode: "import", series: "wrl", season: "2026", since: "2026-10-17", redmist: "485/20" });
  });

  it("starts a race once, 20 min after its end; never practice or qualifying", () => {
    const end = Date.parse("2026-10-18T19:00:00Z");
    const started = new Set<string>();
    expect(dueRaces([ref()], started, end + SETTLE_MS - 1000)).toHaveLength(0);
    expect(dueRaces([ref()], started, end + SETTLE_MS)).toHaveLength(1);
    expect(dueRaces([ref({ kind: "qualify" }), ref({ kind: "practice" })], started, end + SETTLE_MS)).toHaveLength(0);
    started.add("485/20");
    expect(dueRaces([ref()], started, end + SETTLE_MS)).toHaveLength(0);
  });

  it("calls the workflow dispatch endpoint on main with the inputs", async () => {
    const calls: { url: string; init: any }[] = [];
    const fake = async (url: string, init: any) => (calls.push({ url, init }), { status: 204, text: async () => "" });
    expect(await dispatchImport(dispatchInputs(ref()), "tok", "Owner/Repo", fake)).toBe(true);
    expect(calls[0].url).toBe("https://api.github.com/repos/Owner/Repo/actions/workflows/intake.yml/dispatches");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body)).toEqual({ ref: "main", inputs: dispatchInputs(ref()) });
    const bad = async () => ({ status: 403, text: async () => "nope" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await dispatchImport(dispatchInputs(ref()), "tok", "Owner/Repo", bad)).toBe(false);
    warn.mockRestore();
  });

  it("is off without a token, or with AFTER_RACE_IMPORT=0", () => {
    expect(startAfterRaceImport({} as any)).toBe(false);
    expect(startAfterRaceImport({ GITHUB_DISPATCH_TOKEN: "x", AFTER_RACE_IMPORT: "0" } as any)).toBe(false);
  });
});
