import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

interface AdminRace {
  id: string;
  name: string;
  date: string;
  track: string;
  series: string;
  season: number;
  status: string;
  premium: boolean;
  maxLap: number | null;
  totalCars: number | null;
  entryCount: number;
  lapCount: number;
  favoriteCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface ListResult {
  races: AdminRace[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function AdminRacesPage() {
  const [result, setResult] = useState<ListResult | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AdminRace | null>(null);
  const [editRace, setEditRace] = useState<AdminRace | null>(null);

  const fetchRaces = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    q.set("page", String(page));
    q.set("pageSize", "15");
    if (statusFilter) q.set("status", statusFilter);
    if (search) q.set("search", search);
    try {
      const data = await api.get<ListResult>(`/admin/races?${q}`);
      setResult(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    fetchRaces();
  }, [fetchRaces]);

  const toggleStatus = async (race: AdminRace) => {
    const newStatus = race.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    setActionLoading(race.id);
    try {
      await api.put(`/admin/races/${race.id}/status`, { status: newStatus });
      await fetchRaces();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setActionLoading(deleteConfirm.id);
    try {
      await api.delete(`/admin/races/${deleteConfirm.id}`);
      setDeleteConfirm(null);
      await fetchRaces();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  const handleEditSave = async () => {
    if (!editRace) return;
    setActionLoading(editRace.id);
    try {
      await api.put(`/admin/races/${editRace.id}`, {
        name: editRace.name,
        track: editRace.track,
        series: editRace.series,
        season: editRace.season,
        premium: editRace.premium,
      });
      setEditRace(null);
      await fetchRaces();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">Race Management</h1>
        <Link
          to="/admin/races/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          + Upload Race
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <form
          onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(1); }}
          className="flex flex-1 min-w-[200px]"
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search races..."
            className="flex-1 px-3 py-2 rounded-l-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button type="submit" className="px-4 py-2 bg-brand-600 text-white text-sm rounded-r-lg hover:bg-brand-700">
            Search
          </button>
        </form>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
        >
          <option value="">All Status</option>
          <option value="PUBLISHED">Published</option>
          <option value="DRAFT">Draft</option>
        </select>
      </div>

      {/* Table */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Race</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Track</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Cars</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Laps</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-4">
                        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                      </td>
                    </tr>
                  ))
                : result?.races.map((race) => (
                    <tr key={race.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{race.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {race.series} · {race.season} · {new Date(race.date).toLocaleDateString()}
                          {race.premium && <span className="ml-1 text-yellow-600">★ PRO</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 hidden md:table-cell">{race.track}</td>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => toggleStatus(race)}
                          disabled={actionLoading === race.id}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors ${
                            race.status === "PUBLISHED"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
                          }`}
                        >
                          {race.status === "PUBLISHED" ? "✓ Published" : "Draft"}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-400 hidden lg:table-cell">{race.entryCount}</td>
                      <td className="px-3 py-3 text-center text-gray-600 dark:text-gray-400 hidden lg:table-cell">{race.lapCount.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            to={`/races/${race.id}`}
                            className="px-2 py-1 text-xs text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/20 rounded"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => setEditRace({ ...race })}
                            className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(race)}
                            className="px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {/* Empty */}
        {!loading && result && result.races.length === 0 && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No races found.{" "}
            <Link to="/admin/races/new" className="text-brand-600 dark:text-brand-400 hover:underline">Upload one</Link>
          </div>
        )}
      </div>

      {/* Pagination */}
      {result && result.totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900">
            ← Prev
          </button>
          <span className="text-sm text-gray-500">Page {page} of {result.totalPages} ({result.total} total)</span>
          <button onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))} disabled={page === result.totalPages} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900">
            Next →
          </button>
        </div>
      )}

      {/* Delete modal */}
      {deleteConfirm && (
        <Modal onClose={() => setDeleteConfirm(null)}>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Delete Race?</h3>
          <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="font-semibold text-gray-900 dark:text-gray-100">{deleteConfirm.name}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{deleteConfirm.track}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {new Date(deleteConfirm.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            This will permanently delete the race and all associated lap data.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteConfirm(null)}
              autoFocus
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={actionLoading === deleteConfirm.id}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60"
            >
              {actionLoading === deleteConfirm.id ? "Deleting…" : "Delete Race"}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {editRace && (
        <Modal onClose={() => setEditRace(null)}>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-4">Edit Race</h3>
          <div className="space-y-3">
            <Field label="Name" value={editRace.name} onChange={(v) => setEditRace({ ...editRace, name: v })} />
            <Field label="Track" value={editRace.track} onChange={(v) => setEditRace({ ...editRace, track: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Series" value={editRace.series} onChange={(v) => setEditRace({ ...editRace, series: v })} />
              <Field label="Season" value={String(editRace.season)} onChange={(v) => setEditRace({ ...editRace, season: Number(v) || editRace.season })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={editRace.premium}
                onChange={(e) => setEditRace({ ...editRace, premium: e.target.checked })}
                className="rounded border-gray-300"
              />
              Premium (Pro subscribers only)
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setEditRace(null)} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900">
              Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={actionLoading === editRace.id}
              className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60"
            >
              {actionLoading === editRace.id ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Shared components ───────────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-800">
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
      />
    </div>
  );
}
