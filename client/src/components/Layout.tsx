import { useState } from "react";
import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Button } from "./Button";
import { cn } from "../lib/utils";

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="h-7 w-7 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-medium">
          {user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "?"}
        </div>
        <span className="hidden sm:inline text-gray-700 dark:text-gray-300">
          {user?.displayName || user?.email?.split("@")[0]}
        </span>
        <svg
          className={cn("h-4 w-4 text-gray-400 transition-transform", open && "rotate-180")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop to close menu */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />

          <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 py-1">
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {user?.displayName || "User"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {user?.email}
              </p>
            </div>

            <Link
              to="/dashboard"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Dashboard
            </Link>

            <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
            <Link
              to="/settings/account"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Settings
            </Link>
            <Link
              to="/settings/billing"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Billing
            </Link>

            {user?.role === "ADMIN" && (
              <>
                <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                <Link
                  to="/admin"
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Admin Panel
                </Link>
              </>
            )}

            <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
            <button
              onClick={() => {
                setOpen(false);
                handleLogout();
              }}
              className="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
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
              Races
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
            <Link
              to={isAuthenticated ? "/dashboard" : "/"}
              className="flex items-center gap-2"
            >
              <img src="/te-logo-white.png" alt="Tedder Engineering" className="h-8 dark:invert-0" />
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100 hidden sm:inline">RaceTrace</span>
            </Link>

            {/* Desktop nav links */}
            <div className="hidden sm:flex items-center gap-4">
              <Link
                to="/races"
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                Races
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
                <UserMenu />
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
          <div className="flex items-center gap-3">
            <img src="/te-logo-white.png" alt="Tedder Engineering" className="h-6" />
            <p>&copy; {new Date().getFullYear()} Tedder Engineering. All rights reserved.</p>
          </div>
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
