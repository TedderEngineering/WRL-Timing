import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...\n");

  // ── 1. Create Users ──────────────────────────────────────────────
  const adminHash = await bcrypt.hash("admin123456", 12);
  const userHash = await bcrypt.hash("user123456", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@wrllapchart.com" },
    update: {},
    create: {
      email: "admin@wrllapchart.com",
      passwordHash: adminHash,
      displayName: "Admin",
      role: "ADMIN",
      emailVerified: true,
      onboardingDone: true,
      subscription: { create: { plan: "TEAM", status: "ACTIVE" } },
    },
  });
  console.log(`✓ Admin user: ${admin.email} (${admin.id})`);

  const user = await prisma.user.upsert({
    where: { email: "user@example.com" },
    update: {},
    create: {
      email: "user@example.com",
      passwordHash: userHash,
      displayName: "Demo User",
      role: "USER",
      emailVerified: true,
      onboardingDone: true,
      subscription: { create: { plan: "FREE", status: "ACTIVE" } },
    },
  });
  console.log(`✓ Demo user: ${user.email} (${user.id})`);

  // ── 2. Load Race Data ────────────────────────────────────────────
  const dataPath = path.join(__dirname, "seed-data.json");
  const annPath = path.join(__dirname, "seed-annotations.json");

  if (!fs.existsSync(dataPath)) {
    console.log("\n⚠ seed-data.json not found — skipping race seed");
    return;
  }

  console.log("\n📊 Loading race data...");
  const rawData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  const rawAnn = fs.existsSync(annPath)
    ? JSON.parse(fs.readFileSync(annPath, "utf-8"))
    : {};

  // Check if race already exists
  const existingRace = await prisma.race.findFirst({
    where: { name: "Barber 8-Hour 2025" },
  });

  if (existingRace) {
    console.log(`✓ Race already seeded: ${existingRace.name} (${existingRace.id})`);
    return;
  }

  const carNums = Object.keys(rawData.cars);
  console.log(
    `  Cars: ${carNums.length}, Max Lap: ${rawData.maxLap}, Classes: ${Object.keys(rawData.classGroups).join(", ")}`
  );

  // Create Race record
  const race = await prisma.race.create({
    data: {
      name: "Barber 8-Hour 2025",
      date: new Date("2025-02-15"),
      track: "Barber Motorsports Park",
      series: "WRL",
      season: 2025,
      status: "PUBLISHED",
      premium: false,
      maxLap: rawData.maxLap,
      totalCars: carNums.length,
      createdBy: admin.id,
      chartData: rawData,
      annotationData: rawAnn,
    },
  });

  console.log(`✓ Race created: ${race.name} (${race.id})`);

  // Create RaceEntry records
  const entryData = carNums.map((numStr) => {
    const car = rawData.cars[numStr];
    return {
      raceId: race.id,
      carNumber: String(car.num),
      teamName: car.team,
      driverNames: "",
      carClass: car.cls,
      finishPos: car.finishPos,
      finishPosClass: car.finishPosClass,
      lapsCompleted: car.laps.length,
    };
  });

  await prisma.raceEntry.createMany({ data: entryData });
  console.log(`✓ Entries: ${entryData.length}`);

  // Create RaceLap records in batches
  let totalLaps = 0;
  const BATCH = 1000;
  let batch: any[] = [];

  for (const numStr of carNums) {
    const car = rawData.cars[numStr];
    for (const lap of car.laps) {
      batch.push({
        raceId: race.id,
        carNumber: String(car.num),
        lapNumber: lap.l,
        position: lap.p,
        classPosition: lap.cp,
        lapTimeFormatted: lap.lt,
        lapTimeSec: lap.ltSec,
        lapTimeMs: Math.round(lap.ltSec * 1000),
        flag: lap.flag,
        speed: lap.spd ?? null,
        pitStop: lap.pit === 1,
      });

      if (batch.length >= BATCH) {
        await prisma.raceLap.createMany({ data: batch });
        totalLaps += batch.length;
        batch = [];
        process.stdout.write(`\r  Laps: ${totalLaps}...`);
      }
    }
  }

  if (batch.length > 0) {
    await prisma.raceLap.createMany({ data: batch });
    totalLaps += batch.length;
  }

  console.log(`\r✓ Laps: ${totalLaps}       `);
  console.log("\n✅ Seed complete!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
