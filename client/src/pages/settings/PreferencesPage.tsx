import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getAlerts } from "../../features/my-cars/api";
import { switchAlerts } from "../../features/my-cars/alerts";

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

      {/* Chart defaults - placeholder for future */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Chart Defaults
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Default settings applied when viewing race charts.
        </p>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm text-gray-700 dark:text-gray-300">Show pit stop markers</span>
            <ToggleSwitch defaultChecked />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm text-gray-700 dark:text-gray-300">Show FCY/caution periods</span>
            <ToggleSwitch defaultChecked />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm text-gray-700 dark:text-gray-300">Auto-zoom to leader</span>
            <ToggleSwitch />
          </label>
        </div>
      </div>

      {/* Race-ready emails (engagement plan D) */}
      <RaceEmails />
    </div>
  );
}

function ToggleSwitch({ defaultChecked = false }: { defaultChecked?: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
        on ? "bg-brand-600" : "bg-gray-200 dark:bg-gray-700"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
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
