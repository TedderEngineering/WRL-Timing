/**
 * Recorded-fixture HTTP for intake tests: no network. Routes are keyed by a
 * normalised URL (decoded path, decoded and sorted query), so a test can
 * write "https://host/Results/26_2026/21_Road Atlanta/" for a request the
 * client sent percent-encoded.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpClient, type HttpClient } from "../http.js";

export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
export const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf-8");

export type Route = string | Buffer | { status: number; body?: string | Buffer; headers?: Record<string, string> };

export function normUrl(u: string): string {
  const url = new URL(u);
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep */
  }
  const q = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
  return `${url.origin}${path}${q.length ? `?${q.join("&")}` : ""}`;
}

export interface FakeHttp extends HttpClient {
  calls: { url: string; headers: Record<string, string> }[];
  routes: Map<string, Route | ((headers: Record<string, string>) => Route)>;
}

export function fakeHttp(routes: Record<string, Route | ((headers: Record<string, string>) => Route)>): FakeHttp {
  const map = new Map(Object.entries(routes).map(([k, v]) => [normUrl(k), v]));
  const calls: FakeHttp["calls"] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url, headers });
    let r = map.get(normUrl(url));
    if (typeof r === "function") r = r(headers);
    if (r === undefined) return new Response("Not Found", { status: 404 });
    if (typeof r === "string" || Buffer.isBuffer(r)) return new Response(r, { status: 200 });
    return new Response(r.status === 304 ? null : (r.body ?? ""), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  const client = createHttpClient({ fetchImpl, delayMs: 0, backoffMs: 1, sleep: async () => undefined });
  return Object.assign(client, { calls, routes: map });
}
