import { useMemo, useState } from "react";
import type { RaceAnalysisPackage, RuleFinding } from "@shared/race-analysis-package/types";
import { ProseText, type Prose } from "../../lib/prose";
import { finishLabel, matchesFilter, storiesByClass, storyContext } from "./analysis-review";

const ASSESSMENT: Record<RuleFinding["assessment"], string> = {
  compliant: "Within the rules",
  penalised_consistent: "Penalised, consistent with the data",
  possible_unpenalised: "Possible issue, no penalty seen",
  data_insufficient: "Not enough data",
  not_assessable: "Can't be assessed",
};

// The shared package types and the renderer's Prose differ only in how strictly units are typed.
const prose = (p: unknown) => p as Prose;

/**
 * Everything a version would show visitors in words: the race summary, key moments, class notes,
 * every car's story, and (admin-only) the rule findings. Read before publishing.
 */
export function StoryPreview({ pkg }: { pkg: RaceAnalysisPackage }) {
  const ctx = useMemo(() => storyContext(pkg), [pkg]);
  const classes = useMemo(() => storiesByClass(pkg), [pkg]);
  const [filter, setFilter] = useState("");
  const [allOpen, setAllOpen] = useState(false);
  const s = pkg.raceSummary;
  const findings = pkg.ruleFindings ?? [];

  if (!s) {
    return (
      <p className="m-0 text-sm text-gray-600 dark:text-gray-400">
        No stories in this version yet: it has facts and rule checks only. The stories arrive as a newer draft once the
        facts are approved.
      </p>
    );
  }

  const storyCount = classes.reduce((n, g) => n + g.rows.filter((r) => r.story).length, 0);
  const missing = classes.flatMap((g) => g.rows.filter((r) => !r.story).map((r) => `#${r.car}`));
  const shown = classes
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.story && matchesFilter(r, filter)) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-5 text-sm">
      <p className="m-0 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-950/50 dark:text-gray-400">
        While reading: facts only, no praise or blame; nothing about the rules stronger than &ldquo;possible&rdquo;; no team
        accused of anything. Numbers come straight from the facts you checked.
      </p>

      <section>
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Race summary</h3>
        <p className="m-0 mt-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">
          <ProseText prose={prose(s.headline)} ctx={ctx} />
        </p>
        {s.paragraphs.map((p, i) => (
          <p key={i} className="m-0 mt-2 leading-relaxed text-gray-800 dark:text-gray-200">
            <ProseText prose={prose(p)} ctx={ctx} />
          </p>
        ))}
        {s.classSummaries && s.classSummaries.length > 0 && (
          <dl className="m-0 mt-3 flex flex-col gap-2">
            {s.classSummaries.map((c) => (
              <div key={c.class}>
                <dt className="font-semibold text-gray-900 dark:text-gray-100">{ctx.classes?.[c.class] ?? c.class}</dt>
                <dd className="m-0 leading-relaxed text-gray-800 dark:text-gray-200">
                  <ProseText prose={prose(c.text)} ctx={ctx} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {s.keyMoments && s.keyMoments.length > 0 && (
        <section>
          <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Key moments · {s.keyMoments.length}
          </h3>
          <ol className="m-0 mt-1.5 flex list-none flex-col gap-2 p-0">
            {s.keyMoments.map((m) => (
              <li key={m.id} className="leading-relaxed text-gray-800 dark:text-gray-200">
                <span className="mr-1.5 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
                  Lap {String(m.lap.value)}
                  {m.lapEnd ? `–${String(m.lapEnd.value)}` : ""}
                </span>
                <strong className="font-semibold text-gray-900 dark:text-gray-100">
                  <ProseText prose={prose(m.title)} ctx={ctx} />
                </strong>{" "}
                <ProseText prose={prose(m.text)} ctx={ctx} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {findings.length > 0 && (
        <section>
          <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Rule findings · {findings.length} · admins only
          </h3>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
            {findings.map((f) => (
              <li key={f.id} className="leading-relaxed text-gray-800 dark:text-gray-200">
                <span className="mr-1.5 text-xs text-gray-500 dark:text-gray-400">
                  {f.car ? `#${f.car}` : "Race"} · {ASSESSMENT[f.assessment] ?? f.assessment}
                </span>
                <ProseText prose={prose(f.statement)} ctx={ctx} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 mr-auto text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Car stories · {storyCount}
          </h3>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Car, team or driver"
            aria-label="Find a car's story"
            className="min-h-[32px] w-44 rounded-md border border-gray-300 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={() => setAllOpen((o) => !o)}
            className="min-h-[32px] rounded-md border border-gray-300 px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {allOpen ? "Close all" : "Open all"}
          </button>
        </div>
        {missing.length > 0 && (
          <p className="m-0 mt-1.5 text-xs text-yellow-800 dark:text-yellow-300">
            No story for {missing.length} car{missing.length === 1 ? "" : "s"}: {missing.join(", ")}
          </p>
        )}
        {shown.length === 0 ? (
          <p className="m-0 mt-2 text-gray-500 dark:text-gray-400">No story matches &ldquo;{filter}&rdquo;.</p>
        ) : (
          shown.map((g) => (
            <div key={g.classId} className="mt-3">
              <h4 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">{g.name}</h4>
              <div className="mt-1 flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                {g.rows.map((r) => (
                  // key includes allOpen so "Open all" / "Close all" resets every row.
                  <details key={`${r.car}-${allOpen}`} open={allOpen} className="group px-3 py-2">
                    <summary className="flex cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="w-12 shrink-0 font-mono font-semibold tabular-nums text-gray-900 dark:text-gray-100">#{r.car}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-gray-900 dark:text-gray-100">
                          <ProseText prose={prose(r.story!.headline)} ctx={ctx} />
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {[r.entry?.team, finishLabel(r.entry)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span aria-hidden="true" className="text-xs text-gray-400 group-open:rotate-180">
                        ▾
                      </span>
                    </summary>
                    <div className="mt-2 pl-14">
                      {r.story!.paragraphs.map((p, i) => (
                        <p key={i} className="m-0 mt-1.5 leading-relaxed text-gray-800 first:mt-0 dark:text-gray-200">
                          <ProseText prose={prose(p)} ctx={ctx} />
                        </p>
                      ))}
                      {(r.story!.events ?? []).some((ev) => ev.title || ev.text) && (
                        <ol className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-xs">
                          {r.story!.events!
                            .filter((ev) => ev.title || ev.text)
                            .map((ev) => (
                              <li key={ev.id} className="text-gray-700 dark:text-gray-300">
                                <span className="mr-1.5 font-mono tabular-nums text-gray-500 dark:text-gray-400">
                                  Lap {ev.lap}
                                  {ev.lapEnd ? `–${ev.lapEnd}` : ""}
                                </span>
                                {ev.title && (
                                  <strong className="font-semibold">
                                    <ProseText prose={prose(ev.title)} ctx={ctx} />
                                  </strong>
                                )}{" "}
                                {ev.text && <ProseText prose={prose(ev.text)} ctx={ctx} />}
                              </li>
                            ))}
                        </ol>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
