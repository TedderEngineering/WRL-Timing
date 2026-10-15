/**
 * "Add to home screen", shared by RaceTrace and Finding Grip (each site imports it once in
 * its layout, so the browser's offer is caught on the first page load). Chrome and Edge on Android (and desktop) fire
 * `beforeinstallprompt` once, early, when the site can be installed; keep it so
 * a button can show the browser's install dialog later. Safari never fires it,
 * so iPhone users get instructions instead.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own, quieter hint
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export const canPromptInstall = () => deferred !== null;

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Show the browser's install dialog. True if the person installed it. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const choice = await e.userChoice;
  listeners.forEach((l) => l());
  return choice.outcome === "accepted";
}

/** Already running from the home screen. */
export function isInstalled(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export type InstallPlatform = "ios" | "android" | "other";

export function installPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  if (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
    return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}
