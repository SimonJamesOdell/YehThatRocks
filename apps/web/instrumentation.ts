export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Start performance telemetry sampling (records to performance_telemetry_samples
    // every 30s for historical trend analysis). This is a lightweight setInterval.
    const { startPerfSampling } = await import("@/lib/perf-sample-persistence");
    startPerfSampling();

    // Eagerly warm the Prisma connection pool during server startup.
    // Without this, the first API request triggers a lazy $connect which can
    // time out and leave the singleton pool in a permanently broken state.
    // verify-deps-full.ps1 then retries for 180s against the same broken pool.
    if (process.env.DATABASE_URL) {
      const { prisma } = await import("@/lib/db");
      try {
        await prisma.$connect();
      } catch {
        // The API will serve database-error responses until the DB becomes
        // reachable. Don't crash the server over a cold DB.
      }
    }
  }
}