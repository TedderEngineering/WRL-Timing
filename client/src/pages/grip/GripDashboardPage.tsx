import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { gripApi, type Calculation, type ReferenceSession } from "@/features/grip/api";
import { useGrip } from "@/features/grip/GripContext";
import { useLoad } from "@/features/grip/hooks";
import { UpgradeDialog } from "@/features/grip/UpgradeDialog";
import {
  Banner,
  Card,
  ConfirmDialog,
  Eyebrow,
  GripButton,
  PageHeader,
  Pill,
  Spinner,
  TrackBadge,
  WeatherPill,
  formatDate,
  formatShortDate,
  primaryLinkClass,
  secondaryLinkClass,
} from "@/features/grip/components";
import { formatPressure, pressureUnit } from "@/features/grip/units";
import { cn } from "@/lib/utils";
import { gp } from "@/lib/site";
import { SupportCard } from "@/features/support/SupportPrompts";
import { AwaitingOutcomes, OutcomePill, awaitingOutcome } from "@/features/grip/outcome";
import { FirstWeekendChecklist, InstallHint } from "@/features/grip/engagement";
import { ProgressPanel } from "@/features/grip/progress";
import { SeasonRecapCard, previewYear, recapYearFor } from "@/features/grip/season";

function SessionCard({ session, detail }: { session: ReferenceSession; detail: string }) {
  return (
    <Link
      to={
        session.ready
          ? gp(`/calculate?ref=${session.id}`)
          : gp(`/sessions/${session.id}/edit`)
      }
      className="flex flex-col gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 min-w-0 hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <TrackBadge track={session.track} />
          <Pill tone="pro">{formatShortDate(session.sessionDate)}</Pill>
        </div>
        <WeatherPill weather={session.weather} />
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-gray-900 dark:text-gray-100 break-words">
          {session.name}
        </div>
        <div className="text-xs text-gray-500">
          {session.ready ? detail : "Needs hot pressures"}
        </div>
      </div>
    </Link>
  );
}

export function GripDashboardPage() {
  const { user } = useAuth();
  const { account, units, toast } = useGrip();
  const navigate = useNavigate();
  const sessions = useLoad(() => gripApi.sessions());
  const calcs = useLoad(() => gripApi.calculations());
  const progress = useLoad(() => gripApi.progress());
  // Season recap: 20 Nov to the end of January, or `?season=2026` to check it early.
  const location = useLocation();
  const recapYear = previewYear(location.search) ?? recapYearFor(new Date());
  const [upgrade, setUpgrade] = useState(false);
  const [deleting, setDeleting] = useState<Calculation | null>(null);
  const [busy, setBusy] = useState(false);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = user?.displayName || user?.email?.split("@")[0] || "";

  const all = sessions.data ?? [];
  const recent = all.slice(0, 3);
  const mostUsed = [...all]
    .filter((s) => s.useCount > 0)
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 3);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await gripApi.deleteCalculation(deleting.id);
      toast("Calculation deleted");
      setDeleting(null);
      await Promise.all([calcs.reload(), progress.reload()]);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page space-y-6">
      <PageHeader
        title={`${greeting}${name ? `, ${name}` : ""}`}
        subtitle={new Date().toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
        actions={
          <>
            <Link
              to={gp("/guide")}
              className={cn(secondaryLinkClass, "px-4 py-2.5 text-sm")}
            >
              Demo and how-to videos
            </Link>
            <Link
              to={gp("/sessions/new")}
              className={cn(primaryLinkClass, "px-4 py-2.5 text-sm")}
            >
              + New reference session
            </Link>
          </>
        }
      />

      {!account.isPro && (
        <Banner
          action={
            <GripButton size="sm" onClick={() => setUpgrade(true)}>
              Upgrade to Pro
            </GripButton>
          }
        >
          <b>
            {account.freeCalculationsLeft} of {account.freeCalculationLimit} free
            calculations left.
          </b>{" "}
          <span className="text-gray-600 dark:text-gray-400">
            Pro gives you unlimited calculations and the Damper Tuning Tool.
          </span>
        </Banner>
      )}

      {recapYear !== null && <SeasonRecapCard year={recapYear} />}

      {/* Open items: recent runs waiting for their hot pressures. */}
      {calcs.data && <AwaitingOutcomes calcs={calcs.data} />}
      {/* First race weekend: four steps, the first already ticked. */}
      {sessions.data && calcs.data && (
        <FirstWeekendChecklist sessions={sessions.data} calcs={calcs.data} />
      )}
      {/* Phones only: one tap to open it in the pit lane. */}
      <InstallHint />

      {sessions.loading ? (
        <Spinner />
      ) : sessions.error ? (
        <Card className="text-sm text-red-600 dark:text-red-400">{sessions.error}</Card>
      ) : all.length === 0 ? (
        <Card className="text-center py-10">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50">
            Start with a reference session
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto">
            Record one representative run: temperatures, duration, and cold and hot
            pressures. Every calculation is built from it.
          </p>
          <Link
            to={gp("/sessions/new")}
            className={cn(primaryLinkClass, "mt-5 px-5 py-2.5 text-sm")}
          >
            + New reference session
          </Link>
        </Card>
      ) : (
        <>
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Eyebrow>Recent reference sessions</Eyebrow>
              <Link
                to={gp("/sessions")}
                className="text-sm font-medium text-grip-600 dark:text-grip-400 hover:underline"
              >
                All sessions →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((s) => (
                <SessionCard key={s.id} session={s} detail={s.track.name} />
              ))}
            </div>
          </section>

          {mostUsed.length > 0 && (
            <section className="space-y-2.5">
              <Eyebrow>Most used reference sessions</Eyebrow>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mostUsed.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    detail={`Used ${s.useCount} time${s.useCount === 1 ? "" : "s"}`}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Accuracy over time, once a run's hot pressures are recorded. */}
      {progress.data && <ProgressPanel progress={progress.data} units={units} />}

      <section className="space-y-2.5">
        <Eyebrow>Recent tire pressure calculations</Eyebrow>
        {calcs.loading ? (
          <Spinner />
        ) : !calcs.data || calcs.data.length === 0 ? (
          <Card className="text-sm text-gray-600 dark:text-gray-400">
            No calculations yet. Open a reference session to run your first one.
          </Card>
        ) : (
          <Card className="!p-0 divide-y divide-gray-200 dark:divide-gray-800">
            {calcs.data.slice(0, 10).map((c) => (
              <div
                key={c.id}
                className="p-4 flex flex-col gap-3 md:flex-row md:items-center"
              >
                <Link
                  to={gp(`/calculate?calc=${c.id}`)}
                  title="Open this calculation"
                  className="group flex items-center gap-3 min-w-0 md:flex-1 rounded-lg -m-1 p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-grip-500"
                >
                  <TrackBadge track={c.track} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-gray-900 dark:text-gray-100 break-words group-hover:text-grip-600 dark:group-hover:text-grip-400">
                        {c.name}
                      </span>
                      <WeatherPill weather={c.weather} />
                      {c.outcome ? (
                        <OutcomePill calc={c} units={units} />
                      ) : (
                        c.convertedToRef && <Pill tone="ok">Converted</Pill>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(c.sessionDate)} · from {c.referenceName}
                    </div>
                  </div>
                </Link>
                {/* Phone: each corner labelled, so nobody has to remember the order. */}
                <dl className="grid grid-cols-4 gap-2 md:hidden">
                  {(["lf", "rf", "lr", "rr"] as const).map((k) => (
                    <div
                      key={k}
                      className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-2 py-1.5 text-center"
                    >
                      <dt className="text-[10px] font-bold tracking-widest text-gray-500">
                        {k.toUpperCase()}
                      </dt>
                      <dd className="text-base font-bold tabular-nums text-gray-900 dark:text-gray-100">
                        {formatPressure(c.result[k], units)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="hidden md:block text-sm tabular-nums text-gray-600 dark:text-gray-300 md:text-right">
                  {(["lf", "rf", "lr", "rr"] as const)
                    .map((k) => formatPressure(c.result[k], units))
                    .join(" / ")}{" "}
                  <span className="text-xs text-gray-500">{pressureUnit(units)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <GripButton
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate(gp(`/calculate?calc=${c.id}`))}
                  >
                    Open
                  </GripButton>
                  {(!c.convertedToRef || c.outcome) && (
                    <GripButton
                      size="sm"
                      variant={awaitingOutcome(c) ? "primary" : "secondary"}
                      onClick={() => navigate(gp(`/calculations/${c.id}/outcome`))}
                    >
                      {c.outcome ? "How it came in" : "How did it come in?"}
                    </GripButton>
                  )}
                  <GripButton size="sm" variant="ghost" onClick={() => setDeleting(c)}>
                    Delete
                  </GripButton>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Quiet "Finding Grip is free" card; a thank-you after a coffee; nothing for supporters. */}
      <div className="max-w-md">
        <SupportCard />
      </div>

      {upgrade && <UpgradeDialog onClose={() => setUpgrade(false)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this calculation?"
          body={`"${deleting.name}" will be removed. This cannot be undone.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
