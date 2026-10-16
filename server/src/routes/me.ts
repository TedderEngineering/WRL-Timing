/**
 * The signed-in user's own things. My cars (engagement plan B):
 *   GET    /api/me/cars                     the cars the user follows
 *   POST   /api/me/cars                     add one by hand (Settings → My cars)
 *   POST   /api/me/cars/follow              { raceId, carNumber } follow a car from a race page
 *   PATCH  /api/me/cars/:id                 edit (a new number for a new season, a team…)
 *   DELETE /api/me/cars/:id                 stop following
 *   GET    /api/me/cars/in-race/:raceId     which of the race's cars the user follows
 *   PUT    /api/me/cars/order               { ids } the order of the car tabs
 * My drivers (followed across cars and series):
 *   GET    /api/me/drivers                  the drivers the user follows
 *   POST   /api/me/drivers                  { name } follow one (race page, driver search, Settings)
 *   PATCH  /api/me/drivers/:id              { alerts } race emails for this driver
 *   DELETE /api/me/drivers/:id              stop following
 *   GET    /api/me/drivers/in-race/:raceId  which of the race's drivers the user follows
 *   PUT    /api/me/drivers/order            { ids } the order of the driver tabs
 * Race-ready emails (engagement plan D):
 *   GET    /api/me/alerts                   { raceAlerts }
 *   PUT    /api/me/alerts                   { raceAlerts: boolean }
 * Chart defaults (Settings → Preferences):
 *   GET    /api/me/chart-defaults           { openOn, classView, axis, tab }
 *   PUT    /api/me/chart-defaults           any of those fields; returns all of them
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import { z } from "zod";
import * as cars from "../services/my-cars.js";
import * as drivers from "../services/my-drivers.js";
import { getRaceAlerts, setRaceAlerts } from "../services/race-alerts.js";
import { chartDefaultsPatch, getChartDefaults, setChartDefaults } from "../services/chart-defaults.js";

export const meRouter = Router();
meRouter.use(requireAuth);

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

meRouter.get("/cars", wrap(async (req, res) => {
  res.json({ cars: await cars.listCars(req.user!.userId), max: cars.MAX_CARS });
}));

meRouter.post("/cars", wrap(async (req, res) => {
  res.status(201).json({ car: await cars.createCar(req.user!.userId, req.body) });
}));

meRouter.post("/cars/follow", wrap(async (req, res) => {
  const r = await cars.followFromRace(req.user!.userId, req.body);
  res.status(r.created ? 201 : 200).json(r);
}));

meRouter.put("/cars/order", wrap(async (req, res) => {
  res.json({ cars: await cars.reorderCars(req.user!.userId, req.body) });
}));

meRouter.get("/cars/in-race/:raceId", wrap(async (req, res) => {
  res.json({ followed: await cars.followedInRace(req.user!.userId, req.params.raceId as string) });
}));

meRouter.patch("/cars/:id", wrap(async (req, res) => {
  res.json({ car: await cars.updateCar(req.user!.userId, req.params.id as string, req.body) });
}));

meRouter.delete("/cars/:id", wrap(async (req, res) => {
  await cars.deleteCar(req.user!.userId, req.params.id as string);
  res.status(204).end();
}));

meRouter.get("/drivers", wrap(async (req, res) => {
  res.json({ drivers: await drivers.listDrivers(req.user!.userId), max: drivers.MAX_DRIVERS });
}));

meRouter.post("/drivers", wrap(async (req, res) => {
  const r = await drivers.followDriver(req.user!.userId, req.body);
  res.status(r.created ? 201 : 200).json(r);
}));

meRouter.put("/drivers/order", wrap(async (req, res) => {
  res.json({ drivers: await drivers.reorderDrivers(req.user!.userId, req.body) });
}));

meRouter.get("/drivers/in-race/:raceId", wrap(async (req, res) => {
  res.json({ followed: await drivers.followedDriversInRace(req.user!.userId, req.params.raceId as string) });
}));

meRouter.patch("/drivers/:id", wrap(async (req, res) => {
  res.json({ driver: await drivers.updateDriver(req.user!.userId, req.params.id as string, req.body) });
}));

meRouter.delete("/drivers/:id", wrap(async (req, res) => {
  await drivers.deleteDriver(req.user!.userId, req.params.id as string);
  res.status(204).end();
}));

meRouter.get("/alerts", wrap(async (req, res) => {
  res.json({ raceAlerts: await getRaceAlerts(req.user!.userId) });
}));

meRouter.put("/alerts", wrap(async (req, res) => {
  const { raceAlerts } = z.object({ raceAlerts: z.boolean() }).parse(req.body);
  await setRaceAlerts(req.user!.userId, raceAlerts);
  res.json({ raceAlerts });
}));

meRouter.get("/chart-defaults", wrap(async (req, res) => {
  res.json(await getChartDefaults(req.user!.userId));
}));

meRouter.put("/chart-defaults", wrap(async (req, res) => {
  res.json(await setChartDefaults(req.user!.userId, chartDefaultsPatch.parse(req.body)));
}));
