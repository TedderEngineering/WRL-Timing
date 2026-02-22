import { NavLink, Outlet } from "react-router-dom";

const LINKS = [
  { to: "/settings/account", label: "Account", icon: "👤" },
  { to: "/settings/preferences", label: "Preferences", icon: "⚙️" },
  { to: "/settings/billing", label: "Billing", icon: "💳" },
];

export function SettingsLayout() {
  return (
    <div className="container-page py-8 lg:py-10">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">Settings</h1>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar — horizontal on mobile, vertical on desktop */}
        <nav className="lg:w-56 shrink-0">
          <div className="flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-400"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900"
                  }`
                }
              >
                <span>{link.icon}</span>
                {link.label}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
