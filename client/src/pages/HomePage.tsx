import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";
import { HeroChart } from "../components/landing/HeroChart";
import { FeatureCard } from "../components/landing/FeatureCard";

const PRICE_IDS: Record<string, string | undefined> = {
  PRO: import.meta.env.VITE_STRIPE_PRO_PRICE_ID,
  TEAM: import.meta.env.VITE_STRIPE_TEAM_PRICE_ID,
};

export function HomePage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function handleCheckout(tier: "PRO" | "TEAM") {
    if (!isAuthenticated) {
      navigate("/signup");
      return;
    }
    setCheckoutError(null);

    const priceId = PRICE_IDS[tier];
    if (!priceId) {
      setCheckoutError(`No price configured for ${tier} plan.`);
      return;
    }

    try {
      const { url } = await api.post<{ url: string }>("/billing/create-checkout-session", { priceId });
      window.location.href = url;
    } catch (err: any) {
      setCheckoutError(err.message || "Failed to start checkout. Please try again.");
    }
  }

  return (
    <div className="overflow-hidden">
      {/* ─── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative bg-gray-950 text-white overflow-hidden">
        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-brand-900/20 via-transparent to-gray-950" />

        <div className="relative container-page pt-20 pb-24 lg:pt-28 lg:pb-32">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Copy */}
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 rounded-full px-4 py-1.5 mb-6">
                <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-sm text-brand-300 font-medium tracking-wide">
                  Live race data available
                </span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1]">
                Every position.{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-cyan-400">
                  Every lap.
                </span>{" "}
                Analyzed.
              </h1>

              <p className="mt-6 text-lg text-gray-400 leading-relaxed max-w-lg">
                Interactive position trace charts for endurance racing. Follow
                position battles, identify pit strategy, and uncover the story
                of every race — lap by lap. Built by Tedder Engineering.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">
                <Link to={isAuthenticated ? "/dashboard" : "/signup"}>
                  <Button size="lg" className="text-base px-8">
                    {isAuthenticated ? "Go to Dashboard" : "Get Started Free"}
                  </Button>
                </Link>
                <Link to="/pricing">
                  <Button variant="secondary" size="lg" className="text-base px-8 border-gray-700 text-gray-300 hover:bg-gray-800">
                    View Pricing
                  </Button>
                </Link>
              </div>

              <p className="mt-4 text-sm text-gray-500">
                No credit card required. Free tier includes 3 most recent races.
              </p>
            </div>

            {/* Right: Animated chart preview */}
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-brand-500/10 via-transparent to-cyan-500/10 rounded-2xl blur-2xl" />
              <div className="relative bg-gray-900 border border-gray-800 rounded-xl p-4 shadow-2xl">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-3 w-3 rounded-full bg-red-500/70" />
                  <div className="h-3 w-3 rounded-full bg-yellow-500/70" />
                  <div className="h-3 w-3 rounded-full bg-green-500/70" />
                  <span className="ml-2 text-xs text-gray-500 font-mono">
                    Barber Motorsports Park — 8hr
                  </span>
                </div>
                <HeroChart />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-white dark:from-gray-950" />
      </section>

      {/* ─── Features ──────────────────────────────────────────────────── */}
      <section className="container-page py-20 lg:py-28">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
            Everything you need to decode a race
          </h2>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
            From position traces to pit stop analysis, our tools turn raw timing
            data into clear, actionable insights.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <FeatureCard
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
              </svg>
            }
            title="Position Trace Charts"
            description="Follow every car's journey through the field on an interactive lap-by-lap chart. Spot passes, failures, and lead changes at a glance."
          />
          <FeatureCard
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
              </svg>
            }
            title="Filter by Class & Team"
            description="Isolate individual cars, classes, or teams to focus your analysis. Highlight the battles that matter most to you."
          />
          <FeatureCard
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
            title="Pit Stop Strategy"
            description="Visualize pit windows, in-laps, and out-laps. Understand how strategy calls shaped the race outcome."
          />
          <FeatureCard
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            }
            title="Export & Share"
            description="Download chart images and CSV data. Share insights with your team to prepare for the next event."
          />
        </div>
      </section>

      {/* ─── How It Works ──────────────────────────────────────────────── */}
      <section className="bg-gray-50 dark:bg-gray-900/50 border-y border-gray-200 dark:border-gray-800">
        <div className="container-page py-20 lg:py-28">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
              From sign-up to insights in minutes
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12 max-w-4xl mx-auto">
            {[
              {
                step: "01",
                title: "Create your account",
                desc: "Sign up for free in seconds. No credit card required to start exploring race data.",
              },
              {
                step: "02",
                title: "Select a race",
                desc: "Browse races from WRL, IMSA, SRO, and more. Pick any race from the current or past seasons.",
              },
              {
                step: "03",
                title: "Analyze & discover",
                desc: "Interact with the lap chart — hover, filter, zoom. Uncover the story behind every position change.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 text-xl font-bold mb-4">
                  {item.step}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-2">
                  {item.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing Preview ──────────────────────────────────────────── */}
      <section className="container-page py-20 lg:py-28">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
            Start free. Upgrade when you need full access to every race and advanced features.
          </p>
        </div>

        {checkoutError && (
          <div className="max-w-4xl mx-auto mb-6">
            <Alert variant="error">{checkoutError}</Alert>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {[
            {
              name: "Free",
              price: "$0",
              desc: "Perfect for curious fans",
              features: ["3 most recent races", "Basic chart viewing", "Up to 5 favorites"],
              cta: "Get Started",
              tier: null as null,
              highlighted: false,
            },
            {
              name: "Pro",
              price: "$200",
              period: "/yr",
              secondaryPrice: "$17/mo billed annually",
              desc: "For dedicated analysts",
              features: ["All races, all seasons", "Filter, zoom, & export", "Unlimited favorites", "CSV & PNG export"],
              cta: "Start Pro",
              tier: "PRO" as const,
              highlighted: true,
            },
            {
              name: "Team",
              price: "$500",
              period: "/yr",
              secondaryPrice: "$42/mo billed annually",
              desc: "For race teams & groups",
              features: ["Everything in Pro", "Up to 10 team members", "API access", "Priority support"],
              cta: "Start Team",
              tier: "TEAM" as const,
              highlighted: false,
            },
          ].map((t) => (
            <div
              key={t.name}
              className={`relative rounded-xl border p-6 lg:p-8 flex flex-col ${
                t.highlighted
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-950/20 shadow-lg shadow-brand-500/10"
                  : "border-gray-200 dark:border-gray-800"
              }`}
            >
              {t.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  Most Popular
                </div>
              )}
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                {t.name}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {t.desc}
              </p>
              <div className="mt-4 mb-6">
                <span className="text-4xl font-bold text-gray-900 dark:text-gray-50">
                  {t.price}
                </span>
                {t.period && (
                  <span className="text-gray-500 dark:text-gray-400">
                    {t.period}
                  </span>
                )}
                {t.secondaryPrice && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t.secondaryPrice}
                  </p>
                )}
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <svg className="h-5 w-5 text-brand-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              {t.tier ? (
                <Button
                  variant={t.highlighted ? "primary" : "secondary"}
                  className="w-full"
                  onClick={() => handleCheckout(t.tier!)}
                >
                  {t.cta}
                </Button>
              ) : (
                <Link to="/signup">
                  <Button variant="secondary" className="w-full">
                    {t.cta}
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-8">
          All plans include a 14-day money-back guarantee.{" "}
          <Link to="/pricing" className="text-brand-600 dark:text-brand-400 hover:underline">
            See full comparison →
          </Link>
        </p>
      </section>

      {/* ─── Final CTA ─────────────────────────────────────────────────── */}
      <section className="relative bg-gray-950 text-white overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative container-page py-20 lg:py-24 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Ready to see the race differently?
          </h2>
          <p className="mt-4 text-lg text-gray-400 max-w-lg mx-auto">
            Join teams and fans already using RaceTrace to analyze every lap.
          </p>
          <div className="mt-8">
            <Link to={isAuthenticated ? "/dashboard" : "/signup"}>
              <Button size="lg" className="text-base px-10">
                {isAuthenticated ? "Open Dashboard" : "Create Free Account"}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
