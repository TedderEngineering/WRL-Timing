/**
 * Polite HTTP for the intake: one request at a time, a fixed gap between
 * requests, an honest User-Agent, and retry with exponential backoff on
 * network errors, 429 and 5xx. 403 and 404 are answers, not failures, and are
 * returned without retrying.
 *
 * `fetchImpl` and `sleep` are injectable so tests never touch the network.
 */

export const DEFAULT_USER_AGENT =
  "RaceTrace-Intake/1.0 (+https://racetrace.tedderengineering.com; race analysis, polite crawler)";

export interface HttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

export interface HttpGetOptions {
  headers?: Record<string, string>;
}

export interface HttpClient {
  get(url: string, opts?: HttpGetOptions): Promise<HttpResponse>;
  /** GET and decode as UTF-8; throws on any non-2xx status. */
  getText(url: string, opts?: HttpGetOptions): Promise<string>;
  /** GET JSON; returns null on 404, throws on other non-2xx statuses. */
  getJson<T = unknown>(url: string, opts?: HttpGetOptions): Promise<T | null>;
}

export interface HttpOptions {
  fetchImpl?: typeof fetch;
  /** Minimum gap between the end of one request and the start of the next (ms). */
  delayMs?: number;
  /** Attempts per request (default 4: one try and three retries). */
  attempts?: number;
  /** First backoff (ms); doubles each retry. */
  backoffMs?: number;
  userAgent?: string;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    message?: string
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function createHttpClient(opts: HttpOptions = {}): HttpClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const delayMs = opts.delayMs ?? 500;
  const attempts = Math.max(1, opts.attempts ?? 4);
  const backoffMs = opts.backoffMs ?? 1000;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const sleep = opts.sleep ?? defaultSleep;

  // Sequential queue: every request waits for the previous one to finish.
  let chain: Promise<unknown> = Promise.resolve();
  let lastEnd = 0;

  async function once(url: string, o: HttpGetOptions): Promise<HttpResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": userAgent, Accept: "*/*", ...(o.headers ?? {}) },
        signal: ctrl.signal,
        redirect: "follow",
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const body = Buffer.from(await res.arrayBuffer());
      return { status: res.status, url, headers, body };
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(url: string, o: HttpGetOptions): Promise<HttpResponse> {
    let lastErr: unknown = null;
    for (let i = 0; i < attempts; i++) {
      const wait = lastEnd + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        const res = await once(url, o);
        lastEnd = Date.now();
        if (!retryable(res.status) || i === attempts - 1) return res;
        const ra = Number(res.headers["retry-after"]);
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 120_000) : backoffMs * 2 ** i);
      } catch (e) {
        lastEnd = Date.now();
        lastErr = e;
        if (i === attempts - 1) break;
        await sleep(backoffMs * 2 ** i);
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new HttpError(0, url, `Network error after ${attempts} attempts for ${url}: ${msg}`);
  }

  function get(url: string, o: HttpGetOptions = {}): Promise<HttpResponse> {
    const p = chain.then(() => run(url, o));
    chain = p.catch(() => undefined);
    return p;
  }

  return {
    get,
    async getText(url, o) {
      const res = await get(url, o);
      if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, url);
      return res.body.toString("utf-8");
    },
    async getJson<T>(url: string, o?: HttpGetOptions) {
      const res = await get(url, { ...(o ?? {}), headers: { Accept: "application/json", ...(o?.headers ?? {}) } });
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, url);
      return JSON.parse(res.body.toString("utf-8")) as T;
    },
  };
}

/** Encode each path segment of a site-relative path ("Results/26_2026/02_X/…"). */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/** decodeURIComponent that leaves malformed escapes as they are. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/%([0-9A-Fa-f]{2})/g, (m, h) => {
      try {
        return decodeURIComponent(`%${h}`);
      } catch {
        return m;
      }
    });
  }
}

/** Minimal HTML entity decoding for names in index pages. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}
