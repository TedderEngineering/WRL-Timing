import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { markThanked } from "./storage";
import { SupporterAvatar } from "./SupporterAvatar";

/** Stripe Checkout returns here (F9-E). Remembers the supporter so they aren't asked again. */
export function SupportThanksPage() {
  const [params] = useSearchParams();
  const raw = params.get("return") ?? "/dashboard";
  const back = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  useEffect(() => {
    markThanked();
  }, []);
  return (
    <div className="container-page flex justify-center py-16 text-left text-[var(--rt-text)]">
      <div className="w-full max-w-md rounded-2xl border border-[var(--rt-border)] bg-[var(--rt-surface)] p-6">
        <div className="flex items-center gap-3">
          <SupporterAvatar size={52} />
          <h1 className="m-0 text-xl font-semibold">Thank you 🙏</h1>
        </div>
        <p className="mt-4 leading-relaxed text-[var(--rt-text-secondary)]">
          That's another race analysed. RaceTrace stays free for everyone, and I won't ask you again this season.
        </p>
        <p className="text-[13px] text-[var(--rt-text-muted)]">Stripe emails your receipt.</p>
        <Link to={back} className="mt-2 inline-block rounded-md bg-[var(--rt-accent)] px-4 py-2 text-sm font-semibold text-[var(--rt-on-accent)]">
          Back to RaceTrace
        </Link>
      </div>
    </div>
  );
}
