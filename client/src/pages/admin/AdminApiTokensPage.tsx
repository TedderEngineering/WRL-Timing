import { useState, useEffect, useCallback } from "react";
import { api, ApiClientError } from "../../lib/api";

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

const EXPIRY_OPTIONS = [
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "", label: "No expiry" },
];

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString() : "—";
}

function stateOf(t: ApiToken): { label: string; cls: string } {
  if (t.revokedAt) return { label: "Revoked", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" };
  if (t.expiresAt && new Date(t.expiresAt) <= new Date()) return { label: "Expired", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" };
  return { label: "Active", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" };
}

/**
 * API tokens for the Claude-run race intake (RACETRACE_API_TOKEN on the
 * owner's laptop). A token is shown once, when created; only its hash is
 * stored. Revoking takes effect on the next request.
 */
export function AdminApiTokensPage() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("365");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState(false);

  const fetchTokens = useCallback(async () => {
    try {
      const data = await api.get<{ tokens: ApiToken[] }>("/admin/api-tokens");
      setTokens(data.tokens);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load API tokens");
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<{ token: string; apiToken: ApiToken }>("/admin/api-tokens", {
        name: name.trim(),
        scopes: ["intake"],
        expiresInDays: expiry ? Number(expiry) : null,
      });
      setCreated({ token: res.token, name: res.apiToken.name });
      setCopied(false);
      setName("");
      await fetchTokens();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not create the token");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (t: ApiToken) => {
    setRevoking(true);
    try {
      await api.delete(`/admin/api-tokens/${t.id}`);
      setConfirmRevoke(null);
      await fetchTokens();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not revoke the token");
    } finally {
      setRevoking(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-2">API Tokens</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Tokens let the Claude Code race intake on your laptop add races as drafts. Put the token in{" "}
        <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">server/.env.intake</code> as{" "}
        <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">RACETRACE_API_TOKEN</code>. A token acts as you, only while you are an admin.
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900">
          {error}
        </div>
      )}

      {created && (
        <div className="mb-6 p-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20">
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-300 mb-1">Token "{created.name}" created</div>
          <p className="text-xs text-amber-800 dark:text-amber-400 mb-3">Copy it now. It is not stored and cannot be shown again.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <code className="flex-1 min-w-0 break-all px-3 py-2 rounded bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900 text-xs font-mono">
              {created.token}
            </code>
            <button onClick={copy} className="px-3 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={() => setCreated(null)} className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900">
              Done
            </button>
          </div>
        </div>
      )}

      <form onSubmit={create} className="flex flex-wrap gap-3 mb-6 items-end">
        <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Brent's laptop intake"
            maxLength={100}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Expires</span>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={creating || !name.trim()} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40">
          {creating ? "Creating…" : "Create token"}
        </button>
      </form>

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Token</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400">Scopes</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Last used</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Expires</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {tokens === null
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-4">
                        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                      </td>
                    </tr>
                  ))
                : tokens.map((t) => {
                    const st = stateOf(t);
                    return (
                      <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{t.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                            {t.prefix}… · created {fmt(t.createdAt)}
                            {t.createdBy ? ` by ${t.createdBy}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center text-xs">{t.scopes.join(", ")}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-500 hidden md:table-cell">{fmt(t.lastUsedAt)}</td>
                        <td className="px-3 py-3 text-xs text-gray-500 hidden lg:table-cell">{t.expiresAt ? fmt(t.expiresAt) : "Never"}</td>
                        <td className="px-4 py-3 text-right">
                          {!t.revokedAt && (
                            <button onClick={() => setConfirmRevoke(t)} className="px-2 py-1 text-xs rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20">
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
        {tokens && tokens.length === 0 && <div className="text-center py-12 text-gray-500 dark:text-gray-400">No API tokens yet.</div>}
      </div>

      {confirmRevoke && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmRevoke(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-800">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Revoke API token</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              "{confirmRevoke.name}" ({confirmRevoke.prefix}…) stops working immediately. The intake on any machine using it will need a new token.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRevoke(null)} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900">
                Cancel
              </button>
              <button onClick={() => revoke(confirmRevoke)} disabled={revoking} className="px-4 py-2 text-sm text-white rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40">
                {revoking ? "Revoking…" : "Revoke"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
