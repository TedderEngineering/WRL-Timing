import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

interface Stats {
  totalUsers: number;
  subscriptions: Record<string, number>;
  races: Record<string, number>;
}

interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  details: any;
  adminEmail: string;
  adminName: string | null;
  createdAt: string;
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<Stats>("/admin/stats"),
      api.get<{ logs: AuditEntry[] }>("/admin/audit-log?pageSize=8"),
    ])
      .then(([s, a]) => {
        setStats(s);
        setRecentLogs(a.logs);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse bg-gray-100 dark:bg-gray-900" />
          ))}
        </div>
      </div>
    );
  }

  const totalRaces = (stats?.races?.PUBLISHED || 0) + (stats?.races?.DRAFT || 0);

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">
        Admin Dashboard
      </h1>

      {/* Stats grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Total Users" value={stats?.totalUsers ?? 0} />
        <StatCard label="Pro Subscribers" value={stats?.subscriptions?.PRO ?? 0} color="text-blue-600 dark:text-blue-400" />
        <StatCard label="Published Races" value={stats?.races?.PUBLISHED ?? 0} color="text-green-600 dark:text-green-400" />
        <StatCard label="Draft Races" value={stats?.races?.DRAFT ?? 0} color="text-yellow-600 dark:text-yellow-400" />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3 mb-10">
        <Link
          to="/admin/races/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          ⬆️ Upload New Race
        </Link>
        <Link
          to="/admin/races"
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
        >
          🏁 Manage Races ({totalRaces})
        </Link>
        <Link
          to="/admin/users"
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
        >
          👥 Manage Users ({stats?.totalUsers ?? 0})
        </Link>
      </div>

      {/* Subscription breakdown */}
      {stats?.subscriptions && Object.keys(stats.subscriptions).length > 0 && (
        <div className="mb-10">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-3">Subscriptions</h2>
          <div className="flex gap-4">
            {["FREE", "PRO", "TEAM"].map((plan) => {
              const count = stats.subscriptions[plan] || 0;
              const total = stats.totalUsers || 1;
              const pct = Math.round((count / total) * 100);
              return (
                <div key={plan} className="flex-1 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{plan}</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-gray-50">{count}</div>
                  <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Recent Activity</h2>
          <Link to="/admin/audit-log" className="text-sm text-brand-600 dark:text-brand-400 hover:underline">
            View all →
          </Link>
        </div>
        {recentLogs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No recent activity.</p>
        ) : (
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800 overflow-hidden">
            {recentLogs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <ActionBadge action={log.action} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {log.adminName || log.adminEmail}
                  </span>{" "}
                  <span className="text-gray-500 dark:text-gray-400">
                    {formatAction(log.action)} {log.targetType}
                  </span>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {timeAgo(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color || "text-gray-900 dark:text-gray-50"}`}>{value}</p>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    CREATE_RACE: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    DELETE_RACE: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    SUSPEND_USER: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    PROMOTE_ADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  };
  const c = colors[action] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold ${c}`}>{action.replace(/_/g, " ")}</span>;
}

function formatAction(a: string): string {
  return a.replace(/_/g, " ").toLowerCase().replace(/^(.)/, (c) => c);
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return "just now";
  if (d < 3600000) return Math.floor(d / 60000) + "m ago";
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
  return Math.floor(d / 86400000) + "d ago";
}
