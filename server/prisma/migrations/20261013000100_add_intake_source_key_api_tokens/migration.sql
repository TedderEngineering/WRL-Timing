-- Machine intake (RaceTrace 2.0, G4): a stable source key per race so reruns
-- update the same race, and hashed API tokens for the Claude-run intake.
-- Additive only: three nullable columns on races and one new table.

-- AlterTable
ALTER TABLE "races" ADD COLUMN     "results_status" TEXT,
ADD COLUMN     "source_key" TEXT,
ADD COLUMN     "source_version" TEXT;

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "races_source_key_key" ON "races"("source_key");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_created_by_id_idx" ON "api_tokens"("created_by_id");

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Server-only table: the API reaches it through its own connection; nothing
-- reaches it through Supabase's public API.
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;
