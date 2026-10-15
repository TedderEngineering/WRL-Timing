import { shareLink, sharedUrl } from "./shareLink";
import { useShareFeedback } from "./ShareRaceTrace";

/**
 * "Share" on a race page: the share sheet (or the copied message and link) for this race,
 * tagged ?from=share like every shared RaceTrace link. Sends share_app { source: "race" }.
 */
export function ShareRaceButton({
  raceId,
  raceName,
  className,
  style,
}: {
  raceId: string;
  raceName: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { note, done } = useShareFeedback();
  return (
    <button
      type="button"
      aria-live="polite"
      className={className}
      style={style}
      onClick={async () =>
        done(
          await shareLink({
            url: sharedUrl(`${window.location.origin}/chart?race=${encodeURIComponent(raceId)}`),
            title: "RaceTrace",
            text: `${raceName}: position trace, pit stops and lap times on RaceTrace, by Tedder Engineering.`,
            source: "race",
          })
        )
      }
    >
      <span aria-hidden>↗</span> {note ?? "Share"}
    </button>
  );
}
