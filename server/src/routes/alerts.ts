/**
 * One-click unsubscribe from race-ready emails (engagement plan D), no login needed:
 *   POST /api/alerts/unsubscribe?t=…   mail apps' one-click (List-Unsubscribe-Post)
 *   GET  /api/alerts/unsubscribe?t=…   the link in the email; turns them off, then shows the
 *                                      site's confirmation page
 * The token is signed for one user and can only turn their race emails off.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { readUnsubscribeToken, setRaceAlerts } from "../services/race-alerts.js";
import { racetraceSite } from "../services/site.js";

export const alertsRouter = Router();

async function off(req: Request): Promise<boolean> {
  const userId = readUnsubscribeToken(String(req.query.t ?? ""));
  if (!userId) return false;
  await setRaceAlerts(userId, false);
  return true;
}

alertsRouter.post("/unsubscribe", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status((await off(req)) ? 200 : 400).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

alertsRouter.get("/unsubscribe", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = await off(req);
    res.redirect(302, `${racetraceSite().url}/alerts/off${ok ? "" : "?invalid=1"}`);
  } catch (err) {
    next(err);
  }
});
