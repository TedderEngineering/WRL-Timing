/**
 * Fix MX-5 Cup races: wrong series name + old naming format.
 */
import { PrismaClient } from "@prisma/client";

const fixes = [
  { id: "cmmcalyvz010lpb0phi5ffdc7", name: "MX-5 Cup Race 2 — Grand Prix of St. Petersburg", series: "IMSA" },
  { id: "cmmcalxoz00d4pb0pg2tg0fxp", name: "MX-5 Cup Race 1 — Grand Prix of St. Petersburg", series: "IMSA" },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const fix of fixes) {
      const race = await prisma.race.findUnique({ where: { id: fix.id }, select: { name: true, series: true } });
      if (!race) { console.log(`Not found: ${fix.id}`); continue; }
      console.log(`  "${race.series}: ${race.name}"  →  "${fix.series}: ${fix.name}"`);
      await prisma.race.update({ where: { id: fix.id }, data: { name: fix.name, series: fix.series } });
    }
    console.log("Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
