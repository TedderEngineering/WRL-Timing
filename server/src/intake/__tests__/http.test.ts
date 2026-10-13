import { describe, it, expect } from "vitest";
import { createHttpClient, DEFAULT_USER_AGENT, encodePath, safeDecode } from "../http.js";

function scripted(statuses: (number | Error)[]) {
  const seen: { url: string; ua: string }[] = [];
  let i = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    seen.push({ url: String(url), ua: (init?.headers as Record<string, string>)["User-Agent"] });
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    const s = statuses[Math.min(i++, statuses.length - 1)];
    if (s instanceof Error) throw s;
    return new Response(`body ${s}`, { status: s });
  }) as typeof fetch;
  return { fetchImpl, seen, max: () => maxInFlight };
}

describe("polite HTTP client", () => {
  it("retries 503 and network errors with exponential backoff, then succeeds", async () => {
    const f = scripted([503, new Error("ECONNRESET"), 200]);
    const sleeps: number[] = [];
    const http = createHttpClient({ fetchImpl: f.fetchImpl, delayMs: 0, backoffMs: 100, sleep: async (ms) => void sleeps.push(ms) });
    const r = await http.get("https://x/a");
    expect(r.status).toBe(200);
    expect(f.seen).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("does not retry 404 or 403", async () => {
    for (const code of [404, 403]) {
      const f = scripted([code, 200]);
      const http = createHttpClient({ fetchImpl: f.fetchImpl, delayMs: 0, sleep: async () => undefined });
      expect((await http.get("https://x/a")).status).toBe(code);
      expect(f.seen).toHaveLength(1);
    }
  });

  it("gives up after the last attempt with a clear error", async () => {
    const f = scripted([new Error("offline")]);
    const http = createHttpClient({ fetchImpl: f.fetchImpl, attempts: 2, delayMs: 0, sleep: async () => undefined });
    await expect(http.get("https://x/a")).rejects.toThrow(/Network error after 2 attempts.*offline/);
  });

  it("sends one request at a time with the RaceTrace User-Agent", async () => {
    const f = scripted([200]);
    const http = createHttpClient({ fetchImpl: f.fetchImpl, delayMs: 1 });
    await Promise.all(["a", "b", "c", "d"].map((p) => http.get(`https://x/${p}`)));
    expect(f.max()).toBe(1);
    expect(f.seen.map((s) => s.url)).toEqual(["https://x/a", "https://x/b", "https://x/c", "https://x/d"]);
    expect(f.seen.every((s) => s.ua === DEFAULT_USER_AGENT)).toBe(true);
  });

  it("getJson returns null on 404 and throws on 500", async () => {
    const http404 = createHttpClient({ fetchImpl: scripted([404]).fetchImpl, delayMs: 0 });
    expect(await http404.getJson("https://x/a")).toBeNull();
    const http500 = createHttpClient({ fetchImpl: scripted([500]).fetchImpl, delayMs: 0, attempts: 1 });
    await expect(http500.getJson("https://x/a")).rejects.toThrow(/HTTP 500/);
  });

  it("encodes path segments and decodes safely", () => {
    expect(encodePath("Results/26_2026/21_Road Atlanta/a#b.CSV")).toBe("Results/26_2026/21_Road%20Atlanta/a%23b.CSV");
    expect(safeDecode("100%25 %zz %20x")).toBe("100% %zz  x");
  });
});
