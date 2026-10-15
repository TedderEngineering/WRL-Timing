import { useEffect, useState } from "react";
import {
  canPromptInstall,
  installPlatform,
  isInstalled,
  onInstallChange,
  promptInstall,
  type InstallPlatform,
} from "../../lib/install";

/**
 * A quiet card offering to install RaceTrace (home screen on a phone, its own window on a
 * computer). The same rules as Finding Grip's InstallHint: one fact, one "Not now" that
 * hides it for 60 days, never shown inside the installed app or on a computer whose browser
 * has not offered install. Its dismissal lives in RaceTrace's own key.
 */
const KEY = "racetrace.ui.v1";
const QUIET_DAYS = 60;
const DAY = 86_400_000;

interface UiState {
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

export type InstallHintMode = "prompt" | "ios" | "menu";

/** What the card shows, or null when it stays hidden. */
export function installHintMode(s: {
  dismissedAt?: number;
  now: number;
  installed: boolean;
  phone: boolean;
  canPrompt: boolean;
  platform: InstallPlatform;
}): InstallHintMode | null {
  if (s.dismissedAt && s.now - s.dismissedAt < QUIET_DAYS * DAY) return null;
  if (s.installed) return null;
  if (s.canPrompt) return "prompt";
  // Without the browser's offer, only phones get written steps; computers see nothing.
  if (!s.phone) return null;
  if (s.platform === "ios") return "ios";
  if (s.platform === "android") return "menu";
  return null;
}

const BENEFIT = "One tap opens the latest races full screen, like an app.";

export function InstallHint() {
  const [, rerender] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(() => readUi().installDismissedAt);
  useEffect(() => onInstallChange(() => rerender((n) => n + 1)), []);

  let phone = false;
  try {
    phone = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    phone = false;
  }
  const mode = installHintMode({
    dismissedAt,
    now: Date.now(),
    installed: isInstalled(),
    phone,
    canPrompt: canPromptInstall(),
    platform: installPlatform(),
  });
  if (!mode) return null;

  const close = () => {
    const at = Date.now();
    writeUi({ installDismissedAt: at });
    setDismissedAt(at);
  };
  const how =
    mode === "ios"
      ? "In Safari, tap the Share button, then Add to Home Screen."
      : mode === "menu"
        ? "Open the browser menu (⋮) and choose Add to Home screen or Install app."
        : null;

  return (
    <aside
      aria-label="Install RaceTrace"
      className="flex items-start gap-3 rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] px-4 py-3.5 text-left"
    >
      <img src="/racetrace-icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-[10px]" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[var(--rt-text)]">
          {phone ? "Put RaceTrace on your home screen" : "Install RaceTrace"}
        </div>
        <p className="m-0 mt-1 text-[13px] leading-normal text-[var(--rt-text-secondary)]">
          {BENEFIT}
          {how ? ` ${how}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {mode === "prompt" && (
            <button
              type="button"
              onClick={() => promptInstall().then((ok) => ok && close())}
              className="min-h-[36px] rounded-md bg-[var(--rt-accent)] px-3 text-[13px] font-semibold text-[var(--rt-on-accent)]"
            >
              {phone ? "Add to home screen" : "Install"}
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="min-h-[36px] text-[13px] text-[var(--rt-text-muted)] hover:text-[var(--rt-text)]"
          >
            Not now
          </button>
        </div>
      </div>
    </aside>
  );
}
