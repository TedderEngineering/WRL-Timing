import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiClientError } from "@/lib/api";
import {
  gripApi,
  type Calculation,
  type CornerKey,
  type Corners,
  type ReferenceSession,
  type Weather,
} from "@/features/grip/api";
import { useGrip } from "@/features/grip/GripContext";
import { useLoad } from "@/features/grip/hooks";
import { UpgradeDialog } from "@/features/grip/UpgradeDialog";
import {
  Banner,
  Card,
  ChoiceChips,
  CornerGrid,
  CornerInputs,
  Eyebrow,
  Field,
  GripButton,
  Note,
  PageHeader,
  Pill,
  Spinner,
  WeatherPill,
  fieldClass,
  formatDate,
  primaryLinkClass,
} from "@/features/grip/components";
import {
  formatPressure,
  formatPressureDelta,
  formatTemp,
  pressureInput,
  pressureUnit,
  tempUnit,
} from "@/features/grip/units";
import {
  checkCorners,
  checkDuration,
  checkPressure,
  checkTemp,
  emptyCorners,
  mapCorners,
} from "@/features/grip/validate";
import { cn } from "@/lib/utils";

const WEATHER = [
  ["DRY", "Dry"],
  ["WET", "Wet"],
] as const;

interface FormState {
  name: string;
  weather: Weather;
  trackTemp: string;
  ambientTemp: string;
  duration: string;
  wheel: Corners<string>;
  target: Corners<string>;
}

type Errors = Partial<
  Record<"name" | "trackTemp" | "ambientTemp" | "duration" | "form", string>
> & {
  wheel?: Partial<Corners<string>>;
  target?: Partial<Corners<string>>;
};

export function GripCalculatorPage() {
  const { account, units, setAccount, calculatorAvailable, toast } = useGrip();
  const [params, setParams] = useSearchParams();
  const sessions = useLoad(() => gripApi.sessions());
  const resultRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<FormState>({
    name: "",
    weather: "DRY",
    trackTemp: "",
    ambientTemp: "",
    duration: "",
    wheel: emptyCorners(),
    target: emptyCorners(),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [wheelTouched, setWheelTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Calculation | null>(null);
  const [upgrade, setUpgrade] = useState(false);

  const all = sessions.data ?? [];
  const refId = params.get("ref");
  const reference: ReferenceSession | undefined = useMemo(() => {
    if (all.length === 0) return undefined;
    return (
      all.find((s) => s.id === refId) ??
      [...all].filter((s) => s.ready).sort((a, b) => b.useCount - a.useCount)[0] ??
      all[0]
    );
  }, [all, refId]);

  // New reference: start a fresh calculation, carrying the hot pressures over as the starting targets.
  useEffect(() => {
    if (!reference) return;
    setResult(null);
    setErrors({});
    setWheelTouched(false);
    setForm({
      name: `${reference.name} Calc`,
      weather: "DRY",
      trackTemp: "",
      ambientTemp: "",
      duration: "",
      wheel: emptyCorners(),
      target: mapCorners(reference.hot, (v) => pressureInput(v, units)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference?.id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };
  const setCorner = (group: "wheel" | "target", corner: CornerKey, value: string) => {
    setForm((f) => {
      if (group === "wheel" && corner === "lf" && !wheelTouched)
        return { ...f, wheel: { lf: value, rf: value, lr: value, rr: value } };
      return { ...f, [group]: { ...f[group], [corner]: value } };
    });
    if (group === "wheel" && corner !== "lf") setWheelTouched(true);
    setErrors((e) => ({
      ...e,
      [group]: { ...e[group], [corner]: undefined },
      form: undefined,
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reference) return;
    const next: Errors = {};
    if (!form.name.trim()) next.name = "Required";
    const trackTemp = checkTemp(form.trackTemp, units, true);
    const ambientTemp = checkTemp(form.ambientTemp, units, true);
    const duration = checkDuration(form.duration);
    if (trackTemp.error) next.trackTemp = trackTemp.error;
    if (ambientTemp.error) next.ambientTemp = ambientTemp.error;
    if (duration.error) next.duration = duration.error;
    const wheel = checkCorners(form.wheel, (t) => checkTemp(t, units, true));
    const target = checkCorners(form.target, (t) => checkPressure(t, units, true));
    if (!wheel.ok) next.wheel = wheel.errors;
    if (!target.ok) next.target = target.errors;
    if (Object.keys(next).length > 0) {
      setErrors({ ...next, form: "Check the highlighted fields." });
      return;
    }

    setBusy(true);
    try {
      const res = await gripApi.calculate({
        referenceSessionId: reference.id,
        name: form.name.trim(),
        weather: form.weather,
        trackTemp: trackTemp.value!,
        ambientTemp: ambientTemp.value!,
        durationMin: duration.value!,
        wheel: wheel.values as Corners,
        target: target.values as Corners,
      });
      setResult(res.calculation);
      setAccount(res.account);
      toast("Calculated and saved");
      // On a phone the result is below the form; bring it into view.
      requestAnimationFrame(() => {
        if (window.innerWidth < 1024)
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "UPGRADE_REQUIRED")
        setUpgrade(true);
      else
        setErrors({ form: err instanceof Error ? err.message : "Could not calculate" });
    } finally {
      setBusy(false);
    }
  };

  if (sessions.loading) return <Spinner />;
  if (!reference) {
    return (
      <div className="container-page">
        <PageHeader title="Tire pressure calculator" />
        <Card className="text-center py-10">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50">
            No reference session yet
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Create one first. Calculations are built from it.
          </p>
          <Link
            to="/grip/sessions/new"
            className={cn(primaryLinkClass, "mt-5 px-5 py-2.5 text-sm")}
          >
            + New reference session
          </Link>
        </Card>
      </div>
    );
  }

  const pu = pressureUnit(units);
  const tu = tempUnit(units);
  const p = (c: Corners<number | null>) => mapCorners(c, (v) => formatPressure(v, units));
  const outOfFree = !account.isPro && account.freeCalculationsLeft === 0;

  return (
    <div className="container-page">
      <PageHeader
        title="Tire pressure calculator"
        subtitle="Enter today's conditions and your hot targets. Get the cold pressure to set."
        actions={
          !account.isPro && (
            <Pill>
              {account.freeCalculationsLeft} of {account.freeCalculationLimit} free
              calculations left
            </Pill>
          )
        }
      />

      {!calculatorAvailable && (
        <div className="mb-4">
          <Banner tone="warn">
            The calculator isn't switched on yet. You can still enter and save reference
            sessions.
          </Banner>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Card className="space-y-3">
            <label
              htmlFor="calc-reference"
              className="block text-xs font-semibold text-gray-600 dark:text-gray-400"
            >
              Reference session
            </label>
            <select
              id="calc-reference"
              value={reference.id}
              onChange={(e) => setParams({ ref: e.target.value }, { replace: true })}
              className={fieldClass}
            >
              {all.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.track.shortName} · {formatDate(s.sessionDate)}
                  {s.ready ? "" : " (needs hot pressures)"}
                </option>
              ))}
            </select>
            {!reference.ready && (
              <Banner
                tone="warn"
                action={
                  <Link
                    to={`/grip/sessions/${reference.id}/edit`}
                    className="text-sm font-semibold text-grip-700 dark:text-grip-300 hover:underline"
                  >
                    Add hot pressures
                  </Link>
                }
              >
                This session has no hot pressures, so it can't be used as a reference yet.
              </Banner>
            )}
          </Card>

          <Card className="space-y-4">
            <h2 className="font-bold text-gray-900 dark:text-gray-50">Today's session</h2>
            <Field
              id="calc-name"
              label="Calculation name *"
              value={form.name}
              onChange={(v) => set("name", v)}
              error={errors.name}
            />
            <div>
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                Weather
              </div>
              <ChoiceChips
                label="Weather"
                options={WEATHER}
                value={form.weather}
                onChange={(v) => set("weather", v)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                id="calc-track-temp"
                label="Track temperature *"
                unit={tu}
                numeric
                value={form.trackTemp}
                onChange={(v) => set("trackTemp", v)}
                error={errors.trackTemp}
              />
              <Field
                id="calc-ambient-temp"
                label="Ambient temperature *"
                unit={tu}
                numeric
                value={form.ambientTemp}
                onChange={(v) => set("ambientTemp", v)}
                error={errors.ambientTemp}
              />
              <Field
                id="calc-duration"
                label="Session duration *"
                unit="min"
                numeric
                value={form.duration}
                onChange={(v) => set("duration", v)}
                error={errors.duration}
                hint={Number(form.duration) > 60 ? "Calculated as 60." : undefined}
              />
            </div>
          </Card>

          <Card className="space-y-3">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-gray-50">
                Cold wheel temperature *
              </h2>
              <p className="text-xs text-gray-500">
                Enter LF and the other three fill in.
              </p>
            </div>
            <CornerInputs
              idPrefix="calc-wheel"
              values={form.wheel}
              unit={tu}
              errors={errors.wheel}
              onChange={(c, v) => setCorner("wheel", c, v)}
            />
          </Card>

          <Card className="space-y-3">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-gray-50">
                Target hot tire pressure *
              </h2>
              <p className="text-xs text-gray-500">
                Starts from the reference session's hot pressures.
              </p>
            </div>
            <CornerInputs
              idPrefix="calc-target"
              values={form.target}
              unit={pu}
              errors={errors.target}
              onChange={(c, v) => setCorner("target", c, v)}
            />
          </Card>

          {errors.form && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {errors.form}
            </p>
          )}
          {outOfFree ? (
            <GripButton
              type="button"
              size="lg"
              className="w-full"
              onClick={() => setUpgrade(true)}
            >
              Upgrade to calculate
            </GripButton>
          ) : (
            <GripButton
              type="submit"
              size="lg"
              className="w-full"
              loading={busy}
              disabled={!reference.ready || !calculatorAvailable}
            >
              Calculate cold tire pressure
            </GripButton>
          )}
        </form>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <Card className="space-y-3">
            <div ref={resultRef} className="flex items-center justify-between">
              <h2 className="font-bold text-gray-900 dark:text-gray-50">
                Cold tire pressure
              </h2>
              {result && <WeatherPill weather={result.weather} />}
            </div>
            {result ? (
              <>
                <CornerGrid
                  emphasis
                  unit={pu}
                  values={p(result.result)}
                  detail={{
                    lf: `${formatPressureDelta(result.result.lf - result.referenceCold.lf, units)} vs ref`,
                    rf: `${formatPressureDelta(result.result.rf - result.referenceCold.rf, units)} vs ref`,
                    lr: `${formatPressureDelta(result.result.lr - result.referenceCold.lr, units)} vs ref`,
                    rr: `${formatPressureDelta(result.result.rr - result.referenceCold.rr, units)} vs ref`,
                  }}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">Saved to your dashboard.</span>
                  <Link
                    to={`/grip/calculations/${result.id}/convert`}
                    className="text-sm font-semibold text-grip-600 dark:text-grip-400 hover:underline"
                  >
                    Convert to reference →
                  </Link>
                </div>
              </>
            ) : (
              <>
                <CornerGrid unit={pu} values={{ lf: "—", rf: "—", lr: "—", rr: "—" }} />
                <p className="text-xs text-gray-500">
                  Set these pressures before the car leaves. Results save to your
                  dashboard.
                </p>
              </>
            )}
          </Card>

          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Eyebrow>Reference</Eyebrow>
                <div className="font-semibold text-gray-900 dark:text-gray-100 break-words">
                  {reference.name}
                </div>
                <div className="text-xs text-gray-500">
                  {formatDate(reference.sessionDate)} · {reference.track.name}
                </div>
              </div>
              <WeatherPill weather={reference.weather} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-500">Track / ambient</dt>
              <dd className="text-right tabular-nums whitespace-nowrap">
                {formatTemp(reference.trackTemp, units)} /{" "}
                {formatTemp(reference.ambientTemp, units)} {tu}
              </dd>
              <dt className="text-gray-500">Session duration</dt>
              <dd className="text-right tabular-nums">{reference.durationMin} min</dd>
            </dl>
            <Eyebrow>Cold wheel temperature</Eyebrow>
            <CornerGrid
              unit={tu}
              values={mapCorners(reference.wheel, (v) => formatTemp(v, units))}
            />
            <Eyebrow>Cold pressure</Eyebrow>
            <CornerGrid unit={pu} values={p(reference.cold)} />
            <Eyebrow>Hot pressure</Eyebrow>
            <CornerGrid unit={pu} values={p(reference.hot)} />
            {reference.notes && (
              <p className="text-sm text-gray-600 dark:text-gray-400 break-words">
                {reference.notes}
              </p>
            )}
          </Card>
          <Note>
            The calculation runs on Tedder Engineering's servers. Results are guidance;
            stay within your tire manufacturer's limits.
          </Note>
        </aside>
      </div>

      {upgrade && (
        <UpgradeDialog
          reason={`You've used your ${account.freeCalculationLimit} free calculations`}
          onClose={() => setUpgrade(false)}
        />
      )}
    </div>
  );
}
