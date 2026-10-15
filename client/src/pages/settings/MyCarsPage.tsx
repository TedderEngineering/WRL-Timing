import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button";
import { track } from "../../lib/analytics";
import { addCar, carTitle, listCars, removeCar, SERIES_LABEL, updateCar, type CarInput, type MyCar, type SeriesFamily } from "../../features/my-cars/api";

const SERIES: SeriesFamily[] = ["imsa", "sro", "wrl"];
const field = "w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100";
const label = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

interface FormState {
  number: string;
  series: SeriesFamily;
  teamName: string;
  season: string;
  label: string;
}
const blank = (): FormState => ({ number: "", series: "wrl", teamName: "", season: String(new Date().getFullYear()), label: "" });
const fromCar = (c: MyCar): FormState => ({ number: c.number, series: c.series, teamName: c.teamName ?? "", season: c.season ? String(c.season) : "", label: c.label ?? "" });
function toInput(f: FormState): CarInput {
  return { number: f.number.trim().replace(/^#/, ""), series: f.series, teamName: f.teamName, label: f.label, season: f.season ? Number(f.season) : null };
}

function CarForm({ initial, submitLabel, onSubmit, onCancel }: { initial: FormState; submitLabel: string; onSubmit: (f: FormState) => Promise<void>; onCancel?: () => void }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!/^#?[0-9A-Za-z]{1,8}$/.test(f.number.trim())) return setError("Enter the car number, e.g. 67.");
        if (f.season && !/^\d{4}$/.test(f.season)) return setError("Season is a year, e.g. 2026, or blank for any season.");
        setBusy(true);
        try {
          await onSubmit(f);
        } catch (err) {
          setError(err instanceof Error ? err.message : "That did not save. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label className={label} htmlFor="car-number">Car number</label>
        <input id="car-number" className={field} value={f.number} onChange={set("number")} inputMode="text" placeholder="67" required />
      </div>
      <div>
        <label className={label} htmlFor="car-series">Series</label>
        <select id="car-series" className={field} value={f.series} onChange={set("series")}>
          {SERIES.map((s) => (
            <option key={s} value={s}>{SERIES_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="car-team">Team (optional)</label>
        <input id="car-team" className={field} value={f.teamName} onChange={set("teamName")} placeholder="Only this team's car with that number" />
      </div>
      <div>
        <label className={label} htmlFor="car-season">Season (blank = any)</label>
        <input id="car-season" className={field} value={f.season} onChange={set("season")} inputMode="numeric" placeholder="2026" />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="car-label">Your name for it (optional)</label>
        <input id="car-label" className={field} value={f.label} onChange={set("label")} placeholder="e.g. Our Miata" maxLength={60} />
      </div>
      {error && <p role="alert" className="sm:col-span-2 m-0 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="sm:col-span-2 flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{submitLabel}</Button>
        {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

/** Settings → My cars: the cars the user follows; a new number or team each season is an edit. */
export function MyCarsPage() {
  const [cars, setCars] = useState<MyCar[] | null>(null);
  const [max, setMax] = useState(20);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    listCars()
      .then((r) => {
        setCars(r.cars);
        setMax(r.max);
      })
      .catch(() => setLoadError(true));
  }, []);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">My cars</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          The cars you follow. A race entry is your car when the series and number match, and the team and season too when you set them.
          Follow a car from any race with the <b>Follow</b> button above the chart.
        </p>
      </div>

      {loadError && <p className="text-sm text-red-600 dark:text-red-400">Your cars could not be loaded. Refresh to try again.</p>}
      {cars === null && !loadError && <div className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900" />}

      {cars && cars.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-5 text-sm text-gray-600 dark:text-gray-400">
          No cars yet. Open a race from <Link to="/races" className="text-brand-600 dark:text-brand-400 underline">Events</Link> and press <b>Follow</b> on your car, or add it here.
        </div>
      )}

      {cars && cars.length > 0 && (
        <ul className="m-0 list-none divide-y divide-gray-200 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 p-0">
          {cars.map((c) => (
            <li key={c.id} className="p-4">
              {editing === c.id ? (
                <CarForm
                  initial={fromCar(c)}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (f) => {
                    const r = await updateCar(c.id, toInput(f));
                    setCars(cars.map((x) => (x.id === c.id ? r.car : x)));
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded border border-gray-300 dark:border-gray-700 px-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-300">{SERIES_LABEL[c.series]}</span>
                  <span className="min-w-0 flex-1 text-sm text-gray-900 dark:text-gray-100">
                    {carTitle(c)}
                    {c.carClass && <span className="text-gray-500"> · {c.carClass}</span>}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c.id)}>Edit</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await removeCar(c.id);
                      setCars(cars.filter((x) => x.id !== c.id));
                    }}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {cars && (adding ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
          <CarForm
            initial={blank()}
            submitLabel="Add car"
            onCancel={() => setAdding(false)}
            onSubmit={async (f) => {
              const r = await addCar(toInput(f));
              setCars([...cars, r.car]);
              setAdding(false);
              track("follow_car", { series: r.car.series, source: "settings" });
            }}
          />
        </div>
      ) : (
        cars.length < max && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>+ Add a car</Button>
        )
      ))}
    </div>
  );
}
