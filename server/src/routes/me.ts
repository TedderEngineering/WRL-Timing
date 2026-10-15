/**
 * The signed-in user's own things. My cars (engagement plan B):
 *   GET    /api/me/cars                     the cars the user follows
 *   POST   /api/me/cars                     add one by hand (Settings → My cars)
 *   POST   /api/me/cars/follow              { raceId, carNumber } follow a car from a race page
 *   PATCH  /api/me/cars/:id                 edit (a new number for a new season, a team…)
 *   DELETE /api/me/cars/:id                 stop following
 *   GET    /api/me/cars/in-race/:raceId     which of the race's cars the user follows
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as cars from "../services/my-cars.js";

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
