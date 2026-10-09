import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { gripApi, type CornerKey, type Corners } from "@/features/grip/api";
import { useGrip } from "@/features/grip/GripContext";
import { useLoad } from "@/features/grip/hooks";
import {
  Card,
  CornerGrid,
  CornerInputs,
  Field,
  GripButton,
  PageHeader,
  Spinner,
  fieldClass,
} from "@/features/grip/components";
import {
  formatPressure,
  formatTemp,
  pressureUnit,
  tempUnit,
} from "@/features/grip/units";
import {
  checkCorners,
  checkPressure,
  emptyCorners,
  mapCorners,
} from "@/features/grip/validate";
import { cn } from "@/lib/utils";

export function GripConvertPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { units, toast } = useGrip();
  const calc = useLoad(() => gripApi.calculation(id), [id]);

  const [name, setName] = useState("");
  const [hot, setHot] = useState<Corners<string>>(emptyCorners);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<{
    name?: string;
    hot?: Partial<Corners<string>>;
    form?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (calc.data) setName(calc.data.name.replace(/ Calc$/i, "") + " (ref)");
  }, [calc.data]);

  if (calc.loading) return <Spinner />;
  if (calc.error || !calc.data) {
    return (
      <div className="container-page">
        <Card className="text-sm text-red-600 dark:text-red-400">
          {calc.error ?? "Calculation not found"}
        </Card>
      </div>
    );
  }
  const c = calc.data;
  const pu = pressureUnit(units);
  const tu = tempUnit(units);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const checked = checkCorners(hot, (t) => checkPressure(t, units, true));
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Required";
    if (!checked.ok) next.hot = checked.errors;
    if (Object.keys(next).length > 0) {
      setErrors({ ...next, form: "Check the highlighted fields." });
      return;
    }
    setBusy(true);
    try {
      await gripApi.convert(c.id, {
        name: name.trim(),
        hot: checked.values as Corners,
        notes: notes.trim() || null,
      });
      toast("Calculation Session Converted");
      navigate("/grip/sessions");
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : "Could not convert" });
      setBusy(false);
    }
  };

  const setCorner = (corner: CornerKey, value: string) => {
    setHot((h) => ({ ...h, [corner]: value }));
    setErrors((e2) => ({
      ...e2,
      hot: { ...e2.hot, [corner]: undefined },
      form: undefined,
    }));
  };

  return (
    <div className="container-page">
      <PageHeader
        back={
          <Link
            to="/grip/dashboard"
            className="text-sm font-medium text-grip-600 dark:text-grip-400 hover:underline"
          >
            ← Dashboard
          </Link>
        }
        title="Convert to reference session"
        subtitle="Add the hot pressures you measured and this run becomes a new baseline."
      />

      {c.convertedToRef ? (
        <Card className="text-sm text-gray-600 dark:text-gray-400">
          This calculation has already been converted.{" "}
          <Link
            to="/grip/sessions"
            className="font-medium text-grip-600 dark:text-grip-400 hover:underline"
          >
            See your reference sessions
          </Link>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Card className="space-y-4">
              <Field
                id="convert-name"
                label="Reference session name *"
                value={name}
                onChange={(v) => {
                  setName(v);
                  setErrors((e2) => ({ ...e2, name: undefined, form: undefined }));
                }}
                error={errors.name}
              />
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-gray-500">Track</dt>
                <dd className="text-right">{c.track.name}</dd>
                <dt className="text-gray-500">Weather</dt>
                <dd className="text-right">{c.weather === "WET" ? "Wet" : "Dry"}</dd>
                <dt className="text-gray-500">Track / ambient</dt>
                <dd className="text-right tabular-nums whitespace-nowrap">
                  {formatTemp(c.trackTemp, units)} / {formatTemp(c.ambientTemp, units)}{" "}
                  {tu}
                </dd>
                <dt className="text-gray-500">Session duration</dt>
                <dd className="text-right tabular-nums">{c.durationMin} min</dd>
              </dl>
              <p className="text-xs text-gray-500">
                Everything carries over. You can edit the new reference session after it's
                saved.
              </p>
            </Card>

            <Card className="space-y-3">
              <h2 className="font-bold text-gray-900 dark:text-gray-50">
                Cold tire pressure you set
              </h2>
              <CornerGrid
                unit={pu}
                values={mapCorners(c.result, (v) => formatPressure(v, units))}
              />
            </Card>

            <Card className="space-y-3 !border-grip-500">
              <h2 className="font-bold text-gray-900 dark:text-gray-50">
                Hot tire pressure you measured *
              </h2>
              <CornerInputs
                idPrefix="convert-hot"
                values={hot}
                unit={pu}
                errors={errors.hot}
                onChange={setCorner}
              />
            </Card>

            <Card>
              <label
                htmlFor="convert-notes"
                className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5"
              >
                Notes
              </label>
              <textarea
                id="convert-notes"
                rows={3}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="How did the car come in?"
                className={cn(fieldClass, "resize-y")}
              />
            </Card>

            {errors.form && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {errors.form}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <GripButton type="submit" size="lg" loading={busy}>
                Convert to reference session
              </GripButton>
              <Link
                to="/grip/dashboard"
                className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
              >
                Cancel
              </Link>
            </div>
          </form>

          <Card className="space-y-3">
            <h2 className="font-bold text-gray-900 dark:text-gray-50">What happens</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              A new reference session is created from this calculation plus your hot
              pressures.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              The calculation stays in your history, marked Converted.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Your targets were{" "}
              {(["lf", "rf", "lr", "rr"] as const)
                .map((k) => formatPressure(c.target[k], units))
                .join(" / ")}{" "}
              {pu} hot. Comparing them with what you measured shows how close the
              calculation was.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
