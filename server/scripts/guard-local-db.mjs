#!/usr/bin/env node
/**
 * Refuse to run a destructive database script unless DATABASE_URL points at a
 * local database (RaceTrace 2.0, G0).
 *
 * In August 2026, server/.env was found pointing at the production Supabase
 * project while `npm run db:reset` / `dev:db:reset` ran `prisma migrate reset
 * --force`. One mistyped script would have dropped the customer database.
 * `db:seed` also upserts an admin account with a default password.
 *
 * Prisma reads server/.env, so this guard reads it too, the same way.
 * Override for a deliberate, non-local target: ALLOW_REMOTE_DB_DESTRUCTIVE=yes.
 */
import "dotenv/config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal", "db", "postgres"]);
const script = process.env.npm_lifecycle_event || "this script";
const raw = process.env.DATABASE_URL;

if (!raw) {
  console.error(`✖ ${script}: DATABASE_URL is not set. Refusing to run a destructive database script.`);
  process.exit(1);
}

let host;
try {
  host = new URL(raw).hostname.toLowerCase();
} catch {
  console.error(`✖ ${script}: DATABASE_URL is not a valid URL. Refusing to run.`);
  process.exit(1);
}

if (!LOCAL_HOSTS.has(host)) {
  if (process.env.ALLOW_REMOTE_DB_DESTRUCTIVE === "yes") {
    console.warn(`⚠ ${script}: running against NON-LOCAL database host "${host}" (ALLOW_REMOTE_DB_DESTRUCTIVE=yes).`);
  } else {
    console.error(
      `✖ ${script}: DATABASE_URL points at "${host}", not a local database.\n` +
        `  This script can erase or overwrite data. Point server/.env at your local database,\n` +
        `  or set ALLOW_REMOTE_DB_DESTRUCTIVE=yes if you really mean to target "${host}".`
    );
    process.exit(1);
  }
}
