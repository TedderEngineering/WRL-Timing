import type { Prisma } from "@prisma/client";

/** One condition per search word; "R1" also matches "Race 1", "GR_CUP" matches "GR Cup". */
export function adminSearchWords(search: string): Prisma.RaceWhereInput[] {
  return search
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const variants = new Set([word, word.replace(/_/g, " ")]);
      const r = word.match(/^R(\d+)$/i);
      if (r) variants.add(`Race ${r[1]}`);
      return {
        OR: [...variants].flatMap((v) => [
          { name: { contains: v, mode: "insensitive" as const } },
          { track: { contains: v, mode: "insensitive" as const } },
          { series: { contains: v, mode: "insensitive" as const } },
        ]),
      };
    });
}
