import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  gripApi,
  type CornerKey,
  type Corners,
  type SessionInput,
  type Weather,
} from "@/features/grip/api";
import { useGrip } from "@/features/grip/GripContext";
import { useLoad } from "@/features/grip/hooks";
import {
  Card,
  ChoiceChips,
  CornerInputs,
  Field,
  GripButton,
  Note,
  PageHeader,
  Pill,
  Spinner,
  fieldClass,
  fieldErrorClass,
  formatDate,
} from "@/features/grip/components";
import { pressureInput, pressureUnit, tempInput, tempUnit } from "@/features/grip/units";
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
  trackId: string;
  weather: Weather;
  trackTemp: string;
  ambientTemp: string;
  duration: string;
  wheel: Corners<string>;
  cold: Corners<string>;
  hot: Corners<string>;
  notes: string;
}

const blank = (): FormState => ({
  name: "",
  trackId: "",
  weather: "DRY",
  trackTemp: "",
  ambientTemp: "",
  duration: "",
  wheel: emptyCorners(),
  cold: emptyCorners(),
  hot: emptyCorners(),
  notes: "",
});

type Errors = Partial<
  Record<"name" | "trackId" | "trackTemp" | "ambientTemp" | "duration" | "form", string>
> & {
  wheel?: Partial<Corners<string>>;
  cold?: Partial<Corners<string>>;
  hot?: Partial<Corners<string>>;
};

export function GripSessionFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const { units, toast } = useGrip();
  const tracks = useLoad(() => gripApi.tracks());
  const existing = useLoad(
    () => (id ? gripApi.session(id) : Promise.resolve(null)),
    [id]
  );

  const [form, setForm] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  // Entering LF fills the other three wheel temperatures until one of them is edited by hand.
  const [wheelTouched, setWheelTouched] = useState(false);

  useEffect(() => {
    const s = existing.data;
    if (!s) return;
    setForm({
      name: s.name,
      trackId: s.track.id,
      weather: s.weather,
      trackTemp: tempInput(s.trackTemp, units),
      ambientTemp: tempInput(s.ambientTemp, units),
      duration: String(s.durationMin),
      wheel: mapCorners(s.wheel, (v) => tempInput(v, units)),
      cold: mapCorners(s.cold, (v) => pressureInput(v, units)),
      hot: mapCorners(s.hot, (v) => pressureInput(v, units)),
      notes: s.notes ?? "",
    });
    setWheelTouched(true);
    // Only when the record loads; a later units change is handled by the user re-opening the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  const setCorner = (
    group: "wheel" | "cold" | "hot",
    corner: CornerKey,
    value: string
  ) => {
    setForm((f) => {
      if (group === "wheel" && corner === "lf" && !wheelTouched) {
        return { ...f, wheel: { lf: value, rf: value, lr: value, rr: value } };
      }
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
    const next: Errors = {};
    if (!form.name.trim()) next.name = "Required";
    if (!form.trackId) next.trackId = "Choose a track";
    const trackTemp = checkTemp(form.trackTemp, units, true);
    const ambientTemp = checkTemp(form.ambientTemp, units, true);
    const duration = checkDuration(form.duration);
    if (trackTemp.error) next.trackTemp = trackTemp.error;
    if (ambientTemp.error) next.ambientTemp = ambientTemp.error;
    if (duration.error) next.duration = duration.error;
    const wheel = checkCorners(form.wheel, (t) => checkTemp(t, units, true));
    const cold = checkCorners(form.cold, (t) => checkPressure(t, units, true));
    const hot = checkCorners(form.hot, (t) => checkPressure(t, units, false));
    if (!wheel.ok) next.wheel = wheel.errors;
    if (!cold.ok) next.cold = cold.errors;
    if (!hot.ok) next.hot = hot.errors;

    if (Object.keys(next).length > 0) {
      setErrors({ ...next, form: "Check the highlighted fields." });
      return;
    }

    const input: SessionInput = {
      name: form.name.trim(),
      trackId: form.trackId,
      weather: form.weather,
      trackTemp: trackTemp.value!,
      ambientTemp: ambientTemp.value!,
      durationMin: duration.value!,
      wheel: wheel.values as Corners,
      cold: cold.values as Corners,
      hot: hot.values,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    try {
      if (id) await gripApi.updateSession(id, input);
      else await gripApi.createSession(input);
      toast(editing ? "Reference session updated" : "Reference session saved");
      navigate("/grip/sessions");
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : "Could not save" });
      setSaving(false);
    }
  };

  if (tracks.loading || existing.loading) return <Spinner />;
  if (editing && existing.error) {
    return (
      <div className="container-page">
        <Card className="text-sm text-red-600 dark:text-red-400">{existing.error}</Card>
      </div>
    );
  }

  const pu = pressureUnit(units);
  const tu = tempUnit(units);
  const trackOptions = [...(tracks.data ?? [])];
  // Keep a deactivated track selectable on a session that already uses it.
  if (existing.data && !trackOptions.some((t) => t.id === existing.data!.track.id))
    trackOptions.push(existing.data.track);

  return (
    <div className="container-page">
      <PageHeader
        back={
          <Link
            to="/grip/sessions"
            className="text-sm font-medium text-grip-600 dark:text-grip-400 hover:underline"
          >
            ← Reference sessions
          </Link>
        }
        title={editing ? "Edit reference session" : "New reference session"}
        subtitle={
          editing && existing.data
            ? formatDate(existing.data.sessionDate)
            : "Date and time are set when you save."
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Card className="space-y-4">
            <h2 className="font-bold text-gray-900 dark:text-gray-50">Session</h2>
            <Field
              id="session-name"
              label="Session name *"
              value={form.name}
              onChange={(v) => set("name", v)}
              error={errors.name}
              placeholder="e.g. VIR race weekend P1"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label
                  htmlFor="session-track"
                  className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5"
                >
                  Track *
                </label>
                <select
                  id="session-track"
                  value={form.trackId}
                  onChange={(e) => set("trackId", e.target.value)}
                  className={cn(fieldClass, errors.trackId && fieldErrorClass)}
                >
                  <option value="">Select track…</option>
                  {trackOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {errors.trackId && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {errors.trackId}
                  </p>
                )}
              </div>
              <Field
                id="session-duration"
                label="Session duration *"
                unit="min"
                numeric
                value={form.duration}
                onChange={(v) => set("duration", v)}
                error={errors.duration}
                hint="Over 60 minutes is calculated as 60."
              />
            </div>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="session-track-temp"
                label="Track temperature *"
                unit={tu}
                numeric
                value={form.trackTemp}
                onChange={(v) => set("trackTemp", v)}
                error={errors.trackTemp}
              />
              <Field
                id="session-ambient-temp"
                label="Ambient temperature *"
                unit={tu}
                numeric
                value={form.ambientTemp}
                onChange={(v) => set("ambientTemp", v)}
                error={errors.ambientTemp}
              />
            </div>
          </Card>

          <Card className="space-y-3">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-gray-50">
                Cold wheel temperature *
              </h2>
              <p className="text-xs text-gray-500">
                Enter LF and the other three fill in. Correct any that differ.
              </p>
            </div>
            <CornerInputs
              idPrefix="wheel"
              values={form.wheel}
              unit={tu}
              errors={errors.wheel}
              onChange={(c, v) => setCorner("wheel", c, v)}
            />
          </Card>

          <Card className="space-y-3">
            <h2 className="font-bold text-gray-900 dark:text-gray-50">
              Cold tire pressure *
            </h2>
            <CornerInputs
              idPrefix="cold"
              values={form.cold}
              unit={pu}
              errors={errors.cold}
              onChange={(c, v) => setCorner("cold", c, v)}
            />
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold text-gray-900 dark:text-gray-50">
                Hot tire pressure
              </h2>
              <Pill>Optional for now</Pill>
            </div>
            <p className="text-xs text-gray-500">
              You can save without these, but the session can't be used for a calculation
              until all four are in.
            </p>
            <CornerInputs
              idPrefix="hot"
              values={form.hot}
              unit={pu}
              errors={errors.hot}
              onChange={(c, v) => setCorner("hot", c, v)}
            />
          </Card>

          <Card>
            <label
              htmlFor="session-notes"
              className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5"
            >
              Notes
            </label>
            <textarea
              id="session-notes"
              rows={3}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Anything worth remembering about this run"
              className={cn(fieldClass, "resize-y")}
            />
          </Card>

          {errors.form && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {errors.form}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <GripButton type="submit" size="lg" loading={saving}>
              {editing ? "Save changes" : "Save reference session"}
            </GripButton>
            <Link
              to="/grip/sessions"
              className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
            >
              Cancel
            </Link>
          </div>
        </form>

        <Card className="space-y-3">
          <h2 className="font-bold text-gray-900 dark:text-gray-50">
            What makes a good reference
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Use a run that represents your race setup and pace. Take hot pressures as soon
            as the car stops.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Mark the session Wet if the track was wet.
          </p>
          <Note>
            Values are checked against sensible ranges for {pu} and {tu}, so a number
            typed in the wrong unit is caught before it's saved. Change units in Settings.
          </Note>
        </Card>
      </div>
    </div>
  );
}
