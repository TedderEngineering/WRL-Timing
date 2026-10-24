/**
 * Me (mobile redesign, PR 2): the phone bar's account place. It holds what the top bar's
 * hamburger and user menus hold on larger screens: your cars and drivers, settings, billing,
 * admin, support, sharing, and signing in or out. Styled as the Settings pages are.
 */
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { useSupport } from "../features/support/SupportContext";
import { ShareRaceTraceButton } from "../features/share/ShareRaceTrace";
import { isFreeMode, useSiteConfig } from "../lib/site-config";

const rowBase = "flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left text-[15px] hover:bg-gray-50 dark:hover:bg-gray-900";
const row = `${rowBase} text-gray-900 dark:text-gray-100`;

function Chevron() {
  return (
    <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
    </svg>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      {title && <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</h2>}
      <ul className="m-0 list-none divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 p-0 dark:divide-gray-800 dark:border-gray-800">
        {children}
      </ul>
    </section>
  );
}

function Item({ to, label, detail }: { to: string; label: string; detail?: string }) {
  return (
    <li>
      <Link to={to} className={row}>
        <span className="min-w-0">
          {label}
          {detail && <span className="block truncate text-[13px] text-gray-500 dark:text-gray-400">{detail}</span>}
        </span>
        <Chevron />
      </Link>
    </li>
  );
}

export function MePage() {
  const { user, isAuthenticated, logout } = useAuth();
  const { support, openSupport } = useSupport();
  const navigate = useNavigate();
  useSiteConfig();

  return (
    <div className="container-page max-w-xl py-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">Me</h1>
      {isAuthenticated && user ? (
        <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
          {user.displayName ? `${user.displayName} · ` : ""}
          {user.email}
        </p>
      ) : (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to follow your car and get race-ready emails.</p>
      )}

      {isAuthenticated ? (
        <>
          <Group title="Following">
            <Item to="/settings/cars" label="My cars" />
            <Item to="/settings/drivers" label="My drivers" />
          </Group>
          <Group title="Settings">
            <Item to="/settings/account" label="Account" />
            <Item to="/settings/preferences" label="Preferences" detail="Theme, chart defaults, race alerts" />
            <Item to="/settings/billing" label="Billing" />
            {user?.role === "ADMIN" && <Item to="/admin" label="Admin" />}
          </Group>
        </>
      ) : (
        <Group>
          <Item to="/login" label="Log in" />
          <Item to="/signup" label="Create a free account" />
          {!isFreeMode() && <Item to="/pricing" label="Pricing" />}
        </Group>
      )}

      <Group title="RaceTrace">
        {support.enabled && (
          <li>
            <button type="button" className={row} onClick={() => openSupport("me")}>
              <span>☕ Buy me a coffee</span>
              <Chevron />
            </button>
          </li>
        )}
        <li>
          <ShareRaceTraceButton source="menu" className={row} />
        </li>
        <Item to="/privacy" label="Privacy" />
        <Item to="/terms" label="Terms" />
      </Group>

      {isAuthenticated && (
        <Group>
          <li>
            <button
              type="button"
              className={`${rowBase} text-red-600 dark:text-red-400`}
              onClick={async () => {
                await logout();
                navigate("/");
              }}
            >
              Log out
            </button>
          </li>
        </Group>
      )}
    </div>
  );
}
