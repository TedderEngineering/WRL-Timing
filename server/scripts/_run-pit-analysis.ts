import { analyzeRacePitStops } from "../src/services/pitStopAnalysis.service.js";
import { prisma } from "../src/models/prisma.js";

const raceId = process.argv[2];
if (!raceId) {
  // Find Barber Saturday 8-Hour
  const race = await prisma.race.findFirst({
    where: { name: { contains: "Saturday 8" }, track: { contains: "Barber" } },
    select: { id: true, name: true, date: true },
  });
  if (!race) {
    console.error("No Barber Saturday 8-Hour race found");
    process.exit(1);
  }
  console.log(`Found race: ${race.name} (${race.id}) ${race.date}`);
  const result = await analyzeRacePitStops(race.id);
  console.log(JSON.stringify(result, null, 2));
} else {
  const result = await analyzeRacePitStops(raceId);
  console.log(JSON.stringify(result, null, 2));
}

await prisma.$disconnect();
