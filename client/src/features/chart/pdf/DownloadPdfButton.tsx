/** "PDF" in the race header: the open tab as a PDF, saved as a file. */
import { useState, type CSSProperties } from "react";
import { track } from "../../../lib/analytics";
import type { PdfTab, TabPdfInput } from "./index";

export function DownloadPdfButton({ tab, input, className, style }: { tab: PdfTab; input: TabPdfInput; className?: string; style?: CSSProperties }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const run = async () => {
    setState("busy");
    try {
      const [{ tabPdf }, { downloadBlob }] = await Promise.all([import("./index"), import("./kit")]);
      const { blob, name } = await tabPdf(tab, input);
      downloadBlob(blob, name);
      track("download_pdf", { tab });
      setState("idle");
    } catch {
      setState("failed");
      window.setTimeout(() => setState("idle"), 4000);
    }
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "busy"}
      className={className}
      style={{ ...style, opacity: state === "busy" ? 0.6 : 1 }}
      title="Download this tab as a PDF"
      aria-live="polite"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
      </svg>
      {state === "busy" ? "Preparing…" : state === "failed" ? "PDF failed, try again" : "PDF"}
    </button>
  );
}
