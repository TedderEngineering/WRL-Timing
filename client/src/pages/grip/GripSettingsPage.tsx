import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { downloadExport, gripApi } from "@/features/grip/api";
import { useGrip } from "@/features/grip/GripContext";
import { UpgradeDialog } from "@/features/grip/UpgradeDialog";
import {
  Banner,
  Card,
  ChoiceChips,
  GripButton,
  Note,
  PageHeader,
  Pill,
} from "@/features/grip/components";
import type { Units } from "@/features/grip/units";

const UNIT_OPTIONS = [
  ["STANDARD", "PSI · °F"],
  ["METRIC", "bar · °C"],
] as const;

export function GripSettingsPage() {
  const { user } = useAuth();
  const { account, units, setUnits, refresh, toast } = useGrip();
  const [params, setParams] = useSearchParams();
  const [activated, setActivated] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  // Returning from Stripe Checkout
  useEffect(() => {
    if (!params.has("session_id")) return;
    setActivated(true);
    setParams({}, { replace: true });
    // The webhook can land a moment after the redirect; check again shortly.
    refresh();
    const retry = setTimeout(refresh, 3000);
    const hide = setTimeout(() => setActivated(false), 10000);
    return () => {
      clearTimeout(retry);
      clearTimeout(hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeUnits = async (next: Units) => {
    try {
      await setUnits(next);
      toast(next === "METRIC" ? "Showing bar and °C" : "Showing PSI and °F");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change units");
    }
  };

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const { url } = await gripApi.portal();
      window.location.href = url;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to open billing portal");
      setPortalBusy(false);
    }
  };

  const runExport = async () => {
    setExportBusy(true);
    try {
      await downloadExport();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  const isAdmin = user?.role === "ADMIN";
  const paid = account.plan === "PRO";
  const periodEnd = account.currentPeriodEnd
    ? new Date(account.currentPeriodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  let planLine: string;
  if (paid && account.status === "PAST_DUE")
    planLine = "Payment past due. Update your card to keep Pro.";
  else if (paid && account.cancelAtPeriodEnd && periodEnd)
    planLine = `Cancels on ${periodEnd}`;
  else if (paid && account.status === "CANCELED" && periodEnd)
    planLine = account.isPro ? `Access until ${periodEnd}` : `Ended ${periodEnd}`;
  else if (paid && periodEnd) planLine = `Active · renews ${periodEnd}`;
  else if (isAdmin) planLine = "Admin accounts have full access.";
  else
    planLine = `${account.freeCalculationLimit} calculations included · ${account.freeCalculationsLeft} left`;

  return (
    <div className="container-page max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-4">
        {activated && (
          <Banner tone="ok">
            <b>Subscription activated! Your account has been upgraded.</b>
          </Banner>
        )}

        <Card className="space-y-3">
          <h2 className="font-bold text-gray-900 dark:text-gray-50">Units</h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Used everywhere in Finding Grip. Saved data converts automatically.
            </span>
            <ChoiceChips
              label="Units"
              options={UNIT_OPTIONS}
              value={units}
              onChange={changeUnits}
            />
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold text-gray-900 dark:text-gray-50">Plan</h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xl font-extrabold text-gray-900 dark:text-gray-50">
                Finding Grip {isAdmin && !paid ? "Admin" : paid ? "Pro" : "Free"}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{planLine}</div>
            </div>
            <Pill tone={account.isPro ? "ok" : "neutral"}>
              {account.isPro ? "Active" : "Free"}
            </Pill>
          </div>
          <div className="flex flex-wrap gap-2">
            {paid ? (
              <GripButton variant="secondary" loading={portalBusy} onClick={openPortal}>
                Manage billing
              </GripButton>
            ) : (
              !isAdmin && (
                <GripButton onClick={() => setUpgrade(true)}>Upgrade to Pro</GripButton>
              )
            )}
          </div>
          <Note>
            Payment, invoices and cancellation are handled in the Stripe billing portal,
            the same one RaceTrace uses. Cancel any time and keep Pro through the end of
            the billing period. 14-day money-back guarantee on your first purchase.
          </Note>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold text-gray-900 dark:text-gray-50">Your data</h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Download every reference session and calculation as a CSV file.
            </span>
            <GripButton
              variant="secondary"
              size="sm"
              loading={exportBusy}
              onClick={runExport}
            >
              Export my data
            </GripButton>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold text-gray-900 dark:text-gray-50">
            Tedder Engineering account
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400 break-all">
              Signed in as {user?.email}. Name, password and RaceTrace billing are managed
              in your account settings.
            </span>
            <Link
              to="/settings/account"
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Account settings
            </Link>
          </div>
        </Card>
      </div>
      {upgrade && <UpgradeDialog onClose={() => setUpgrade(false)} />}
    </div>
  );
}
