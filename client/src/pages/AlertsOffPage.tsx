import { Link, useSearchParams } from "react-router-dom";

/** Where the race-email unsubscribe link lands (no login needed). */
export function AlertsOffPage() {
  const [params] = useSearchParams();
  const invalid = params.get("invalid") === "1";
  return (
    <div className="container-page max-w-lg py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">{invalid ? "That link did not work" : "Race emails are off"}</h1>
      <p className="mt-3 text-gray-600 dark:text-gray-400">
        {invalid
          ? "The link may be incomplete. You can turn race emails off in Settings → Preferences."
          : "You won't get race emails any more. You can turn them back on any time in Settings → Preferences."}
      </p>
      <div className="mt-6 flex justify-center gap-4 text-sm">
        <Link to="/settings/preferences" className="font-semibold text-brand-600 dark:text-brand-400">Preferences</Link>
        <Link to="/races" className="text-gray-600 dark:text-gray-400">Events</Link>
      </div>
    </div>
  );
}
