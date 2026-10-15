import { useCallback, useState } from "react";
import { track } from "@/lib/analytics";

export type ShareMethod = "share" | "download" | "cancelled";

/**
 * Hand an image to the phone's share sheet (Web Share with files), or
 * download it where sharing files isn't supported.
 */
export async function shareImage(
  blob: Blob,
  filename: string,
  text: string
): Promise<ShareMethod> {
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: text, text });
      return "share";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Some browsers refuse at the last moment: fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "download";
}

/** "INDY R1 Calc" -> "indy-r1-calc.png", with a site prefix. */
export function imageName(prefix: string, title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "card";
  return `${prefix}-${slug}.png`;
}

/**
 * Make and share a card from a button. Sends `share_card { kind, method }`
 * (same event on both sites) once the image has been shared or downloaded.
 */
export function useShareCard() {
  const [busy, setBusy] = useState(false);
  const share = useCallback(
    async (args: {
      make: () => Promise<Blob>;
      filename: string;
      text: string;
      /** What the card shows, e.g. "pressures", "stint", "season". */
      kind: string;
    }): Promise<ShareMethod> => {
      setBusy(true);
      try {
        const method = await shareImage(await args.make(), args.filename, args.text);
        if (method !== "cancelled") track("share_card", { kind: args.kind, method });
        return method;
      } finally {
        setBusy(false);
      }
    },
    []
  );
  return { share, busy };
}
