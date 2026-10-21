/**
 * The one way out of a race panel on the dashboard (a weekend's recap, a followed car's race, a
 * followed driver's race), the same everywhere so it is found without looking:
 *
 *   [▲ Position Trace]  [Story]  [Pit stops]                  quiet actions (share, copy)
 *
 * The Position Trace is the one filled button: the main thing RaceTrace shows, and the next step
 * from any race. Story and Pit stops follow as outlined buttons in that order. Sharing and saving
 * sit apart and quieter. On a phone the Position Trace spans the width and every target is at
 * least 44 px tall.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const icon = "h-4 w-4 shrink-0";

export function TraceIcon() {
  return (
    <svg className={icon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1.5 12.5 5 7.5l3 2.5 3-6 3.5 2.5" />
    </svg>
  );
}

function StoryIcon() {
  return (
    <svg className={icon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 3h4a1.5 1.5 0 0 1 1.5 1.5V13a1 1 0 0 0-1-1H2.5zM13.5 3h-4A1.5 1.5 0 0 0 8 4.5V13a1 1 0 0 1 1-1h4.5z" />
    </svg>
  );
}

function PitIcon() {
  return (
    <svg className={icon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="9" r="5.5" />
      <path d="M8 9V6.2M6.5 1.5h3M12.2 4.4l1-1" />
    </svg>
  );
}

const base = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors sm:min-h-[40px]";
const primary = `${base} w-full bg-[var(--rt-accent)] text-[var(--rt-on-accent)] shadow-sm hover:brightness-110 sm:w-auto`;
const secondary = `${base} border border-[var(--rt-border)] text-[var(--rt-text)] hover:border-[var(--rt-accent)] hover:text-[var(--rt-accent)]`;

export interface RaceActionsProps {
  /** The race's Position Trace (with the car, when the panel is about one). */
  trace: string;
  /** Story: shown in the panel (a toggle), or opened on the race page (a link). */
  story?: { expanded: boolean; onToggle: () => void } | { href: string };
  /** The race's Pit Stops tab. */
  pits?: string;
  /** Called when the visitor leaves for the race page (dashboard analytics). */
  onOpen?: () => void;
  /** Sharing and saving: right-aligned, quieter. */
  more?: ReactNode;
  /** A small note at the end of the row. */
  note?: ReactNode;
}

export function RaceActions({ trace, story, pits, onOpen, more, note }: RaceActionsProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
      <Link to={trace} onClick={onOpen} className={primary}>
        <TraceIcon />
        Position Trace
      </Link>
      {(story || pits) && (
        <div className={`grid gap-2 sm:flex sm:gap-2.5 ${story && pits ? "grid-cols-2" : "grid-cols-1"}`}>
          {story &&
            ("href" in story ? (
              <Link to={story.href} onClick={onOpen} className={secondary}>
                <StoryIcon />
                Story
              </Link>
            ) : (
              <button type="button" aria-expanded={story.expanded} onClick={story.onToggle} className={secondary}>
                <StoryIcon />
                {story.expanded ? "Show less" : "Story"}
              </button>
            ))}
          {pits && (
            <Link to={pits} onClick={onOpen} className={secondary}>
              <PitIcon />
              Pit stops
            </Link>
          )}
        </div>
      )}
      {(more || note) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[13px] text-[var(--rt-text-secondary)] sm:ml-auto sm:pt-0">
          {more}
          {note && <span className="text-xs text-[var(--rt-text-muted)]">{note}</span>}
        </div>
      )}
    </div>
  );
}
