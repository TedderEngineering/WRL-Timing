import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { rememberPostAuthRedirect } from "../../lib/postAuthRedirect";
import { track } from "../../lib/analytics";
import { followCar, followedInRace, rememberPendingFollow, removeCar, takePendingFollow } from "./api";
import { AlertAskAfterFollow } from "./alerts";

const norm = (n: string) => (/^\d+$/.test(n) ? String(Number(n)) : n.toUpperCase());

/**
 * "Follow #67" for the race page's focus car. Signed out, it asks for an account first and the
 * follow is done on the way back (the plan: account required, sign-up returns with the follow
 * done). `onFollowed` lists the race's followed car numbers, so the page can focus one.
 */
export function FollowCarButton({
  raceId,
  carNumber,
  series,
  onFollowed,
  style,
}: {
  raceId: string;
  carNumber: string;
  series: string;
  onFollowed?: (carNumbers: string[]) => void;
  style?: React.CSSProperties;
}) {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [followed, setFollowed] = useState<{ carNumber: string; carId: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Just followed here: offer the race-ready email once (it hides itself when already on).
  const [justFollowed, setJustFollowed] = useState(false);

  useEffect(() => {
    setFollowed([]);
    setError(null);
    if (!isAuthenticated) return;
    let alive = true;
    (async () => {
      // A follow asked for before signing up is done now, then the list is read.
      const pending = takePendingFollow(raceId);
      if (pending) {
        try {
          const r = await followCar(raceId, pending);
          track("follow_car", { series, source: "race_page" });
          if (alive && r.created) setJustFollowed(true);
        } catch {
          // shown as not followed; they can press Follow again
        }
      }
      try {
        const r = await followedInRace(raceId);
        if (!alive) return;
        setFollowed(r.followed);
        onFollowed?.(r.followed.map((f) => f.carNumber));
      } catch {
        // the button just shows "Follow"
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId, isAuthenticated]);

  const mine = followed.find((f) => norm(f.carNumber) === norm(carNumber));

  const toggle = async () => {
    setError(null);
    if (!isAuthenticated) {
      rememberPendingFollow(raceId, carNumber);
      rememberPostAuthRedirect(`${window.location.pathname}${window.location.search}`);
      navigate("/signup");
      return;
    }
    setBusy(true);
    try {
      if (mine) {
        await removeCar(mine.carId);
        setFollowed((f) => f.filter((x) => x.carId !== mine.carId));
      } else {
        const r = await followCar(raceId, carNumber);
        setFollowed((f) => [...f, { carNumber, carId: r.car.id }]);
        if (r.created) {
          track("follow_car", { series, source: "race_page" });
          setJustFollowed(true);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={!!mine}
        title={mine ? "Stop following this car (Settings → My cars lists them all)" : "Follow this car in every race it runs"}
        className="flex min-h-[36px] items-center gap-1.5 rounded-md border px-3 text-sm disabled:opacity-60"
        style={style}
      >
        <span aria-hidden style={{ color: mine ? "#4ade80" : undefined }}>{mine ? "✓" : "+"}</span>
        {mine ? `Following #${carNumber}` : `Follow #${carNumber}`}
      </button>
      {justFollowed && mine && <AlertAskAfterFollow carNumber={carNumber} style={{ color: "#cbd5e1" }} />}
      {error && (
        <span role="alert" className="mt-1 text-xs" style={{ color: "#e66767" }}>
          {error}
        </span>
      )}
    </span>
  );
}
