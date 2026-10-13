/**
 * The hand-written migration for G4 must match schema.prisma exactly (CI runs
 * `prisma migrate diff --exit-code`; Prisma cannot run in every workspace).
 * Every column, index and foreign key of the new model and fields is checked.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const PRISMA = fileURLToPath(new URL("../../../prisma/", import.meta.url));
const schema = readFileSync(join(PRISMA, "schema.prisma"), "utf-8");
const MIG = "20261013000000_add_intake_source_key_api_tokens";
const sql = readFileSync(join(PRISMA, "migrations", MIG, "migration.sql"), "utf-8");

function model(name: string): string {
  const m = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${name} not found`);
  return m[1];
}

/** Scalar fields of a model: [field, column, prismaType, optional]. */
function scalarFields(body: string): { field: string; column: string; type: string; optional: boolean; attrs: string }[] {
  const out = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    const m = line.match(/^(\w+)\s+(String|Int|Boolean|DateTime|Json|Float|BigInt)(\[\])?(\?)?\s*(.*)$/);
    if (!m) continue;
    const map = m[5].match(/@map\("([^"]+)"\)/);
    out.push({ field: m[1], column: map ? map[1] : m[1], type: m[2] + (m[3] ?? ""), optional: !!m[4], attrs: m[5] });
  }
  return out;
}

const PG: Record<string, string> = { String: "TEXT", "String[]": "TEXT[]", DateTime: "TIMESTAMP(3)", Int: "INTEGER", Boolean: "BOOLEAN" };

describe(`migration ${MIG}`, () => {
  it("adds Race.sourceKey (unique), sourceVersion and resultsStatus as nullable TEXT", () => {
    const race = scalarFields(model("Race"));
    for (const f of ["sourceKey", "sourceVersion", "resultsStatus"]) {
      const d = race.find((x) => x.field === f)!;
      expect(d, f).toBeDefined();
      expect(d.optional).toBe(true);
      expect(sql).toMatch(new RegExp(`ADD COLUMN\\s+"${d.column}" TEXT(,|;)`));
    }
    expect(race.find((x) => x.field === "sourceKey")!.attrs).toMatch(/@unique/);
    expect(sql).toContain('CREATE UNIQUE INDEX "races_source_key_key" ON "races"("source_key");');
    expect(sql).toMatch(/ALTER TABLE "races" ADD COLUMN/);
  });

  it("creates api_tokens with every column of model ApiToken, with matching types and nullability", () => {
    const body = model("ApiToken");
    expect(body).toMatch(/@@map\("api_tokens"\)/);
    const create = sql.match(/CREATE TABLE "api_tokens" \(([\s\S]*?)\n\);/)![1];
    const cols = Object.fromEntries(
      create
        .split("\n")
        .map((l) => l.trim().replace(/,$/, ""))
        .filter((l) => l.startsWith('"'))
        .map((l) => [l.match(/^"([^"]+)"/)![1], l])
    );
    const fields = scalarFields(body);
    expect(Object.keys(cols).sort()).toEqual(fields.map((f) => f.column).sort());
    for (const f of fields) {
      const def = cols[f.column];
      expect(def.startsWith(`"${f.column}" ${PG[f.type]}`), `${f.column}: ${def}`).toBe(true);
      // Prisma: scalar lists are nullable columns; required scalars are NOT NULL.
      const notNull = !f.optional && !f.type.endsWith("[]");
      expect(def.includes("NOT NULL"), `${f.column} NOT NULL`).toBe(notNull);
      if (/@default\(now\(\)\)/.test(f.attrs)) expect(def).toContain("DEFAULT CURRENT_TIMESTAMP");
      if (/@default\(\[\]\)/.test(f.attrs)) expect(def).toContain("DEFAULT ARRAY[]::TEXT[]");
    }
    expect(create).toContain('CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")');
  });

  it("has the unique token hash, the creator index and the cascading foreign key", () => {
    expect(model("ApiToken")).toMatch(/tokenHash\s+String\s+@unique/);
    expect(sql).toContain('CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");');
    expect(model("ApiToken")).toMatch(/@@index\(\[createdById\]\)/);
    expect(sql).toContain('CREATE INDEX "api_tokens_created_by_id_idx" ON "api_tokens"("created_by_id");');
    expect(model("ApiToken")).toMatch(/onDelete: Cascade/);
    expect(sql).toContain(
      'ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;'
    );
    expect(model("User")).toMatch(/apiTokens\s+ApiToken\[\]\s+@relation\("ApiTokenCreator"\)/);
  });

  it("is additive only: no DROP, no ALTER of existing columns, RLS on the new table", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    expect(sql).toContain('ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;');
  });
});
