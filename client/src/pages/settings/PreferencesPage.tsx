import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getAlerts } from "../../features/my-cars/api";
import { switchAlerts } from "../../features/my-cars/alerts";
import type { ChartDefaults } from "@shared/types";
import { loadChartDefaults, readChartDefaults, saveChartDefaults } from "../../features/chart/chart-defaults";

type Theme = "light" | "dark" | "system";

function getStoredTheme(): Theme {
  return (localStorage.getItem("theme") as Theme) || "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  localStorage.setItem("theme", theme);
}

export function PreferencesPage() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system theme changes when "system" is selected
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const THEMES: { value: Theme; label: string; desc: string; icon: string }[] = [
    { value: "light", label: "Light", desc: "Always use light mode", icon: "☀️" },
    { value: "dark", label: "Dark", desc: "Always use dark mode", icon: "🌙" },
    { value: "system", label: "System", desc: "Match your OS setting", icon: "💻" },
  ];

  return (
    <div className="space-y-8 max-w-lg">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">Preferences</h2>

      {/* Theme */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Appearance
        </h3>
        <div className="grid gap-2">
          {THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border-2 text-left transition-colors ${
                theme === t.value
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-950/20"
                  : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
              }`}
            >
              <span className="text-xl">{t.icon}</span>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t.desc}</p>
              </div>
              {theme === t.value && (
                <span className="ml-auto text-brand-600 dark:text-brand-400 text-sm font-bold">✓</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* How race pages open (saved to the account) */}
      <ChartDefaultsSection />

      {/* Race-ready emails (engagement plan D) */}
      <RaceEmails />
    </div>
  );
}

type Choice<K extends keyof ChartDefaults> = { value: ChartDefaults[K]; label: string };

const CHOICES: { [K in keyof ChartDefaults]: { label: string; options: Choice<K>[] } } = {
  openOn: {
    label: "Open a race on",
    options: [
      { value: "my_car", label: "My car, when it ran" },
      { value: "winner", label: "The overall winner" },
    ],
  },
  classView: {
    label: "Show",
    options: [
      { value: "all", label: "The whole field" },
      { value: "focus_class", label: "Just that car's class" },
    ],
  },
  axis: {
    label: "Position Trace axis",
    options: [
      { value: "laps", label: "Laps" },
      { value: "hours", label: "Race time" },
      { value: "both", label: "Both" },
    ],
  },
  tab: {
    label: "Start on",
    options: [
      { value: "position", label: "Position Trace" },
      { value: "pitanalysis", label: "Pit Stops" },
      { value: "laptimes", label: "Lap Times" },
      { value: "strategy", label: "Strategy" },
    ],
  },
};

/** Chart defaults: how every race page opens. Saved to the account on each change. */
function ChartDefaultsSection() {
  const [d, setD] = useState<ChartDefaults>(readChartDefaults);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    loadChartDefaults().then(setD).catch(() => setStatus("error"));
  }, []);
  const pick = async <K extends keyof ChartDefaults>(key: K, value: ChartDefaults[K]) => {
    const before = d;
    setD({ ...d, [key]: value });
    setStatus("saving");
    try {
      setD(await saveChartDefaults({ [key]: value } as Partial<ChartDefaults>));
      setStatus("saved");
    } catch {
      setD(before);
      setStatus("error");
    }
  };
  return (
    <div id="chart-defaults" className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Chart defaults</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400" role="status">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Couldn't save. Try again." : ""}
        </span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        How every race opens for you, on any device. A link that names a car or a tab still opens on it.
      </p>
      <div className="space-y-4">
        {(Object.keys(CHOICES) as (keyof ChartDefaults)[]).map((key) => {
          const c = CHOICES[key];
          return (
            <fieldset key={key}>
              <legend className="mb-1.5 text-sm text-gray-700 dark:text-gray-300">{c.label}</legend>
              <div className="flex flex-wrap gap-1.5">
                {c.options.map((o) => {
                  const on = d[key] === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => !on && pick(key, o.value as never)}
                      className={`min-h-[36px] rounded-lg border px-3 text-sm transition-colors ${
                        on
                          ? "border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/30 dark:text-brand-300"
                          : "border-gray-200 text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:text-gray-300 dark:hover:border-gray-700"
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}

/** One switch: an email when a race with one of your cars is up. Off until turned on. */
function RaceEmails() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    getAlerts()
      .then((r) => setOn(r.raceAlerts))
      .catch(() => setError(true));
  }, []);
  const flip = async () => {
    if (on === null) return;
    setError(false);
    try {
      setOn(await switchAlerts(!on, "settings"));
    } catch {
      setError(true);
    }
  };
  return (
    <div id="race-emails" className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Race emails</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        One email when a race with one of <Link to="/settings/cars" className="underline">your cars</Link> is on RaceTrace: its finish and pit
        cycles. At most one per race; every email has a one-click way to turn them off.
      </p>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-700 dark:text-gray-300">Email me when my car&apos;s race is up</span>
        <button
          type="button"
          role="switch"
          aria-checked={!!on}
          aria-label="Email me when my car's race is up"
          disabled={on === null}
          onClick={flip}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-brand-600" : "bg-gray-300 dark:bg-gray-700"}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">That did not save. Try again.</p>}
    </div>
  );
}
