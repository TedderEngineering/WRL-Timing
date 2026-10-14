import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useSiteConfig, type SupportConfig } from "../../lib/site-config";
import { RACETRACE_COPY, SUPPORT_COPY, type SupportCopy, type SupportSite } from "./copy";
import { SupportSheet } from "./SupportSheet";

interface SupportContextValue {
  support: SupportConfig;
  copy: SupportCopy;
  openSupport: (from: string) => void;
}

const OFF: SupportConfig = { enabled: false, checkout: false, paymentLinkUrl: null, coffeeCents: 500, options: [1, 3, 20] };

const Ctx = createContext<SupportContextValue | null>(null);

/**
 * One support sheet for the whole app; any "Buy me a coffee" opens it.
 * `site` picks the wording and where Stripe returns to; `enabled={false}` hides
 * every ask (Finding Grip does this while it has paid plans).
 */
export function SupportProvider({ children, site = "racetrace", enabled = true }: { children: ReactNode; site?: SupportSite; enabled?: boolean }) {
  const config = useSiteConfig().support;
  const support = enabled ? config : OFF;
  const copy = SUPPORT_COPY[site];
  const [openFrom, setOpenFrom] = useState<string | null>(null);
  const openSupport = useCallback((from: string) => setOpenFrom(from), []);
  const value = useMemo(() => ({ support, copy, openSupport }), [support, copy, openSupport]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {openFrom && support.enabled && <SupportSheet support={support} copy={copy} onClose={() => setOpenFrom(null)} />}
    </Ctx.Provider>
  );
}

export function useSupport(): SupportContextValue {
  const v = useContext(Ctx);
  // Outside a provider (tests): support is simply off.
  return v ?? { support: OFF, copy: RACETRACE_COPY, openSupport: () => {} };
}
