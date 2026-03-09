import { useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";

interface UpgradePromptProps {
  open: boolean;
  onClose: () => void;
}

export function UpgradePrompt({ open, onClose }: UpgradePromptProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          aria-label="Close"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Lock icon */}
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-brand-500/10 flex items-center justify-center">
            <svg className="h-6 w-6 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>

        <h3 className="text-lg font-bold text-gray-100 text-center mb-1">
          Unlock Full Access
        </h3>
        <p className="text-sm text-gray-400 text-center mb-6">
          Free accounts include the 3 most recent races. Upgrade to access
          the entire library of race analytics.
        </p>

        {/* Tier cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {/* Pro */}
          <div className="rounded-xl border border-gray-700 p-4">
            <div className="text-sm font-semibold text-gray-200 mb-1">Pro</div>
            <div className="text-2xl font-bold text-white">
              $200<span className="text-sm font-normal text-gray-500">/yr</span>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-gray-400">
              <li className="flex items-start gap-1.5">
                <span className="text-green-400 mt-px">&#10003;</span>
                All races, instant access
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-green-400 mt-px">&#10003;</span>
                Historical seasons
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-green-400 mt-px">&#10003;</span>
                Full chart interactivity
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-green-400 mt-px">&#10003;</span>
                Unlimited favorites
              </li>
            </ul>
          </div>

          {/* Team */}
          <div className="rounded-xl border border-brand-500/50 bg-brand-500/5 p-4">
            <div className="text-sm font-semibold text-brand-400 mb-1">Team</div>
            <div className="text-2xl font-bold text-white">
              $500<span className="text-sm font-normal text-gray-500">/yr</span>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-gray-400">
              <li className="flex items-start gap-1.5">
                <span className="text-green-400 mt-px">&#10003;</span>
                Everything in Pro
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-green-400 mt-px">&#10003;</span>
                Strategy analysis
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-green-400 mt-px">&#10003;</span>
                Pit analysis
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-green-400 mt-px">&#10003;</span>
                Priority support
              </li>
            </ul>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => {
            onClose();
            navigate(user ? "/pricing" : "/signup");
          }}
          className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-sm transition-colors"
        >
          {user ? "View Plans" : "Sign Up Free"}
        </button>

        {!user && (
          <p className="text-center text-xs text-gray-500 mt-3">
            Already have an account?{" "}
            <button
              onClick={() => { onClose(); navigate("/login"); }}
              className="text-brand-400 hover:text-brand-300"
            >
              Sign in
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
