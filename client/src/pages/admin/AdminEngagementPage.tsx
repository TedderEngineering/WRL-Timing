import { useEffect, useState } from "react";
import { api } from "../../lib/api";

/**
 * Admin › Engagement: the engagement plan's measures that come from RaceTrace's own database
 * (server services/engagement.ts). Admin and suspended accounts are left out. What the
 * anonymous analytics count (visits by source, shares, coffees) is in PostHog, listed at the end.
 */

interface WeekendComeBack {
  key: string;
  name: string;
  track: string;
  series: string;
  date: string;
  publishedAt: string;
  publishedFrom: "audit" | "email" | "created";
  races: number;
  followers: number;
  cameBack: number;
}

interface Engagement {
  period: { days: number; from: string; to: string };
  people: { accounts: number; following: number; carsFollowed: number; driversFollowed: number; emailsOn: number };
  follows: { newAccounts: number; newAccountsFollowing: number; followsPerNewAccount: number | null };
  comeBack: {
    hours: number;
    weekends: number;
    weekendsWithFollowers: number;
    weekendsWithComeBack: number;
    followerWeekends: number;
    followerWeekendsCameBack: number;
    recent: WeekendComeBack[];
  };
  emails: { sent: number; officialSent: number; opened: number; openDays: number };
  activity: { peopleOpeningRaces: number; cameBackAnotherDay: number; raceOpens: number };
}

const PERIODS = [7, 30, 90, 365] as const;

/** "64%" or "—" when there is nothing to divide by. */
function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

const PUBLISHED_FROM: Record<WeekendComeBack["publishedFrom"], string> = {
  audit: "publish time from the admin log",
  email: "publish time from its first race email",
  created: "publish time from when the race was added",
};

export function AdminEngagementPage() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Engagement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(false);
    api
      .get<Engagement>(`/admin/engagement?days=${days}`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [days]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl pb-24 lg:pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">Engagement</h1>
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-gray-200 dark:border-gray-800 p-0.5">
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-md text-sm ${
                days === d ? "bg-brand-600 text-white font-medium" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              }`}
            >
              {d === 365 ? "Year" : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 max-w-3xl">
        The engagement plan&apos;s measures, from RaceTrace&apos;s own records. Admin accounts are left out, so your
        own use doesn&apos;t count.
      </p>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">The measures could not be loaded. Refresh to try again.</p>
      ) : !data ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-24 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse bg-gray-100 dark:bg-gray-900" />
          ))}
        </div>
      ) : (
        <Measures e={data} />
      )}
    </div>
  );
}

function Measures({ e }: { e: Engagement }) {
  const cb = e.comeBack;
  return (
    <>
      <Section
        title={`Come back within ${cb.hours} hours`}
        note={`Followers of a car or driver in a race weekend who opened one of its races within ${cb.hours} hours of it being published.`}
      >
        <Stat
          label="Weekends with a follower back"
          value={pct(cb.weekendsWithComeBack, cb.weekendsWithFollowers)}
          sub={`${cb.weekendsWithComeBack} of ${cb.weekendsWithFollowers} weekends with followers`}
          strong
        />
        <Stat label="Followers who came back" value={pct(cb.followerWeekendsCameBack, cb.followerWeekends)} sub={`${cb.followerWeekendsCameBack} of ${cb.followerWeekends}, per weekend`} />
        <Stat label="Weekends published" value={String(cb.weekends)} sub={`${cb.weekends - cb.weekendsWithFollowers} with no followers yet`} />
      </Section>

      {cb.recent.length > 0 && (
        <div className="mb-10 -mt-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Weekend</th>
                <th className="px-4 py-2.5 font-semibold">Published</th>
                <th className="px-4 py-2.5 font-semibold text-right">Followers</th>
                <th className="px-4 py-2.5 font-semibold text-right">Back in {cb.hours} h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {cb.recent.map((w) => (
                <tr key={w.key}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{w.track}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {w.series} · {w.date} · {w.races} {w.races === 1 ? "race" : "races"}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400" title={PUBLISHED_FROM[w.publishedFrom]}>
                    {new Date(w.publishedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {w.publishedFrom !== "audit" && <span className="text-gray-400"> *</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{w.followers}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {w.followers ? (
                      <>
                        {w.cameBack} <span className="text-gray-400">({pct(w.cameBack, w.followers)})</span>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cb.recent.some((w) => w.publishedFrom !== "audit") && (
            <p className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-800">
              * No publish record in the admin log: the time of the first race email is used, else when the race was added.
            </p>
          )}
        </div>
      )}

      <Section title="Follows" note="Accounts opened in the period, and what they follow now.">
        <Stat label="New accounts" value={String(e.follows.newAccounts)} />
        <Stat
          label="New accounts following"
          value={pct(e.follows.newAccountsFollowing, e.follows.newAccounts)}
          sub={`${e.follows.newAccountsFollowing} of ${e.follows.newAccounts}`}
          strong
        />
        <Stat label="Follows per new account" value={e.follows.followsPerNewAccount === null ? "—" : e.follows.followsPerNewAccount.toFixed(1)} sub="cars and drivers" />
        <Stat label="Following, all accounts" value={String(e.people.following)} sub={`${e.people.carsFollowed} cars · ${e.people.driversFollowed} drivers · ${e.people.accounts} accounts`} />
      </Section>

      <Section
        title="Race emails"
        note={`Race-ready emails sent in the period, and how many led to that person opening the race within ${e.emails.openDays} days.`}
      >
        <Stat label="Emails on" value={String(e.people.emailsOn)} sub={`of ${e.people.following} following`} />
        <Stat label="Emails sent" value={String(e.emails.sent)} sub={e.emails.officialSent ? `+ ${e.emails.officialSent} "results official"` : undefined} />
        <Stat label="Race opened" value={pct(e.emails.opened, e.emails.sent)} sub={`${e.emails.opened} of ${e.emails.sent}`} strong />
      </Section>

      <Section title="Activity" note="Signed-in people who opened a race in the period.">
        <Stat label="People opening races" value={String(e.activity.peopleOpeningRaces)} />
        <Stat
          label="Came back another day"
          value={pct(e.activity.cameBackAnotherDay, e.activity.peopleOpeningRaces)}
          sub={`${e.activity.cameBackAnotherDay} of ${e.activity.peopleOpeningRaces}`}
          strong
        />
        <Stat label="Race opens" value={String(e.activity.raceOpens)} />
      </Section>

      <section className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5 text-sm text-gray-600 dark:text-gray-400">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50 mb-2">In PostHog</h2>
        <p className="mb-3">These are counted by the site&apos;s anonymous analytics, not stored here. Open them in PostHog › Insights:</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          <li>
            <b className="text-gray-800 dark:text-gray-200">Visits by source:</b> event <code>visit</code>, broken down by <code>source</code>{" "}
            (or <code>landing</code> for the page type)
          </li>
          <li>
            <b className="text-gray-800 dark:text-gray-200">Shares per race:</b> <code>share_card</code> by <code>kind</code>; <code>share_app</code>,{" "}
            <code>share_arrival</code>
          </li>
          <li>
            <b className="text-gray-800 dark:text-gray-200">Coffee:</b> a funnel from <code>coffee_open</code> to <code>coffee_paid</code>, by{" "}
            <code>from</code>
          </li>
          <li>
            <b className="text-gray-800 dark:text-gray-200">Stories and alerts:</b> <code>open_story</code>, <code>alert_open</code>,{" "}
            <code>alert_opt_in</code>
          </li>
        </ul>
      </section>
    </>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{title}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-3xl">{note}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub, strong = false }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${strong ? "border-brand-300 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/20" : "border-gray-200 dark:border-gray-800"}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${strong ? "text-brand-700 dark:text-brand-400" : "text-gray-900 dark:text-gray-50"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  );
}
