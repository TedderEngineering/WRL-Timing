import { useState } from "react";
import { ApiClientError } from "@/lib/api";
import { gripApi } from "./api";
import { useGrip } from "./GripContext";
import { Dialog, GripButton, Pill } from "./components";

/** Start Stripe Checkout for Finding Grip Pro. Returns an error message, or never returns on success (the page leaves). */
export async function startCheckout(): Promise<string> {
  try {
    const { url } = await gripApi.checkout();
    window.location.href = url;
    return "";
  } catch (err) {
    if (err instanceof ApiClientError && err.code === "GRIP_PRICE_NOT_CONFIGURED") {
      return "Finding Grip Pro isn't on sale yet. Check back soon.";
    }
    return err instanceof Error
      ? err.message
      : "Failed to start checkout. Please try again.";
  }
}

export function UpgradeDialog({
  reason,
  onClose,
}: {
  reason?: string;
  onClose: () => void;
}) {
  const { checkoutAvailable } = useGrip();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    const message = await startCheckout();
    if (message) {
      setError(message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={reason ?? "Upgrade to Pro"} onClose={onClose}>
      <div className="mt-2">
        <Pill tone="pro">Finding Grip Pro</Pill>
      </div>
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
        Unlimited tire pressure calculations and the Damper Tuning Tool.
      </p>
      <p className="mt-3 text-xs text-gray-500">
        Billed annually through Stripe, the same checkout RaceTrace uses. 14-day
        money-back guarantee. Cancel any time and keep Pro through the end of the billing
        period.
      </p>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!checkoutAvailable && !error && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
          Pro isn't on sale yet.
        </p>
      )}
      <div className="mt-5 flex flex-col gap-2">
        <GripButton size="lg" loading={busy} disabled={!checkoutAvailable} onClick={go}>
          Continue to checkout
        </GripButton>
        <GripButton variant="ghost" onClick={onClose}>
          Not now
        </GripButton>
      </div>
    </Dialog>
  );
}
