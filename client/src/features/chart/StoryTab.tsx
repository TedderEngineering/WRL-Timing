/**
 * The race page's Story tab (runbook step 5, first decision): the published analysis in words.
 * The race summary, its key moments and each class's result on one side; the focus car's own
 * story on the other (below on a phone). The car follows the page's focus car, so a car picked on
 * Position Trace opens here, and a car number in the text opens that car's story.
 *
 * Facts only, as written in the package: every number is the package's own reference.
 */
import { useEffect, useMemo, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { api } from "../../lib/api";
import { ProseText, type Prose, type ProseContext } from "../../lib/prose";
import { track } from "../../lib/analytics";
import { MomentStrip, causeStyle, lapLabel } from "../dashboard/RecapCard";
import type { Recap } from "../dashboard/types";
import { carKey } from "./car-number";

export interface RaceStory {
  car: string;
  cls: string;
  headline: Prose;
  paragraphs: Prose[];
  positionClass: number | null;
  positionOverall: number | null;
}

export interface RaceStories {
  version: number;
  publishedAt: string | null;
  recap: Recap;
  stories: RaceStory[];
}

// One fetch per race while the page is open.
const loaded = new Map<string, Promise<RaceStories | null>>();

export function loadRaceStories(raceId: string): Promise<RaceStories | null> {
  let p = loaded.get(raceId);
  if (!p) {
    p = api.get<RaceStories>(`/races/${raceId}/stories`).catch(() => {
      loaded.delete(raceId);
      return null;
    });
    loaded.set(raceId, p);
  }
  return p;
}

/** The package car for the chart's focus car: by published number ("007", "4A"), then by key. */
export function storyCarFor(data: RaceChartData | null, focusNum: number, stories: RaceStory[]): string | null {
  if (!focusNum) return null;
  const c = data?.cars[String(focusNum)];
  const published = c?.label ?? String(c?.num ?? focusNum);
  if (stories.some((s) => s.car === published)) return published;
  const k = String(focusNum);
  return stories.some((s) => s.car === k) ? k : null;
}

/** Stories in the order of the results: class by class (the recap's class order), then class position. */
export function orderStories(stories: RaceStory[], classOrder: string[]): RaceStory[] {
  const ci = (c: string) => {
    const i = classOrder.indexOf(c);
    return i < 0 ? classOrder.length : i;
  };
  const pos = (s: RaceStory) => s.positionClass ?? 9999;
  return [...stories].sort((a, b) => ci(a.cls) - ci(b.cls) || pos(a) - pos(b) || a.car.localeCompare(b.car, undefined, { numeric: true }));
}

const RT = { line: "#1e1e38", card: "#12122a", text: "#e0e0e8", soft: "#cbd5e1", muted: "#9a9ab4", accent: "#F48C34" };

export function StoryTab({
  raceId,
  data,
  focusNum,
  setFocusNum,
  onOpenTab,
}: {
  raceId: string;
  data: RaceChartData | null;
  focusNum: number;
  setFocusNum: (n: number) => void;
  onOpenTab: (tab: "position" | "pitanalysis") => void;
}) {
  const [stories, setStories] = useState<RaceStories | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setStories(undefined);
    loadRaceStories(raceId).then((s) => live && setStories(s));
    track("open_story", { raceId, hasPackage: true, from: "race_page" });
    return () => {
      live = false;
    };
  }, [raceId]);

  if (stories === undefined) {
    return <p className="m-0 px-3 py-6 text-sm sm:px-6" style={{ color: RT.muted }}>Loading the story…</p>;
  }
  if (stories === null) {
    return (
      <p className="m-0 px-3 py-6 text-sm sm:px-6" style={{ color: RT.muted }}>
        This race's story isn't available right now. Position Trace and Pit Stops still show the race.
      </p>
    );
  }

  return (
    <StoryView
      stories={stories}
      data={data}
      focusNum={focusNum}
      onCar={(c) => {
        const k = data ? carKey(data, c) : null;
        if (k !== null && data?.cars[String(k)]) setFocusNum(k);
        track("open_story", { raceId, hasPackage: true, from: "story_car" });
      }}
      onOpenTab={onOpenTab}
    />
  );
}

/** The tab's content for loaded stories (pure: rendered in tests without the network). */
export function StoryView({
  stories,
  data,
  focusNum,
  onCar,
  onOpenTab,
}: {
  stories: RaceStories;
  data: RaceChartData | null;
  focusNum: number;
  onCar: (car: string) => void;
  onOpenTab: (tab: "position" | "pitanalysis") => void;
}) {
  const ctx: ProseContext = useMemo(() => ({ cars: stories.recap.cars, classes: stories.recap.classes }), [stories]);
  const ordered = useMemo(() => orderStories(stories.stories, Object.keys(stories.recap.classes)), [stories]);
  const { recap } = stories;
  const car = storyCarFor(data, focusNum, stories.stories);
  const story = car ? stories.stories.find((s) => s.car === car) ?? null : null;
  const openCar = onCar;
  const entry = car ? recap.cars[car] : undefined;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-3 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-6">
      {/* The race */}
      <section aria-labelledby="story-race" className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
        <h2 id="story-race" className="m-0 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: RT.muted }}>
          The race
        </h2>
        <p className="m-0 text-[19px] font-semibold leading-snug sm:text-[22px]" style={{ color: RT.text }}>
          <ProseText prose={recap.headline} ctx={ctx} onCar={openCar} />
        </p>
        {recap.paragraphs.map((p, i) => (
          <p key={i} className="m-0 text-[15px] leading-relaxed" style={{ color: RT.soft }}>
            <ProseText prose={p} ctx={ctx} onCar={openCar} />
          </p>
        ))}

      </section>

      {/* The focus car: after the summary on a phone, beside the whole race from lg up */}
      <section aria-labelledby="story-car" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="story-car" className="m-0 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: RT.muted }}>
            Car story
          </h2>
          <label className="flex items-center gap-2 text-sm" style={{ color: RT.muted }}>
            <span className="sr-only">Choose a car</span>
            <select
              value={car ?? ""}
              onChange={(e) => openCar(e.target.value)}
              className="min-h-[36px] max-w-[260px] rounded-md border px-2 text-sm"
              style={{ borderColor: RT.line, background: RT.card, color: RT.text }}
            >
              {!car && <option value="">Choose a car</option>}
              {ordered.map((s) => (
                <option key={s.car} value={s.car}>
                  {`#${s.car} ${recap.cars[s.car]?.team ?? ""} · ${recap.classes[s.cls] ?? s.cls}${s.positionClass ? ` · P${s.positionClass}` : ""}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        {story ? (
          <article className="flex flex-col gap-3 rounded-xl border px-4 py-4 sm:px-5" style={{ borderColor: RT.line, background: RT.card }}>
            <div className="text-[13px]" style={{ color: RT.muted }}>
              <span className="font-mono font-bold" style={{ color: RT.accent }}>#{story.car}</span> {entry?.team}
              {entry?.drivers?.length ? ` · ${entry.drivers.join(", ")}` : ""}
            </div>
            <p className="m-0 text-[17px] font-semibold leading-snug" style={{ color: RT.text }}>
              <ProseText prose={story.headline} ctx={ctx} onCar={openCar} />
            </p>
            {story.paragraphs.map((p, i) => (
              <p key={i} className="m-0 text-[15px] leading-relaxed" style={{ color: RT.soft }}>
                <ProseText prose={p} ctx={ctx} onCar={openCar} />
              </p>
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
              <button type="button" onClick={() => onOpenTab("position")} className="font-semibold" style={{ color: RT.accent }}>
                Position Trace →
              </button>
              <button type="button" onClick={() => onOpenTab("pitanalysis")} style={{ color: RT.accent }}>
                Pit stops →
              </button>
            </div>
          </article>
        ) : (
          <p className="m-0 rounded-xl border px-4 py-4 text-sm" style={{ borderColor: RT.line, background: RT.card, color: RT.muted }}>
            {car === null && focusNum
              ? "There's no story for this car in this race. Pick another car above."
              : "Pick a car above, or a car number in the text, to read its race."}
          </p>
        )}
        <p className="m-0 text-xs" style={{ color: RT.muted }}>
          Written from the timing data: every number is from the race's facts.
          {stories.publishedAt ? ` Published ${new Date(stories.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.` : ""}
        </p>
      </section>

      {/* Key moments and the classes */}
      <section aria-label="Key moments and classes" className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2">
        {recap.moments.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: RT.muted }}>
              Key moments
            </h3>
            <MomentStrip recap={recap} ctx={ctx} />
            <ol className="m-0 flex list-none flex-col p-0">
              {recap.moments.map((m) => {
                const s = causeStyle(m);
                return (
                  <li key={m.id} className="flex gap-3 border-t py-2.5 text-sm" style={{ borderColor: RT.line }}>
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0" style={{ background: s.color, borderRadius: s.shape === "dot" ? "50%" : 2 }} aria-hidden />
                    <span className="w-16 shrink-0 font-mono tabular-nums" style={{ color: RT.muted }}>
                      {lapLabel(m)}
                    </span>
                    <span className="min-w-0">
                      <span className="font-semibold" style={{ color: RT.text }}>
                        <ProseText prose={m.title} ctx={ctx} onCar={openCar} />
                      </span>
                      {m.text && (
                        <span className="block leading-relaxed" style={{ color: RT.soft }}>
                          <ProseText prose={m.text} ctx={ctx} onCar={openCar} />
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {recap.classWinners.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: RT.muted }}>
              Class by class
            </h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {recap.classWinners.map((w) => (
                <li key={w.class} className="rounded-lg border px-3.5 py-2.5 text-sm" style={{ borderColor: RT.line, background: RT.card }}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold" style={{ color: RT.text }}>{w.className}</span>
                    <button type="button" onClick={() => openCar(w.car)} className="font-mono font-semibold tabular-nums hover:underline" style={{ color: RT.accent }}>
                      #{w.car}
                    </button>
                    <span style={{ color: RT.muted }}>{w.team}</span>
                  </div>
                  {w.summary && (
                    <p className="m-0 mt-1 leading-relaxed" style={{ color: RT.soft }}>
                      <ProseText prose={w.summary} ctx={ctx} onCar={openCar} />
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
