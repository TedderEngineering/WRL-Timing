import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiClientError } from "../../lib/api";
import {
  type PackageReviewItem,
  fetchRacePackage,
  listPackagesForReview,
  publishRacePackage,
  rejectRacePackage,
  validatorReportOf,
} from "../../lib/package-api";
import type { DataQualityNote, RuleCheck } from "@shared/race-analysis-package/types";

const badge = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";
const tone = {
  good: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  warn: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  bad: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  plain: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function day(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Analysis drafts: new analysis packages waiting for the owner, across every race. The races
 * themselves are already on the site; a draft is a newer analysis of one (facts and rule checks
 * first, stories later). Visitors keep seeing the published version until a draft is published.
 */
export function AdminAnalysisPage() {
  const [items, setItems] = useState<PackageReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await listPackagesForReview("draft")).packages);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load the drafts");
      setItems([]);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Newest draft of each race first; older drafts of the same race are listed under it.
  const groups = useMemo(() => {
    const by = new Map<string, PackageReviewItem[]>();
    for (const p of items ?? []) by.set(p.race.id, [...(by.get(p.race.id) ?? []), p]);
    return [...by.values()].map((list) => list.sort((a, b) => b.version - a.version));
  }, [items]);

  return (
    <div className="p-4 pb-24 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Analysis drafts</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
        New analysis for races already on the site, waiting for you. Visitors keep seeing the published analysis (or the
        import&apos;s own pit analysis when there is none) until you publish a draft. Rule checks are findings to look at,
        never more than &ldquo;possible&rdquo; while the rulebook is unverified.
      </p>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {items === null ? (
        <div className="mt-6 h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-900" />
      ) : groups.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No drafts waiting. New ones appear here when the intake analyses a race.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <p className="m-0 text-sm text-gray-500 dark:text-gray-400">
            {groups.length} race{groups.length === 1 ? "" : "s"} with a draft
          </p>
          {groups.map((list) => (
            <DraftCard key={list[0].race.id} draft={list[0]} older={list.slice(1)} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Details {
  hasStories: boolean;
  cars: number;
  checks: RuleCheck[];
  notes: DataQualityNote[];
}

function DraftCard({ draft, older, onChanged }: { draft: PackageReviewItem; older: PackageReviewItem[]; onChanged: () => void }) {
  const r = draft.race;
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "publish" | "reject">("idle");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; lines?: string[] } | null>(null);

  const loadDetails = useCallback(async () => {
    if (details) return details;
    try {
      const { pkg } = await fetchRacePackage(r.id, { version: draft.version });
      const d: Details = {
        hasStories: pkg.raceSummary != null,
        cars: pkg.entries?.length ?? 0,
        checks: pkg.ruleChecks ?? [],
        notes: pkg.dataQuality ?? [],
      };
      setDetails(d);
      return d;
    } catch (e) {
      setLoadError(e instanceof ApiClientError ? e.message : "Could not load the package");
      return null;
    }
  }, [details, r.id, draft.version]);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open) loadDetails();
  };

  const publish = async () => {
    setBusy(true);
    setResult(null);
    try {
      await publishRacePackage(r.id, draft.version);
      setResult({ ok: true, text: `v${draft.version} is published. Visitors see it now.` });
      setMode("idle");
      onChanged();
    } catch (e) {
      const report = validatorReportOf(e);
      if (report) {
        const gate = report.errors.some((x) => x.code === "PUBLISH_GATE");
        setResult({
          ok: false,
          text: gate
            ? "Can't publish yet: this draft has facts and rule checks only. The race summary and car stories have to be written first."
            : `Can't publish: ${report.errorCount} problem(s) found.`,
          lines: report.errors.slice(0, 5).map((x) => `${x.code} ${x.path} ${x.message}`.trim()),
        });
      } else {
        setResult({ ok: false, text: e instanceof ApiClientError ? e.message : "Publishing failed" });
      }
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    setResult(null);
    try {
      await rejectRacePackage(r.id, draft.version, reason.trim() || undefined);
      setMode("idle");
      onChanged();
    } catch (e) {
      setResult({ ok: false, text: e instanceof ApiClientError ? e.message : "Rejecting failed" });
    } finally {
      setBusy(false);
    }
  };

  const v = draft.validatorReport;
  const grade = draft.dataQualityGrade;
  const counts = details ? countChecks(details.checks) : null;
  const blockedForStories = details ? !details.hasStories : false;

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">
            <Link to={`/chart?race=${r.id}`} className="hover:underline">
              {r.name}
            </Link>
          </h2>
          <p className="m-0 mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {[r.series, r.subSeries, r.track, day(r.date)].filter(Boolean).join(" · ")}
          </p>
          <p className="m-0 mt-1 text-sm text-gray-700 dark:text-gray-300">
            <strong>v{draft.version} draft</strong> · engine {draft.engineVersion} · made {day(draft.createdAt)} ·{" "}
            {r.currentVersion !== null ? `visitors see v${r.currentVersion}` : "nothing published yet"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`${badge} ${v?.passed ? tone.good : tone.bad}`}>{v?.passed ? "Valid" : `${v?.errorCount ?? "?"} validation errors`}</span>
          {grade && (
            <span className={`${badge} ${grade === "good" ? tone.good : grade === "check_notes" ? tone.warn : tone.bad}`}>
              Data: {grade === "good" ? "good" : grade === "check_notes" ? "check notes" : "limited"}
            </span>
          )}
          {draft.resultsStatus && <span className={`${badge} ${draft.resultsStatus === "official" ? tone.plain : tone.warn}`}>{draft.resultsStatus === "official" ? "Official results" : "Provisional results"}</span>}
          <span className={`${badge} ${tone.plain}`}>{draft.rulebookVersion ? `Rulebook ${draft.rulebookVersion}` : "No rulebook"}</span>
        </div>
      </div>

      {draft.notes && <p className="m-0 mt-2 text-xs text-gray-500 dark:text-gray-400">{draft.notes}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggle} aria-expanded={open} className="min-h-[36px] rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
          {open ? "Hide rule checks and data notes" : "Rule checks and data notes"}
        </button>
        <Link
          to={`/chart?race=${r.id}&facts=${draft.version}`}
          className="inline-flex min-h-[36px] items-center rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Preview pit facts on the race page
        </Link>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            setMode(mode === "publish" ? "idle" : "publish");
            loadDetails();
          }}
          disabled={busy}
          className="min-h-[36px] rounded-md bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
        >
          Publish…
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "reject" ? "idle" : "reject")}
          disabled={busy}
          className="min-h-[36px] rounded-md border border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          Reject…
        </button>
      </div>

      {mode === "publish" && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-950/50">
          {blockedForStories ? (
            <p className="m-0 text-gray-700 dark:text-gray-300">
              This draft has facts and rule checks only, so it can&apos;t be published yet: the race summary and car stories
              are written next, as a new draft, once you&apos;ve checked the facts here.
            </p>
          ) : (
            <>
              <p className="m-0 text-gray-700 dark:text-gray-300">
                Publish v{draft.version} of {r.name}? Visitors see it straight away
                {r.currentVersion !== null ? `, and v${r.currentVersion} can be rolled back to` : ""}.
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={publish} disabled={busy} className="min-h-[36px] rounded-md bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                  {busy ? "Publishing…" : `Publish v${draft.version}`}
                </button>
                <button type="button" onClick={() => setMode("idle")} className="min-h-[36px] px-2 text-sm text-gray-600 dark:text-gray-400">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "reject" && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-950/50">
          <label htmlFor={`reason-${draft.id}`} className="block text-gray-700 dark:text-gray-300">
            Why? (optional; kept with the draft so the next run can fix it)
          </label>
          <input
            id={`reason-${draft.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            placeholder="e.g. #12's stop on lap 40 is a drive-through"
          />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={reject} disabled={busy} className="min-h-[36px] rounded-md bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
              {busy ? "Rejecting…" : `Reject v${draft.version}`}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="min-h-[36px] px-2 text-sm text-gray-600 dark:text-gray-400">
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`mt-3 rounded-lg p-3 text-sm ${result.ok ? tone.good : tone.bad}`} role="status">
          {result.text}
          {result.lines && result.lines.length > 0 && (
            <ul className="m-0 mt-1 list-disc pl-5 text-xs">
              {result.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {open && (
        <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-800">
          {loadError ? (
            <p className="m-0 text-sm text-red-600 dark:text-red-400">{loadError}</p>
          ) : !details ? (
            <div className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              <p className="m-0 text-gray-700 dark:text-gray-300">
                {details.cars} cars · stories {details.hasStories ? "written" : "not written yet"} · rule checks:{" "}
                {counts!.total === 0
                  ? "none (no rulebook for this series)"
                  : `${counts!.pass} pass, ${counts!.fail} possible issue${counts!.fail === 1 ? "" : "s"}, ${counts!.unknown} can't tell, ${counts!.na} not applicable`}
              </p>
              <CheckList title="Possible issues" checks={details.checks.filter((c) => c.status === "fail")} />
              <CheckList title="Can't tell from the data" checks={details.checks.filter((c) => c.status === "unknown")} />
              <NoteList notes={details.notes} />
            </div>
          )}
        </div>
      )}

      {older.length > 0 && (
        <p className="m-0 mt-3 text-xs text-gray-500 dark:text-gray-400">
          Older draft{older.length === 1 ? "" : "s"} of this race: {older.map((o) => `v${o.version}`).join(", ")} (replaced by v
          {draft.version}; reject {older.length === 1 ? "it" : "them"} from the race&apos;s package list when convenient).
        </p>
      )}
    </article>
  );
}

function countChecks(checks: RuleCheck[]) {
  const n = (s: RuleCheck["status"]) => checks.filter((c) => c.status === s).length;
  return { total: checks.length, pass: n("pass"), fail: n("fail"), unknown: n("unknown"), na: n("not_applicable") };
}

function amount(v: number | null | undefined, unit: RuleCheck["unit"]): string {
  if (v === null || v === undefined) return "—";
  if (unit === "s") return `${v.toFixed(1)} s`;
  if (unit === "fraction") return `${(v * 100).toFixed(0)}%`;
  if (unit === "lap") return `lap ${v}`;
  return `${v}${unit ? ` ${unit}` : ""}`;
}

function CheckList({ title, checks }: { title: string; checks: RuleCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <section>
      <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title} · {checks.length}
      </h3>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-xs text-gray-500 dark:text-gray-400">
              <th className="py-1 pr-3 font-medium">Car</th>
              <th className="py-1 pr-3 font-medium">Rule</th>
              <th className="py-1 pr-3 font-medium">Measured</th>
              <th className="py-1 pr-3 font-medium">Limit</th>
              <th className="py-1 pr-3 font-medium">Lap</th>
              <th className="py-1 font-medium">Rulebook</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} className="border-t border-gray-100 align-top dark:border-gray-800">
                <td className="py-1.5 pr-3 font-semibold tabular-nums text-gray-900 dark:text-gray-100">{c.car ? `#${c.car}` : "Race"}</td>
                <td className="py-1.5 pr-3 text-gray-800 dark:text-gray-200">
                  {c.ruleKey}
                  {c.notes?.length ? <span className="block text-xs text-gray-500 dark:text-gray-400">{c.notes.join(", ")}</span> : null}
                </td>
                <td className="py-1.5 pr-3 tabular-nums text-gray-800 dark:text-gray-200">
                  {c.measuredRange ? `${amount(c.measuredRange[0], c.unit)}–${amount(c.measuredRange[1], c.unit)}` : amount(c.measured, c.unit)}
                </td>
                <td className="py-1.5 pr-3 tabular-nums text-gray-800 dark:text-gray-200">{amount(c.limit, c.unit)}</td>
                <td className="py-1.5 pr-3 tabular-nums text-gray-800 dark:text-gray-200">{c.lap ?? "—"}</td>
                <td className="py-1.5 text-xs text-gray-600 dark:text-gray-400">
                  {c.rulebookRef?.section}
                  {c.verified ? " · verified" : " · not verified"}
                  {c.officialAction?.length ? " · race control acted" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NoteList({ notes }: { notes: DataQualityNote[] }) {
  const shown = notes.filter((n) => n.severity !== "note");
  if (shown.length === 0) return <p className="m-0 text-gray-500 dark:text-gray-400">No data warnings.</p>;
  return (
    <section>
      <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Data notes · {shown.length}</h3>
      <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
        {shown.map((n) => (
          <li key={n.id} className="text-gray-800 dark:text-gray-200">
            <span className={`${badge} mr-2 ${n.severity === "blocker" ? tone.bad : tone.warn}`}>{n.severity === "blocker" ? "Blocker" : "Warning"}</span>
            {n.message} <span className="text-xs text-gray-500 dark:text-gray-400">({n.code})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
