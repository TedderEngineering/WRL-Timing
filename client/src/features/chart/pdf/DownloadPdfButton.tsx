/**
 * "PDF" in the race header: the open tab as a PDF, saved as a file. With `choices` (the Story tab
 * with a focus car), it first asks which: the whole race or the focus car alone.
 *
 * The PDF code loads only when someone downloads. A page left open while the site is updated asks
 * for files the update replaced: the button then reloads the page (keeping the address, so the
 * same race and tab) and the download starts by itself once the page is back.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { track } from "../../../lib/analytics";
import type { PdfTab, TabPdfInput } from "./index";

const RESUME_KEY = "racetrace:pdf-after-reload";

/** The browser could not load a part of the site that was replaced by an update. */
export function isStaleChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload|Failed to fetch/i.test(msg);
}

export interface PdfChoice {
  scope: "race" | "focus";
  label: string;
}

export function DownloadPdfButton({
  tab,
  input,
  choices,
  className,
  style,
}: {
  tab: PdfTab;
  input: TabPdfInput;
  choices?: PdfChoice[];
  className?: string;
  style?: CSSProperties;
}) {
  const [state, setState] = useState<"idle" | "busy" | "failed" | "reloading">("idle");
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const run = async (scope: PdfChoice["scope"] = "race", resumed = false) => {
    setOpen(false);
    setState("busy");
    let loaded = false;
    try {
      const [{ tabPdf }, { downloadBlob }] = await Promise.all([import("./index"), import("./kit")]);
      loaded = true;
      const { blob, name } = await tabPdf(tab, { ...input, scope });
      downloadBlob(blob, name);
      track("download_pdf", { tab, scope });
      setState("idle");
    } catch (e) {
      // Once per click: a page reloaded for this download does not reload again.
      if (!loaded && !resumed && isStaleChunkError(e)) {
        track("pdf_failed", { tab, reason: "site_updated" });
        try {
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({ tab, scope, path: location.pathname + location.search, at: Date.now() }));
        } catch {
          /* private mode: the reload still fixes the next click */
        }
        setState("reloading");
        window.location.reload();
        return;
      }
      console.error("PDF download failed", e);
      track("pdf_failed", { tab, reason: loaded ? "build" : "load" });
      setState("failed");
      window.setTimeout(() => setState("idle"), 4000);
    }
  };

  // After a reload for a site update: finish the download that was asked for.
  const resumedOnce = useRef(false);
  useEffect(() => {
    if (resumedOnce.current) return;
    resumedOnce.current = true;
    let pending: { tab: string; scope: PdfChoice["scope"]; path: string; at: number } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null");
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      pending = null;
    }
    if (pending && pending.tab === tab && pending.path === location.pathname + location.search && Date.now() - pending.at < 60_000) {
      void run(pending.scope, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const menu = choices && choices.length > 1;
  return (
    <div ref={wrap} className="relative inline-flex">
      <button
        type="button"
        onClick={() => (menu ? setOpen((o) => !o) : run())}
        disabled={state === "busy" || state === "reloading"}
        className={className}
        style={{ ...style, opacity: state === "busy" || state === "reloading" ? 0.6 : 1 }}
        title="Download this tab as a PDF"
        aria-haspopup={menu ? "menu" : undefined}
        aria-expanded={menu ? open : undefined}
        aria-live="polite"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
        </svg>
        {state === "busy" ? "Preparing…" : state === "reloading" ? "Updating…" : state === "failed" ? "PDF failed, try again" : "PDF"}
        {menu && state === "idle" && <span aria-hidden>▾</span>}
      </button>
      {menu && open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[170px] overflow-hidden rounded-md border py-1 text-sm shadow-lg"
          style={{ background: (style?.background as string) ?? "#12122a", borderColor: (style?.borderColor as string) ?? "#3a3a5c" }}
        >
          {choices.map((c) => (
            <button
              key={c.scope}
              type="button"
              role="menuitem"
              onClick={() => run(c.scope)}
              className="block w-full px-3 py-2 text-left hover:bg-white/10"
              style={{ color: (style?.color as string) ?? "#e0e0e8" }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
