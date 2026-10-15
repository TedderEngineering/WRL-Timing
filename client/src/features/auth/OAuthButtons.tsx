import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { rememberPostAuthRedirect } from "../../lib/postAuthRedirect";

interface Provider {
  id: string;
  label: string;
}

/** Why a sign-in with another account came back to the login page (server routes/oauth.ts). */
const MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long or was started in another tab. Try again.",
  no_email: "That account didn't share an email address. Choose another way to sign in.",
  email_taken: "An account with this email already exists. Log in with your email and password.",
  suspended: "This account has been suspended.",
  unavailable: "That sign-in option isn't available right now.",
  failed: "Sign-in didn't work. Try again, or use your email and password.",
};

export function oauthMessage(search: string): string | null {
  try {
    const code = new URLSearchParams(search).get("oauth");
    return code ? (MESSAGES[code] ?? MESSAGES.failed) : null;
  } catch {
    return null;
  }
}

/**
 * "Continue with Google / Apple / Microsoft / Facebook / GitHub", for the providers the server
 * has settings for. Each opens the provider through this site's own /api, so the session cookie
 * lands where the site reads it; the page to return to is kept in this tab (postAuthRedirect).
 */
export function OAuthButtons({ next, verb = "Continue" }: { next: string; verb?: string }) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<{ providers: Provider[] }>("/auth/oauth/providers")
      .then((r) => alive && setProviders(r.providers ?? []))
      .catch(() => alive && setProviders([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!providers || providers.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="flex flex-col gap-2.5">
        {providers.map((p) => (
          <a
            key={p.id}
            href={`/api/auth/oauth/${p.id}/start?next=${encodeURIComponent(next)}`}
            onClick={() => rememberPostAuthRedirect(next)}
            className="flex min-h-[44px] w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            {verb} with {p.label}
          </a>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
        or with email
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
      </div>
    </div>
  );
}
