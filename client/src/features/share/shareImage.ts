import { useCallback, useState } from "react";
import { track } from "@/lib/analytics";
import { currentDeviceClass } from "@/lib/breakpoint";

export type ShareMethod = "share" | "copy" | "download" | "cancelled";

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
  return downloadImage(blob, filename);
}

/** Save the PNG to the computer. */
export function downloadImage(blob: Blob, filename: string): "download" {
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

/** A computer (fine pointer), where a share sheet for files is the OS's and often can't copy. */
export function isComputer(): boolean {
  try {
    return !window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return true;
  }
}

/**
 * Put the PNG on the clipboard, ready to paste into a message or document. The ClipboardItem
 * takes the promise itself, so the copy starts inside the click (Safari needs that while the
 * image is still being drawn). False when the browser refuses.
 */
export async function copyImage(blob: Promise<Blob>): Promise<boolean> {
  try {
    const C = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (!C || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new C({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
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
      /**
       * On a computer: "copy" puts the image on the clipboard (falling back to a download when
       * the browser refuses); "download" saves it; omitted keeps the old behaviour (the OS share
       * sheet where the browser offers one, else a download). Phones always get the share sheet.
       */
      onComputer?: "copy" | "download";
    }): Promise<ShareMethod> => {
      setBusy(true);
      try {
        let method: ShareMethod;
        if (args.onComputer && isComputer()) {
          // Start the drawing and the copy within the click, before anything is awaited.
          const blob = args.make();
          if (args.onComputer === "copy" && (await copyImage(blob))) method = "copy";
          else method = downloadImage(await blob, args.filename);
        } else {
          method = await shareImage(await args.make(), args.filename, args.text);
        }
        if (method !== "cancelled") track("share_card", { kind: args.kind, method, device: currentDeviceClass() });
        return method;
      } finally {
        setBusy(false);
      }
    },
    []
  );
  return { share, busy };
}
