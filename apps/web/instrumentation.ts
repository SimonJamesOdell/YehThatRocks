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
    //
    // A cold MySQL container can accept TCP before it can reliably serve
    // queries (buffer pool loading, crash recovery, background threads).
    // If the pool's initial connections fail during that window, the pool
    // enters a permanently exhausted state (active=0 idle=0) that never
    // recovers. We retry with exponential backoff and run a real warmup
    // query (SELECT 1) to confirm the pool is actually healthy before
    // the server starts accepting requests.
    if (process.env.DATABASE_URL) {
      const { prisma } = await import("@/lib/db");
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await prisma.$connect();
          // Verify the pool actually works — a raw SELECT 1 forces a real
          // round-trip through the pool and confirms MySQL is query-ready.
          await prisma.$queryRawUnsafe("SELECT 1");
          if (attempt > 0) {
            console.log(`[instrumentation] Prisma pool warmed after ${attempt + 1} attempts`);
          }
          break;
        } catch {
          if (attempt < 9) {
            const delayMs = 1000 * 2 ** attempt;
            console.warn(
              `[instrumentation] Prisma pool warmup attempt ${attempt + 1} failed — ` +
              `retrying in ${delayMs}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          } else {
            console.error(
              `[instrumentation] Prisma pool warmup failed after 10 attempts. ` +
              `The API will serve database-error responses until the DB becomes reachable.`,
            );
          }
        }
      }
    }
  }
}