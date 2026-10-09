import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { gripApi } from "@/features/grip/api";
import { useLoad } from "@/features/grip/hooks";
import { startCheckout } from "@/features/grip/UpgradeDialog";
import {
  Card,
  CornerGrid,
  GripButton,
  Pill,
  Spinner,
  WeatherPill,
  primaryLinkClass,
  secondaryLinkClass,
} from "@/features/grip/components";
import { rememberPostAuthRedirect } from "@/lib/postAuthRedirect";
import { cn } from "@/lib/utils";

/**
 * Annual price shown on the pricing cards, e.g. "$120". Leave null until the
 * Stripe price exists; the cards then say the price is still to be announced.
 */
const PRO_PRICE_PER_YEAR: string | null = null;

const signUpProps = {
  to: "/signup",
  onClick: () => rememberPostAuthRedirect("/grip/dashboard"),
};

/** While Finding Grip is limited to testers, signed-out visitors see this instead of the marketing pages. */
function PrivateNotice() {
  return (
    <div className="container-page py-24 text-center max-w-xl">
      <Pill tone="pro">Coming soon</Pill>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
        Finding Grip
      </h1>
      <p className="mt-3 text-gray-600 dark:text-gray-400">
        Tire pressure and damper tools from Tedder Engineering. Currently in private
        testing.
      </p>
      <Link
        to="/login"
        state={{ from: { pathname: "/grip/dashboard" } }}
        className={cn(secondaryLinkClass, "mt-6 px-5 py-2.5 text-sm")}
      >
        Tester log in
      </Link>
    </div>
  );
}

function useOpenToPublic() {
  const { isAuthenticated } = useAuth();
  const status = useLoad(() => gripApi.status().catch(() => ({ open: false })));
  return { loading: status.loading, show: isAuthenticated || !!status.data?.open };
}

function Check() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function PlanCards() {
  const { isAuthenticated } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startPro = async () => {
    setBusy(true);
    setError(null);
    const message = await startCheckout();
    if (message) {
      setError(message);
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <p className="mb-4 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="grid gap-5 md:grid-cols-2 max-w-3xl mx-auto">
        <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">Free</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Try it on your own car
            </p>
          </div>
          <div className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
            $0
          </div>
          <ul className="flex-1 space-y-2 text-sm text-gray-600 dark:text-gray-300">
            {[
              "Unlimited reference sessions",
              "3 tire pressure calculations",
              "PSI / °F or bar / °C",
            ].map((f) => (
              <li key={f} className="flex gap-2">
                <Check />
                {f}
              </li>
            ))}
          </ul>
          {isAuthenticated ? (
            <Link
              to="/grip/dashboard"
              className={cn(secondaryLinkClass, "px-4 py-2.5 text-sm")}
            >
              Open Finding Grip
            </Link>
          ) : (
            <Link
              {...signUpProps}
              className={cn(secondaryLinkClass, "px-4 py-2.5 text-sm")}
            >
              Get Started
            </Link>
          )}
        </div>

        <div className="relative flex flex-col gap-4 rounded-2xl border border-grip-500 bg-white dark:bg-gray-900 p-6">
          <span className="absolute -top-3 left-6 rounded-full bg-grip-500 px-2.5 py-0.5 text-[11px] font-bold text-gray-950">
            Most Popular
          </span>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">Pro</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              For every session of the season
            </p>
          </div>
          <div>
            {PRO_PRICE_PER_YEAR ? (
              <>
                <span className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
                  {PRO_PRICE_PER_YEAR}
                </span>
                <span className="text-gray-500">/yr</span>
              </>
            ) : (
              <span className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
                Price to be announced
              </span>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-400">Billed annually</p>
          </div>
          <ul className="flex-1 space-y-2 text-sm text-gray-600 dark:text-gray-300">
            {[
              "Unlimited tire pressure calculations",
              "Damper Tuning Tool, rebound-only and two-way",
              "Everything in Free",
            ].map((f) => (
              <li key={f} className="flex gap-2">
                <Check />
                {f}
              </li>
            ))}
          </ul>
          {isAuthenticated ? (
            <GripButton loading={busy} onClick={startPro}>
              Start Pro
            </GripButton>
          ) : (
            <Link
              {...signUpProps}
              className={cn(primaryLinkClass, "px-4 py-2.5 text-sm")}
            >
              Start Pro
            </Link>
          )}
        </div>
      </div>
      <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        All plans include a 14-day money-back guarantee. Cancel any time and keep access
        through the end of the billing period.
      </p>
    </>
  );
}

export function GripHomePage() {
  const { isAuthenticated } = useAuth();
  const { loading, show } = useOpenToPublic();
  if (isAuthenticated) return <Navigate to="/grip/dashboard" replace />;
  if (loading) return <Spinner />;
  if (!show) return <PrivateNotice />;

  return (
    <div>
      <section className="border-b border-gray-200 dark:border-gray-800">
        <div className="container-page grid gap-10 lg:grid-cols-2 items-center py-12 lg:py-20">
          <div className="space-y-5">
            <Pill tone="pro">Tire pressure &amp; damper tools</Pill>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.05] text-gray-900 dark:text-white">
              Set cold pressures that{" "}
              <span className="text-grip-600 dark:text-grip-400">come in on target.</span>
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-xl">
              Finding Grip turns one good reference session into cold tire pressures for
              today's track temperature, wheel temperature and run length, corner by
              corner. Built by Tedder Engineering.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                {...signUpProps}
                className={cn(primaryLinkClass, "px-7 py-3 text-base")}
              >
                Get Started Free
              </Link>
              <Link
                to="/grip/pricing"
                className={cn(secondaryLinkClass, "px-7 py-3 text-base")}
              >
                View Pricing
              </Link>
            </div>
            <p className="text-sm text-gray-500">
              No credit card required. Free tier includes 3 calculations.
            </p>
          </div>

          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
                  Cold tire pressure · example
                </div>
                <div className="font-semibold text-gray-900 dark:text-gray-100">
                  Race 2 morning
                </div>
              </div>
              <WeatherPill weather="DRY" />
            </div>
            <CornerGrid
              emphasis
              unit="PSI"
              values={{ lf: "27.2", rf: "27.5", lr: "26.9", rr: "27.2" }}
              detail={{
                lf: "target hot 30.5",
                rf: "target hot 30.5",
                lr: "target hot 30.0",
                rr: "target hot 30.0",
              }}
            />
            <p className="text-xs text-gray-500">
              Illustrative numbers. Yours come from your own reference session.
            </p>
          </Card>
        </div>
      </section>

      <section className="container-page py-14">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
          From one good session to every session
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              "Cold Pressure Calculator",
              "Enter today's conditions and your hot targets. Get a cold pressure for each corner, dry or wet.",
            ],
            [
              "Reference Sessions",
              "Save the baseline once: temperatures, run length, cold and hot pressures. Reuse it all season.",
            ],
            [
              "Damper Tuning Tool",
              "Describe the problem by corner phase and speed. Get up to three adjustments to try, in order.",
            ],
            [
              "Standard or metric",
              "Work in PSI and °F or bar and °C. Switch any time; your saved data follows.",
            ],
          ].map(([title, body]) => (
            <Card key={title} className="space-y-1.5">
              <h3 className="font-bold text-gray-900 dark:text-gray-50">{title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="container-page pb-14">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
          How a weekend goes
        </h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            [
              "Log a reference session",
              "After a representative run, record temperatures, duration, and cold and hot pressures.",
            ],
            [
              "Calculate the next run",
              "Pick the reference, enter today's conditions and target hot pressures, and set what it tells you.",
            ],
            [
              "Convert it to a new reference",
              "Add the hot pressures you measured and that run becomes your newest baseline.",
            ],
          ].map(([title, body], i) => (
            <li key={title}>
              <div className="text-3xl font-extrabold tabular-nums text-grip-600 dark:text-grip-400">
                0{i + 1}
              </div>
              <h3 className="mt-1 font-bold text-gray-900 dark:text-gray-50">{title}</h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="container-page pb-16">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
          Simple, transparent pricing
        </h2>
        <p className="mt-2 mb-8 text-center text-gray-600 dark:text-gray-400">
          Start free. Upgrade when you need unlimited calculations and the damper tool.
        </p>
        <PlanCards />
      </section>
    </div>
  );
}

const COMPARE: [string, string, string][] = [
  ["Reference sessions", "Unlimited", "Unlimited"],
  ["Tire pressure calculations", "3 total", "Unlimited"],
  ["Dry and wet calculations", "Yes", "Yes"],
  ["Convert a calculation to a reference", "Yes", "Yes"],
  ["Damper Tuning Tool", "—", "Yes"],
  ["Standard and metric units", "Yes", "Yes"],
];

export function GripPricingPage() {
  const { loading, show } = useOpenToPublic();
  const [params] = useSearchParams();
  if (loading) return <Spinner />;
  if (!show) return <PrivateNotice />;

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
          Choose your plan
        </h1>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          Start free. Upgrade any time for unlimited calculations and the Damper Tuning
          Tool.
        </p>
        {params.has("canceled") && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            Checkout was cancelled. You have not been charged.
          </p>
        )}
      </div>
      <PlanCards />

      <h2 className="mt-14 mb-4 text-center text-xl font-bold text-gray-900 dark:text-gray-50">
        Compare features
      </h2>
      <div className="max-w-3xl mx-auto overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-gray-500">
              <th className="px-4 py-3 font-bold">Feature</th>
              <th className="px-4 py-3 font-bold">Free</th>
              <th className="px-4 py-3 font-bold">Pro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800 border-t border-gray-200 dark:border-gray-800">
            {COMPARE.map(([feature, free, pro]) => (
              <tr key={feature}>
                <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{feature}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{free}</td>
                <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-center text-sm text-gray-500">
        Questions?{" "}
        <a
          href="https://tedderengineering.com#contact"
          className="font-medium text-grip-600 dark:text-grip-400 hover:underline"
        >
          Contact us
        </a>
        . We're happy to help.
      </p>
    </div>
  );
}
