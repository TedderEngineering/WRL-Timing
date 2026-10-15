import { useEffect, useState } from "react";
import { track } from "../../lib/analytics";
import { getAlerts, setAlerts } from "./api";
import { readUi, writeUi } from "../dashboard/ui-state";

/**
 * Race-ready emails (engagement plan D): off by default, asked for twice at most, on the
 * first-steps checklist and once right after the first follow. One fact, one "No thanks".
 */

/** Turn race emails on or off and record it (alert_opt_in, the agreed event). */
export async function switchAlerts(on: boolean, source: string): Promise<boolean> {
  const r = await setAlerts(on);
  track("alert_opt_in", { channel: "email", on, source });
  return r.raceAlerts;
}

let arrivalNoted = false;

/** Once per load: a visit from an alert email (?from=alert) sends alert_open, and the tag goes. */
export function noteAlertArrival(): void {
  if (arrivalNoted || typeof window === "undefined") return;
  arrivalNoted = true;
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get("from") !== "alert") return;
    track("alert_open", { raceId: u.searchParams.get("race") ?? undefined });
    u.searchParams.delete("from");
    window.history.replaceState(window.history.state, "", `${u.pathname}${u.search}${u.hash}`);
  } catch {
    // never break the page for analytics
  }
}

export function __resetAlertArrivalForTests(): void {
  arrivalNoted = false;
}

/** The ask right after a follow: shown once per browser, and only while emails are off. */
export function AlertAskAfterFollow({ carNumber, style }: { carNumber: string; style?: React.CSSProperties }) {
  const [state, setState] = useState<"checking" | "ask" | "on" | "gone">(() => (readUi().alertAskDone ? "gone" : "checking"));
  useEffect(() => {
    if (state !== "checking") return;
    getAlerts()
      .then((r) => setState(r.raceAlerts ? "gone" : "ask"))
      .catch(() => setState("gone"));
  }, [state]);
  if (state === "checking" || state === "gone") return null;
  const done = (next: "on" | "gone") => {
    writeUi({ alertAskDone: true });
    setState(next);
  };
  if (state === "on") {
    return (
      <span className="mt-1 block text-xs" style={style}>
        ✓ We&apos;ll email you when #{carNumber}&apos;s next race is up. Turn it off any time in Settings → Preferences.
      </span>
    );
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={style}>
      Email me when #{carNumber}&apos;s next race is up?
      <button
        type="button"
        className="font-semibold underline"
        onClick={async () => {
          try {
            await switchAlerts(true, "after_follow");
            done("on");
          } catch {
            done("gone");
          }
        }}
      >
        Turn on
      </button>
      <button type="button" className="opacity-70" onClick={() => done("gone")}>
        No thanks
      </button>
    </span>
  );
}
