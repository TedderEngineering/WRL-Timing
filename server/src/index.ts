import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./models/prisma.js";
import { STORAGE_BUCKET, supabase } from "./lib/supabase.js";
import { startLiveRecorder, stopLiveRecorder } from "./live/recorder.js";

async function main() {
  // Verify database connection
  try {
    await prisma.$connect();
    console.log("✓ Database connected");
  } catch (error) {
    console.error("✗ Failed to connect to database:", error);
    process.exit(1);
  }

  const app = createApp();

  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`✓ Server running on port ${env.PORT}`);
    console.log(`  Environment: ${env.NODE_ENV}`);
    console.log(`  Frontend URL: ${env.FRONTEND_URL}`);
    console.log(`  API URL: ${env.BACKEND_URL}`);
  });

  // RaceTrace Live: record live WRL sessions for replay (live/recorder.ts; LIVE_RECORD=0 turns it off).
  if (startLiveRecorder(supabase ? supabase.storage.from(STORAGE_BUCKET) : null)) console.log("✓ Live recorder on");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    // Upload what the live recorder has kept (at most 10 s).
    await Promise.race([stopLiveRecorder(), new Promise((r) => setTimeout(r, 10_000))]);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
