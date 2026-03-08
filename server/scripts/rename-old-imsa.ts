/**
 * Rename old-format IMSA races to new championship-prefixed format.
 * Usage: npx tsx scripts/rename-old-imsa.ts
 */
import { PrismaClient } from "@prisma/client";

const renames: [string, string][] = [
  ["cmm1io06c03oinv0dpdgpx687", "IMSA MPC — BMW M Endurance Challenge at Daytona"],
  ["cmm1inx7u0003nv0dmrnxf6e2", "IMSA MPC — Alan Jay Automotive Network 120"],
  ["cmm1inyya01lqnv0dkc92zyl0", "IMSA MPC — WeatherTech Raceway Laguna Seca 120"],
  ["cmm1j7e6q0003qx0db7vr7k9s", "IMSA MPC — O'Reilly Auto Parts 4 Hours Of Mid-Ohio"],
  ["cmm1l2v4y09ghnt0dnep46gyl", "IMSA MPC — The Esses 120 At The Glen"],
  ["cmm1l2u5l07mrnt0da2edx21e", "IMSA MPC — Canadian Tire Motorsports Park 120"],
  ["cmm1l2t6d06l7nt0d6902r5b4", "IMSA MPC — Road America 120"],
  ["cmm1l09m704kcnt0drwvrli43", "IMSA MPC — Indianapolis Motor Speedway 120"],
  ["cmm1l086o0237nt0d6zdp8k8q", "IMSA MPC — Fox Factory 120"],
  ["cmlzxjtsj0q6sqa01rzb31415", "IMSA MPC — BMW M Endurance Challenge"],
  ["cmmf6nzdm0003np0p1epa97hd", "IMSA WeatherTech — Rolex 24 at Daytona"],
];

async function main() {
  const prisma = new PrismaClient();
  try {
    let count = 0;
    for (const [id, newName] of renames) {
      const race = await prisma.race.findUnique({ where: { id }, select: { name: true } });
      if (!race) {
        console.log(`  Not found: ${id}`);
        continue;
      }
      console.log(`  "${race.name}"  →  "${newName}"`);
      await prisma.race.update({ where: { id }, data: { name: newName } });
      count++;
    }
    console.log(`\nRenamed ${count} race(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
