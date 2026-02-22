import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./models/prisma.js";

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

  app.listen(env.PORT, () => {
    console.log(`✓ Server running on port ${env.PORT}`);
    console.log(`  Environment: ${env.NODE_ENV}`);
    console.log(`  Frontend URL: ${env.FRONTEND_URL}`);
    console.log(`  API URL: ${env.BACKEND_URL}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
