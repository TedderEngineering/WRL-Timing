/**
 * Site-wide switches served by GET /api/site-config: whether RaceTrace is free
 * (every race and feature open) and how optional support is offered.
 *
 * Free mode is assumed until the server says otherwise, so nothing flashes
 * "locked" while the config loads; the server enforces access either way.
 */
import { useEffect, useState } from "react";
import { api } from "./api";

export interface SupportConfig {
  enabled: boolean;
  checkout: boolean;
  paymentLinkUrl: string | null;
  coffeeCents: number;
  options: number[];
}

export interface SiteConfig {
  freeMode: boolean;
  support: SupportConfig;
}

const DEFAULT_CONFIG: SiteConfig = {
  freeMode: true,
  support: { enabled: false, checkout: false, paymentLinkUrl: null, coffeeCents: 500, options: [1, 3, 20] },
};

let current: SiteConfig = DEFAULT_CONFIG;
let pending: Promise<SiteConfig> | null = null;
const listeners = new Set<(c: SiteConfig) => void>();

/** Synchronous read for helpers like hasFullAccess(). */
export function isFreeMode(): boolean {
  return current.freeMode;
}

export function loadSiteConfig(): Promise<SiteConfig> {
  if (!pending) {
    pending = api
      .get<SiteConfig>("/site-config")
      .then((c) => {
        current = { ...DEFAULT_CONFIG, ...c, support: { ...DEFAULT_CONFIG.support, ...(c?.support ?? {}) } };
        listeners.forEach((l) => l(current));
        return current;
      })
      .catch(() => current);
  }
  return pending;
}

export function useSiteConfig(): SiteConfig {
  const [config, setConfig] = useState(current);
  useEffect(() => {
    listeners.add(setConfig);
    loadSiteConfig().then(setConfig);
    return () => {
      listeners.delete(setConfig);
    };
  }, []);
  return config;
}

/** Tests only. */
export function __setSiteConfigForTests(c: Partial<SiteConfig>) {
  current = { ...DEFAULT_CONFIG, ...c, support: { ...DEFAULT_CONFIG.support, ...(c.support ?? {}) } };
  pending = Promise.resolve(current);
}
