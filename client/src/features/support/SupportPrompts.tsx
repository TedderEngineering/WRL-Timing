import { useEffect, useState } from "react";
import { useSupport } from "./SupportContext";
import { SupporterAvatar } from "./SupporterAvatar";
import { canAsk, isSupporter, markAsked, markDismissed, recentlyThanked } from "./storage";

const btn = "inline-flex items-center gap-1.5";

/** F9-A: the quiet header link. Always there while support is set up. */
export function SupportLink({ variant = "pill", onClick, className }: { variant?: "pill" | "menu"; onClick?: () => void; className?: string }) {
  const { support, openSupport } = useSupport();
  if (!support.enabled) return null;
  const open = () => {
    onClick?.();
    openSupport("header");
  };
  return variant === "menu" ? (
    <button type="button" onClick={open} className={className ?? "py-2 text-left text-gray-700 dark:text-gray-300"}>
      ☕ Buy me a coffee
    </button>
  ) : (
    <button
      type="button"
      onClick={open}
      className={`${btn} whitespace-nowrap rounded-full border border-gray-300 px-3 py-1.5 text-[13px] text-gray-600 transition-colors hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:text-white`}
    >
      ☕ Buy me a coffee
    </button>
  );
}

/**
 * The header's coffee entry where the "☕ Buy me a coffee" link doesn't fit (below 1024px). Passive:
 * it never opens by itself. Same placement name as the link ("header"). Finding Grip's header
 * has the same button (GripLayout.tsx); `className` sets where it shows.
 */
export function CoffeeIconButton({ className = "" }: { className?: string }) {
  const { support, openSupport } = useSupport();
  if (!support.enabled) return null;
  return (
    <button
      type="button"
      onClick={() => openSupport("header")}
      aria-label="Buy me a coffee"
      title="Buy me a coffee"
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gray-300 text-xl leading-none hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-gray-700 dark:hover:bg-gray-800 ${className}`}
    >
      <span aria-hidden="true">☕</span>
    </button>
  );
}

/**
 * F9-B: shown once (at most every 30 days), at the end of a recap the reader
 * chose to expand. Never to someone who came back from checkout.
 * `lead`/`body`/`from` replace the site's usual wording for a second moment
 * (Finding Grip's season recap); left out, nothing changes.
 */
export function SupportAsk({ lead, body, from }: { lead?: string; body?: string; from?: string } = {}) {
  const { support, copy, openSupport } = useSupport();
  const [show] = useState(() => support.enabled && canAsk());
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (show) markAsked();
  }, [show]);
  if (!support.enabled || !show || hidden) return null;
  return (
    <div className="flex items-start gap-3.5 border-t border-[var(--rt-rule)] pt-3.5">
      <SupporterAvatar size={44} />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="m-0 leading-normal text-[var(--rt-text)]">
          <b>{lead ?? copy.askLead}</b> {body ?? copy.askBody}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openSupport(from ?? (copy.site === "grip" ? "on-target" : "recap"))}
            className="rounded-md bg-[var(--rt-accent)] px-3.5 py-2 text-sm font-semibold text-[var(--rt-on-accent)]"
          >
            ☕ Buy me a coffee
          </button>
          <button
            type="button"
            onClick={() => {
              markDismissed();
              setHidden(true);
            }}
            className="min-h-[36px] px-1.5 text-[13px] text-[var(--rt-text-muted)]"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

/** F9-D / E: dashboard card; a thank-you after someone comes back from checkout. */
export function SupportCard() {
  const { support, copy, openSupport } = useSupport();
  if (recentlyThanked()) {
    return (
      <div className="rounded-xl border px-4 py-3.5 text-left" style={{ borderColor: "color-mix(in srgb, var(--rt-good) 45%, transparent)", background: "color-mix(in srgb, var(--rt-good) 9%, transparent)" }}>
        <div className="font-semibold">Thank you 🙏</div>
        <p className="mb-0 mt-1.5 text-[13px] leading-normal text-[var(--rt-text-secondary)]">{copy.thanksCardBody}</p>
      </div>
    );
  }
  if (!support.enabled || isSupporter()) return null;
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] px-4 py-3.5 text-left">
      <div className="flex items-center gap-2.5">
        <SupporterAvatar size={36} />
        <div className="font-semibold">{copy.cardTitle}</div>
      </div>
      <p className="m-0 text-[13px] leading-normal text-[var(--rt-text-secondary)]">{copy.cardBody}</p>
      <button type="button" onClick={() => openSupport("dashboard")} className="self-start text-[13px] font-semibold text-[var(--rt-accent)]">
        ☕ Buy me a coffee →
      </button>
    </div>
  );
}
