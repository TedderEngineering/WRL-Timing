import { useState } from "react";
import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Button } from "./Button";
import { UserMenu } from "./UserMenu";

/** RaceTrace's links for the shared profile menu. */
function RaceTraceUserMenu() {
  const { user } = useAuth();
  return (
    <UserMenu
      afterLogout="/"
      groups={[
        [{ label: "Dashboard", to: "/dashboard" }],
        [
          { label: "Settings", to: "/settings/account" },
          { label: "Billing", to: "/settings/billing" },
        ],
        user?.role === "ADMIN" ? [{ label: "Admin Panel", to: "/admin" }] : [],
      ]}
    />
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="sm:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        aria-label="Menu"
      >
        {open ? (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute top-16 left-0 right-0 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 shadow-lg z-50">
          <nav className="container-page py-4 flex flex-col gap-2">
            <Link to="/races" onClick={() => setOpen(false)} className="py-2 text-gray-700 dark:text-gray-300">
              Events
            </Link>
            {!isAuthenticated && (
              <Link to="/pricing" onClick={() => setOpen(false)} className="py-2 text-gray-700 dark:text-gray-300">
                Pricing
              </Link>
            )}

            {isAuthenticated ? (
              <>
                <Link to="/dashboard" onClick={() => setOpen(false)} className="py-2 text-gray-700 dark:text-gray-300">
                  Dashboard
                </Link>
                {user?.role === "ADMIN" && (
                  <Link to="/admin" onClick={() => setOpen(false)} className="py-2 text-gray-700 dark:text-gray-300">
                    Admin
                  </Link>
                )}
                <button
                  onClick={async () => {
                    setOpen(false);
                    await logout();
                    navigate("/");
                  }}
                  className="py-2 text-left text-red-600 dark:text-red-400"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setOpen(false)} className="py-2 text-gray-700 dark:text-gray-300">
                  Log in
                </Link>
                <Link to="/signup" onClick={() => setOpen(false)} className="py-2 text-brand-600 dark:text-brand-400 font-medium">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800">
        <nav className="container-page flex items-center justify-between h-16">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <a href="https://tedderengineering.com" target="_blank" rel="noopener noreferrer">
                <img src="/te-logo-black.png" alt="Tedder Engineering" className="h-8 dark:hidden" />
                <img src="/te-logo-white.png" alt="Tedder Engineering" className="h-8 hidden dark:block" />
              </a>
              <Link to={isAuthenticated ? "/dashboard" : "/"} className="text-lg font-bold text-gray-900 dark:text-gray-100 hidden sm:inline">RaceTrace</Link>
            </div>

            {/* Desktop nav links */}
            <div className="hidden sm:flex items-center gap-4">
              <Link
                to="/races"
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                Events
              </Link>
              {!isAuthenticated && (
                <Link
                  to="/pricing"
                  className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                >
                  Pricing
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Desktop auth */}
            <div className="hidden sm:flex items-center gap-3">
              {isLoading ? (
                <div className="h-7 w-7 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
              ) : isAuthenticated ? (
                <RaceTraceUserMenu />
              ) : (
                <>
                  <Link
                    to="/login"
                    className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >
                    Log in
                  </Link>
                  <Link to="/signup">
                    <Button size="sm">Sign up</Button>
                  </Link>
                </>
              )}
            </div>

            {/* Mobile menu */}
            <MobileMenu />
          </div>
        </nav>
      </header>

      {/* Page content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8">
        <div className="container-page flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-400">
          <a href="https://tedderengineering.com" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src="/te-logo-black.png" alt="Tedder Engineering" className="h-6 dark:hidden" />
            <img src="/te-logo-white.png" alt="Tedder Engineering" className="h-6 hidden dark:block" />
            <p>&copy; {new Date().getFullYear()} Tedder Engineering. All rights reserved.</p>
          </a>
          <div className="flex gap-6">
            <Link to="/terms" className="hover:text-gray-700 dark:hover:text-gray-300">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-gray-700 dark:hover:text-gray-300">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
