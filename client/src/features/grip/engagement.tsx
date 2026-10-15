/**
 * Finding Grip dashboard pieces for step 4 of ENGAGEMENT_PRINCIPLES ("Low
 * effort", then the first-use checklist):
 *  - a quiet hint on phones to put Finding Grip on the home screen;
 *  - the first-weekend checklist: four steps, the first already ticked.
 * Both can be closed and stay closed. No streaks, no nagging.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { gp } from "@/lib/site";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import type { Calculation, ReferenceSession } from "./api";
import { Card, GripButton } from "./components";
import { awaitingOutcome } from "./outcome";
import {
  canPromptInstall,
  installPlatform,
  isInstalled,
  onInstallChange,
  promptInstall,
} from "./install";

// ─── Per-browser memory (hidden cards) ───────────────────────────────────────

const KEY = "findinggrip.ui.v1";
interface UiState {
  checklistHidden?: boolean;
  installDismissedAt?: number;
}
function readUi(): UiState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function writeUi(patch: UiState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readUi(), ...patch }));
  } catch {
    // private window or blocked storage: the card just shows again next time
  }
}

// ─── First weekend ───────────────────────────────────────────────────────────

/**
 * Four steps, the first already ticked. Shows until all are done (or hidden),
 * and it teaches the whole loop: reference, calculate, record, repeat.
 */
export function FirstWeekendChecklist({
  sessions,
  calcs,
}: {
  sessions: ReferenceSession[];
  calcs: Calculation[];
}) {
  const [hidden, setHidden] = useState(() => !!readUi().checklistHidden);
  const waiting = calcs.find((c) => awaitingOutcome(c));
  const steps = [
    { key: "account", label: "Create your account", done: true, to: null },
    {
      key: "reference",
      label: "Add a reference session from a run you know well",
      done: sessions.length > 0,
      to: gp("/sessions/new"),
    },
    {
      key: "calculation",
      label: "Run your first calculation before a session",
      done: calcs.length > 0,
      to: gp("/calculate"),
    },
    {
      key: "record_hot",
      label: "After the session, record how it came in",
      done: calcs.some((c) => c.outcome),
      to: waiting ? gp(`/calculations/${waiting.id}/outcome`) : gp("/calculate"),
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (hidden || done === steps.length) return null;
  const next = steps.find((s) => !s.done);

  return (
    <Card className="space-y-3" aria-labelledby="checklist-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="checklist-title" className="font-bold text-gray-900 dark:text-gray-50">
            Your first race weekend with Finding Grip
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {done} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            writeUi({ checklistHidden: true });
            setHidden(true);
          }}
          className="min-h-[36px] px-2 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          Hide
        </button>
      </div>
      <div
        className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        aria-label="Checklist progress"
      >
        <div
          className="h-full rounded-full bg-grip-500 transition-all"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>
      <ol className="space-y-1">
        {steps.map((s) => {
          const isNext = s === next;
          const body = (
            <>
              <span
                aria-hidden
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold",
                  s.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : isNext
                      ? "border-2 border-grip-500"
                      : "border-gray-300 dark:border-gray-700"
                )}
              >
                {s.done ? "✓" : null}
              </span>
              <span
                className={cn(
                  "text-sm",
                  s.done
                    ? "text-gray-500 line-through decoration-gray-400/60"
                    : isNext
                      ? "font-semibold text-gray-900 dark:text-gray-100"
                      : "text-gray-700 dark:text-gray-300"
                )}
              >
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : ""}</span>
              </span>
              {isNext && (
                <span className="ml-auto text-sm font-semibold text-grip-600 dark:text-grip-400">
                  Start →
                </span>
              )}
            </>
          );
          return (
            <li key={s.label}>
              {s.done || !s.to ? (
                <div className="flex min-h-[44px] items-center gap-3 px-1">{body}</div>
              ) : (
                <Link
                  to={s.to}
                  // Same event on both sites: which checklist step was opened.
                  onClick={() => track("checklist_step", { step: s.key })}
                  className="flex min-h-[44px] items-center gap-3 rounded-lg px-1 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ─── Home screen ─────────────────────────────────────────────────────────────

/** A quiet hint on phones to add Finding Grip to the home screen. Hidden for 60 days when closed. */
export function InstallHint() {
  const [, force] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    const at = readUi().installDismissedAt;
    return !!at && Date.now() - at < 60 * 86_400_000;
  });
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);

  let phone = false;
  try {
    phone = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    phone = false;
  }
  const platform = installPlatform();
  const canPrompt = canPromptInstall();
  if (dismissed || isInstalled() || (!phone && !canPrompt)) return null;
  if (!canPrompt && platform === "other") return null;

  const close = () => {
    writeUi({ installDismissedAt: Date.now() });
    setDismissed(true);
  };
  return (
    <Card className="flex items-start gap-3">
      <img src="/grip-icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-semibold text-gray-900 dark:text-gray-100">
          Put Finding Grip on your home screen
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {canPrompt
            ? "One tap to open it in the pit lane, full screen like an app."
            : platform === "ios"
              ? "In Safari, tap the Share button, then Add to Home Screen. One tap to open it in the pit lane."
              : "Open the browser menu (⋮) and choose Add to Home screen or Install app. One tap to open it in the pit lane."}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canPrompt && (
            <GripButton
              size="sm"
              onClick={() => promptInstall().then((ok) => ok && close())}
            >
              Add to home screen
            </GripButton>
          )}
          <button
            type="button"
            onClick={close}
            className="min-h-[36px] px-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Not now
          </button>
        </div>
      </div>
    </Card>
  );
}
