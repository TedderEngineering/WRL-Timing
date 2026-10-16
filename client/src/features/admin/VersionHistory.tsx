import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "../../lib/api";
import {
  type PackageSummary,
  fetchRacePackage,
  listRacePackages,
  rejectRacePackage,
  rollbackRacePackage,
} from "../../lib/package-api";
import type { RaceAnalysisPackage } from "@shared/race-analysis-package/types";
import { StoryPreview } from "./StoryPreview";

const badge = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";
const STATUS: Record<PackageSummary["status"], { label: string; cls: string }> = {
  published: { label: "Visitors see this", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  draft: { label: "Draft", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  superseded: { label: "Published before", cls: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Every version of one race's analysis, newest first. A version published before can be made
 * current again (Roll back); older drafts can be rejected; any version's stories can be read.
 */
export function VersionHistory({ raceId, raceName, onChanged }: { raceId: string; raceName: string; onChanged: () => void }) {
  const [versions, setVersions] = useState<PackageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ version: number; action: "rollback" | "reject" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reading, setReading] = useState<{ version: number; pkg: RaceAnalysisPackage | null; error?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setVersions((await listRacePackages(raceId)).packages);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load the versions");
    }
  }, [raceId]);
  useEffect(() => {
    load();
  }, [load]);

  const current = versions?.find((v) => v.status === "published") ?? null;

  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    setMessage(null);
    try {
      if (confirm.action === "rollback") {
        const r = await rollbackRacePackage(raceId, confirm.version);
        setMessage({
          ok: true,
          text: `v${confirm.version} is current again. Visitors see it now${r.previousVersion ? `; v${r.previousVersion} is kept and can be restored the same way` : ""}.`,
        });
      } else {
        await rejectRacePackage(raceId, confirm.version, "Rejected from the version history");
        setMessage({ ok: true, text: `v${confirm.version} is rejected.` });
      }
      setConfirm(null);
      await load();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiClientError ? e.message : "That didn't work" });
    } finally {
      setBusy(false);
    }
  };

  const read = async (version: number) => {
    if (reading?.version === version) {
      setReading(null);
      return;
    }
    setReading({ version, pkg: null });
    try {
      const { pkg } = await fetchRacePackage(raceId, { version });
      setReading({ version, pkg });
    } catch (e) {
      setReading({ version, pkg: null, error: e instanceof ApiClientError ? e.message : "Could not load that version" });
    }
  };

  if (error) return <p className="m-0 text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!versions) return <div className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
        {versions.map((v) => {
          const s = STATUS[v.status];
          return (
            <li key={v.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">v{v.version}</span>
                  <span className={`${badge} ${s.cls}`}>{s.label}</span>
                </div>
                <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Made {when(v.createdAt)}
                  {v.publishedAt ? ` · published ${when(v.publishedAt)}` : ""} · engine {v.engineVersion}
                </p>
                {v.notes && <p className="m-0 mt-0.5 whitespace-pre-line text-xs text-gray-500 dark:text-gray-400">{v.notes}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {v.status !== "rejected" && (
                  <button
                    type="button"
                    onClick={() => read(v.version)}
                    aria-expanded={reading?.version === v.version}
                    className="min-h-[32px] rounded-md border border-gray-300 px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {reading?.version === v.version ? "Hide stories" : "Read stories"}
                  </button>
                )}
                {v.status === "superseded" && (
                  <button
                    type="button"
                    onClick={() => setConfirm({ version: v.version, action: "rollback" })}
                    disabled={busy}
                    className="min-h-[32px] rounded-md border border-brand-500 px-2.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-950/30"
                  >
                    Roll back to v{v.version}
                  </button>
                )}
                {v.status === "draft" && (
                  <button
                    type="button"
                    onClick={() => setConfirm({ version: v.version, action: "reject" })}
                    disabled={busy}
                    className="min-h-[32px] rounded-md border border-red-300 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    Reject
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {confirm && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/50">
          <p className="m-0 text-gray-700 dark:text-gray-300">
            {confirm.action === "rollback"
              ? `Make v${confirm.version} what visitors see for ${raceName}?${current ? ` v${current.version} stops showing but is kept, so you can switch back.` : ""}`
              : `Reject draft v${confirm.version} of ${raceName}? It stays in this list, marked rejected, and can't be published.`}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={act}
              disabled={busy}
              className={`min-h-[36px] rounded-md px-3 text-sm font-semibold text-white disabled:opacity-50 ${confirm.action === "rollback" ? "bg-brand-600 hover:bg-brand-500" : "bg-red-600 hover:bg-red-500"}`}
            >
              {busy ? "Working…" : confirm.action === "rollback" ? `Roll back to v${confirm.version}` : `Reject v${confirm.version}`}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="min-h-[36px] px-2 text-sm text-gray-600 dark:text-gray-400">
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`m-0 rounded-lg p-3 ${message.ok ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}
        >
          {message.text}
        </p>
      )}

      {reading && (
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <p className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Stories in v{reading.version}</p>
          {reading.error ? (
            <p className="m-0 text-red-600 dark:text-red-400">{reading.error}</p>
          ) : reading.pkg ? (
            <StoryPreview pkg={reading.pkg} />
          ) : (
            <div className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          )}
        </div>
      )}
    </div>
  );
}
