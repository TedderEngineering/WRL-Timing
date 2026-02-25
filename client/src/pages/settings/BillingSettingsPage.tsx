import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import { api } from "../../lib/api";

export function BillingSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showSuccess, setShowSuccess] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const plan = user?.subscription?.plan || "FREE";
  const status = user?.subscription?.status || "active";
  const periodEnd = user?.subscription?.currentPeriodEnd;
  const cancelAtPeriodEnd = user?.subscription?.cancelAtPeriodEnd;

  // Handle checkout success redirect
  useEffect(() => {
    if (searchParams.has("session_id")) {
      refreshUser();
      setShowSuccess(true);
      setSearchParams({}, { replace: true });
      const timer = setTimeout(() => setShowSuccess(false), 8000);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const { url } = await api.post<{ url: string }>("/billing/create-portal-session");
      window.location.href = url;
    } catch (err: any) {
      alert(err.message || "Failed to open billing portal");
      setPortalLoading(false);
    }
  }

  const periodEndStr = periodEnd
    ? new Date(periodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="space-y-8 max-w-lg">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">Billing</h2>

      {/* Success banner */}
      {showSuccess && (
        <div className="rounded-lg border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-800 dark:text-green-300">
          Subscription activated! Your account has been upgraded.
        </div>
      )}

      {/* Current Plan */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          Current Plan
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-gray-50 capitalize">
                {plan.toLowerCase()}
              </span>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  status === "active" || status === "ACTIVE"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : status === "past_due" || status === "PAST_DUE"
                    ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                }`}
              >
                {status === "active" || status === "ACTIVE" ? "Active" : status === "past_due" || status === "PAST_DUE" ? "Past Due" : "Canceled"}
              </span>
            </div>
            {plan === "FREE" && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Limited access. Upgrade to unlock all races and features.
              </p>
            )}
            {plan !== "FREE" && periodEndStr && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {cancelAtPeriodEnd
                  ? `Your plan will cancel on ${periodEndStr}. You have access until then.`
                  : `Renews on ${periodEndStr}.`}
              </p>
            )}
            {plan !== "FREE" && !periodEndStr && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Full access to all races and analysis tools.
              </p>
            )}
          </div>
        </div>

        {plan === "FREE" && (
          <Link
            to="/pricing"
            className="inline-block mt-4 px-5 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Upgrade Plan
          </Link>
        )}
      </div>

      {/* Plan Comparison */}
      {plan === "FREE" && (
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            What you're missing
          </h3>
          <div className="space-y-2">
            {[
              "Access to all race datasets (current & historical)",
              "Full chart interactivity — zoom, filter, export",
              "Unlimited favorites",
              "Data export (CSV, PNG)",
              "Priority support",
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <span className="text-brand-500">+</span>
                {feature}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billing Management */}
      {plan !== "FREE" && (
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Manage Subscription
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Update payment method, view invoices, or change your plan.
          </p>
          <button
            onClick={handlePortal}
            disabled={portalLoading}
            className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {portalLoading ? "Opening..." : "Open Billing Portal"}
          </button>
        </div>
      )}

      {/* Invoice History placeholder */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Invoice History
        </h3>
        {plan === "FREE" ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No invoices — you're on the free plan.
          </p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            View and download invoices from the billing portal above.
          </p>
        )}
      </div>
    </div>
  );
}
