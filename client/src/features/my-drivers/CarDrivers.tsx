import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { useAuth, useOptionalAuth } from "../auth/AuthContext";
import { rememberPostAuthRedirect } from "../../lib/postAuthRedirect";
import { track } from "../../lib/analytics";
import { splitTeam } from "../chart/panel-ui";
import { formatDuration } from "../../lib/prose";
import {
  displayName,
  followDriver,
  followedAs,
  rememberPendingDriver,
  sameDriver,
  takePendingDriver,
  unfollowDriver,
  useMyDrivers,
} from "./api";
import { driveOf, driveTimeText, stintsOf } from "./stints";

const T = { line: "#1e1e38", text: "#e0e0e8", soft: "#cbd5e1", muted: "#9a9ab4", accent: "#f48c34", control: "#2c2c50" };

/** The car's drivers as the import found them: the driver list, else "Team (A / B)". */
export function carDriverNames(car: { team?: string; drivers?: string[] } | undefined): string[] {
  const listed = car?.drivers?.filter((d) => d.trim()) ?? [];
  const names = listed.length ? listed : (splitTeam(car?.team).drivers ?? "").split(/\s*[/,]\s*/).filter(Boolean);
  const out: string[] = [];
  for (const n of names) if (!out.some((o) => sameDriver(o, n))) out.push(n);
  return out;
}

/**
 * "Drivers" under the focus car on the race page: each driver's share of the race when the timing
 * says who drove when, and a Follow button. Signed out, Follow asks for an account first and the
 * follow is done on the way back.
 */
export function CarDrivers(props: { data: RaceChartData; focusNum: number; annotations: AnnotationData | null }) {
  // Only inside the app (auth and router): the chart panels also render on their own.
  return useOptionalAuth() ? <CarDriversInApp {...props} /> : null;
}

function CarDriversInApp({ data, focusNum, annotations }: { data: RaceChartData; focusNum: number; annotations: AnnotationData | null }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mine = useMyDrivers(user?.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justFollowed, setJustFollowed] = useState<string | null>(null);
  const car = data.cars[String(focusNum)];
  const names = useMemo(() => carDriverNames(car), [car]);
  const stints = useMemo(
    () => (car ? stintsOf(car.laps, annotations?.[String(focusNum)]?.pits, names.length === 1 ? names[0] : null, names) : []),
    [car, annotations, focusNum, names]
  );

  // A follow asked for before signing up is done now.
  useEffect(() => {
    if (!user) return;
    const pending = takePendingDriver();
    if (!pending) return;
    followDriver(pending)
      .then((r) => {
        if (r.created) {
          track("follow_driver", { source: "race_page" });
          setJustFollowed(r.driver.name);
        }
      })
      .catch(() => undefined);
  }, [user]);

  if (!car || names.length === 0) return null;

  const toggle = async (name: string) => {
    setError(null);
    if (!user) {
      rememberPendingDriver(name);
      rememberPostAuthRedirect(`${window.location.pathname}${window.location.search}`);
      navigate("/signup");
      return;
    }
    setBusy(name);
    try {
      const f = followedAs(mine, name);
      if (f) {
        await unfollowDriver(f.id);
        if (justFollowed && sameDriver(justFollowed, name)) setJustFollowed(null);
      } else {
        const r = await followDriver(name);
        if (r.created) {
          track("follow_driver", { source: "race_page" });
          setJustFollowed(r.driver.name);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Drivers" className="mt-1 flex flex-col">
      {names.map((n) => {
        const drive = driveOf(car.laps, stints, n);
        const f = followedAs(mine, n);
        return (
          <div key={n} className="flex min-h-[44px] items-center gap-2.5 border-t py-1" style={{ borderColor: T.line }}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold" style={{ color: T.text }}>
                {displayName(n)}
              </div>
              {drive && drive.stints > 0 && (
                <div className="truncate text-[12px] tabular-nums" style={{ color: T.muted }}>
                  {drive.stints} stint{drive.stints === 1 ? "" : "s"} · {driveTimeText(drive.driveTimeS)}
                  {drive.best ? ` · best ${formatDuration(drive.best.sec)}` : ""}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => toggle(n)}
              disabled={busy === n}
              aria-pressed={!!f}
              aria-label={f ? `Stop following ${displayName(n)}` : `Follow ${displayName(n)}`}
              title={f ? "Stop following (Settings › My drivers lists them all)" : "Follow this driver in every race, whatever the car"}
              className="min-h-[32px] shrink-0 rounded-full border px-2.5 text-[12px] font-semibold disabled:opacity-60"
              style={
                f
                  ? { borderColor: "rgba(244,140,52,0.6)", background: "rgba(244,140,52,0.12)", color: T.accent }
                  : { borderColor: T.control, color: T.text }
              }
            >
              {f ? "✓ Following" : "+ Follow"}
            </button>
          </div>
        );
      })}
      {justFollowed && followedAs(mine, justFollowed) && (
        <p className="m-0 mt-1 text-[12px]" style={{ color: T.soft }}>
          {justFollowed}&apos;s latest race now shows on your{" "}
          <Link to="/dashboard" style={{ color: T.accent }}>
            Dashboard
          </Link>
          , whatever car they race.
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 mt-1 text-[12px]" style={{ color: "#e66767" }}>
          {error}
        </p>
      )}
    </section>
  );
}
