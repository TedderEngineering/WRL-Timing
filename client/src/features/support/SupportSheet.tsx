import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { SupportConfig } from "../../lib/site-config";
import { stripGripPrefix } from "../../lib/site";
import { RACETRACE_COPY, type SupportCopy } from "./copy";
import { markDismissed } from "./storage";
import { SupporterAvatar } from "./SupporterAvatar";

const LABELS: Record<number, { icon: string; title: string; badge?: string }> = {
  1: { icon: "☕", title: "1 coffee" },
  3: { icon: "☕☕☕", title: "3 coffees", badge: "A race weekend" },
  20: { icon: "🏁", title: "A full season" },
};

export const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/**
 * F9-C / F10: pick 1, 3 (default) or a season, then go to Stripe Checkout.
 * Centered dialog on wide screens, bottom sheet on phones.
 */
export function SupportSheet({ support, copy = RACETRACE_COPY, onClose }: { support: SupportConfig; copy?: SupportCopy; onClose: () => void }) {
  const options = support.options?.length ? support.options : [1, 3, 20];
  const [choice, setChoice] = useState(options.includes(3) ? 3 : options[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const total = dollars(choice * support.coffeeCents);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && notNow();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function notNow() {
    markDismissed();
    onClose();
  }

  async function go() {
    setError(null);
    if (!support.checkout && support.paymentLinkUrl) {
      window.location.assign(support.paymentLinkUrl);
      return;
    }
    setBusy(true);
    try {
      // Finding Grip paths go without the /grip prefix; the server adds Finding Grip's address.
      const path = copy.site === "grip" ? stripGripPrefix(window.location.pathname) : window.location.pathname;
      const returnPath = `${path}${window.location.search}`;
      const r = await api.post<{ url: string }>("/support/checkout", { coffees: choice, returnPath, ...(copy.site === "grip" ? { site: "grip" } : {}) });
      window.location.assign(r.url);
    } catch {
      setBusy(false);
      setError("Checkout couldn't start. Please try again in a moment.");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center" onClick={notNow}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] rounded-t-2xl border border-[var(--rt-border)] bg-[var(--rt-surface)] p-5 text-left text-[var(--rt-text)] shadow-2xl sm:rounded-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-[var(--rt-border)] sm:hidden" />
        <div className="flex items-center gap-3">
          <SupporterAvatar size={52} />
          <div>
            <h2 id="support-title" className="m-0 text-[17px] font-semibold">
              {copy.sheetTitle}
            </h2>
            <div className="text-[13px] text-[var(--rt-text-muted)]">Brent Tedder · Tedder Engineering</div>
          </div>
        </div>
        <p className="mb-0 mt-3 leading-relaxed text-[var(--rt-text-secondary)]">
          {copy.sheetBody}
        </p>
        <div role="radiogroup" aria-label="How many coffees" className="mt-4 grid grid-cols-3 gap-2">
          {options.map((n, i) => {
            const l = LABELS[n] ?? { icon: "☕", title: `${n} coffees` };
            const on = n === choice;
            return (
              <button
                key={n}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setChoice(n)}
                className="relative min-h-[72px] rounded-xl border px-2 py-3 text-center"
                style={{
                  borderColor: on ? "var(--rt-accent)" : "var(--rt-border)",
                  borderWidth: on ? 2 : 1,
                  background: on ? "var(--rt-accent-soft)" : "var(--rt-surface-2)",
                }}
              >
                {l.badge && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--rt-accent)] px-2 py-px text-[10px] font-bold text-[var(--rt-on-accent)]">
                    {l.badge}
                  </span>
                )}
                <div className="text-lg leading-none">{l.icon}</div>
                <div className="mt-1 text-sm font-semibold">{l.title}</div>
                <div className="font-mono text-xs tabular-nums text-[var(--rt-text-muted)]">{dollars(n * support.coffeeCents)}</div>
              </button>
            );
          })}
        </div>
        {error && <p className="mb-0 mt-3 text-sm text-[var(--rt-critical)]">{error}</p>}
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-[var(--rt-accent)] px-4 py-3 font-bold text-[var(--rt-on-accent)] disabled:opacity-60"
        >
          {busy ? "Opening checkout…" : support.checkout ? `${choice === 1 ? "Buy me a coffee" : LABELS[choice]?.title === "A full season" ? "Back a full season" : `Buy me ${choice} coffees`} · ${total}` : "Continue to checkout"}
        </button>
        <div className="mt-2 flex items-center justify-between text-xs text-[var(--rt-text-muted)]">
          <span>Secure checkout by Stripe</span>
          <button type="button" onClick={notNow} className="min-h-[36px] px-1 text-[var(--rt-text-muted)]">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
