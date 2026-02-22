import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", icon: "📊", end: true },
  { to: "/admin/races", label: "Races", icon: "🏁", end: false },
  { to: "/admin/races/new", label: "Upload Race", icon: "⬆️", end: true },
  { to: "/admin/users", label: "Users", icon: "👥", end: false },
  { to: "/admin/audit-log", label: "Audit Log", icon: "📋", end: false },
];

export function AdminLayout() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <aside className="hidden lg:block w-56 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/50">
        <div className="sticky top-16 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3 px-2">
            Admin
          </h2>
          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-400 font-medium"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900 hover:text-gray-900 dark:hover:text-gray-200"
                  )
                }
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 px-2 py-1 flex justify-around">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] transition-colors min-w-0",
                isActive
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-gray-500 dark:text-gray-400"
              )
            }
          >
            <span className="text-lg">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0 pb-20 lg:pb-0">
        <Outlet />
      </main>
    </div>
  );
}
