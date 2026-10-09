import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { rememberPostAuthRedirect } from "@/lib/postAuthRedirect";
import { cn } from "@/lib/utils";
import { GripProvider, useGrip } from "./GripContext";
import { Pill, Spinner, primaryLinkClass } from "./components";
import { useGripStatus } from "./hooks";
import { IS_GRIP_SITE, RACETRACE_URL, gp, stripGripPrefix } from "@/lib/site";

const APP_NAV = [
  { to: gp("/dashboard"), label: "Dashboard", short: "Home" },
  { to: gp("/sessions"), label: "Sessions", short: "Sessions" },
  { to: gp("/calculate"), label: "Calculator", short: "Calculate" },
  { to: gp("/damper"), label: "Damper", short: "Damper" },
  { to: gp("/guide"), label: "Guide", short: "Guide" },
];

function GripMark({ className }: { className?: string }) {
  return (
    <img src="/finding-grip-logo.png" alt="" className={cn("rounded-md", className)} />
  );
}

function Header({ signedInApp }: { signedInApp: boolean }) {
  const { isAuthenticated, user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const status = useGripStatus();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const links = signedInApp
    ? [
        ...APP_NAV,
        ...(user?.role === "ADMIN"
          ? [{ to: gp("/admin"), label: "Admin", short: "Admin" }]
          : []),
      ]
    : [
        { to: gp(""), label: "Overview", short: "Overview" },
        ...(status.free
          ? []
          : [{ to: gp("/pricing"), label: "Pricing", short: "Pricing" }]),
      ];

  const handleLogout = async () => {
    await logout();
    navigate(gp(""));
  };

  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800">
      <nav
        className="container-page flex items-center justify-between h-16 gap-3"
        aria-label="Main"
      >
        <div className="flex items-center gap-3 sm:gap-6 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <a
              href="https://tedderengineering.com"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0"
            >
              <img
                src="/te-logo-black.png"
                alt="Tedder Engineering"
                className="h-8 dark:hidden"
              />
              <img
                src="/te-logo-white.png"
                alt="Tedder Engineering"
                className="h-8 hidden dark:block"
              />
            </a>
            <Link
              to={isAuthenticated ? gp("/dashboard") : gp("")}
              className="flex items-center gap-2 border-l border-gray-300 dark:border-gray-700 pl-3 text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 min-w-0"
            >
              <GripMark className="h-6 w-6 shrink-0" />
              <span className="truncate">Finding Grip</span>
            </Link>
          </div>

          <div className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === gp("")}
                className={({ isActive }) =>
                  cn(
                    "px-2.5 py-1.5 text-sm transition-colors border-b-2",
                    isActive
                      ? "border-grip-500 text-gray-900 dark:text-gray-100 font-semibold"
                      : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-3">
            {isAuthenticated ? (
              <>
                {signedInApp && <PlanPill />}
                <Link
                  to={gp("/settings")}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <span className="h-7 w-7 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 flex items-center justify-center text-xs font-bold">
                    {user?.displayName?.[0]?.toUpperCase() ||
                      user?.email?.[0]?.toUpperCase() ||
                      "?"}
                  </span>
                  <span className="max-w-[10rem] truncate">
                    {user?.displayName || user?.email?.split("@")[0]}
                  </span>
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  state={{ from: { pathname: gp("/dashboard") } }}
                  className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  Log in
                </Link>
                <Link
                  to="/signup"
                  onClick={() => rememberPostAuthRedirect(gp("/dashboard"))}
                  className={cn(primaryLinkClass, "px-3 py-1.5 text-sm")}
                >
                  Sign up
                </Link>
              </>
            )}
          </div>

          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="md:hidden p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={menuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"}
              />
            </svg>
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="md:hidden absolute top-16 inset-x-0 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 shadow-lg z-50">
          <div className="container-page py-3 flex flex-col">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="py-2.5 text-gray-700 dark:text-gray-300"
              >
                {l.label}
              </Link>
            ))}
            {isAuthenticated ? (
              <>
                {signedInApp && (
                  <Link
                    to={gp("/settings")}
                    className="py-2.5 text-gray-700 dark:text-gray-300"
                  >
                    Settings
                  </Link>
                )}
                {!IS_GRIP_SITE && (
                  <Link
                    to="/dashboard"
                    className="py-2.5 text-gray-700 dark:text-gray-300"
                  >
                    RaceTrace
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="py-2.5 text-left text-red-600 dark:text-red-400"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  state={{ from: { pathname: gp("/dashboard") } }}
                  className="py-2.5 text-gray-700 dark:text-gray-300"
                >
                  Log in
                </Link>
                <Link
                  to="/signup"
                  onClick={() => rememberPostAuthRedirect(gp("/dashboard"))}
                  className="py-2.5 font-medium text-grip-600 dark:text-grip-400"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function PlanPill() {
  const { account } = useGrip();
  const { user } = useAuth();
  if (user?.role === "ADMIN") return <Pill tone="pro">Admin</Pill>;
  if (account.freeForAll) return null;
  return (
    <Pill tone={account.isPro ? "pro" : "neutral"}>{account.isPro ? "Pro" : "Free"}</Pill>
  );
}

function Footer({ padForTabBar }: { padForTabBar: boolean }) {
  return (
    <footer
      className={cn(
        "border-t border-gray-200 dark:border-gray-800 py-8 text-sm text-gray-500 dark:text-gray-400",
        padForTabBar && "pb-24 md:pb-8"
      )}
    >
      <div className="container-page flex flex-col sm:flex-row sm:items-start justify-between gap-6">
        <div className="space-y-2">
          <a
            href="https://tedderengineering.com"
            className="inline-block hover:opacity-80 transition-opacity"
          >
            <img
              src="/te-logo-black.png"
              alt="Tedder Engineering"
              className="h-6 dark:hidden"
            />
            <img
              src="/te-logo-white.png"
              alt="Tedder Engineering"
              className="h-6 hidden dark:block"
            />
          </a>
          <p>
            &copy; {new Date().getFullYear()} Tedder Engineering. All rights reserved.
          </p>
        </div>
        <div className="flex gap-12">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
              Tools
            </span>
            {IS_GRIP_SITE ? (
              <a
                href={RACETRACE_URL}
                className="hover:text-gray-700 dark:hover:text-gray-300"
              >
                RaceTrace
              </a>
            ) : (
              <Link to="/" className="hover:text-gray-700 dark:hover:text-gray-300">
                RaceTrace
              </Link>
            )}
            <a
              href="https://converter.tedderengineering.com"
              className="hover:text-gray-700 dark:hover:text-gray-300"
            >
              VBOX to MoTeC Converter
            </a>
            <Link to={gp("")} className="hover:text-gray-700 dark:hover:text-gray-300">
              Finding Grip
            </Link>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
              Company
            </span>
            <a
              href="https://tedderengineering.com#contact"
              className="hover:text-gray-700 dark:hover:text-gray-300"
            >
              Contact
            </a>
            <Link to="/terms" className="hover:text-gray-700 dark:hover:text-gray-300">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-gray-700 dark:hover:text-gray-300">
              Privacy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function TabBar() {
  const tabs = APP_NAV.filter((t) => t.to !== gp("/guide"));
  return (
    <nav
      aria-label="App"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-4">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                "py-3 text-center text-xs font-semibold border-t-2 -mt-px",
                isActive
                  ? "border-grip-500 text-grip-600 dark:text-grip-400"
                  : "border-transparent text-gray-500"
              )
            }
          >
            {t.short}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function PrivateTesting() {
  return (
    <div className="container-page py-24 text-center max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
        Finding Grip is in private testing
      </h1>
      <p className="mt-3 text-gray-600 dark:text-gray-400">
        Your account isn't part of the test group yet. Tire pressure and damper tools from
        Tedder Engineering are on the way.
      </p>
      {!IS_GRIP_SITE && (
        <Link
          to="/dashboard"
          className="mt-6 inline-block text-grip-600 dark:text-grip-400 font-medium hover:underline"
        >
          Back to RaceTrace
        </Link>
      )}
    </div>
  );
}

/**
 * Once Finding Grip has its own address, its pages on the RaceTrace site
 * forward there (before any login prompt, so people sign in on the right site).
 */
function GripSiteGate({ children }: { children: React.ReactNode }) {
  const status = useGripStatus();
  const location = useLocation();

  let target: string | null = null;
  if (!IS_GRIP_SITE && status.siteUrl) {
    try {
      const site = new URL(status.siteUrl);
      if (site.origin !== window.location.origin) {
        target =
          site.origin +
          stripGripPrefix(location.pathname) +
          location.search +
          location.hash;
      }
    } catch {
      // Misconfigured address: stay here.
    }
  }

  useEffect(() => {
    if (target) window.location.replace(target);
  }, [target]);

  if (IS_GRIP_SITE) return <>{children}</>;
  if (status.loading || target) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return <>{children}</>;
}

/** Shell for the signed-in app pages: requires login, then loads the Finding Grip account. */
export function GripAppLayout() {
  return (
    <GripSiteGate>
      <div className="min-h-screen flex flex-col">
        <ProtectedRoute>
          <GripProvider
            blocked={
              <>
                <Header signedInApp={false} />
                <main className="flex-1">
                  <PrivateTesting />
                </main>
                <Footer padForTabBar={false} />
              </>
            }
          >
            <Header signedInApp />
            <main className="flex-1 py-6 sm:py-8 pb-24 md:pb-10">
              <Outlet />
            </main>
            <Footer padForTabBar />
            <TabBar />
          </GripProvider>
        </ProtectedRoute>
      </div>
    </GripSiteGate>
  );
}

/** Shell for the public pages (overview, pricing). */
export function GripPublicLayout() {
  return (
    <GripSiteGate>
      <div className="min-h-screen flex flex-col">
        <Header signedInApp={false} />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer padForTabBar={false} />
      </div>
    </GripSiteGate>
  );
}
