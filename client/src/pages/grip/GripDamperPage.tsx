import { useRef, useState } from "react";
import { ApiClientError } from "@/lib/api";
import { gripApi, type DamperQuery, type DamperResult } from "@/features/grip/api";
import { useGrip } from "@/features/grip/GripContext";
import { UpgradeDialog } from "@/features/grip/UpgradeDialog";
import {
  Card,
  ChoiceChips,
  GripButton,
  PageHeader,
  Pill,
} from "@/features/grip/components";

const QUESTIONS = [
  {
    key: "type",
    label: "Damper adjustment type",
    options: [
      ["rebound_only", "Rebound Only"],
      ["two_way", "Two Way"],
    ],
  },
  {
    key: "direction",
    label: "Turn direction",
    options: [
      ["left", "Left"],
      ["right", "Right"],
    ],
  },
  {
    key: "over_under",
    label: "Over / under",
    options: [
      ["oversteer", "Oversteer"],
      ["understeer", "Understeer"],
    ],
  },
  {
    key: "segment",
    label: "Corner segment",
    options: [
      ["braking", "Braking"],
      ["turn_in", "Turn In"],
      ["mid_corner", "Mid Corner"],
      ["corner_exit", "Corner Exit"],
    ],
  },
  {
    key: "speed",
    label: "Corner speed",
    options: [
      ["low", "Low Speed"],
      ["mid", "Mid Speed"],
      ["high", "High Speed"],
    ],
  },
] as const;

type Answers = Partial<Record<keyof DamperQuery, string>>;

export function GripDamperPage() {
  const { account } = useGrip();
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<{ data: DamperResult; summary: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  if (!account.isPro) {
    return (
      <div className="container-page">
        <PageHeader
          title={
            <>
              Damper tuning tool{" "}
              <Pill tone="pro" className="align-middle ml-1">
                Pro
              </Pill>
            </>
          }
        />
        <Card className="text-center py-12">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">
            Available with Finding Grip Pro
          </h2>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 max-w-lg mx-auto">
            Describe the handling problem by turn direction, corner phase and speed. The
            tool returns up to three damper adjustments to try, for rebound-only or
            two-way dampers.
          </p>
          <GripButton size="lg" className="mt-5" onClick={() => setUpgrade(true)}>
            Upgrade to Pro
          </GripButton>
          <p className="mt-3 text-xs text-gray-500">14-day money-back guarantee.</p>
        </Card>
        {upgrade && <UpgradeDialog onClose={() => setUpgrade(false)} />}
      </div>
    );
  }

  const complete = QUESTIONS.every((q) => answers[q.key]);

  const submit = async () => {
    if (!complete) return;
    setBusy(true);
    setError(null);
    try {
      const data = await gripApi.damper(answers as unknown as DamperQuery);
      const summary = QUESTIONS.map(
        (q) => q.options.find(([v]) => v === answers[q.key])?.[1]
      ).join(" · ");
      setResult({ data, summary });
      requestAnimationFrame(() => {
        if (window.innerWidth < 1024)
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } catch (err) {
      setResult(null);
      if (err instanceof ApiClientError && err.code === "DAMPER_UNAVAILABLE")
        setError("The damper tool isn't switched on yet.");
      else setError(err instanceof Error ? err.message : "Could not look that up");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page">
      <PageHeader
        title="Damper tuning tool"
        subtitle="Answer five questions about the problem. Get adjustments to try, in order."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
        <div className="space-y-3">
          {QUESTIONS.map((q) => (
            <Card key={q.key} className="space-y-2.5">
              <h2 className="font-bold text-gray-900 dark:text-gray-50">{q.label}</h2>
              <ChoiceChips
                label={q.label}
                options={q.options}
                value={(answers[q.key] as never) ?? null}
                onChange={(v) => {
                  setAnswers((a) => ({ ...a, [q.key]: v }));
                  setResult(null);
                }}
              />
            </Card>
          ))}
          <GripButton
            size="lg"
            className="w-full"
            disabled={!complete}
            loading={busy}
            onClick={submit}
          >
            Make damper change
          </GripButton>
          {!complete && (
            <p className="text-xs text-gray-500 text-center">
              Answer all five to continue.
            </p>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <Card className="space-y-3">
            <div ref={resultRef} className="flex items-center justify-between gap-2">
              <h2 className="font-bold text-gray-900 dark:text-gray-50">Damper change</h2>
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            {result ? (
              <>
                <p className="text-xs text-gray-500">{result.summary}</p>
                <ol className="space-y-2.5">
                  {result.data.options.map((option, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-grip-500 text-sm font-bold text-gray-950">
                        {i + 1}
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {option}
                      </span>
                    </li>
                  ))}
                </ol>
                {result.data.options.length > 1 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Make option 1, run the car, then reassess before trying the next.
                  </p>
                )}
              </>
            ) : (
              !error && (
                <p className="text-sm text-gray-500">
                  Your recommended adjustments appear here.
                </p>
              )
            )}
          </Card>
          <Card className="space-y-2">
            <h2 className="font-bold text-gray-900 dark:text-gray-50">How to use it</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <b>Rebound Only</b> is for single-adjustable dampers. <b>Two Way</b> is for
              separate compression and rebound adjusters.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <b>Corner segment</b> is the phase of the corner where you feel the problem.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
