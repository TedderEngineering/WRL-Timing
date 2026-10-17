/**
 * The site's live banner: which session to show and what it says. Live sessions first (a race
 * before qualifying before practice), then the next scheduled session within a day and a half,
 * then a session that ended in the last two hours.
 */
export type SessionKind = "race" | "qualify" | "practice";

export interface LiveListed {
  slug: string;
  eventName: string;
  sessionName: string;
  track: string;
  startedAt: string | null;
  endedAt: string | null;
  kind: SessionKind;
  status?: { leaderLap: number; flag: string | null } | null;
}

export interface UpcomingListed {
  id: string;
  series: string;
  eventName: string;
  sessionName: string;
  track: string;
  kind: SessionKind;
  startsAt: string;
  endsAt: string;
}

export interface LiveListing {
  sessions: LiveListed[];
  upcoming?: UpcomingListed[];
  recent?: LiveListed[];
}

export interface Banner {
  /** Dismissals key on this: the same session in a new state shows again. */
  key: string;
  state: "live" | "upcoming" | "finished";
  /** "LIVE", "Tomorrow 8:00 AM EDT", "Starts in 42 min", "Finished". */
  when: string;
  /** "WRL Sebring · Race 2 · 7 Hour" */
  what: string;
  /** "Lap 112 · Green" while live. */
  detail: string | null;
  action: string;
  to: string;
  /** More live sessions than the one shown. */
  more: number;
}

const KIND_ORDER: Record<SessionKind, number> = { race: 0, qualify: 1, practice: 2 };

/** "Sebring International Raceway 2026" → "Sebring" (the series name goes in front). */
export function shortEvent(eventName: string, track: string): string {
  const base = (track || eventName).replace(/\s+\d{4}$/, "");
  return base.replace(/\s+(International\s+)?(Raceway|Motorsports Park|Motor Speedway|Speedway|Circuit|Park)$/i, "").trim() || base;
}

/** "Today 8:00 AM EDT", "Tomorrow 8:00 AM EDT", "Sun 8:00 AM EDT"; under an hour "Starts in 42 min". */
export function whenText(startsAt: string, now: number, timeZone?: string): string {
  const t = Date.parse(startsAt);
  const mins = Math.round((t - now) / 60_000);
  if (mins <= 0) return "Starting now";
  if (mins < 60) return `Starts in ${mins} min`;
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone, ...o });
  const day = (ms: number) => fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const time = fmt({ hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(t);
  if (day(t) === day(now)) return `Today ${time}`;
  if (day(t) === day(now + 86_400_000)) return `Tomorrow ${time}`;
  return `${fmt({ weekday: "short" }).format(t)} ${time}`;
}

const kindWord = (k: SessionKind) => (k === "qualify" ? "Qualifying" : k === "practice" ? "Practice" : "Race");

export function bannerFor(list: LiveListing | null, now: number, timeZone?: string): Banner | null {
  if (!list) return null;
  const live = [...list.sessions].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  if (live.length) {
    const s = live[0];
    const lap = s.status?.leaderLap ? `Lap ${s.status.leaderLap}` : null;
    const flag = s.status?.flag ?? null;
    // A session's name usually says what it is ("GTO/GTU Qualifying"); a race's may not.
    const name = s.kind !== "race" || /race|hour/i.test(s.sessionName) ? s.sessionName : `${kindWord(s.kind)} · ${s.sessionName}`;
    return {
      key: `live:${s.slug}`,
      state: "live",
      when: "LIVE",
      what: `WRL ${shortEvent(s.eventName, s.track)} · ${name}`,
      detail: [lap, flag].filter(Boolean).join(" · ") || null,
      action: "Watch live",
      to: `/live/${s.slug}`,
      more: live.length - 1,
    };
  }
  const next = (list.upcoming ?? [])[0];
  if (next) {
    return {
      key: `upcoming:${next.id}`,
      state: "upcoming",
      when: whenText(next.startsAt, now, timeZone),
      what: `${next.series} ${shortEvent(next.eventName, next.track)} · ${next.sessionName}`,
      detail: null,
      action: "Live timing here",
      to: "/live",
      more: 0,
    };
  }
  const done = [...(list.recent ?? [])].sort((a, b) => Date.parse(b.endedAt ?? "") - Date.parse(a.endedAt ?? ""))[0];
  if (done) {
    return {
      key: `finished:${done.slug}`,
      state: "finished",
      when: "Finished",
      what: `WRL ${shortEvent(done.eventName, done.track)} · ${done.sessionName}`,
      detail: null,
      action: "See how it ended",
      to: `/live/${done.slug}`,
      more: 0,
    };
  }
  return null;
}
