/**
 * Comparing a class on a phone (mobile redesign): instead of a wide table or a card per row, one
 * number at a time, ranked, with a bar for where each sits in the class. The Driver Report, Pits
 * and Strategy (their rows drivers or cars) all use it; a row's tap can open its detail in a sheet.
 *
 *   [Avg lap] [Best] [Consistency] [Pace vs class] [Clean air] …   which number (swipe the list too)
 *   ┌ Your car ─────────────────────────────┐
 *   │  #60 Alana · Michele · Hannah        │  each metric as a percentile strip (Baseball Savant)
 *   └──────────────────────────────────────┘
 *   1  Alana Carter        #60 Stratus 60   1:32.069  ▓▓▓▓▓▓▓▓▓▓▓▓
 *   2  Driver 70           #70 …            1:32.201  ▓▓▓▓▓▓▓▓▓▓▓
 *   …
 *   Hold a row (or Compare) to pick 2–3, then "Compare 3" lays them side by side: the metrics down,
 *   the drivers across, the best of each row marked.
 *
 * Bars run from the class's worst (short) to its best (full), so "better" is always longer.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Sheet, SHEET } from "../../components/Sheet";
import { ChipRow, PC } from "./phone-cards";

export interface RankedMetric<R> {
  key: string;
  label: string;
  /** Which way is better. */
  better: "low" | "high";
  value: (r: R) => number | null;
  format: (v: number) => string;
  /** One line under the chips: what the number is. */
  note?: string;
}

export interface RankedItem<R> {
  id: string;
  row: R;
  /** "Alana Carter" */
  title: string;
  /** "#60 Stratus 60" */
  sub: string;
  /** Your car's: outlined in orange, and in the strips at the top. */
  mine: boolean;
  /** A small tag after the title ("IN CAR"). */
  tag?: ReactNode;
}

/** Each item's place in one metric: rank (1 = best), share of the way from worst to best (0–1), percentile (0–100). */
function standings<R>(items: RankedItem<R>[], m: RankedMetric<R>) {
  const valued = items.map((it) => ({ it, v: m.value(it.row) })).filter((x): x is { it: RankedItem<R>; v: number } => x.v !== null && Number.isFinite(x.v));
  valued.sort((a, b) => (m.better === "low" ? a.v - b.v : b.v - a.v));
  const best = valued[0]?.v;
  const worst = valued[valued.length - 1]?.v;
  const span = best !== undefined && worst !== undefined ? Math.abs(worst - best) : 0;
  const out = new Map<string, { rank: number; v: number; share: number; pct: number }>();
  // Equal values share a rank (two cars on 3 stops are both 1st), and so a percentile.
  let rankAt = 0;
  valued.forEach((x, i) => {
    if (i === 0 || x.v !== valued[i - 1].v) rankAt = i;
    const share = span > 0 ? 1 - Math.abs(x.v - best!) / span : 1;
    const pct = valued.length > 1 ? Math.round(100 * (1 - rankAt / (valued.length - 1))) : 100;
    out.set(x.it.id, { rank: rankAt + 1, v: x.v, share, pct });
  });
  return { order: valued.map((x) => x.it), place: out, count: valued.length };
}

/** Red for the class's tail, through grey, to RaceTrace orange at the front (percentile 0–100). */
function pctColor(p: number): string {
  if (p >= 67) return "#F48C34";
  if (p >= 34) return "#9a9ab4";
  return "#e66767";
}

/** Your car's drivers (or cars), each metric as a percentile strip: where they sit in the class. */
function PercentileCard<R>({ items, metrics, all }: { items: RankedItem<R>[]; metrics: RankedMetric<R>[]; all: RankedItem<R>[] }) {
  const [pick, setPick] = useState(0);
  const it = items[Math.min(pick, items.length - 1)];
  const places = useMemo(() => metrics.map((m) => ({ m, s: standings(all, m) })), [metrics, all]);
  if (!it) return null;
  return (
    <section aria-label={`${it.title} against the class`} className="rounded-xl border p-3" style={{ borderColor: PC.accent, background: PC.focusBg }} data-ranked="percentiles">
      <div className="flex items-center gap-2">
        <h3 className="m-0 min-w-0 flex-1 truncate text-[14px] font-semibold">
          {items.length > 1 ? "Your drivers" : it.title}
          <span className="ml-1.5 text-[12px] font-normal" style={{ color: PC.muted }}>
            percentile in class
          </span>
        </h3>
      </div>
      {items.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Your drivers">
          {items.map((x, i) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={i === pick}
              onClick={() => setPick(i)}
              data-touch-44
              className="relative h-8 rounded-full border px-3 text-[13px] font-semibold before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
              style={i === pick ? { borderColor: PC.accent, color: PC.text, background: "rgba(244,140,52,0.14)" } : { borderColor: PC.border, color: PC.muted }}
            >
              {x.title.split(/\s+/)[0]}
            </button>
          ))}
        </div>
      )}
      <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
        {places.map(({ m, s }) => {
          const p = s.place.get(it.id);
          return (
            <li key={m.key} className="grid grid-cols-[96px_1fr_64px] items-center gap-2 text-[13px]">
              <span className="truncate" style={{ color: PC.soft }}>
                {m.label}
              </span>
              <span className="relative h-2 rounded-full" style={{ background: PC.line }} aria-hidden>
                {p && <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(6, Math.min(94, p.pct))}%`, background: pctColor(p.pct), opacity: 0.35 }} />}
                {p && (
                  <span
                    className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ left: `${Math.max(6, Math.min(94, p.pct))}%`, background: pctColor(p.pct), color: "#0b0b18" }}
                  >
                    {p.pct}
                  </span>
                )}
              </span>
              <span className="text-right font-mono text-[12px]" style={{ color: PC.text }}>
                {p ? m.format(p.v) : "—"}
              </span>
              <span className="sr-only">{p ? `${m.label}: ${m.format(p.v)}, ${p.rank} of ${s.count}, percentile ${p.pct}` : `${m.label}: no value`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Two or three side by side: metrics down, them across, the best of each row in orange. */
function VersusSheet<R>({ open, onClose, items, metrics, all }: { open: boolean; onClose: () => void; items: RankedItem<R>[]; metrics: RankedMetric<R>[]; all: RankedItem<R>[] }) {
  const rows = useMemo(() => metrics.map((m) => ({ m, s: standings(all, m) })), [metrics, all]);
  return (
    <Sheet open={open} onClose={onClose} title={`Compare ${items.length}`}>
      <table className="w-full table-fixed border-collapse text-[13px]" data-ranked="versus">
        <thead>
          <tr>
            <th className="w-[30%] pb-2 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: SHEET.muted }} />
            {items.map((it) => (
              <th key={it.id} className="pb-2 text-left align-bottom">
                <span className="block truncate text-[13px] font-semibold" style={{ color: it.mine ? PC.accent : SHEET.text }}>
                  {it.title}
                </span>
                <span className="block truncate text-[11px] font-normal" style={{ color: SHEET.muted }}>
                  {it.sub}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ m, s }) => {
            const vals = items.map((it) => s.place.get(it.id));
            const bestRank = Math.min(...vals.map((v) => v?.rank ?? Infinity));
            return (
              <tr key={m.key} className="border-t" style={{ borderColor: SHEET.border }}>
                <td className="py-2.5 pr-2" style={{ color: SHEET.muted }}>
                  {m.label}
                </td>
                {vals.map((v, i) => (
                  <td key={items[i].id} className="py-2.5 font-mono" style={{ color: v && v.rank === bestRank ? PC.accent : SHEET.text, fontWeight: v && v.rank === bestRank ? 700 : 400 }}>
                    {v ? m.format(v.v) : "—"}
                    {v && <span className="block font-sans text-[11px] font-normal" style={{ color: SHEET.muted }}>{v.rank} of {s.count}</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Sheet>
  );
}

const TURN_KEY = "rt.rotateHinted";

/**
 * A phone with a turn arrow, beside the view's title: sideways shows the full table. On the first
 * visit it turns twice; a tap says what it means.
 */
function RotateHint() {
  const [animate] = useState(() => {
    try {
      if (localStorage.getItem(TURN_KEY) === "1") return false;
      localStorage.setItem(TURN_KEY, "1");
      return true;
    } catch {
      return false;
    }
  });
  const [say, setSay] = useState(false);
  useEffect(() => {
    if (!say) return;
    const t = setTimeout(() => setSay(false), 3000);
    return () => clearTimeout(t);
  }, [say]);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Turn the phone sideways for the full table"
        onClick={() => setSay((v) => !v)}
        data-ranked="rotate"
        className="-my-1.5 -mr-2 flex h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
        style={{ color: PC.muted }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {/* The phone, upright, turning to sideways; two arrows round it say "turn". */}
          <g className={animate ? "animate-phone-turn" : undefined} style={{ transformBox: "fill-box" }}>
            <rect x="8.25" y="5" width="7.5" height="14" rx="1.5" />
            <path d="M11 16.6h2" />
          </g>
          <path d="M15.2 2.6a9.6 9.6 0 0 1 6.2 6.2" />
          <path d="M21.6 6.2l-.2 2.6-2.5-.8" />
          <path d="M8.8 21.4a9.6 9.6 0 0 1-6.2-6.2" />
          <path d="M2.4 17.8l.2-2.6 2.5.8" />
        </svg>
      </button>
      {say && (
        <div role="status" className="absolute right-0 top-full z-20 mt-1 w-max max-w-[220px] rounded-lg px-3 py-2 text-[12px] shadow-lg" style={{ background: "rgba(18,18,42,0.96)", border: `1px solid ${SHEET.border}`, color: SHEET.text }}>
          Turn the phone sideways for the full table.
        </div>
      )}
    </div>
  );
}

/** The class buttons for a ranked view: slim, one row. */
export function ClassChips({ classes, value, onChange, colors }: { classes: string[]; value: string; onChange: (c: string) => void; colors: Record<string, string> }) {
  return <ChipRow slim label="Class" items={classes.map((c) => ({ key: c, label: c, color: colors[c] }))} value={value} onChange={onChange} />;
}

export function RankedMetrics<R>({
  items,
  metrics: allMetrics,
  title,
  subtitle,
  above,
  below,
  onOpen,
  detail,
}: {
  items: RankedItem<R>[];
  metrics: RankedMetric<R>[];
  title: string;
  subtitle?: string;
  /** Between the heading and the metric chips (the class chips). */
  above?: ReactNode;
  /** Under the list (the method note). */
  below?: ReactNode;
  /** A row's tap outside comparing (make its car the focus car). */
  onOpen?: (item: RankedItem<R>) => void;
  /** A row's tap outside comparing opens this in a sheet (a car's stops, its stints). */
  detail?: (item: RankedItem<R>, close: () => void) => { title: ReactNode; body: ReactNode };
}) {
  // Only the numbers the class has values for: a race without timed stops has no "Time lost".
  const metrics = useMemo(() => {
    const had = allMetrics.filter((m) => items.some((it) => m.value(it.row) !== null));
    return had.length ? had : allMetrics.slice(0, 1);
  }, [allMetrics, items]);
  const [metricKey, setMetricKey] = useState(metrics[0]?.key ?? "");
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const idx = metrics.indexOf(metric);
  const { order, place, count } = useMemo(() => standings(items, metric), [items, metric]);
  const missing = items.filter((it) => !place.has(it.id));
  const mine = items.filter((it) => it.mine);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = openId ? items.find((it) => it.id === openId) : undefined;
  const openDetail = opened && detail ? detail(opened, () => setOpenId(null)) : null;

  // Comparing: hold a row (or press Compare) to start, then tap to add or drop, up to three.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [versus, setVersus] = useState(false);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? [...p.slice(1), id] : [...p, id]));
  const hold = useRef<{ t: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);
  const startHold = (id: string) => {
    const h = { fired: false, t: setTimeout(() => {
      h.fired = true;
      setPicking(true);
      setPicked((p) => (p.includes(id) ? p : [...p, id].slice(-3)));
      navigator.vibrate?.(10);
    }, 450) };
    hold.current = h;
  };
  const endHold = () => hold.current && clearTimeout(hold.current.t);

  // A sideways swipe on the list moves to the next or previous number.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => (swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: TouchEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      const next = metrics[idx + (dx < 0 ? 1 : -1)];
      if (next) setMetricKey(next.key);
    }
  };

  const row = (it: RankedItem<R>) => {
    const p = place.get(it.id);
    const on = picked.includes(it.id);
    return (
      <li key={it.id}>
        <button
          type="button"
          data-ranked-row
          aria-pressed={picking ? on : undefined}
          onPointerDown={() => startHold(it.id)}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (hold.current?.fired) return;
            if (picking) toggle(it.id);
            else {
              onOpen?.(it);
              if (detail) setOpenId(it.id);
            }
          }}
          className="relative flex min-h-[52px] w-full items-center gap-2 overflow-hidden rounded-lg px-2 text-left"
          style={{ background: on ? "rgba(244,140,52,0.16)" : "transparent", outline: it.mine ? `1px solid ${PC.accent}` : undefined, outlineOffset: -1 }}
        >
          {/* The bar, behind the row: the class's best is full width. */}
          {p && (
            <span
              aria-hidden
              className="absolute inset-y-1.5 left-0 rounded-r-md"
              style={{ width: `${8 + p.share * 92}%`, background: it.mine ? "rgba(244,140,52,0.22)" : "rgba(122,162,255,0.12)" }}
            />
          )}
          {picking && (
            <span aria-hidden className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold" style={{ borderColor: on ? PC.accent : PC.border, background: on ? PC.accent : "transparent", color: "#0b0b18" }}>
              {on ? "✓" : ""}
            </span>
          )}
          <span className="relative w-6 shrink-0 text-right font-mono text-[13px]" style={{ color: PC.muted }}>
            {p?.rank ?? "–"}
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold" style={{ color: it.mine ? PC.accent : PC.text }}>
                {it.title}
              </span>
              {it.tag}
            </span>
            <span className="block truncate text-[12px]" style={{ color: PC.muted }}>
              {it.sub}
            </span>
          </span>
          <span className="relative shrink-0 font-mono text-[15px] font-bold">{p ? metric.format(p.v) : "—"}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="px-3 pb-24 pt-2.5" style={{ color: PC.text }} data-ranked="view">
      {/* The heading in two short lines, the turn-sideways symbol beside it. */}
      <div className="flex items-start gap-2" data-ranked="head">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[16px] font-semibold leading-tight">{title}</h2>
          {subtitle && (
            <p className="m-0 mt-0.5 truncate text-[12px]" style={{ color: PC.muted }}>
              {subtitle}
            </p>
          )}
        </div>
        <RotateHint />
      </div>
      {above && <div className="mt-2.5">{above}</div>}
      {mine.length > 0 && (
        <div className="mt-3">
          <PercentileCard items={mine} metrics={metrics} all={items} />
        </div>
      )}
      <div className="sticky top-0 z-10 -mx-3 mt-2 px-3 pb-1 pt-2" style={{ background: PC.bg }}>
        <ChipRow slim label="Rank by" items={metrics.map((m) => ({ key: m.key, label: m.label }))} value={metric.key} onChange={setMetricKey} />
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px]" style={{ color: PC.muted }}>
          <span className="min-w-0 truncate">
            {metric.note ?? (metric.better === "low" ? "Lowest first" : "Highest first")} · {count} ranked
          </span>
          <button
            type="button"
            onClick={() => {
              setPicking((p) => !p);
              setPicked([]);
            }}
            className="min-h-[44px] shrink-0 px-1 text-[13px] font-semibold"
            style={{ color: PC.accent }}
          >
            {picking ? "Cancel" : "Compare"}
          </button>
        </div>
      </div>
      {picking && (
        <p className="m-0 mb-1 text-[12px]" style={{ color: PC.muted }}>
          Tap up to three to compare them side by side.
        </p>
      )}
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-label={`Ranked by ${metric.label}`}>
        {order.map(row)}
        {missing.map(row)}
      </ol>
      {below && <div className="mt-3">{below}</div>}

      {picking && picked.length >= 2 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pt-2" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", background: "linear-gradient(transparent, #0b0b18 30%)" }}>
          <button
            type="button"
            onClick={() => setVersus(true)}
            data-ranked="compare"
            className="flex min-h-[48px] w-full items-center justify-center rounded-xl text-[15px] font-bold shadow-lg"
            style={{ background: PC.accent, color: "#0b0b18" }}
          >
            Compare {picked.length} side by side
          </button>
        </div>
      )}
      {detail && (
        <Sheet open={!!openDetail} onClose={() => setOpenId(null)} title={openDetail?.title ?? ""}>
          <div data-ranked="detail">{openDetail?.body}</div>
        </Sheet>
      )}
      <VersusSheet open={versus} onClose={() => setVersus(false)} items={picked.map((id) => items.find((it) => it.id === id)!).filter(Boolean)} metrics={metrics} all={items} />
    </div>
  );
}
