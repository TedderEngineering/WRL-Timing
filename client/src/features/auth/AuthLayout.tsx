import { Link, useLocation } from "react-router-dom";
import { peekPostAuthRedirect } from "../../lib/postAuthRedirect";
import { IS_GRIP_SITE, gp } from "../../lib/site";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  // One Tedder Engineering account signs in to every tool; show the one the visitor came from.
  const location = useLocation();
  const destination =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname || peekPostAuthRedirect() || "";
  const forGrip = IS_GRIP_SITE || destination.startsWith("/grip");

  return (
    <div className="container-page flex items-center justify-center min-h-[80vh] py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to={forGrip ? gp("") : "/"} className="inline-flex flex-col items-center gap-2">
            <img src="/te-logo-black.png" alt="Tedder Engineering" className="h-10 dark:hidden" />
            <img src="/te-logo-white.png" alt="Tedder Engineering" className="h-10 hidden dark:block" />
            <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{forGrip ? "Finding Grip" : "RaceTrace"}</span>
          </Link>
          <h1 className="mt-6 text-2xl font-semibold text-gray-900 dark:text-gray-50">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
