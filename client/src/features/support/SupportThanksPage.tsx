import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { gp } from "../../lib/site";
import { useSupport } from "./SupportContext";
import { markThanked } from "./storage";
import { SupporterAvatar } from "./SupporterAvatar";

/** Stripe Checkout returns here (F9-E). Remembers the supporter so they aren't asked again. */
export function SupportThanksPage() {
  const { copy } = useSupport();
  const [params] = useSearchParams();
  const raw = params.get("return") ?? "/dashboard";
  const safe = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  // Finding Grip return paths come without /grip; put it back when Finding Grip is under RaceTrace.
  const back = copy.site === "grip" ? gp(safe === "/" ? "" : safe) : safe;
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
          {copy.thanksBody}
        </p>
        <p className="text-[13px] text-[var(--rt-text-muted)]">Stripe emails your receipt.</p>
        <Link to={back} className="mt-2 inline-block rounded-md bg-[var(--rt-accent)] px-4 py-2 text-sm font-semibold text-[var(--rt-on-accent)]">
          Back to {copy.name}
        </Link>
      </div>
    </div>
  );
}
