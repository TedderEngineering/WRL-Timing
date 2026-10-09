import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClientError } from "@/lib/api";
import { gripApi, type GripAccount, type GripMe } from "./api";
import type { Units } from "./units";

interface GripContextValue {
  account: GripAccount;
  units: Units;
  checkoutAvailable: boolean;
  calculatorAvailable: boolean;
  setAccount: (account: GripAccount) => void;
  setUnits: (units: Units) => Promise<void>;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
}

const GripContext = createContext<GripContextValue | null>(null);

export function useGrip(): GripContextValue {
  const ctx = useContext(GripContext);
  if (!ctx) throw new Error("useGrip must be used inside GripProvider");
  return ctx;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "blocked" }
  | { kind: "unverified" }
  | { kind: "error"; message: string }
  | { kind: "ready"; me: GripMe };

/**
 * Loads the signed-in user's Finding Grip account. Renders `blocked` when the
 * server says this account is not part of the current test group, and
 * `unverified` (given a function to check again) until the email address has
 * been verified.
 */
export function GripProvider({
  children,
  blocked,
  unverified,
}: {
  children: ReactNode;
  blocked: ReactNode;
  unverified: (recheck: () => Promise<boolean>) => ReactNode;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      setState({ kind: "ready", me: await gripApi.me() });
      return true;
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "GRIP_NOT_AVAILABLE") {
        setState({ kind: "blocked" });
      } else if (err instanceof ApiClientError && err.code === "EMAIL_NOT_VERIFIED") {
        setState({ kind: "unverified" });
      } else {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Something went wrong",
        });
      }
    }
    return false;
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [load]);

  const toast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 2800);
  }, []);

  const setAccount = useCallback((account: GripAccount) => {
    setState((prev) =>
      prev.kind === "ready" ? { kind: "ready", me: { ...prev.me, account } } : prev
    );
  }, []);

  const setUnits = useCallback(
    async (units: Units) => {
      const { account } = await gripApi.setUnits(units);
      setAccount(account);
    },
    [setAccount]
  );

  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-4 border-grip-500 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (state.kind === "blocked") return <>{blocked}</>;
  if (state.kind === "unverified") return <>{unverified(load)}</>;
  if (state.kind === "error") {
    return (
      <div className="container-page py-20 text-center">
        <p className="text-gray-600 dark:text-gray-400">
          Finding Grip could not load: {state.message}
        </p>
        <button
          className="mt-4 text-grip-600 dark:text-grip-400 font-medium hover:underline"
          onClick={() => {
            setState({ kind: "loading" });
            load();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const { me } = state;
  return (
    <GripContext.Provider
      value={{
        account: me.account,
        units: me.account.units,
        checkoutAvailable: me.checkoutAvailable,
        calculatorAvailable: me.calculatorAvailable,
        setAccount,
        setUnits,
        refresh: async () => {
          await load();
        },
        toast,
      }}
    >
      {children}
      {toastMessage && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 sm:bottom-8 z-50 max-w-[calc(100%-2rem)] rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-2 text-sm font-medium shadow-lg"
        >
          {toastMessage}
        </div>
      )}
    </GripContext.Provider>
  );
}
