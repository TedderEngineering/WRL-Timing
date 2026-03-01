import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { api, ApiClientError } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: "USER" | "ADMIN";
  emailVerified: boolean;
  onboardingDone: boolean;
  createdAt: string;
  subscription?: {
    plan: "FREE" | "PRO" | "TEAM";
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // Track refresh timer
  const [refreshTimer, setRefreshTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Deduplicate concurrent refresh calls
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const scheduleRefresh = useCallback(
    (expiresInMs: number) => {
      if (refreshTimer) clearTimeout(refreshTimer);
      // Refresh 1 minute before expiry
      const refreshIn = Math.max(expiresInMs - 60_000, 5_000);
      const timer = setTimeout(() => {
        // refreshTokens handles all errors internally — never rejects
        refreshTokens();
      }, refreshIn);
      setRefreshTimer(timer);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleAuthResponse = useCallback(
    (data: { accessToken: string; user: User }) => {
      api.setAccessToken(data.accessToken);
      setState({
        user: data.user,
        isLoading: false,
        isAuthenticated: true,
      });
      // Schedule refresh ~14 minutes from now (token lasts 15 min)
      scheduleRefresh(14 * 60 * 1000);
    },
    [scheduleRefresh]
  );

  // Attempt silent refresh — deduplicates concurrent calls
  const refreshTokens = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;

    const promise = (async () => {
      try {
        const data = await api.post<{ accessToken: string; user: User }>(
          "/auth/refresh"
        );
        handleAuthResponse(data);
      } catch (err) {
        // Only log out on a definitive auth rejection (401/403)
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
          api.setAccessToken(null);
          setState({ user: null, isLoading: false, isAuthenticated: false });
        } else {
          // Transient error (network, 500, etc.)
          // If already authenticated, keep current session — token may still be valid.
          // If initial load, we have no session to preserve — mark unauthenticated.
          setState((prev) =>
            prev.isAuthenticated
              ? prev
              : { user: null, isLoading: false, isAuthenticated: false }
          );
        }
      } finally {
        refreshInFlight.current = null;
      }
    })();

    refreshInFlight.current = promise;
    return promise;
  }, [handleAuthResponse]);

  useEffect(() => {
    refreshTokens();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<{ accessToken: string; user: User }>(
        "/auth/login",
        { email, password }
      );
      handleAuthResponse(data);
    },
    [handleAuthResponse]
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const data = await api.post<{ accessToken: string; user: User }>(
        "/auth/register",
        { email, password, displayName }
      );
      handleAuthResponse(data);
    },
    [handleAuthResponse]
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Logout even if request fails
    }
    api.setAccessToken(null);
    if (refreshTimer) clearTimeout(refreshTimer);
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, [refreshTimer]);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get<{ user: User }>("/auth/me");
      setState((prev) => ({ ...prev, user: data.user }));
    } catch {
      // Ignore errors
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
