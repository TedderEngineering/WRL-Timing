/**
 * Render package prose ({text, refs}) for display (RaceTrace 2.0).
 *
 * '{n}' is refs[n]; '{car:68}', '{class:Pro-Am}' and '{driver:68:2}' are
 * entity tokens. Numbers are shown exactly as the package states them:
 * seconds use the ref's `display` ([h:]m:ss.sss, no rounding), positions
 * read 'P3'. Nothing here computes a number.
 */
import type { ReactNode } from "react";

export interface ProseRef {
  value: number | string;
  factId: string;
  field: string;
  unit?: string;
  display?: string;
  transform?: "abs" | "neg";
}

export interface Prose {
  text: string;
  refs: ProseRef[];
}

export interface ProseContext {
  cars?: Record<string, { team?: string; drivers?: string[]; driverNumbers?: number[] }>;
  classes?: Record<string, string>;
}

const TOKEN = /\{(?:(\d+)|car:([0-9A-Za-z]{1,8})|class:([A-Za-z0-9][A-Za-z0-9+_-]{0,31})|driver:([0-9A-Za-z]{1,8}):(\d+))\}/g;

/** [h:]m:ss.sss to 3 decimals, never rounded beyond the millisecond. */
export function formatDuration(v: number): string {
  const sign = v < 0 ? "-" : "";
  const ms = Math.round(Math.abs(v) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return h ? `${sign}${h}:${String(m).padStart(2, "0")}:${s}` : `${sign}${m}:${s}`;
}

export function formatRef(ref: ProseRef): string {
  if (ref.display) return ref.display;
  let v = ref.value;
  if (typeof v === "number" && ref.transform === "abs") v = Math.abs(v);
  if (typeof v === "number" && ref.transform === "neg") v = -v;
  if (typeof v === "string") return v;
  if (ref.unit === "s") return formatDuration(v);
  if (ref.unit === "pos") return `P${v}`;
  return String(v);
}

export function driverName(ctx: ProseContext, car: string, n: number): string {
  const c = ctx.cars?.[car];
  if (!c?.drivers) return `#${car} driver`;
  const i = c.driverNumbers ? c.driverNumbers.indexOf(n) : n - 1;
  return c.drivers[i] ?? `#${car} driver`;
}

/** Plain-text rendering (titles, aria labels, tests). */
export function proseToText(p: Prose, ctx: ProseContext = {}): string {
  return p.text.replace(TOKEN, (_m, n, car, cls, dcar, dn) => {
    if (n !== undefined) return p.refs[Number(n)] ? formatRef(p.refs[Number(n)]) : "";
    if (car !== undefined) return `#${car}`;
    if (cls !== undefined) return ctx.classes?.[cls] ?? cls;
    return driverName(ctx, dcar, Number(dn));
  });
}

/** React rendering: numbers and car numbers in tabular mono so columns of figures line up. */
export function ProseText({ prose, ctx = {}, carClassName = "font-semibold" }: { prose: Prose; ctx?: ProseContext; carClassName?: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of prose.text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(prose.text.slice(last, at));
    const [, n, car, cls, dcar, dn] = m;
    if (n !== undefined) {
      const ref = prose.refs[Number(n)];
      out.push(
        <span key={k++} className="font-mono tabular-nums">
          {ref ? formatRef(ref) : ""}
        </span>
      );
    } else if (car !== undefined) {
      out.push(
        <span key={k++} className={`font-mono tabular-nums ${carClassName}`}>
          #{car}
        </span>
      );
    } else if (cls !== undefined) {
      out.push(ctx.classes?.[cls] ?? cls);
    } else {
      out.push(driverName(ctx, dcar, Number(dn)));
    }
    last = at + m[0].length;
  }
  if (last < prose.text.length) out.push(prose.text.slice(last));
  return <>{out}</>;
}
