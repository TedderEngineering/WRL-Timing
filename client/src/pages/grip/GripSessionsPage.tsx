import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { gripApi, type ReferenceSession } from "@/features/grip/api";
import { useGrip } from "@/features/grip/GripContext";
import { useLoad } from "@/features/grip/hooks";
import {
  Card,
  ChoiceChips,
  ConfirmDialog,
  Eyebrow,
  GripButton,
  PageHeader,
  Pill,
  Spinner,
  TrackBadge,
  WeatherPill,
  formatDate,
  primaryLinkClass,
} from "@/features/grip/components";
import { formatPressure, pressureUnit } from "@/features/grip/units";
import { cn } from "@/lib/utils";

type Sort = "date" | "track" | "name";
const SORTS = [
  ["date", "Date"],
  ["track", "Track"],
  ["name", "Name"],
] as const;

export function GripSessionsPage() {
  const { units, toast } = useGrip();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(() => gripApi.sessions());
  const [sort, setSort] = useState<Sort>("date");
  const [deleting, setDeleting] = useState<ReferenceSession | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => {
    const list = [...(data ?? [])];
    if (sort === "track")
      list.sort(
        (a, b) =>
          a.track.name.localeCompare(b.track.name) ||
          b.sessionDate.localeCompare(a.sessionDate)
      );
    else if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
    return list;
  }, [data, sort]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await gripApi.deleteSession(deleting.id);
      toast("Reference session deleted");
      setDeleting(null);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  };

  const four = (c: ReferenceSession["hot"]) =>
    (["lf", "rf", "lr", "rr"] as const)
      .map((k) => formatPressure(c[k], units))
      .join(" / ");

  return (
    <div className="container-page">
      <PageHeader
        title="Reference sessions"
        subtitle="The baselines your calculations are built from."
        actions={
          <Link
            to="/grip/sessions/new"
            className={cn(primaryLinkClass, "px-4 py-2.5 text-sm")}
          >
            + New reference session
          </Link>
        }
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <Card className="text-sm text-red-600 dark:text-red-400">{error}</Card>
      ) : sorted.length === 0 ? (
        <Card className="text-center py-10 text-sm text-gray-600 dark:text-gray-400">
          No reference sessions yet. Create one after a representative run.
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Eyebrow>Sort</Eyebrow>
            <ChoiceChips
              label="Sort by"
              options={SORTS}
              value={sort}
              onChange={setSort}
            />
          </div>
          <Card className="!p-0 divide-y divide-gray-200 dark:divide-gray-800">
            {sorted.map((s) => (
              <div
                key={s.id}
                className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center"
              >
                <div className="flex items-center gap-3 min-w-0 lg:flex-1">
                  <TrackBadge track={s.track} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-gray-900 dark:text-gray-100 break-words">
                        {s.name}
                      </span>
                      <WeatherPill weather={s.weather} />
                      {!s.ready && <Pill tone="warn">Needs hot pressures</Pill>}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(s.sessionDate)} · {s.track.name} · {s.durationMin} min
                    </div>
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums">
                  <dt className="text-gray-500">Cold</dt>
                  <dd className="text-gray-700 dark:text-gray-300">
                    {four(s.cold)} {pressureUnit(units)}
                  </dd>
                  <dt className="text-gray-500">Hot</dt>
                  <dd className="text-gray-700 dark:text-gray-300">
                    {s.ready ? `${four(s.hot)} ${pressureUnit(units)}` : "Not recorded"}
                  </dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {s.ready ? (
                    <GripButton
                      size="sm"
                      onClick={() => navigate(`/grip/calculate?ref=${s.id}`)}
                    >
                      Calculate
                    </GripButton>
                  ) : (
                    <GripButton
                      size="sm"
                      onClick={() => navigate(`/grip/sessions/${s.id}/edit`)}
                    >
                      Add hot pressures
                    </GripButton>
                  )}
                  <GripButton
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate(`/grip/sessions/${s.id}/edit`)}
                  >
                    Edit
                  </GripButton>
                  <GripButton size="sm" variant="ghost" onClick={() => setDeleting(s)}>
                    Delete
                  </GripButton>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this reference session?"
          body={`"${deleting.name}" will be removed. Calculations made from it stay in your history. This cannot be undone.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
