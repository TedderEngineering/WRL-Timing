/**
 * "PDF" in the race header: the open tab as a PDF, saved as a file. With `choices` (the Story tab
 * with a focus car), it first asks which: the whole race or the focus car alone.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { track } from "../../../lib/analytics";
import type { PdfTab, TabPdfInput } from "./index";

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
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
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

  const run = async (scope: PdfChoice["scope"] = "race") => {
    setOpen(false);
    setState("busy");
    try {
      const [{ tabPdf }, { downloadBlob }] = await Promise.all([import("./index"), import("./kit")]);
      const { blob, name } = await tabPdf(tab, { ...input, scope });
      downloadBlob(blob, name);
      track("download_pdf", { tab, scope });
      setState("idle");
    } catch {
      setState("failed");
      window.setTimeout(() => setState("idle"), 4000);
    }
  };

  const menu = choices && choices.length > 1;
  return (
    <div ref={wrap} className="relative inline-flex">
      <button
        type="button"
        onClick={() => (menu ? setOpen((o) => !o) : run())}
        disabled={state === "busy"}
        className={className}
        style={{ ...style, opacity: state === "busy" ? 0.6 : 1 }}
        title="Download this tab as a PDF"
        aria-haspopup={menu ? "menu" : undefined}
        aria-expanded={menu ? open : undefined}
        aria-live="polite"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
        </svg>
        {state === "busy" ? "Preparing…" : state === "failed" ? "PDF failed, try again" : "PDF"}
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
