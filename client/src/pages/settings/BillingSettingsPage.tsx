import { Link } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";

export function BillingSettingsPage() {
  const { user } = useAuth();
  const plan = user?.subscription?.plan || "FREE";
  const status = user?.subscription?.status || "active";

  return (
    <div className="space-y-8 max-w-lg">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">Billing</h2>

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
                  status === "active"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : status === "past_due"
                    ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                }`}
              >
                {status === "active" ? "Active" : status === "past_due" ? "Past Due" : "Canceled"}
              </span>
            </div>
            {plan === "FREE" && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Limited access. Upgrade to unlock all races and features.
              </p>
            )}
            {plan !== "FREE" && (
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
                <span className="text-brand-500">✦</span>
                {feature}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billing Management (when Stripe is connected) */}
      {plan !== "FREE" && (
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Manage Subscription
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Update payment method, view invoices, or change your plan.
          </p>
          <button
            disabled
            className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-400 cursor-not-allowed"
          >
            Open Billing Portal (coming soon)
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
            Invoice history will be available once Stripe billing is connected.
          </p>
        )}
      </div>
    </div>
  );
}
