import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  emailVerified: boolean;
  suspended: boolean;
  suspendedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  plan: string;
  subscriptionStatus: string;
}

interface ListResult {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function AdminUsersPage() {
  const [result, setResult] = useState<ListResult | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "suspend" | "unsuspend" | "promote" | "demote";
    user: AdminUser;
  } | null>(null);
  const [confirmInput, setConfirmInput] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    q.set("page", String(page));
    q.set("pageSize", "20");
    if (search) q.set("search", search);
    if (roleFilter) q.set("role", roleFilter);
    if (planFilter) q.set("plan", planFilter);
    try {
      const data = await api.get<ListResult>(`/admin/users?${q}`);
      setResult(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, planFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSuspendToggle = async (user: AdminUser) => {
    setActionLoading(user.id);
    try {
      await api.put(`/admin/users/${user.id}/suspend`);
      setConfirmAction(null);
      setConfirmInput("");
      await fetchUsers();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  const handleRoleChange = async (user: AdminUser, newRole: string) => {
    setActionLoading(user.id);
    try {
      await api.put(`/admin/users/${user.id}/role`, { role: newRole });
      setConfirmAction(null);
      setConfirmInput("");
      await fetchUsers();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  const executeConfirm = () => {
    if (!confirmAction) return;
    const { type, user } = confirmAction;
    if (type === "promote" || type === "demote") {
      if (confirmInput !== user.email) return;
      handleRoleChange(user, type === "promote" ? "ADMIN" : "USER");
    } else {
      handleSuspendToggle(user);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">User Management</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <form onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(1); }} className="flex flex-1 min-w-[200px]">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by email or name..."
            className="flex-1 px-3 py-2 rounded-l-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button type="submit" className="px-4 py-2 bg-brand-600 text-white text-sm rounded-r-lg hover:bg-brand-700">Search</button>
        </form>
        <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
          <option value="">All Roles</option>
          <option value="USER">User</option>
          <option value="ADMIN">Admin</option>
        </select>
        <select value={planFilter} onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
          <option value="">All Plans</option>
          <option value="FREE">Free</option>
          <option value="PRO">Pro</option>
          <option value="TEAM">Team</option>
        </select>
      </div>

      {/* Table */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">User</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400">Role</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400">Plan</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Status</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Joined</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={6} className="px-4 py-4"><div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" /></td></tr>
                  ))
                : result?.users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{user.displayName || "—"}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                          user.role === "ADMIN"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                          user.plan === "TEAM" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          : user.plan === "PRO" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}>
                          {user.plan}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center hidden md:table-cell">
                        <div className="flex items-center justify-center gap-1.5">
                          {user.suspended && (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Suspended</span>
                          )}
                          {!user.emailVerified && (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Unverified</span>
                          )}
                          {!user.suspended && user.emailVerified && (
                            <span className="text-xs text-green-600 dark:text-green-400">Active</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-gray-500 hidden lg:table-cell">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() =>
                              setConfirmAction({
                                type: user.suspended ? "unsuspend" : "suspend",
                                user,
                              })
                            }
                            className={`px-2 py-1 text-xs rounded ${
                              user.suspended
                                ? "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20"
                                : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
                            }`}
                          >
                            {user.suspended ? "Unsuspend" : "Suspend"}
                          </button>
                          <button
                            onClick={() =>
                              setConfirmAction({
                                type: user.role === "ADMIN" ? "demote" : "promote",
                                user,
                              })
                            }
                            className="px-2 py-1 text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/20 rounded"
                          >
                            {user.role === "ADMIN" ? "Demote" : "Promote"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!loading && result && result.users.length === 0 && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">No users found.</div>
        )}
      </div>

      {/* Pagination */}
      {result && result.totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 border-gray-300 dark:border-gray-700">← Prev</button>
          <span className="text-sm text-gray-500">Page {page} of {result.totalPages} ({result.total} total)</span>
          <button onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))} disabled={page === result.totalPages} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 border-gray-300 dark:border-gray-700">Next →</button>
        </div>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setConfirmAction(null); setConfirmInput(""); }} />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-800">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">
              {confirmAction.type === "suspend" && "Suspend User"}
              {confirmAction.type === "unsuspend" && "Unsuspend User"}
              {confirmAction.type === "promote" && "Promote to Admin"}
              {confirmAction.type === "demote" && "Remove Admin Role"}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {confirmAction.type === "suspend" && `Suspended users cannot log in. Are you sure you want to suspend ${confirmAction.user.email}?`}
              {confirmAction.type === "unsuspend" && `This will restore login access for ${confirmAction.user.email}.`}
              {confirmAction.type === "promote" && `This will give ${confirmAction.user.email} full admin access. Type their email to confirm.`}
              {confirmAction.type === "demote" && `This will remove admin access from ${confirmAction.user.email}. Type their email to confirm.`}
            </p>

            {(confirmAction.type === "promote" || confirmAction.type === "demote") && (
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={confirmAction.user.email}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm mb-4"
              />
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirmAction(null); setConfirmInput(""); }} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900">Cancel</button>
              <button
                onClick={executeConfirm}
                disabled={
                  actionLoading === confirmAction.user.id ||
                  ((confirmAction.type === "promote" || confirmAction.type === "demote") && confirmInput !== confirmAction.user.email)
                }
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                  confirmAction.type === "suspend" || confirmAction.type === "demote"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-brand-600 hover:bg-brand-700"
                }`}
              >
                {actionLoading === confirmAction.user.id ? "Processing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
