/**
 * "How did it come in?" After a run the driver enters the hot pressures they
 * measured. The page shows how close the calculation got, can save the run as
 * a reference session for next time, and (when it came in on target) is the
 * one place Finding Grip asks for a coffee.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  gripApi,
  CORNER_KEYS,
  type Calculation,
  type CornerKey,
  type Corners,
  type ReferenceSession,
} from "@/features/grip/api";
import { useGrip } from "@/features/grip/GripContext";
import {
  Banner,
  Card,
  CornerGrid,
  CornerInputs,
  Field,
  GripButton,
  Note,
  PageHeader,
  Spinner,
  WeatherPill,
  fieldClass,
  formatDate,
  primaryLinkClass,
} from "@/features/grip/components";
import {
  PressureTable,
  outcomeDetail,
  tolerance,
  verdict,
} from "@/features/grip/outcome";
import {
  formatPressure,
  formatPressureDelta,
  pressureInput,
  pressureUnit,
} from "@/features/grip/units";
import {
  checkCorners,
  checkPressure,
  emptyCorners,
  mapCorners,
} from "@/features/grip/validate";
import { SupportAsk } from "@/features/support/SupportPrompts";
import { track } from "@/lib/analytics";
import { SharePressuresButton } from "@/features/grip/pressureCard";
import { cn } from "@/lib/utils";
import { gp } from "@/lib/site";

const ON_TARGET_PSI = 0.5; // shown before saving; the server decides the saved verdict

export function GripOutcomePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { units, toast } = useGrip();

  const [calc, setCalc] = useState<Calculation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [hot, setHot] = useState<Corners<string>>(emptyCorners);
  const [saveRef, setSaveRef] = useState(true);
  const [refName, setRefName] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<{
    hot?: Partial<Corners<string>>;
    name?: string;
    form?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);
  /** Set when the result was recorded on this visit: the moment to celebrate (and the coffee ask). */
  const [justRecorded, setJustRecorded] = useState(false);
  const [savedRef, setSavedRef] = useState<ReferenceSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    gripApi
      .calculation(id)
      .then((c) => {
        if (cancelled) return;
        setCalc(c);
        setEditing(!c.outcome);
        setRefName(`${c.name.replace(/ Calc$/i, "")} (ref)`.slice(0, 100));
        if (c.outcome) setHot(mapCorners(c.outcome.hot, (v) => pressureInput(v, units)));
      })
      .catch(
        (err) =>
          !cancelled &&
          setLoadError(err instanceof Error ? err.message : "Calculation not found")
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loadError)
    return (
      <div className="container-page">
        <Card className="text-sm text-red-600 dark:text-red-400">{loadError}</Card>
      </div>
    );
  if (!calc) return <Spinner />;
  const c = calc;
  const pu = pressureUnit(units);
  const back = (
    <Link
      to={gp("/dashboard")}
      className="text-sm font-medium text-grip-600 dark:text-grip-400 hover:underline"
    >
      ← Dashboard
    </Link>
  );
  const subtitle = `${c.name} · ${c.track.name} · ${formatDate(c.sessionDate)}`;

  // Live comparison while typing (the saved verdict comes from the server).
  const typed = checkCorners(hot, (t) => checkPressure(t, units, true));
  const live =
    typed.ok && typed.allFilled
      ? CORNER_KEYS.map((k) => (typed.values[k] as number) - c.target[k])
      : null;
  const liveOnTarget = live?.every((d) => Math.abs(d) <= ON_TARGET_PSI + 1e-9) ?? false;

  const setCorner = (corner: CornerKey, value: string) => {
    setHot((h) => ({ ...h, [corner]: value }));
    setErrors((e) => ({ ...e, hot: { ...e.hot, [corner]: undefined }, form: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!typed.ok) next.hot = typed.errors;
    const wantsRef = saveRef && !c.convertedToRef;
    if (wantsRef && !refName.trim()) next.name = "Required";
    if (Object.keys(next).length) {
      setErrors({ ...next, form: "Check the highlighted fields." });
      return;
    }
    setBusy(true);
    try {
      const r = await gripApi.recordOutcome(c.id, {
        hot: typed.values as Corners,
        saveAsReference: wantsRef,
        ...(wantsRef
          ? { referenceName: refName.trim(), notes: notes.trim() || null }
          : {}),
      });
      setCalc(r.calculation);
      if (r.session) setSavedRef(r.session);
      // Analytics: anonymous facts only (see client/src/lib/analytics.ts).
      const o = r.calculation.outcome;
      track("record_hot", {
        onTarget: o?.onTarget ?? null,
        savedAsReference: !!r.session,
        corrected: !!c.outcome,
        weather: c.weather,
      });
      if (o?.onTarget) track("on_target", { worstMissPsi: o.worstMiss });
      setJustRecorded(true);
      setEditing(false);
      toast(r.session ? "Saved, and added as a reference session" : "Saved");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setSkipping(true);
    try {
      await gripApi.skipOutcome(c.id);
      toast("Okay, we won't ask about this one");
      navigate(gp("/dashboard"));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save");
      setSkipping(false);
    }
  };

  // ── Result ──
  if (!editing && c.outcome) {
    const o = c.outcome;
    const v = verdict(o, units);
    const nextRef = savedRef?.id ?? c.referenceSessionId;
    return (
      <div className="container-page max-w-3xl space-y-4">
        <PageHeader back={back} title="How it came in" subtitle={subtitle} />

        <Card className={cn("space-y-4", o.onTarget && "!border-emerald-500/60")}>
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "grid h-12 w-12 shrink-0 place-items-center rounded-full text-2xl font-bold",
                o.onTarget
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              )}
            >
              {o.onTarget ? "✓" : "↕"}
            </span>
            <div className="min-w-0">
              <h2
                className={cn(
                  "text-2xl font-extrabold tracking-tight",
                  o.onTarget
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-gray-900 dark:text-gray-50"
                )}
              >
                {v.title}
              </h2>
              <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{v.body}</p>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-gray-500">
              Hot pressure you measured
            </div>
            <CornerGrid
              unit={pu}
              values={mapCorners(o.hot, (x) => formatPressure(x, units))}
              detail={outcomeDetail(o, units)}
            />
          </div>
          <PressureTable
            label="What you set"
            units={units}
            rows={[
              { label: "Cold set", values: c.result, tone: "set" },
              { label: "Target hot", values: c.target },
            ]}
          />

          {!o.onTarget && (
            <Note>
              {savedRef || c.convertedToRef
                ? "This run is now a reference session, so the next calculation starts from how the car really behaved."
                : "Saving runs as reference sessions means the next calculation starts from how the car really behaved."}
            </Note>
          )}

          {/* The one contextual coffee ask: right after a run that came in on target. */}
          {justRecorded && o.onTarget && <SupportAsk />}
        </Card>

        {savedRef && (
          <Banner tone="ok">
            Saved as reference session <b>{savedRef.name}</b>. It is the baseline for your
            next calculation.
          </Banner>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {nextRef && (
            <Link
              to={gp(`/calculate?ref=${nextRef}`)}
              className={cn(primaryLinkClass, "px-4 py-2 text-sm")}
            >
              Calculate the next session
            </Link>
          )}
          <SharePressuresButton calc={c} />
          <GripButton
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(true);
              setJustRecorded(false);
            }}
          >
            Change the pressures
          </GripButton>
        </div>
      </div>
    );
  }

  // ── Form ──
  return (
    <div className="container-page max-w-3xl">
      <PageHeader back={back} title="How did it come in?" subtitle={subtitle} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold text-gray-900 dark:text-gray-50">What you set</h2>
            <WeatherPill weather={c.weather} />
          </div>
          <PressureTable
            label="What you set"
            units={units}
            rows={[
              { label: "Cold set", values: c.result, tone: "set" },
              { label: "Target hot", values: c.target },
            ]}
          />
        </Card>

        <Card className="space-y-3 !border-grip-500">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-gray-50">
              Hot pressure you measured *
            </h2>
            <p className="text-xs text-gray-500">
              Check them as soon as the car comes in. Within{" "}
              {tolerance({ onTargetPsi: ON_TARGET_PSI }, units)} of the target counts as
              on target.
            </p>
          </div>
          <CornerInputs
            idPrefix="outcome-hot"
            values={hot}
            unit={pu}
            errors={errors.hot}
            onChange={setCorner}
          />
          <p className="min-h-5 text-sm" role="status">
            {live &&
              (liveOnTarget ? (
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  ✓ All four within {tolerance({ onTargetPsi: ON_TARGET_PSI }, units)} of
                  target
                </span>
              ) : (
                <span className="text-gray-600 dark:text-gray-400">
                  vs target:{" "}
                  {CORNER_KEYS.map(
                    (k, i) => `${k.toUpperCase()} ${formatPressureDelta(live[i], units)}`
                  ).join(" · ")}
                </span>
              ))}
          </p>
        </Card>

        {c.convertedToRef ? (
          <Note>This run is already saved as a reference session.</Note>
        ) : (
          <Card className="space-y-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                id="outcome-save-ref"
                type="checkbox"
                checked={saveRef}
                onChange={(e) => setSaveRef(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 accent-grip-500 focus:ring-grip-500"
              />
              <span>
                <b className="text-gray-900 dark:text-gray-100">
                  Also save it as a reference session
                </b>
                <span className="block text-gray-600 dark:text-gray-400">
                  Your next calculation can start from how the car really behaved today.
                </span>
              </span>
            </label>
            {saveRef && (
              <>
                <Field
                  id="outcome-ref-name"
                  label="Reference session name *"
                  value={refName}
                  onChange={(v) => {
                    setRefName(v);
                    setErrors((e2) => ({ ...e2, name: undefined, form: undefined }));
                  }}
                  error={errors.name}
                />
                <div>
                  <label
                    htmlFor="outcome-notes"
                    className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400"
                  >
                    Notes
                  </label>
                  <textarea
                    id="outcome-notes"
                    rows={2}
                    maxLength={2000}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Anything to remember about this run?"
                    className={cn(fieldClass, "resize-y")}
                  />
                </div>
              </>
            )}
          </Card>
        )}

        {errors.form && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {errors.form}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <GripButton type="submit" size="lg" loading={busy}>
            Save how it came in
          </GripButton>
          {c.outcome ? (
            <GripButton type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </GripButton>
          ) : (
            <GripButton type="button" variant="ghost" loading={skipping} onClick={skip}>
              Didn't run it
            </GripButton>
          )}
        </div>
      </form>
    </div>
  );
}
