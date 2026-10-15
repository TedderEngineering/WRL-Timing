/**
 * "Your 2026 on Finding Grip": the season recap card on the dashboard
 * (ENGAGEMENT_PRINCIPLES step 6). Shown from 20 November to the end of
 * January; `?season=2026` on the dashboard shows it any time (for checking).
 *
 * Facts from the driver's own runs only: no praise, no ranking against other
 * drivers, nothing about streaks. A short teaser opens to the full recap; the
 * season's one coffee ask comes at its end, under the usual caps. Hide keeps
 * it hidden for that year.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  drawText,
  imageName,
  makeShareCard,
  roundRect,
  useShareCard,
  type Box,
  type SiteStyle,
} from "@/features/share";
import { SupportAsk } from "@/features/support/SupportPrompts";
import { gp } from "@/lib/site";
import { gripApi, type Season } from "./api";
import { Card, GripButton } from "./components";
import { readUi, writeUi } from "./engagement";
import { useGrip } from "./GripContext";
import { useLoad } from "./hooks";
import { formatPressure, pressureUnit, type Units } from "./units";

// ─── When it shows ───────────────────────────────────────────────────────────

/** The year whose recap is shown on `now`: Nov 20–Dec 31 that year, January the year before. */
export function recapYearFor(now: Date): number | null {
  const m = now.getMonth();
  const y = now.getFullYear();
  if (m === 10 && now.getDate() >= 20) return y;
  if (m === 11) return y;
  if (m === 0) return y - 1;
  return null;
}

/** `?season=2026` (for checking before 20 November). */
export function previewYear(search: string, now = new Date()): number | null {
  const v = Number(new URLSearchParams(search).get("season"));
  return Number.isInteger(v) && v >= 2020 && v <= now.getFullYear() ? v : null;
}

// ─── Wording (shared by the card and the image) ──────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "2026-04-10" as a local date, so it doesn't shift a day west of UTC. */
const dayDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shortDay = (ymd: string) =>
  dayDate(ymd).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "14 calculations at 3 tracks over 9 track days." */
export function seasonHeadline(s: Season): string {
  return `${plural(s.calculations, "calculation")} at ${plural(s.tracks.length, "track")} over ${plural(s.trackDays, "track day")}.`;
}

/** "INDY R1 at VIR, Oct 10: within 0.1 PSI on all four corners" (without the date: "INDY R1 at VIR, within …"). */
export function closestText(s: Season, units: Units, withDate = true): string | null {
  const c = s.closest;
  if (!c) return null;
  const miss = `${formatPressure(c.worstMiss, units)} ${pressureUnit(units)}`;
  const when = withDate
    ? `, ${new Date(c.sessionDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "";
  const how =
    c.worstMiss < 0.05
      ? "on target on all four corners"
      : c.onTarget
        ? `within ${miss} on all four corners`
        : `worst corner ${miss} off`;
  const where = `${c.name} at ${c.track.shortName || c.track.name}`;
  return withDate ? `${where}${when}: ${how}` : `${where}, ${how}`;
}

// ─── Share image ─────────────────────────────────────────────────────────────

function drawSeason(
  ctx: CanvasRenderingContext2D,
  box: Box,
  style: SiteStyle,
  s: Season
) {
  // Four tiles: calculations, track days, tracks, on target.
  const gap = 24;
  const tileW = (box.w - gap) / 2;
  const tileH = 190;
  const tiles: [string, string][] = [
    [s.calculations.toLocaleString("en-US"), "CALCULATIONS"],
    [s.trackDays.toLocaleString("en-US"), "TRACK DAYS"],
    [s.tracks.length.toLocaleString("en-US"), s.tracks.length === 1 ? "TRACK" : "TRACKS"],
    s.recorded > 0
      ? [`${s.onTarget}/${s.recorded}`, "RECORDED RUNS ON TARGET"]
      : [s.referenceSessions.toLocaleString("en-US"), "REFERENCE SESSIONS"],
  ];
  tiles.forEach(([value, label], i) => {
    const x = box.x + (i % 2) * (tileW + gap);
    const y = box.y + Math.floor(i / 2) * (tileH + gap);
    roundRect(ctx, x, y, tileW, tileH, 28);
    ctx.fillStyle = style.panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = style.border;
    ctx.stroke();
    drawText(ctx, value, x + 32, y + 112, {
      size: 92,
      weight: 700,
      font: "mono",
      color: i === 3 && s.recorded > 0 ? style.good : style.accent,
      maxWidth: tileW - 64,
    });
    drawText(ctx, label, x + 32, y + 160, {
      size: 24,
      weight: 700,
      color: style.muted,
      maxWidth: tileW - 64,
    });
  });

  // Tracks, most days first.
  let y = box.y + tileH * 2 + gap + 72;
  drawText(ctx, "TRACKS", box.x, y, { size: 24, weight: 700, color: style.muted });
  y += 20;
  const rows = s.tracks.slice(0, 4);
  const rowH = Math.min(62, (box.y + box.h - y) / Math.max(rows.length, 1));
  for (const t of rows) {
    y += rowH;
    drawText(ctx, t.track.name, box.x, y, {
      size: 34,
      weight: 600,
      color: style.text,
      maxWidth: box.w * 0.6,
    });
    const right =
      t.recorded > 0
        ? `${plural(t.days, "day")} · ${t.onTarget}/${t.recorded} on target`
        : plural(t.days, "day");
    drawText(ctx, right, box.x + box.w, y, {
      size: 28,
      weight: 500,
      color: style.muted,
      align: "right",
      maxWidth: box.w * 0.38,
    });
  }
  if (s.tracks.length > rows.length) {
    drawText(
      ctx,
      `+ ${plural(s.tracks.length - rows.length, "more track")}`,
      box.x,
      y + 48,
      {
        size: 26,
        weight: 500,
        color: style.muted,
      }
    );
  }
}

/** The PNG for a season. Results only, never how they were calculated. */
export function makeSeasonCard(s: Season, units: Units): Promise<Blob> {
  const closest = closestText(s, units, false);
  return makeShareCard({
    site: "findinggrip",
    title: `My ${s.year} season`,
    subtitle: seasonHeadline(s).replace(/\.$/, ""),
    body: (ctx, box, style) => drawSeason(ctx, box, style, s),
    fact: closest
      ? { text: `Closest: ${closest}`, tone: s.closest?.onTarget ? "good" : "neutral" }
      : undefined,
  });
}

// ─── The card ────────────────────────────────────────────────────────────────

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2.5">
      <div className="text-2xl font-extrabold tabular-nums text-gray-900 dark:text-gray-50">
        {value}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
    </div>
  );
}

export function SeasonRecapCard({ year }: { year: number }) {
  const { units, toast } = useGrip();
  const season = useLoad(() => gripApi.season(year), [year]);
  const [hidden, setHidden] = useState(() => readUi().recapHiddenYear === year);
  const [open, setOpen] = useState(false);
  const { share, busy } = useShareCard();

  const s = season.data;
  if (hidden || !s || s.calculations + s.referenceSessions === 0) return null;
  const pu = pressureUnit(units);
  const closest = closestText(s, units);

  const hide = () => {
    writeUi({ recapHiddenYear: year });
    setHidden(true);
  };
  const shareSeason = async () => {
    try {
      const method = await share({
        make: () => makeSeasonCard(s, units),
        filename: imageName("finding-grip", `season-${s.year}`),
        text: `My ${s.year} season · Finding Grip`,
        kind: "season",
      });
      if (method === "download") toast("Image saved.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not make the image");
    }
  };

  return (
    <section aria-labelledby="season-title">
      <Card className="space-y-4 !border-grip-500/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-grip-600 dark:text-grip-400">
              Your {s.year}
            </div>
            <h2
              id="season-title"
              className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50"
            >
              Your {s.year} on Finding Grip
            </h2>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              {seasonHeadline(s)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <GripButton
              size="sm"
              variant={open ? "secondary" : "primary"}
              aria-expanded={open}
              aria-controls="season-detail"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Close" : "See your season"}
            </GripButton>
            {!open && (
              <GripButton size="sm" variant="ghost" onClick={hide}>
                Hide
              </GripButton>
            )}
          </div>
        </div>

        {open && (
          <div id="season-detail" className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat value={s.calculations.toLocaleString("en-US")} label="Calculations" />
              <Stat
                value={s.referenceSessions.toLocaleString("en-US")}
                label="Reference sessions"
              />
              <Stat value={s.trackDays.toLocaleString("en-US")} label="Track days" />
              <Stat value={s.tracks.length.toLocaleString("en-US")} label="Tracks" />
            </div>

            {s.recorded > 0 && (
              <p className="text-sm text-gray-700 dark:text-gray-300">
                On target in <b>{s.onTarget}</b> of {plural(s.recorded, "recorded run")}
                {s.averageWorstMiss !== null &&
                  `; worst corner off by ${formatPressure(s.averageWorstMiss, units)} ${pu} on average`}
                .
              </p>
            )}
            {closest && s.closest && (
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Closest run:{" "}
                <Link
                  to={gp(`/calculations/${s.closest.id}/outcome`)}
                  className="font-semibold text-grip-600 dark:text-grip-400 hover:underline"
                >
                  {closest}
                </Link>
                .
              </p>
            )}

            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {s.tracks.map((t) => (
                <li key={t.track.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">
                    {t.track.name}
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums text-gray-600 dark:text-gray-400">
                    {plural(t.days, "day")}
                    {t.recorded > 0 && (
                      <span className="block text-[11px] text-gray-500">
                        {t.onTarget} of {t.recorded} on target
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {s.firstDate && s.lastDate && (
              <p className="text-xs text-gray-500">
                {s.firstDate === s.lastDate
                  ? `One day: ${dayDate(s.firstDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`
                  : `From ${shortDay(s.firstDate)} to ${shortDay(s.lastDate)}.`}{" "}
                Your own runs only; nobody else sees this unless you share it.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <GripButton
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={shareSeason}
              >
                Share your season
              </GripButton>
            </div>

            {/* The season's one coffee ask, at the end of the recap (usual caps apply). */}
            <SupportAsk
              lead={`That's your ${s.year}.`}
              body={`I'm Brent, and I build Finding Grip. It's free, with no ads. If it helped your season, a coffee keeps it running for ${s.year + 1}.`}
              from="season"
            />
          </div>
        )}
      </Card>
    </section>
  );
}
