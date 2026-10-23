import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublic } from "../useLiveChartData";

type W = { __rtEarly?: Record<string, { at: number; p: Promise<unknown> }> };

describe("a live page's first requests, started before the app loaded", () => {
  const g = globalThis as unknown as { window?: W; fetch: typeof fetch };
  const realFetch = g.fetch;
  afterEach(() => {
    g.fetch = realFetch;
    delete g.window;
  });

  it("takes over the head index.html already asked for while it is fresh, and asks itself after that", async () => {
    const early = { at: Date.now(), doneAt: undefined as number | undefined, p: Promise.resolve({ ok: true, body: { v: 3 }, age: 2 }) };
    g.window = { __rtEarly: { "/live/replay-x/head": early } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ v: 4 }), { status: 200 }));
    g.fetch = fetchMock as unknown as typeof fetch;
    // Both of the app's first asks share it.
    expect(await getPublic<{ v: number }>("/live/replay-x/head")).toEqual({ body: { v: 3 }, edgeAgeMs: 2000 });
    expect((await getPublic<{ v: number }>("/live/replay-x/head")).body.v).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
    // Answered over 2 s ago: the next poll asks the server.
    early.doneAt = Date.now() - 3_000;
    expect((await getPublic<{ v: number }>("/live/replay-x/head")).body.v).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks itself when the early request failed or is stale", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ v: 5 }), { status: 200 }));
    g.fetch = fetchMock as unknown as typeof fetch;
    g.window = { __rtEarly: { "/live/replay-x/head": { at: Date.now(), p: Promise.resolve({ ok: false }) } } };
    expect((await getPublic<{ v: number }>("/live/replay-x/head")).body.v).toBe(5);
    g.window = { __rtEarly: { "/live/replay-x/head": { at: Date.now() - 60_000, p: Promise.resolve({ ok: true, body: { v: 1 } }) } } };
    expect((await getPublic<{ v: number }>("/live/replay-x/head")).body.v).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
