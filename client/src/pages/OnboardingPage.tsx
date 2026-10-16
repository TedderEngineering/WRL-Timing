import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { cn } from "../lib/utils";
import { takePostAuthRedirect } from "../lib/postAuthRedirect";
import { track } from "../lib/analytics";
import { addCar, hasPendingFollow, RACE_SERIES, SERIES_LABEL, type SeriesFamily } from "../features/my-cars/api";
import { followDriver, followedAs, hasPendingDriver, unfollowDriver, useMyDrivers } from "../features/my-drivers/api";
import { useDriverSearch } from "../features/races/DriverResults";

type Theme = "light" | "dark" | "system";

interface OnboardingStep {
  id: string;
  title: string;
}

const ALL_STEPS: OnboardingStep[] = [
  { id: "welcome", title: "Welcome" },
  { id: "car", title: "Who you follow" },
  { id: "preferences", title: "Preferences" },
  { id: "tour", title: "Quick Tour" },
];

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 rounded-full transition-all duration-300",
            i === current
              ? "w-8 bg-brand-600"
              : i < current
                ? "w-2 bg-brand-400"
                : "w-2 bg-gray-200 dark:bg-gray-700"
          )}
        />
      ))}
    </div>
  );
}

function WelcomeStep({ name, onNext }: { name: string; onNext: () => void }) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 mb-6">
        <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-2">
        Welcome{name ? `, ${name}` : ""}!
      </h2>
      <p className="text-gray-600 dark:text-gray-400 max-w-sm mx-auto mb-8">
        You're all set to explore race data. Let's personalize your experience
        in just a couple of quick steps.
      </p>
      <Button onClick={onNext} size="lg" className="px-10">
        Let's go
      </Button>
    </div>
  );
}

/**
 * "Who do you follow?": a car (number and series) or a driver (found by name), or Skip. Either
 * one's latest race opens first on the Dashboard. Not asked when the visitor signed up from a
 * race page's Follow button (that follow is done on return).
 */
function FollowStep({ onNext }: { onNext: () => void }) {
  const [kind, setKind] = useState<"car" | "driver">("car");
  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-2">Who do you follow?</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-5 max-w-sm mx-auto">
        Their latest race opens first on your dashboard: the finish, the pit cycles and the story.
      </p>
      <div role="tablist" aria-label="Follow a car or a driver" className="mx-auto mb-5 grid max-w-xs grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        {(
          [
            ["car", "A car"],
            ["driver", "A driver"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "min-h-[40px] rounded-md text-sm font-semibold",
              kind === k ? "bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-gray-50" : "text-gray-600 dark:text-gray-400"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "car" ? <CarStep onNext={onNext} /> : <DriverStep onNext={onNext} />}
    </div>
  );
}

/** Find a driver by name and follow one or more; Continue once one is followed. */
function DriverStep({ onNext }: { onNext: () => void }) {
  const { user } = useAuth();
  const mine = useMyDrivers(user?.id);
  const [query, setQuery] = useState("");
  const { drivers: found, loading } = useDriverSearch(query);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100";

  const toggle = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      const f = followedAs(mine, name);
      if (f) await unfollowDriver(f.id);
      else if ((await followDriver(name)).created) track("follow_driver", { source: "onboarding" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not save. You can follow drivers later in Settings → My drivers.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="text-left">
      <label className="block max-w-sm mx-auto">
        <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Driver&apos;s name</span>
        <input className={field} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="At least 3 letters" autoComplete="off" autoFocus />
      </label>
      <div className="max-w-sm mx-auto mt-2 min-h-[48px]">
        {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Searching…</p>}
        {!loading && query.trim().length >= 3 && found.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No driver called &ldquo;{query.trim()}&rdquo; in a race on RaceTrace yet.</p>
        )}
        {found.length > 0 && (
          <ul className="m-0 list-none divide-y divide-gray-200 rounded-lg border border-gray-200 p-0 dark:divide-gray-800 dark:border-gray-800">
            {found.slice(0, 5).map((d) => {
              const f = followedAs(mine, d.name);
              const r = d.races[0];
              return (
                <li key={d.name} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{d.name}</div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {d.races.length} race{d.races.length === 1 ? "" : "s"}
                      {r ? ` · latest #${r.carNumber} ${r.carClass}, ${r.raceName}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-pressed={!!f}
                    disabled={busy === d.name || mine === null}
                    onClick={() => toggle(d.name)}
                    className={cn(
                      "min-h-[36px] shrink-0 rounded-full border px-3 text-[13px] font-semibold disabled:opacity-50",
                      f ? "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300" : "border-gray-300 text-gray-800 dark:border-gray-700 dark:text-gray-200"
                    )}
                  >
                    {f ? "✓ Following" : "+ Follow"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-3 mb-6">Follow more drivers, or cars, any time in Settings.</p>
      {error && <p role="alert" className="text-sm text-center text-red-600 dark:text-red-400 mb-4">{error}</p>}
      <div className="flex items-center justify-center gap-3">
        <Button type="button" variant="ghost" onClick={onNext}>
          Skip
        </Button>
        <Button type="button" size="lg" className="px-10" disabled={!mine?.length} onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}

/** The car side of "Who do you follow?": one number and a series. */
function CarStep({ onNext }: { onNext: () => void }) {
  const [number, setNumber] = useState("");
  const [series, setSeries] = useState<SeriesFamily>("wrl");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = number.trim().replace(/^#/, "");
    if (!/^[0-9A-Za-z]{1,8}$/.test(n)) return setError("Enter the car number, e.g. 67.");
    setBusy(true);
    setError(null);
    try {
      await addCar({ number: n, series, season: null });
      track("follow_car", { series, source: "onboarding" });
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not save. You can add it later in Settings → My cars.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="text-center" onSubmit={save}>
      <div className="grid grid-cols-[1fr_1.2fr] gap-3 max-w-xs mx-auto mb-2 text-left">
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Car number</span>
          <input className={field} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="67" autoFocus />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Series</span>
          <select className={field} value={series} onChange={(e) => setSeries(e.target.value as SeriesFamily)}>
            {RACE_SERIES.map((s) => (
              <option key={s} value={s}>{SERIES_LABEL[s]}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">Add a team, a season or more cars any time in Settings → My cars.</p>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}
      <div className="flex items-center justify-center gap-3">
        <Button type="button" variant="ghost" onClick={onNext}>
          Skip
        </Button>
        <Button type="submit" size="lg" className="px-10" disabled={busy}>
          Follow this car
        </Button>
      </div>
    </form>
  );
}

function PreferencesStep({
  theme,
  setTheme,
  onNext,
  onSkip,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const themes: { value: Theme; label: string; icon: string }[] = [
    { value: "light", label: "Light", icon: "☀️" },
    { value: "dark", label: "Dark", icon: "🌙" },
    { value: "system", label: "System", icon: "💻" },
  ];

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-2">
        Set your preferences
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Choose a theme. You can always change this later in settings.
      </p>

      <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto mb-8">
        {themes.map((t) => (
          <button
            key={t.value}
            onClick={() => setTheme(t.value)}
            className={cn(
              "flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 transition-all",
              theme === t.value
                ? "border-brand-500 bg-brand-50 dark:bg-brand-950/20"
                : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
            )}
          >
            <span className="text-2xl">{t.icon}</span>
            <span
              className={cn(
                "text-sm font-medium",
                theme === t.value
                  ? "text-brand-700 dark:text-brand-400"
                  : "text-gray-600 dark:text-gray-400"
              )}
            >
              {t.label}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-center gap-3">
        <Button variant="ghost" onClick={onSkip}>
          Skip
        </Button>
        <Button onClick={onNext} size="lg" className="px-10">
          Continue
        </Button>
      </div>
    </div>
  );
}

function TourStep({ onFinish }: { onFinish: () => void }) {
  const tips = [
    {
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
        </svg>
      ),
      title: "Browse races",
      desc: "Head to the Races page to see every available event. Use filters to find specific tracks or seasons.",
    },
    {
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
        </svg>
      ),
      title: "Interact with charts",
      desc: "Hover on any line to see car details. Click to highlight a car. Use the class filter to focus on specific battles.",
    },
    {
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
      ),
      title: "Save favorites",
      desc: "Bookmark your favorite races for quick access. They'll show up on your dashboard whenever you log in.",
    },
  ];

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-2">
        Quick tour
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Here's what you can do with RaceTrace.
      </p>

      <div className="space-y-4 max-w-md mx-auto text-left mb-8">
        {tips.map((tip) => (
          <div
            key={tip.title}
            className="flex gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50"
          >
            <div className="shrink-0 h-10 w-10 rounded-lg bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 flex items-center justify-center">
              {tip.icon}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                {tip.title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                {tip.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      <Button onClick={onFinish} size="lg" className="px-10">
        Start exploring
      </Button>
    </div>
  );
}

export function OnboardingPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  // Signed up from a race page's Follow button (car or driver): that follow is done on return, so
  // "Who do you follow?" is not asked.
  const [steps] = useState(() => (hasPendingFollow() || hasPendingDriver() ? ALL_STEPS.filter((s) => s.id !== "car") : ALL_STEPS));
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState<Theme>("dark");
  const at = steps[step]?.id;
  const next = () => setStep((n) => n + 1);

  const applyTheme = (t: Theme) => {
    setTheme(t);
    const root = document.documentElement;
    if (t === "dark") {
      root.classList.add("dark");
    } else if (t === "light") {
      root.classList.remove("dark");
    } else {
      // System
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
  };

  const finish = async () => {
    try {
      await api.put("/auth/onboarding-complete", { theme });
      await refreshUser();
    } catch {
      // Non-critical — proceed anyway
    }
    navigate(takePostAuthRedirect("/dashboard"), { replace: true });
  };

  return (
    <div className="container-page flex items-center justify-center min-h-[80vh] py-12">
      <div className="w-full max-w-lg">
        <StepIndicator current={step} total={steps.length} />

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-sm">
          {at === "welcome" && <WelcomeStep name={user?.displayName || ""} onNext={next} />}
          {at === "car" && <FollowStep onNext={next} />}
          {at === "preferences" && <PreferencesStep theme={theme} setTheme={applyTheme} onNext={next} onSkip={next} />}
          {at === "tour" && <TourStep onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}
