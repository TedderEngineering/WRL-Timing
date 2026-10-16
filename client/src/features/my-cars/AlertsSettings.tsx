import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { carTitle, getAlerts, listCars, updateCar, type MyCar } from "./api";
import { switchAlerts } from "./alerts";

/**
 * Settings › Preferences › Alerts (shared "Alerts and preferences" contract): the account's race
 * emails switch, then a switch per car. One component for both sites; `carsHref` is where that
 * site keeps its My cars page.
 */
export function AlertsSettings({ carsHref = "/settings/cars" }: { carsHref?: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [cars, setCars] = useState<MyCar[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getAlerts()
      .then((r) => setOn(r.raceAlerts))
      .catch(() => setError(true));
    listCars()
      .then((r) => setCars(r.cars))
      .catch(() => setCars([]));
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

  const flipCar = async (car: MyCar) => {
    setError(false);
    const next = car.alerts === false;
    setCars((cs) => cs?.map((c) => (c.id === car.id ? { ...c, alerts: next } : c)) ?? cs);
    try {
      await updateCar(car.id, { alerts: next });
    } catch {
      setCars((cs) => cs?.map((c) => (c.id === car.id ? { ...c, alerts: !next } : c)) ?? cs);
      setError(true);
    }
  };

  const raceCars = (cars ?? []).filter((c) => c.series !== "other");

  return (
    <div id="race-emails" className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Alerts</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        One email when a race with one of <Link to={carsHref} className="underline">your cars</Link> is on RaceTrace: its finish and pit
        cycles. A second only if the official results change your car&apos;s result. Every email has a one-click way to turn them off.
      </p>
      <Switch label="Email me when my car's race is up" on={!!on} disabled={on === null} onClick={flip} />

      {on && raceCars.length > 1 && (
        <fieldset className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
          <legend className="mb-2 text-xs text-gray-500 dark:text-gray-400">For these cars</legend>
          <div className="space-y-2">
            {raceCars.map((c) => (
              <Switch key={c.id} label={carTitle(c)} on={c.alerts !== false} onClick={() => flipCar(c)} small />
            ))}
          </div>
        </fieldset>
      )}
      {on && cars !== null && raceCars.length === 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          No race car followed yet. <Link to={carsHref} className="underline">Add one in My cars</Link>.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">That did not save. Try again.</p>}
    </div>
  );
}

function Switch({ label, on, disabled, onClick, small }: { label: string; on: boolean; disabled?: boolean; onClick: () => void; small?: boolean }) {
  return (
    <div className="flex min-h-[36px] items-center justify-between gap-3">
      <span className={`${small ? "text-sm text-gray-600 dark:text-gray-400" : "text-sm text-gray-700 dark:text-gray-300"} min-w-0 truncate`}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-brand-600" : "bg-gray-300 dark:bg-gray-700"}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}
