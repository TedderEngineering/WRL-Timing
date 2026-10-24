/**
 * Home on a phone (mobile redesign, step 6): your car's latest race on one screen. The result
 * first (peak-end), one tap to its story (Fogg: ability), and, when you follow more than one car,
 * a swipe (or the dots, or the car's name) to the next one.
 *
 *   WRL · Saturday 8 Hour · Feb 21                    Official
 *   #60 Stratus 60 · GTU
 *   Finished P1 in GTU of 10 · P1 overall           (or the story's headline)
 *   Pit cycles: gained 3 places over 4 cycles · 12 stops
 *   ✓ Fastest lap in GTU, 1:31.540 on lap 210
 *   [ Read the story ]                               (filled, full width)
 *   [ Position Trace ] [ Pit stops ]
 *   More about this race ›                           (the laptop card, below)
 *   ● ○                                              (one dot per car)
 *
 * The full car card (stints, every pit cycle, the car's other races) opens under "More about
 * this race", so nothing the laptop shows is lost.
 */
import { useRef, useState, type TouchEvent } from "react";
import { Link } from "react-router-dom";
import { SeriesBadge } from "../../components/SeriesBadge";
import { ProseText, type ProseContext } from "../../lib/prose";
import { track } from "../../lib/analytics";
import { StatusPill } from "./RecapCard";
import { formatDayRange } from "./format";
import { MyCarCard, carStops, finishLine, type MyCarResponse } from "./MyCarCard";
import { carTabLabel } from "./CarTabs";

const chartHref = (id: string, car?: string, tab?: string) =>
  `/chart?race=${id}${car ? `&car=${encodeURIComponent(car)}` : ""}${tab ? `&tab=${tab}` : ""}`;

/** "gained 3 places over 4 cycles", "held its place over 2 cycles". */
function cyclesLine(cycles: { net: number }[]): string {
  const net = cycles.reduce((n, c) => n + c.net, 0);
  const over = `over ${cycles.length} pit cycle${cycles.length === 1 ? "" : "s"}`;
  if (net > 0) return `Gained ${net} place${net === 1 ? "" : "s"} ${over}`;
  if (net < 0) return `Lost ${-net} place${net === -1 ? "" : "s"} ${over}`;
  return `Held its place ${over}`;
}

export function PhoneCarHero({
  data,
  active,
  onChoose,
  ask,
  onPickRace,
  picking,
}: {
  data: MyCarResponse;
  active: string;
  onChoose: (id: string) => void;
  ask: boolean;
  onPickRace: (raceId: string | null) => void;
  picking: string | null;
}) {
  const [more, setMore] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const cars = data.cars ?? [];
  const idx = Math.max(0, cars.findIndex((c) => c.id === active));
  const go = (d: 1 | -1) => {
    const next = cars[idx + d];
    if (next) {
      setMore(false);
      onChoose(next.id);
    }
  };
  // A sideways swipe moves between cars; anything mostly vertical is the page scrolling.
  const onTouchStart = (e: TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s || cars.length < 2) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  const { car, race, facts, story } = data;
  if (!car) return null;
  const number = facts?.number ?? car.number;
  const open = () => race && track("open_story", { raceId: race.id, hasPackage: !!story, from: "home_phone" });
  const ctx: ProseContext = { cars: story?.cars, classes: story?.classes };

  return (
    <section
      aria-roledescription={cars.length > 1 ? "carousel" : undefined}
      aria-label={cars.length > 1 ? `Your cars, ${idx + 1} of ${cars.length}` : "Your car"}
      data-phone-home="car"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="flex flex-col"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--rt-text-muted)]">
          {cars.length > 1 ? `Your cars · ${idx + 1} of ${cars.length}` : "Your car"}
        </h2>
        <Link to="/settings/cars" className="inline-flex min-h-[44px] items-center text-[13px] text-[var(--rt-accent)]">
          My cars →
        </Link>
      </div>

      <article className="overflow-hidden rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] p-4 text-left">
        {!race ? (
          <>
            <div className="text-[16px] font-semibold">{carTabLabel(cars[idx] ?? { ...car, series: car.series })}</div>
            <p className="m-0 mt-1 text-[14px] text-[var(--rt-text-secondary)]">No race for this car on RaceTrace yet. Its next race shows here once it is published.</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[13px] text-[var(--rt-text-secondary)]">
              <SeriesBadge series={race.series} size="sm" />
              <span className="min-w-0 flex-1 truncate">
                {race.name} · {formatDayRange(race.date, race.date)}
              </span>
              <StatusPill status={race.resultsStatus} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-[18px] font-bold text-[var(--rt-accent)]">#{number}</span>
              <span className="min-w-0 truncate text-[16px] font-semibold">{facts?.team ?? car.teamName ?? ""}</span>
              {facts?.cls && <span className="shrink-0 text-[14px] text-[var(--rt-text-muted)]">· {facts.cls}</span>}
            </div>

            {race.locked ? (
              <p className="m-0 mt-3 text-[14px] text-[var(--rt-text-secondary)]">
                🔒 {race.lockReason === "available_soon" ? "This race opens to free members shortly." : "Upgrade to Pro to read this race."}{" "}
                <Link to="/settings/billing" className="font-semibold text-[var(--rt-accent)]">See plans →</Link>
              </p>
            ) : (
              <>
                {story ? (
                  <p className="m-0 mt-3 text-[19px] font-semibold leading-snug">
                    <ProseText prose={story.headline} ctx={ctx} />
                  </p>
                ) : null}
                {facts && (
                  <p className={`m-0 tabular-nums ${story ? "mt-1.5 text-[14px] text-[var(--rt-text-secondary)]" : "mt-3 text-[19px] font-semibold leading-snug"}`}>
                    {finishLine(facts)}
                  </p>
                )}
                {facts && (
                  <p className="m-0 mt-1.5 text-[14px] text-[var(--rt-text-secondary)]">
                    {facts.pitCycles.length > 0 ? `${cyclesLine(facts.pitCycles)} · ` : ""}
                    {carStops(facts, data.drive ?? null)} stops · {facts.laps} of {facts.raceLaps} laps
                  </p>
                )}
                {/* One benchmark: the best thing that went right. */}
                {facts?.highlights?.[0] && (
                  <p className="m-0 mt-2.5 flex items-baseline gap-2 text-[14px] text-[var(--rt-text)]">
                    <span aria-hidden className="font-bold text-[var(--rt-good)]">✓</span>
                    <span>{facts.highlights[0].text}</span>
                  </p>
                )}

                <div className="mt-4 flex flex-col gap-2">
                  <Link
                    to={chartHref(race.id, number, story ? "story" : undefined)}
                    onClick={open}
                    data-phone-home="primary"
                    className="flex min-h-[48px] items-center justify-center rounded-lg bg-[var(--rt-accent)] text-[15px] font-semibold text-[var(--rt-on-accent)]"
                  >
                    {story ? "Read the story" : "Open the race"}
                  </Link>
                  <div className="grid grid-cols-2 gap-2">
                    <Link to={chartHref(race.id, number, "position")} onClick={open} className="flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--rt-border)] text-[14px] font-semibold">
                      Position Trace
                    </Link>
                    <Link to={chartHref(race.id, number, "pitanalysis")} onClick={open} className="flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--rt-border)] text-[14px] font-semibold">
                      Pit stops
                    </Link>
                  </div>
                </div>
              </>
            )}
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore((m) => !m)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center text-[14px] text-[var(--rt-accent)]"
            >
              {more ? "Less about this race" : "More about this race ›"}
            </button>
          </>
        )}
      </article>

      {more && (
        <div className="mt-3">
          <MyCarCard data={data} ask={ask} onPickRace={onPickRace} picking={picking} />
        </div>
      )}

      {cars.length > 1 && (
        <div className="mt-1 flex items-center justify-center" role="group" aria-label="Choose a car">
          {cars.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => i !== idx && (setMore(false), onChoose(c.id))}
              aria-label={carTabLabel(c)}
              aria-current={i === idx ? "true" : undefined}
              className="flex h-11 w-9 items-center justify-center"
            >
              <span className={`block h-2 rounded-full transition-all ${i === idx ? "w-5 bg-[var(--rt-accent)]" : "w-2 bg-[var(--rt-border)]"}`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
