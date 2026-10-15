/**
 * Link previews for shared races (engagement plan G).
 *
 *   GET /api/share/r/:raceId[?car=67]   (served at racetrace…/r/:raceId by a Vercel rewrite)
 *
 * Chat apps (WhatsApp, Messages, Facebook) read Open Graph tags without running JavaScript, so
 * the single-page app can only ever show the site's own preview. This page states the race
 * (and the car's finish when one is named) in its tags, then sends people on to the race on
 * Position Trace (a meta refresh: the API's CSP allows no inline script), keeping the
 * ?from=share tag so the visit is counted once there.
 * Published races only; anything else goes to the home page.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../models/prisma.js";
import { escapeHtml } from "../services/email.js";
import { racetraceSite } from "../services/site.js";
import { carFacts } from "../dashboard/my-car.js";
import { canonicalTrack } from "../lib/weekends.js";

export const shareRouter = Router();

const DESCRIPTION = "Free lap charts, position traces, pit cycles and race stories for WRL, IMSA and SRO races.";

export function sharePage(p: { title: string; description: string; url: string; target: string; image: string }): string {
  const t = escapeHtml(p.title);
  const d = escapeHtml(p.description);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="RaceTrace" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${escapeHtml(p.url)}" />
<meta property="og:image" content="${escapeHtml(p.image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${escapeHtml(p.image)}" />
<link rel="canonical" href="${escapeHtml(p.url)}" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(p.target)}" />
</head><body style="background:#0b0b18;color:#e0e0e8;font-family:sans-serif">
<p><a href="${escapeHtml(p.target)}" style="color:#F48C34">Open the race on RaceTrace</a></p>
</body></html>`;
}

shareRouter.get("/r/:raceId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const site = racetraceSite().url;
    const raceId = String(req.params.raceId);
    const carParam = typeof req.query.car === "string" && /^[0-9A-Za-z]{1,8}$/.test(req.query.car) ? req.query.car : null;
    const race = (await prisma.race.findUnique({
      where: { id: raceId },
      select: { id: true, name: true, date: true, track: true, status: true, resultsStatus: true, ...(carParam ? { chartData: true, annotationData: true } : {}) },
    })) as any;
    if (!race || race.status !== "PUBLISHED") {
      res.redirect(302, `${site}/?from=share`);
      return;
    }
    const date = new Date(race.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    let title = `${race.name} · RaceTrace`;
    let description = `${canonicalTrack(race.track)} · ${date}. Position trace, pit stops and lap times. ${DESCRIPTION}`;
    const f = carParam && race.chartData ? carFacts(race.chartData, race.annotationData ?? null, carParam) : null;
    if (f) {
      const finish = f.finishClass !== null ? `P${f.finishClass} in ${f.cls}` : f.status === "dsq" ? "Disqualified" : f.status === "dnf" ? "Did not finish" : "Not classified";
      title = `#${f.number} ${f.team}: ${finish} · ${race.name}`;
      description = [`${canonicalTrack(race.track)} · ${date}`, ...f.benchmarks].join(" · ") + ". On RaceTrace.";
    }
    const query = `race=${encodeURIComponent(race.id)}${f ? `&car=${encodeURIComponent(carParam!)}` : ""}`;
    res.set("Cache-Control", "public, max-age=300");
    res.type("html").send(
      sharePage({
        title,
        description,
        url: `${site}/r/${encodeURIComponent(race.id)}${f ? `?car=${encodeURIComponent(carParam!)}` : ""}`,
        target: `${site}/chart?${query}&from=share`,
        image: `${site}/racetrace-og.png`,
      })
    );
  } catch (err) {
    next(err);
  }
});
