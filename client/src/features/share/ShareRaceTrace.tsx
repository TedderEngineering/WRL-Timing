import { useState } from "react";
import { shareLink, sharedUrl, type ShareLinkMethod } from "./shareLink";

/**
 * "Share RaceTrace" (the site), the RaceTrace sibling of Finding Grip's shareApp: one factual
 * line and the home address tagged ?from=share. Placed in the phone menu, the footer, Settings
 * and one quiet line under the dashboard's free card; never a pop-up, never on a timer, and
 * never at the peak moment (Your car's race), which carries the coffee ask.
 */
export const RACETRACE_SHARE_TEXT =
  "RaceTrace: free lap charts, position traces and race stories for WRL, IMSA and SRO races, by Tedder Engineering.";

export function useShareFeedback() {
  const [note, setNote] = useState<string | null>(null);
  const done = (m: ShareLinkMethod) => {
    setNote(m === "copy" ? "Link copied ✓" : m === "failed" ? "Copy failed: use the address bar" : null);
    if (m === "copy" || m === "failed") setTimeout(() => setNote(null), 2500);
  };
  return { note, done };
}

export function ShareRaceTraceButton({
  source,
  className,
  label = "Share RaceTrace",
  onShared,
}: {
  /** Where the button is: "menu", "footer", "settings", "dashboard". */
  source: string;
  className?: string;
  label?: string;
  onShared?: () => void;
}) {
  const { note, done } = useShareFeedback();
  return (
    <button
      type="button"
      aria-live="polite"
      className={className}
      onClick={async () => {
        const m = await shareLink({ url: sharedUrl(`${window.location.origin}/`), title: "RaceTrace", text: RACETRACE_SHARE_TEXT, source });
        done(m);
        if (m === "share") onShared?.();
      }}
    >
      {note ?? label}
    </button>
  );
}
