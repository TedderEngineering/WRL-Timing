/**
 * The season (mobile redesign, step 6): on a phone, Home keeps to your car, the next round and the
 * latest races, and the season's calendar moves here, under Me. Laptops still show it on the
 * dashboard beside the races; this page works there too.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { SeasonPanel } from "../features/dashboard/SeasonPanel";
import type { SeasonResponse } from "../features/dashboard/types";

export function SeasonPage() {
  const [season, setSeason] = useState<SeasonResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<SeasonResponse>("/dashboard/season")
      .then((v) => alive && setSeason(v))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="container-page max-w-xl py-5 text-left text-[var(--rt-text)]">
      <Link to="/me" className="inline-flex min-h-[44px] items-center text-[14px] text-[var(--rt-accent)]">
        ‹ Me
      </Link>
      <h1 className="m-0 mb-3 text-2xl font-semibold">Season</h1>
      {failed ? <p className="text-[var(--rt-text-secondary)]">The season could not be loaded. Refresh to try again.</p> : <SeasonPanel data={season} />}
    </div>
  );
}
