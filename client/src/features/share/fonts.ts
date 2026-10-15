/**
 * IBM Plex Sans (text) and IBM Plex Mono (numbers) for share cards.
 *
 * Loaded only when someone makes a card, from our own files (the @fontsource
 * packages), never from a font service. Pages that never make a card load
 * nothing extra.
 */
import sans500 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2?url";
import sans600 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?url";
import sans700 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2?url";
import mono600 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url";
import mono700 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2?url";

export const SANS = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
export const MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

const FACES: [family: string, url: string, weight: string][] = [
  ["IBM Plex Sans", sans500, "500"],
  ["IBM Plex Sans", sans600, "600"],
  ["IBM Plex Sans", sans700, "700"],
  ["IBM Plex Mono", mono600, "600"],
  ["IBM Plex Mono", mono700, "700"],
];

let loading: Promise<void> | null = null;

/** Load the card fonts once. Never fails: if a font can't load, the system font is used. */
export function loadShareFonts(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      if (typeof document === "undefined" || typeof FontFace === "undefined") return;
      await Promise.all(
        FACES.map(async ([family, url, weight]) => {
          try {
            const face = new FontFace(family, `url(${url})`, { weight, style: "normal" });
            document.fonts.add(await face.load());
          } catch {
            // Offline or blocked: fall back to the system font.
          }
        })
      );
      try {
        await document.fonts.ready;
      } catch {
        // ignore
      }
    })();
  }
  return loading;
}
