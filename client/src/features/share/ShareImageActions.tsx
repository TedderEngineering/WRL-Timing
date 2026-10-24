import { useState } from "react";
import { isComputer, useShareCard, type ShareMethod } from "./shareImage";

/**
 * RaceTrace's buttons for a share image. On a phone: one button, the share sheet with the
 * PNG. On a computer, where the OS share sheet often can't copy an image: "Copy image" (to the
 * clipboard, ready to paste into a message) and "Download". Each says what happened.
 */
export function ShareImageActions({
  make,
  filename,
  text,
  kind,
  label,
  className = "min-h-[44px] text-[13px] hover:underline disabled:opacity-60 sm:min-h-0",
  color = "#F48C34",
}: {
  make: () => Promise<Blob>;
  filename: string;
  text: string;
  kind: string;
  /** The phone button, e.g. "Share an image of this car's race". */
  label: string;
  className?: string;
  color?: string;
}) {
  const { share, busy } = useShareCard();
  const [note, setNote] = useState<string | null>(null);
  const computer = isComputer();
  const run = async (onComputer?: "copy" | "download") => {
    setNote(null);
    let m: ShareMethod;
    try {
      m = await share({ make, filename, text, kind, onComputer });
    } catch {
      setNote("The image could not be made. Try again.");
      return;
    }
    setNote(m === "copy" ? "Image copied. Paste it into a message or post." : m === "download" ? "Image saved to your downloads." : null);
    if (m === "copy" || m === "download") setTimeout(() => setNote(null), 4000);
  };
  return (
    <span className="flex flex-col items-start gap-0.5">
      {computer ? (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" disabled={busy} onClick={() => run("copy")} className={className} style={{ color }}>
            {busy ? "Making the image…" : `${label.replace(/^Share /, "Copy ")} ›`}
          </button>
          <button type="button" disabled={busy} onClick={() => run("download")} className={className} style={{ color }}>
            Download
          </button>
        </span>
      ) : (
        <button type="button" disabled={busy} onClick={() => run()} className={className} style={{ color }}>
          {busy ? "Making the image…" : `${label} ›`}
        </button>
      )}
      {note && (
        <span role="status" className="text-xs" style={{ color: "#9a9ab4" }}>
          {note}
        </span>
      )}
    </span>
  );
}
