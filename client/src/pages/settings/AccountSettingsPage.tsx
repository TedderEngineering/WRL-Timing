import { useState } from "react";
import { useAuth } from "../../features/auth/AuthContext";
import { api } from "../../lib/api";

export function AccountSettingsPage() {
  const { user, refreshUser } = useAuth();

  // Display name
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Email verification resend
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "rate-limited" | "error">("idle");
  const handleResend = async () => {
    setResendStatus("sending");
    try {
      await api.post("/auth/resend-verification");
      setResendStatus("sent");
      setTimeout(() => setResendStatus("idle"), 60_000);
    } catch (err: any) {
      if (err?.code === "RATE_LIMITED" || err?.status === 429) {
        setResendStatus("rate-limited");
        setTimeout(() => setResendStatus("idle"), 60_000);
      } else {
        setResendStatus("error");
      }
    }
  };

  // Delete
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const saveName = async () => {
    setNameSaving(true);
    setNameMsg(null);
    try {
      await api.put("/auth/profile", { displayName: displayName.trim() });
      if (refreshUser) await refreshUser();
      setNameMsg({ ok: true, text: "Display name updated." });
    } catch (err: any) {
      setNameMsg({ ok: false, text: err.message || "Failed to update." });
    } finally {
      setNameSaving(false);
    }
  };

  const changePassword = async () => {
    setPwMsg(null);
    if (newPw.length < 8) {
      setPwMsg({ ok: false, text: "Password must be at least 8 characters." });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: "Passwords don't match." });
      return;
    }
    setPwSaving(true);
    try {
      await api.put("/auth/password", { currentPassword: currentPw, newPassword: newPw });
      setPwMsg({ ok: true, text: "Password changed successfully." });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err: any) {
      setPwMsg({ ok: false, text: err.message || "Failed to change password." });
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-lg">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">Account</h2>

      {/* Email (read-only for now) */}
      <Section title="Email Address">
        <input
          type="email"
          value={user?.email || ""}
          disabled
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-sm text-gray-500 cursor-not-allowed"
        />
        {user?.emailVerified ? (
          <p className="text-xs text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Email verified
          </p>
        ) : (
          <div className="mt-1.5">
            <div className="flex items-center gap-2">
              <p className="text-xs text-amber-600 dark:text-amber-400">Your email is not yet verified.</p>
              <button
                onClick={handleResend}
                disabled={resendStatus === "sending" || resendStatus === "sent" || resendStatus === "rate-limited"}
                className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
              >
                {resendStatus === "sending" && "Sending..."}
                {resendStatus === "sent" && "Verification email sent!"}
                {resendStatus === "rate-limited" && "Please wait before requesting another email"}
                {resendStatus === "error" && "Failed to send — try again"}
                {resendStatus === "idle" && "Resend verification email"}
            </button>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-1">
          Contact support to change your email address.
        </p>
      </Section>

      {/* Display Name */}
      <Section title="Display Name">
        <div className="flex gap-2">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
          />
          <button
            onClick={saveName}
            disabled={nameSaving || displayName.trim() === (user?.displayName || "")}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {nameSaving ? "Saving…" : "Save"}
          </button>
        </div>
        {nameMsg && (
          <p className={`text-xs mt-1.5 ${nameMsg.ok ? "text-green-600" : "text-red-500"}`}>
            {nameMsg.text}
          </p>
        )}
      </Section>

      {/* Change Password */}
      <Section title="Change Password">
        <div className="space-y-3">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current password"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (min 8 characters)"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
          />
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Confirm new password"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
          />
          <button
            onClick={changePassword}
            disabled={pwSaving || !currentPw || !newPw}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pwSaving ? "Changing…" : "Change Password"}
          </button>
          {pwMsg && (
            <p className={`text-xs ${pwMsg.ok ? "text-green-600" : "text-red-500"}`}>
              {pwMsg.text}
            </p>
          )}
        </div>
      </Section>

      {/* Danger Zone */}
      <Section title="Danger Zone" danger>
        {!showDelete ? (
          <button
            onClick={() => setShowDelete(true)}
            className="px-4 py-2 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            Delete my account
          </button>
        ) : (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-3">
            <p className="text-sm text-red-700 dark:text-red-400 font-medium">
              This will permanently delete your account, all your data, and cancel any active subscription. This action cannot be undone.
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder='Type "DELETE" to confirm'
              className="w-full px-3 py-2 border border-red-300 dark:border-red-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
            />
            <div className="flex gap-2">
              <button
                disabled={deleteConfirm !== "DELETE"}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Permanently Delete Account
              </button>
              <button
                onClick={() => { setShowDelete(false); setDeleteConfirm(""); }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, danger, children }: { title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className={`border rounded-lg p-5 ${danger ? "border-red-200 dark:border-red-900/50" : "border-gray-200 dark:border-gray-800"}`}>
      <h3 className={`text-sm font-semibold mb-3 ${danger ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-300"}`}>
        {title}
      </h3>
      {children}
    </div>
  );
}
