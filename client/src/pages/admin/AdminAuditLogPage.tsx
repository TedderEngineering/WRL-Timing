import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

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

interface ListResult {
  logs: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function AdminAuditLogPage() {
  const [result, setResult] = useState<ListResult | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ListResult>(`/admin/audit-log?page=${page}&pageSize=25`);
      setResult(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">Audit Log</h1>

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 w-40">Time</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Admin</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Action</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Target</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400 w-16">Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-4 py-4">
                        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                      </td>
                    </tr>
                  ))
                : result?.logs.map((log) => (
                    <LogRow
                      key={log.id}
                      log={log}
                      isExpanded={expanded.has(log.id)}
                      onToggle={() => toggleExpand(log.id)}
                    />
                  ))}
            </tbody>
          </table>
        </div>

        {!loading && result && result.logs.length === 0 && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No audit log entries yet.
          </div>
        )}
      </div>

      {/* Pagination */}
      {result && result.totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {result.totalPages} ({result.total} total)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))}
            disabled={page === result.totalPages}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Log row with expandable details ─────────────────────────────────────────

function LogRow({
  log,
  isExpanded,
  onToggle,
}: {
  log: AuditEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const timeStr = new Date(log.createdAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const hasDetails = log.details && Object.keys(log.details).length > 0;

  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap">
          {timeStr}
        </td>
        <td className="px-4 py-3">
          <span className="text-gray-900 dark:text-gray-100">
            {log.adminName || log.adminEmail}
          </span>
        </td>
        <td className="px-4 py-3">
          <ActionBadge action={log.action} />
        </td>
        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">
          <span className="text-xs font-mono">{log.targetType}/{log.targetId?.slice(0, 8)}</span>
        </td>
        <td className="px-3 py-3 text-center">
          {hasDetails && (
            <button
              onClick={onToggle}
              className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              {isExpanded ? "Hide" : "Show"}
            </button>
          )}
        </td>
      </tr>
      {isExpanded && hasDetails && (
        <tr>
          <td colSpan={5} className="px-6 py-3 bg-gray-50 dark:bg-gray-900/30">
            <pre className="text-xs text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    CREATE_RACE: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    UPDATE_RACE: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    DELETE_RACE: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    PUBLISH_RACE: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    UNPUBLISH_RACE: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    REPROCESS_RACE: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    SUSPEND_USER: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    UNSUSPEND_USER: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    PROMOTE_ADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    DEMOTE_USER: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  };
  const c = colors[action] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold ${c}`}>
      {action.replace(/_/g, " ")}
    </span>
  );
}
