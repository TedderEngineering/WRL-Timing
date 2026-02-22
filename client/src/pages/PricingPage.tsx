import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Button } from "../components/Button";
import { cn } from "../lib/utils";

type Interval = "monthly" | "annual";

const TIERS = [
  {
    id: "free" as const,
    name: "Free",
    description: "Perfect for curious fans",
    monthlyPrice: 0,
    annualPrice: 0,
    cta: "Get Started",
    highlighted: false,
  },
  {
    id: "pro" as const,
    name: "Pro",
    description: "For dedicated analysts",
    monthlyPrice: 9.99,
    annualPrice: 99,
    cta: "Start Pro",
    highlighted: true,
  },
  {
    id: "team" as const,
    name: "Team",
    description: "For race teams & groups",
    monthlyPrice: 29.99,
    annualPrice: 299,
    cta: "Start Team",
    highlighted: false,
  },
];

interface FeatureRow {
  feature: string;
  free: string | boolean;
  pro: string | boolean;
  team: string | boolean;
}

const COMPARISON: FeatureRow[] = [
  { feature: "Race chart access", free: "3 most recent", pro: "All races", team: "All races" },
  { feature: "Historical seasons", free: false, pro: true, team: true },
  { feature: "Chart interactivity", free: "View only", pro: "Full (filter, zoom)", team: "Full (filter, zoom)" },
  { feature: "Favorites", free: "Up to 5", pro: "Unlimited", team: "Unlimited" },
  { feature: "CSV export", free: false, pro: true, team: true },
  { feature: "PNG chart export", free: false, pro: true, team: true },
  { feature: "API access", free: false, pro: false, team: true },
  { feature: "Team members", free: "1", pro: "1", team: "Up to 10" },
  { feature: "Priority support", free: false, pro: false, team: true },
];

function formatPrice(price: number): string {
  if (price === 0) return "$0";
  return `$${price % 1 === 0 ? price : price.toFixed(2)}`;
}

function CellValue({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <svg className="h-5 w-5 text-brand-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    ) : (
      <svg className="h-5 w-5 text-gray-300 dark:text-gray-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  return <span className="text-sm text-gray-700 dark:text-gray-300">{value}</span>;
}

export function PricingPage() {
  const [interval, setInterval] = useState<Interval>("monthly");
  const { isAuthenticated, user } = useAuth();

  const currentPlan = user?.subscription?.plan ?? "FREE";

  function ctaForTier(tierId: string) {
    if (!isAuthenticated) return tierId === "free" ? "/signup" : "/signup";
    if (tierId.toUpperCase() === currentPlan) return null; // current plan
    return "/settings/billing"; // upgrade path
  }

  return (
    <div className="container-page py-16 lg:py-24">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
          Choose your plan
        </h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
          Start free. Upgrade anytime for full access to full access to every race in the library.
        </p>
      </div>

      {/* Interval toggle */}
      <div className="flex items-center justify-center gap-3 mb-12">
        <button
          onClick={() => setInterval("monthly")}
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
            interval === "monthly"
              ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          )}
        >
          Monthly
        </button>
        <button
          onClick={() => setInterval("annual")}
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-lg transition-colors relative",
            interval === "annual"
              ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          )}
        >
          Annual
          <span className="absolute -top-2 -right-12 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            Save 17%
          </span>
        </button>
      </div>

      {/* Tier cards */}
      <div className="grid md:grid-cols-3 gap-6 lg:gap-8 max-w-5xl mx-auto mb-20">
        {TIERS.map((tier) => {
          const price = interval === "monthly" ? tier.monthlyPrice : tier.annualPrice;
          const isCurrentPlan = isAuthenticated && tier.id.toUpperCase() === currentPlan;
          const href = ctaForTier(tier.id);

          return (
            <div
              key={tier.id}
              className={cn(
                "relative rounded-2xl border p-6 lg:p-8 flex flex-col",
                tier.highlighted
                  ? "border-brand-500 shadow-xl shadow-brand-500/10 bg-white dark:bg-gray-900"
                  : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
              )}
            >
              {tier.highlighted && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-semibold px-4 py-1 rounded-full">
                  Most Popular
                </div>
              )}

              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">
                {tier.name}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-6">
                {tier.description}
              </p>

              <div className="mb-8">
                <span className="text-5xl font-extrabold text-gray-900 dark:text-gray-50 tracking-tight">
                  {formatPrice(price)}
                </span>
                {price > 0 && (
                  <span className="text-gray-500 dark:text-gray-400 ml-1">
                    /{interval === "monthly" ? "mo" : "yr"}
                  </span>
                )}
                {interval === "annual" && price > 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {formatPrice(price / 12)}/mo billed annually
                  </p>
                )}
              </div>

              <div className="flex-1" />

              {isCurrentPlan ? (
                <Button variant="secondary" disabled className="w-full">
                  Current Plan
                </Button>
              ) : href ? (
                <Link to={href}>
                  <Button
                    variant={tier.highlighted ? "primary" : "secondary"}
                    className="w-full"
                    size="lg"
                  >
                    {tier.cta}
                  </Button>
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Feature comparison table */}
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 text-center mb-8">
          Compare features
        </h2>

        {/* Desktop table */}
        <div className="hidden md:block overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900">
                <th className="text-left text-sm font-semibold text-gray-900 dark:text-gray-100 py-4 px-6 w-2/5">
                  Feature
                </th>
                {TIERS.map((tier) => (
                  <th
                    key={tier.id}
                    className="text-center text-sm font-semibold text-gray-900 dark:text-gray-100 py-4 px-4"
                  >
                    {tier.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row, i) => (
                <tr
                  key={row.feature}
                  className={cn(
                    "border-t border-gray-100 dark:border-gray-800",
                    i % 2 === 0 ? "bg-white dark:bg-gray-950" : "bg-gray-50/50 dark:bg-gray-900/50"
                  )}
                >
                  <td className="py-3.5 px-6 text-sm text-gray-700 dark:text-gray-300">
                    {row.feature}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <CellValue value={row.free} />
                  </td>
                  <td className="py-3.5 px-4 text-center bg-brand-50/30 dark:bg-brand-950/10">
                    <CellValue value={row.pro} />
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <CellValue value={row.team} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile comparison: stacked cards */}
        <div className="md:hidden space-y-6">
          {COMPARISON.map((row) => (
            <div
              key={row.feature}
              className="border border-gray-200 dark:border-gray-800 rounded-lg p-4"
            >
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                {row.feature}
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {(["free", "pro", "team"] as const).map((tier) => (
                  <div key={tier}>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 capitalize">
                      {tier}
                    </p>
                    <CellValue value={row[tier]} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ teaser */}
      <div className="text-center mt-16">
        <p className="text-gray-600 dark:text-gray-400">
          Questions?{" "}
          <a
            href="mailto:support@tedderengineering.com"
            className="text-brand-600 dark:text-brand-400 hover:underline"
          >
            Contact us
          </a>{" "}
          — we're happy to help.
        </p>
      </div>
    </div>
  );
}
