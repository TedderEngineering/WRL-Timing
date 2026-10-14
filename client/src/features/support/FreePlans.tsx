import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useSupport } from "./SupportContext";

/** F9-F: what the plans section says while RaceTrace is free. */
export function FreePlans({ compact = false }: { compact?: boolean }) {
  const { support, openSupport } = useSupport();
  const { isAuthenticated } = useAuth();
  return (
    <div className={`mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-6 text-left dark:border-gray-800 dark:bg-gray-900 ${compact ? "" : "sm:p-8"}`}>
      <h2 className="m-0 text-2xl font-bold text-gray-900 dark:text-gray-50">Everything is free</h2>
      <ul className="mb-0 mt-4 list-disc space-y-1.5 pl-5 text-gray-700 dark:text-gray-300">
        <li>Every race, every series, back to 2025</li>
        <li>Race recaps, pit stops and cycles, car stories</li>
        <li>No plan limits, no ads</li>
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link to={isAuthenticated ? "/dashboard" : "/signup"} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">
          {isAuthenticated ? "Go to your dashboard" : "Create a free account"}
        </Link>
        {support.enabled && (
          <button type="button" onClick={() => openSupport("plans")} className="text-sm font-semibold text-brand-600 dark:text-brand-400">
            ☕ Want to help? Buy me a coffee
          </button>
        )}
      </div>
    </div>
  );
}
