import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useSiteConfig, type SupportConfig } from "../../lib/site-config";
import { SupportSheet } from "./SupportSheet";

interface SupportContextValue {
  support: SupportConfig;
  openSupport: (from: string) => void;
}

const Ctx = createContext<SupportContextValue | null>(null);

/** One support sheet for the whole app; any "Buy me a coffee" opens it. */
export function SupportProvider({ children }: { children: ReactNode }) {
  const { support } = useSiteConfig();
  const [openFrom, setOpenFrom] = useState<string | null>(null);
  const openSupport = useCallback((from: string) => setOpenFrom(from), []);
  const value = useMemo(() => ({ support, openSupport }), [support, openSupport]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {openFrom && support.enabled && <SupportSheet support={support} onClose={() => setOpenFrom(null)} />}
    </Ctx.Provider>
  );
}

export function useSupport(): SupportContextValue {
  const v = useContext(Ctx);
  // Outside the provider (tests, Finding Grip pages): support is simply off.
  return v ?? { support: { enabled: false, checkout: false, paymentLinkUrl: null, coffeeCents: 500, options: [1, 3, 20] }, openSupport: () => {} };
}
