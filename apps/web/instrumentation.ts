export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Start performance telemetry sampling (records to performance_telemetry_samples
    // every 30s for historical trend analysis). This is a lightweight setInterval.
    const { startPerfSampling } = await import("@/lib/perf-sample-persistence");
    startPerfSampling();
  }
}