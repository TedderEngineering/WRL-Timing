import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { cn } from "../lib/utils";

export interface UserMenuItem {
  label: string;
  to: string;
}

/**
 * The profile menu in the header: avatar and name, opening a dropdown with
 * the account's name and email, groups of links, and Log out. Shared by every
 * Tedder Engineering site so the account controls look and work the same;
 * each site passes its own links.
 */
export function UserMenu({
  groups,
  afterLogout,
}: {
  /** Link groups, separated by dividers. Empty groups are skipped. */
  groups: UserMenuItem[][];
  /** Where to go after logging out. */
  afterLogout: string;
}) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const root = useRef<HTMLDivElement>(null);

  // Close on a click anywhere else, or Escape. Listening on the document
  // (instead of a full-screen backdrop) works inside a blurred sticky header,
  // where a fixed backdrop would only cover the header itself.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleLogout = async () => {
    await logout();
    navigate(afterLogout);
  };

  return (
    <div className="relative" ref={root}>
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="h-7 w-7 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-medium">
          {user?.displayName?.[0]?.toUpperCase() ||
            user?.email?.[0]?.toUpperCase() ||
            "?"}
        </div>
        <span className="hidden sm:inline max-w-[10rem] truncate text-gray-700 dark:text-gray-300">
          {user?.displayName || user?.email?.split("@")[0]}
        </span>
        <svg
          className={cn(
            "h-4 w-4 text-gray-400 transition-transform",
            open && "rotate-180"
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <>
          <div
            role="menu"
            className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 py-1"
          >
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {user?.displayName || "User"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {user?.email}
              </p>
            </div>

            {groups
              .filter((group) => group.length > 0)
              .map((group, index) => (
                <div key={group[0].to + group[0].label}>
                  {index > 0 && (
                    <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                  )}
                  {group.map((item) => (
                    <Link
                      key={item.label}
                      to={item.to}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))}

            <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
            <button
              role="menuitem"
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
