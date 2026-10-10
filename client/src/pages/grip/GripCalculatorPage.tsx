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
  tempInput,
  tempUnit,
} from "@/features/grip/units";
import {
  checkCorners,
  checkDuration,
  checkPressure,
  checkTemp,
  emptyCorners,
  keepUnchanged,
  keepUnchangedCorners,
  mapCorners,
} from "@/features/grip/validate";
import { cn } from "@/lib/utils";
import { gp } from "@/lib/site";

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

  // A saved calculation opened from the dashboard (?calc=<id>), or the one
  // just calculated. While one is open, calculating again updates it in place.
  const calcId = params.get("calc");
  const [editing, setEditing] = useState<Calculation | null>(null);
  /** The form as it was when `editing` was loaded or last saved, to tell when inputs have changed since. */
  const [savedForm, setSavedForm] = useState<string | null>(null);
  /** Stored values behind prefilled fields, so an untouched field is sent back exactly. */
  const loaded = useRef<{
    trackTemp?: { text: string; value: number };
    ambientTemp?: { text: string; value: number };
    wheel?: { texts: Corners<string>; values: Corners<number | null> };
    target?: { texts: Corners<string>; values: Corners<number | null> };
  }>({});
  const filledFrom = useRef<string | null>(null);
  const lastReferenceId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!calcId) {
      setEditing(null);
      return;
    }
    if (editing?.id === calcId) return;
    let cancelled = false;
    gripApi
      .calculation(calcId)
      .then((c) => {
        if (!cancelled) setEditing(c);
      })
      .catch(() => {
        if (cancelled) return;
        toast("That saved calculation no longer exists");
        setParams({}, { replace: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcId]);

  const all = sessions.data ?? [];
  const refId = params.get("ref");
  const openCalc = calcId && editing?.id === calcId ? editing : null;
  const reference: ReferenceSession | undefined = useMemo(() => {
    if (all.length === 0) return undefined;
    return (
      all.find((s) => s.id === refId) ??
      (openCalc ? all.find((s) => s.id === openCalc.referenceSessionId) : undefined) ??
      [...all].filter((s) => s.ready).sort((a, b) => b.useCount - a.useCount)[0] ??
      all[0]
    );
  }, [all, refId, openCalc]);

  const formFromCalculation = (c: Calculation): FormState => ({
    name: c.name,
    weather: c.weather,
    trackTemp: tempInput(c.trackTemp, units),
    ambientTemp: tempInput(c.ambientTemp, units),
    duration: String(c.durationMin),
    wheel: mapCorners(c.wheel, (v) => tempInput(v, units)),
    target: mapCorners(c.target, (v) => pressureInput(v, units)),
  });

  /** Remember what the form holds for calculation `c`, so later edits can be told apart from it. */
  const rememberSaved = (c: Calculation, shown: FormState) => {
    loaded.current = {
      trackTemp: { text: shown.trackTemp, value: c.trackTemp },
      ambientTemp: { text: shown.ambientTemp, value: c.ambientTemp },
      wheel: { texts: shown.wheel, values: c.wheel },
      target: { texts: shown.target, values: c.target },
    };
    filledFrom.current = c.id;
    setSavedForm(JSON.stringify(shown));
  };

  // Fill the form: from the saved calculation when one is open, otherwise a
  // fresh one for the chosen reference with its hot pressures as the targets.
  useEffect(() => {
    if (!reference) return;
    const referenceChanged =
      lastReferenceId.current !== undefined && lastReferenceId.current !== reference.id;
    lastReferenceId.current = reference.id;

    if (calcId) {
      if (!openCalc) return; // still loading
      if (filledFrom.current !== openCalc.id) {
        const shown = formFromCalculation(openCalc);
        setForm(shown);
        setErrors({});
        setWheelTouched(true);
        setResult(openCalc);
        rememberSaved(openCalc, shown);
      } else if (referenceChanged) {
        // Same inputs, different baseline: the saved result no longer applies.
        setErrors({});
      }
      return;
    }

    filledFrom.current = null;
    setSavedForm(null);
    setResult(null);
    setErrors({});
    setWheelTouched(false);
    const target = mapCorners(reference.hot, (v) => pressureInput(v, units));
    loaded.current = { target: { texts: target, values: reference.hot } };
    setForm({
      name: `${reference.name} Calc`,
      weather: "DRY",
      trackTemp: "",
      ambientTemp: "",
      duration: "",
      wheel: emptyCorners(),
      target,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference?.id, openCalc?.id, calcId]);

  /** True when the result on screen was calculated from different inputs than the form now holds. */
  const stale =
    !!openCalc &&
    !!reference &&
    (savedForm !== JSON.stringify(form) || openCalc.referenceSessionId !== reference.id);

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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(false);
  };

  /** Calculate. Updates the open saved calculation unless `asNew` (or none is open). */
  const run = async (asNew: boolean) => {
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
      const input = {
        referenceSessionId: reference.id,
        name: form.name.trim(),
        weather: form.weather,
        // A field left as prefilled is sent back as the exact stored value,
        // not the rounded text converted back.
        trackTemp: keepUnchanged(
          trackTemp,
          form.trackTemp,
          loaded.current.trackTemp?.text,
          loaded.current.trackTemp?.value
        ).value!,
        ambientTemp: keepUnchanged(
          ambientTemp,
          form.ambientTemp,
          loaded.current.ambientTemp?.text,
          loaded.current.ambientTemp?.value
        ).value!,
        durationMin: duration.value!,
        wheel: keepUnchangedCorners(
          wheel.values,
          form.wheel,
          loaded.current.wheel?.texts,
          loaded.current.wheel?.values
        ) as Corners,
        target: keepUnchangedCorners(
          target.values,
          form.target,
          loaded.current.target?.texts,
          loaded.current.target?.values
        ) as Corners,
      };
      const updating = !!openCalc && !asNew;
      const res = updating
        ? await gripApi.updateCalculation(openCalc.id, input)
        : await gripApi.calculate(input);
      setResult(res.calculation);
      setAccount(res.account);
      // Keep this calculation open, so the next change updates it instead of
      // leaving a trail of near-identical copies on the dashboard.
      setEditing(res.calculation);
      rememberSaved(res.calculation, form);
      setParams({ calc: res.calculation.id }, { replace: true });
      toast(updating ? "Calculation updated" : "Calculated and saved");
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

  if (sessions.loading || (calcId && !openCalc)) return <Spinner />;
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
            to={gp("/sessions/new")}
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
        subtitle={
          openCalc
            ? `Saved calculation from ${formatDate(openCalc.sessionDate)}. Change anything and update it.`
            : "Enter today's conditions and your hot targets. Get the cold pressure to set."
        }
        actions={
          <>
            {!account.isPro && (
              <Pill>
                {account.freeCalculationsLeft} of {account.freeCalculationLimit} free
                calculations left
              </Pill>
            )}
            {openCalc && (
              <Link
                to={gp(`/calculate?ref=${reference.id}`)}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                New calculation
              </Link>
            )}
          </>
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
              onChange={(e) =>
                setParams(
                  calcId
                    ? { calc: calcId, ref: e.target.value }
                    : { ref: e.target.value },
                  { replace: true }
                )
              }
              className={fieldClass}
            >
              {all.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.track.shortName} · {formatDate(s.sessionDate)}
                  {s.ready ? "" : " (needs hot pressures)"}
                </option>
              ))}
            </select>
            {openCalc && !openCalc.referenceSessionId && (
              <Banner tone="warn">
                The reference session this was calculated from ({openCalc.referenceName})
                has been deleted. Updating will recalculate from the one selected here.
              </Banner>
            )}
            {!reference.ready && (
              <Banner
                tone="warn"
                action={
                  <Link
                    to={gp(`/sessions/${reference.id}/edit`)}
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
            <div className="flex flex-col gap-2 sm:flex-row">
              <GripButton
                type="submit"
                size="lg"
                className="w-full"
                loading={busy}
                disabled={!reference.ready || !calculatorAvailable}
              >
                {openCalc ? "Update calculation" : "Calculate cold tire pressure"}
              </GripButton>
              {openCalc && (
                <GripButton
                  type="button"
                  size="lg"
                  variant="secondary"
                  className="w-full sm:w-auto sm:shrink-0"
                  disabled={busy || !reference.ready || !calculatorAvailable}
                  onClick={() => run(true)}
                >
                  Save as new
                </GripButton>
              )}
            </div>
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
                {stale && (
                  <p
                    className="rounded-lg border border-amber-400/60 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
                    role="status"
                  >
                    These pressures are for the saved inputs. Update the calculation to
                    see them for what you have entered now.
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">Saved to your dashboard.</span>
                  <Link
                    to={gp(`/calculations/${result.id}/convert`)}
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
