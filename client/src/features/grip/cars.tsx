/**
 * My cars in Finding Grip: the one car list shared by every Tedder Engineering
 * site (RaceTrace's `user_cars`, `/api/me/cars`; see features/my-cars/api.ts).
 * Same fields, limits and wording ("My cars", "+ Add a car"). A car can be a
 * race car (IMSA, SRO, WRL) or a track-day / club car ("other").
 *
 * - CarPicker: the optional "Car" choice on a reference session, with
 *   "+ Add a car" in place.
 * - MyCarsCard: the list in Settings (add, edit, remove).
 * Adding a car sends `follow_car { series, source }` with a grip_* source.
 */
import { useEffect, useState, type FormEvent } from "react";
import {
  SERIES_LABEL,
  addCar,
  listCars,
  removeCar,
  updateCar,
  type CarInput,
  type MyCar,
  type SeriesFamily,
} from "@/features/my-cars/api";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Card, ConfirmDialog, GripButton, fieldClass } from "./components";

/** Finding Grip lists track day / club first: most of its drivers are there. */
const GRIP_SERIES: SeriesFamily[] = ["other", "wrl", "sro", "imsa"];

/** "Track day Miata (#12)" or "#67 · SRO". */
export function carName(c: {
  label: string | null;
  number: string;
  series: string;
}): string {
  return c.label
    ? `${c.label} (#${c.number})`
    : `#${c.number} · ${SERIES_LABEL[c.series as SeriesFamily] ?? c.series}`;
}

/** Load the shared list once per page. */
export function useMyCars() {
  const [cars, setCars] = useState<MyCar[] | null>(null);
  const [max, setMax] = useState(20);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    listCars()
      .then((r) => {
        if (cancelled) return;
        setCars(r.cars);
        setMax(r.max);
      })
      .catch(
        () =>
          !cancelled && setError("Your cars could not be loaded. Refresh to try again.")
      );
    return () => {
      cancelled = true;
    };
  }, []);
  return { cars, setCars, max, error };
}

interface CarForm {
  number: string;
  series: SeriesFamily;
  label: string;
  teamName: string;
  season: string;
}

const blankCar = (): CarForm => ({
  number: "",
  series: "other",
  label: "",
  teamName: "",
  season: "",
});
const fromCar = (c: MyCar): CarForm => ({
  number: c.number,
  series: c.series,
  label: c.label ?? "",
  teamName: c.teamName ?? "",
  season: c.season ? String(c.season) : "",
});
const toInput = (f: CarForm): CarInput => ({
  number: f.number.trim().replace(/^#/, ""),
  series: f.series,
  label: f.label.trim(),
  teamName: f.teamName.trim(),
  season: f.season ? Number(f.season) : null,
});

const labelClass = "block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5";

/** Add or edit one car. Team and season only matter for race cars, so they show for those. */
function CarFields({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  idPrefix,
}: {
  initial: CarForm;
  submitLabel: string;
  onSubmit: (f: CarForm) => Promise<void>;
  onCancel: () => void;
  idPrefix: string;
}) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof CarForm, v: string) => setF((x) => ({ ...x, [k]: v }));
  const raceCar = f.series !== "other";

  // A nested <form> is not allowed inside the session form, so this is a group with its own button.
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!/^#?[0-9A-Za-z]{1,8}$/.test(f.number.trim()))
      return setError("Enter the car number: letters and digits, e.g. 12.");
    if (f.season && !/^\d{4}$/.test(f.season))
      return setError("Season is a year, e.g. 2026, or blank for any season.");
    setBusy(true);
    try {
      await onSubmit(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="group"
      aria-label={submitLabel}
      className="grid gap-3 sm:grid-cols-2"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-number`}>
          Car number
        </label>
        <input
          id={`${idPrefix}-number`}
          className={fieldClass}
          value={f.number}
          onChange={(e) => set("number", e.target.value)}
          placeholder="12"
          maxLength={9}
          autoComplete="off"
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-series`}>
          Runs in
        </label>
        <select
          id={`${idPrefix}-series`}
          className={fieldClass}
          value={f.series}
          onChange={(e) => set("series", e.target.value)}
        >
          {GRIP_SERIES.map((s) => (
            <option key={s} value={s}>
              {SERIES_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`${idPrefix}-label`}>
          Your name for it (optional)
        </label>
        <input
          id={`${idPrefix}-label`}
          className={fieldClass}
          value={f.label}
          onChange={(e) => set("label", e.target.value)}
          placeholder="e.g. Track day Miata"
          maxLength={60}
        />
      </div>
      {raceCar && (
        <>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-team`}>
              Team (optional)
            </label>
            <input
              id={`${idPrefix}-team`}
              className={fieldClass}
              value={f.teamName}
              onChange={(e) => set("teamName", e.target.value)}
              maxLength={120}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-season`}>
              Season (blank = any)
            </label>
            <input
              id={`${idPrefix}-season`}
              className={fieldClass}
              value={f.season}
              onChange={(e) => set("season", e.target.value)}
              inputMode="numeric"
              placeholder="2026"
            />
          </div>
        </>
      )}
      {error && (
        <p
          role="alert"
          className="sm:col-span-2 m-0 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      <div className="sm:col-span-2 flex flex-wrap gap-2">
        <GripButton type="button" size="sm" loading={busy} onClick={() => void submit()}>
          {submitLabel}
        </GripButton>
        <GripButton type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </GripButton>
      </div>
    </div>
  );
}

/**
 * Optional "Car" for a reference session. `value` is a car id or "" for none.
 * Calculations made from the session take its car.
 */
export function CarPicker({
  value,
  onChange,
  source,
}: {
  value: string;
  onChange: (carId: string) => void;
  source: string;
}) {
  const { cars, setCars, max, error } = useMyCars();
  const [adding, setAdding] = useState(false);
  const list = cars ?? [];

  return (
    <div className="space-y-2">
      <label htmlFor="session-car" className={labelClass}>
        Car (optional)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="session-car"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={cars === null && !error}
          className={cn(fieldClass, "min-w-0 flex-1 basis-56")}
        >
          <option value="">No car</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {carName(c)}
            </option>
          ))}
        </select>
        {!adding && cars !== null && list.length < max && (
          <GripButton
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setAdding(true)}
          >
            + Add a car
          </GripButton>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {adding && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
          <CarFields
            idPrefix="new-car"
            initial={blankCar()}
            submitLabel="Add car"
            onCancel={() => setAdding(false)}
            onSubmit={async (f) => {
              const r = await addCar(toInput(f));
              setCars([...list, r.car]);
              onChange(r.car.id);
              setAdding(false);
              track("follow_car", { series: r.car.series, source });
            }}
          />
        </div>
      )}
      <p className="text-xs text-gray-500">
        See how close each car comes on target. Calculations from this session use the
        same car.
      </p>
    </div>
  );
}

/** Settings: the shared car list (add, edit, remove). */
export function MyCarsCard() {
  const { cars, setCars, max, error } = useMyCars();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<MyCar | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section aria-labelledby="my-cars-title">
      <Card className="space-y-3">
        <div>
          <h2 id="my-cars-title" className="font-bold text-gray-900 dark:text-gray-50">
            My cars
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Choose a car on a reference session to see your accuracy for each car. One
            list for your Tedder Engineering account: the same cars appear on every Tedder
            Engineering site.
          </p>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {cars === null && !error && (
          <div className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900" />
        )}
        {cars && cars.length > 0 && (
          <ul className="m-0 list-none divide-y divide-gray-200 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 p-0">
            {cars.map((c) => (
              <li key={c.id} className="p-3">
                {editing === c.id ? (
                  <CarFields
                    idPrefix={`edit-${c.id}`}
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
                  <div className="flex items-start gap-2">
                    {/* Name and badge wrap on the left; the two buttons stay together on the right. */}
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 pt-1.5">
                      <span className="rounded border border-gray-300 dark:border-gray-700 px-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                        {SERIES_LABEL[c.series] ?? c.series}
                      </span>
                      <span className="min-w-0 break-words text-sm text-gray-900 dark:text-gray-100">
                        {c.label ? `${c.label} (#${c.number})` : `#${c.number}`}
                        {c.teamName && (
                          <span className="text-gray-500"> · {c.teamName}</span>
                        )}
                        {c.season && <span className="text-gray-500"> · {c.season}</span>}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <GripButton
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(c.id)}
                      >
                        Edit
                      </GripButton>
                      <GripButton
                        size="sm"
                        variant="ghost"
                        onClick={() => setRemoving(c)}
                      >
                        Remove
                      </GripButton>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {cars && cars.length === 0 && !adding && (
          <p className="text-sm text-gray-500">No cars yet.</p>
        )}
        {cars &&
          (adding ? (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              <CarFields
                idPrefix="add-car"
                initial={blankCar()}
                submitLabel="Add car"
                onCancel={() => setAdding(false)}
                onSubmit={async (f) => {
                  const r = await addCar(toInput(f));
                  setCars([...cars, r.car]);
                  setAdding(false);
                  track("follow_car", { series: r.car.series, source: "grip_settings" });
                }}
              />
            </div>
          ) : (
            cars.length < max && (
              <GripButton size="sm" variant="secondary" onClick={() => setAdding(true)}>
                + Add a car
              </GripButton>
            )
          ))}
        {removing && (
          <ConfirmDialog
            title={`Remove ${carName(removing)}?`}
            body="Its sessions and calculations stay; they just won't show a car. It is also removed from your list on the other Tedder Engineering sites."
            confirmLabel="Remove car"
            busy={busy}
            onClose={() => setRemoving(null)}
            onConfirm={async () => {
              setBusy(true);
              try {
                await removeCar(removing.id);
                setCars((cars ?? []).filter((x) => x.id !== removing.id));
                setRemoving(null);
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </Card>
    </section>
  );
}
