import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import { Prisma } from "@prisma/client";

interface RaceListParams {
  page: number;
  pageSize: number;
  series?: string;
  track?: string;
  season?: number;
  status?: "DRAFT" | "PUBLISHED";
  search?: string;
  sortBy: "date" | "name" | "createdAt";
  sortOrder: "asc" | "desc";
}

// ─── List Races ──────────────────────────────────────────────────────────────

export async function listRaces(params: RaceListParams, userId?: string) {
  const where: Prisma.RaceWhereInput = {};

  // Non-admins only see published races
  if (params.status) {
    where.status = params.status;
  } else {
    where.status = "PUBLISHED";
  }

  if (params.series) where.series = params.series;
  if (params.track) where.track = { contains: params.track, mode: "insensitive" };
  if (params.season) where.season = params.season;
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { track: { contains: params.search, mode: "insensitive" } },
      { series: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const [races, total] = await prisma.$transaction([
    prisma.race.findMany({
      where,
      select: {
        id: true,
        name: true,
        date: true,
        track: true,
        series: true,
        season: true,
        status: true,
        premium: true,
        maxLap: true,
        totalCars: true,
        createdAt: true,
        _count: { select: { entries: true, favorites: true } },
        ...(userId
          ? {
              favorites: {
                where: { userId },
                select: { userId: true },
              },
            }
          : {}),
      },
      orderBy: { [params.sortBy]: params.sortOrder },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.race.count({ where }),
  ]);

  return {
    races: races.map((r: any) => ({
      id: r.id,
      name: r.name,
      date: r.date.toISOString(),
      track: r.track,
      series: r.series,
      season: r.season,
      status: r.status,
      premium: r.premium,
      maxLap: r.maxLap,
      totalCars: r.totalCars,
      entryCount: r._count.entries,
      favoriteCount: r._count.favorites,
      isFavorited: userId ? r.favorites?.length > 0 : false,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil(total / params.pageSize),
  };
}

// ─── List Races (Admin — includes drafts, lap counts) ────────────────────────

export async function listRacesAdmin(params: RaceListParams) {
  const where: Prisma.RaceWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.series) where.series = params.series;
  if (params.season) where.season = params.season;
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { track: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const [races, total] = await prisma.$transaction([
    prisma.race.findMany({
      where,
      select: {
        id: true,
        name: true,
        date: true,
        track: true,
        series: true,
        season: true,
        status: true,
        premium: true,
        maxLap: true,
        totalCars: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { entries: true, laps: true, favorites: true } },
      },
      orderBy: { [params.sortBy]: params.sortOrder },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.race.count({ where }),
  ]);

  return {
    races: races.map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date.toISOString(),
      track: r.track,
      series: r.series,
      season: r.season,
      status: r.status,
      premium: r.premium,
      maxLap: r.maxLap,
      totalCars: r.totalCars,
      entryCount: r._count.entries,
      lapCount: r._count.laps,
      favoriteCount: r._count.favorites,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil(total / params.pageSize),
  };
}

// ─── Get Race Detail ─────────────────────────────────────────────────────────

export async function getRaceDetail(raceId: string, userId?: string) {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    select: {
      id: true,
      name: true,
      date: true,
      track: true,
      series: true,
      season: true,
      status: true,
      premium: true,
      maxLap: true,
      totalCars: true,
      createdAt: true,
      entries: {
        select: {
          carNumber: true,
          teamName: true,
          carClass: true,
          finishPos: true,
          finishPosClass: true,
          lapsCompleted: true,
        },
        orderBy: { finishPos: "asc" },
      },
      _count: { select: { favorites: true } },
      ...(userId
        ? {
            favorites: {
              where: { userId },
              select: { userId: true },
            },
          }
        : {}),
    },
  });

  if (!race) {
    throw new AppError(404, "Race not found", "RACE_NOT_FOUND");
  }

  return {
    id: race.id,
    name: race.name,
    date: race.date.toISOString(),
    track: race.track,
    series: race.series,
    season: race.season,
    status: race.status,
    premium: race.premium,
    maxLap: race.maxLap,
    totalCars: race.totalCars,
    favoriteCount: race._count.favorites,
    isFavorited: userId ? (race as any).favorites?.length > 0 : false,
    createdAt: race.createdAt.toISOString(),
    entries: race.entries,
  };
}

// ─── Get Chart Data ──────────────────────────────────────────────────────────

export async function getChartData(raceId: string) {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    select: {
      id: true,
      name: true,
      date: true,
      track: true,
      series: true,
      season: true,
      status: true,
      premium: true,
      chartData: true,
      annotationData: true,
    },
  });

  if (!race) {
    throw new AppError(404, "Race not found", "RACE_NOT_FOUND");
  }

  if (!race.chartData) {
    throw new AppError(404, "No chart data available for this race", "NO_CHART_DATA");
  }

  return {
    race: {
      id: race.id,
      name: race.name,
      date: race.date.toISOString(),
      track: race.track,
      series: race.series,
      season: race.season,
    },
    data: race.chartData,
    annotations: race.annotationData || {},
  };
}

// ─── Get Entries ─────────────────────────────────────────────────────────────

export async function getRaceEntries(raceId: string) {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    select: { id: true },
  });
  if (!race) throw new AppError(404, "Race not found", "RACE_NOT_FOUND");

  return prisma.raceEntry.findMany({
    where: { raceId },
    orderBy: { finishPos: "asc" },
  });
}

// ─── Update Race ─────────────────────────────────────────────────────────────

export async function updateRace(
  raceId: string,
  data: {
    name?: string;
    date?: Date;
    track?: string;
    series?: string;
    season?: number;
    status?: "DRAFT" | "PUBLISHED";
    premium?: boolean;
  }
) {
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race) throw new AppError(404, "Race not found", "RACE_NOT_FOUND");

  return prisma.race.update({ where: { id: raceId }, data });
}

// ─── Delete Race ─────────────────────────────────────────────────────────────

export async function deleteRace(raceId: string) {
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race) throw new AppError(404, "Race not found", "RACE_NOT_FOUND");

  // Cascade delete handles entries, laps, favorites, views
  await prisma.race.delete({ where: { id: raceId } });
  return race;
}

// ─── Favorites ───────────────────────────────────────────────────────────────

export async function toggleFavorite(
  userId: string,
  raceId: string
): Promise<boolean> {
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race) throw new AppError(404, "Race not found", "RACE_NOT_FOUND");

  const existing = await prisma.userFavorite.findUnique({
    where: { userId_raceId: { userId, raceId } },
  });

  if (existing) {
    await prisma.userFavorite.delete({
      where: { userId_raceId: { userId, raceId } },
    });
    return false; // unfavorited
  } else {
    await prisma.userFavorite.create({
      data: { userId, raceId },
    });
    return true; // favorited
  }
}

// ─── Record View ─────────────────────────────────────────────────────────────

export async function recordView(userId: string, raceId: string) {
  await prisma.userRaceView.create({
    data: { userId, raceId },
  });
}

// ─── Distinct filter values ──────────────────────────────────────────────────

export async function getFilterOptions() {
  const [series, tracks, seasons] = await prisma.$transaction([
    prisma.race.findMany({
      where: { status: "PUBLISHED" },
      select: { series: true },
      distinct: ["series"],
      orderBy: { series: "asc" },
    }),
    prisma.race.findMany({
      where: { status: "PUBLISHED" },
      select: { track: true },
      distinct: ["track"],
      orderBy: { track: "asc" },
    }),
    prisma.race.findMany({
      where: { status: "PUBLISHED" },
      select: { season: true },
      distinct: ["season"],
      orderBy: { season: "desc" },
    }),
  ]);

  return {
    series: series.map((s) => s.series),
    tracks: tracks.map((t) => t.track),
    seasons: seasons.map((s) => s.season),
  };
}
