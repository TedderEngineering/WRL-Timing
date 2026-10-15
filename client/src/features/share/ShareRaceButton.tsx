import { shareLink, sharedUrl } from "./shareLink";
import { useShareFeedback } from "./ShareRaceTrace";

/**
 * "Share" on a race page: the share sheet (or the copied message and link) for this race,
 * tagged ?from=share like every shared RaceTrace link. The link is /r/:id, whose page gives chat
 * apps the race's own title (server routes/share.ts). Sends share_app { source: "race" }.
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
            // /r/:id gives chat apps the race's own preview, then opens the race.
            url: sharedUrl(`${window.location.origin}/r/${encodeURIComponent(raceId)}`),
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
