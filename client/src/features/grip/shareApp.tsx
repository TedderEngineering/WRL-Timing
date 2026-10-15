/**
 * "Share Finding Grip": send the site's link to a friend. Always available and
 * never a pop-up (menu, footer, settings, the dashboard's free card); it is
 * not offered at the on-target moment, which already carries the coffee ask.
 *
 * Uses the shared helper (features/share/shareLink.ts): the phone's share
 * sheet, or "Link copied" on a computer; `share_app { source, method }`.
 */
import { useEffect, useRef, useState } from "react";
import { noteShareArrival, shareLink, sharedUrl } from "@/features/share/shareLink";
import { IS_GRIP_SITE, gp } from "@/lib/site";
import { cn } from "@/lib/utils";
import { GripButton } from "./components";

// Count a visit from a shared link once, as the page loads (before routing).
if (
  typeof window !== "undefined" &&
  (IS_GRIP_SITE || window.location.pathname.startsWith("/grip"))
) {
  const home = gp("") || "/";
  noteShareArrival((path) => (path === home || path === `${home}/` ? "home" : "app"));
}

export const GRIP_SHARE_TITLE = "Finding Grip";
export const GRIP_SHARE_TEXT =
  "Finding Grip: a free cold tire pressure calculator and damper guide for race and track cars, by Tedder Engineering.";

/** The home page of whichever address this is, tagged as a share. */
export function gripShareUrl(): string {
  return sharedUrl(new URL(gp("") || "/", window.location.origin).toString());
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

/**
 * `source` names the placement in analytics. `look`: "button" (a secondary
 * button), "menu" (a row in the phone menu) or "link" (a footer link).
 */
export function ShareGripButton({
  source,
  look = "button",
  className,
  onDone,
}: {
  source: string;
  look?: "button" | "menu" | "link";
  className?: string;
  onDone?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = async () => {
    setBusy(true);
    try {
      const method = await shareLink({
        url: gripShareUrl(),
        title: GRIP_SHARE_TITLE,
        text: GRIP_SHARE_TEXT,
        source,
      });
      if (method === "copy") {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2500);
      }
      if (method === "share") onDone?.();
    } finally {
      setBusy(false);
    }
  };

  const label = copied ? "Link copied ✓" : "Share Finding Grip";
  if (look === "button") {
    return (
      <GripButton
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={go}
        className={className}
      >
        {!copied && <ShareIcon className="mr-1.5 h-4 w-4" />}
        <span aria-live="polite">{label}</span>
      </GripButton>
    );
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className={cn(
        look === "menu"
          ? "flex items-center gap-2 py-2.5 text-left text-gray-700 dark:text-gray-300"
          : "inline-flex items-center gap-1.5 text-left hover:text-gray-700 dark:hover:text-gray-300",
        className
      )}
    >
      {!copied && <ShareIcon className="h-4 w-4" />}
      <span aria-live="polite">{label}</span>
    </button>
  );
}
