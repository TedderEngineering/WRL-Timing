import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { cn } from "../lib/utils";
import { takePostAuthRedirect } from "../lib/postAuthRedirect";
import { track } from "../lib/analytics";
import { addCar, hasPendingFollow, RACE_SERIES, SERIES_LABEL, type SeriesFamily } from "../features/my-cars/api";

type Theme = "light" | "dark" | "system";

interface OnboardingStep {
  id: string;
  title: string;
}

const ALL_STEPS: OnboardingStep[] = [
  { id: "welcome", title: "Welcome" },
  { id: "car", title: "Your car" },
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
 * "Which car do you follow?" (engagement plan B/C): one number and a series, or Skip. Not
 * asked when the visitor signed up from a race's Follow button (that follow is done on return).
 */
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
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-2">Which car do you follow?</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-sm mx-auto">
        Your car's latest race opens first on your dashboard: its finish, its pit cycles and its story.
      </p>
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
  // Signed up from a race's Follow button: that follow is done on return, so the car step is not asked.
  const [steps] = useState(() => (hasPendingFollow() ? ALL_STEPS.filter((s) => s.id !== "car") : ALL_STEPS));
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
          {at === "car" && <CarStep onNext={next} />}
          {at === "preferences" && <PreferencesStep theme={theme} setTheme={applyTheme} onNext={next} onSkip={next} />}
          {at === "tour" && <TourStep onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}
