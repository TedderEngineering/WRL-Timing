import { useState } from "react";
import { shareLink, shareUrl } from "./shareLink";

/**
 * "Share" for a race: the share sheet on a phone, "Link copied" on a computer. The link opens
 * the race on Position Trace for anyone, signed in or not.
 */
export function ShareRaceButton({
  raceId,
  title,
  kind = "race_link",
  className,
  style,
  label = "Share",
}: {
  raceId: string;
  title: string;
  kind?: string;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const click = async () => {
    const url = shareUrl(`/chart?race=${encodeURIComponent(raceId)}`);
    const m = await shareLink({ url, title, kind });
    setNote(m === "copy" ? "Link copied" : m === "failed" ? "Copy failed: use the address bar" : null);
    if (m === "copy" || m === "failed") setTimeout(() => setNote(null), 2500);
  };
  return (
    <button type="button" onClick={click} className={className} style={style} aria-live="polite">
      <span aria-hidden>↗</span> {note ?? label}
    </button>
  );
}
