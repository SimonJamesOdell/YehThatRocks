#!/usr/bin/env node
/**
 * Admin Dashboard Cache Scheduler
 *
 * Runs in the background and periodically refreshes the admin dashboard cache.
 * This implementation executes maintenance in-process to avoid repeated Node
 * process spawn overhead on frequent intervals.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

// Interval between maintenance runs (default: 5 minutes)
const MAINTENANCE_INTERVAL_MS = Number(process.env.ADMIN_DASHBOARD_MAINTENANCE_INTERVAL_MS || "300000");

// Whether to run as a background daemon (default: true for production)
const RUN_AS_DAEMON = process.env.ADMIN_DASHBOARD_RUN_AS_DAEMON !== "false";

let maintenanceInFlight = false;

async function runMaintenanceOnce() {
  if (maintenanceInFlight) {
    const now = new Date().toISOString();
    console.warn(`[${now}] Admin dashboard cache maintenance already running; skipping overlapping tick`);
    return true;
  }

  maintenanceInFlight = true;
  let success = true;
  const startTime = new Date().toISOString();
  console.log(`[${startTime}] Starting admin dashboard cache maintenance...`);

  try {
    const maintainModuleUrl = new URL("./maintain-admin-dashboard-cache.mjs", import.meta.url);
    const { maintainAdminDashboardCache } = await import(maintainModuleUrl.href);
    await maintainAdminDashboardCache();

    const endTime = new Date().toISOString();
    console.log(`[${endTime}] ✓ Admin dashboard cache maintenance completed successfully`);
  } catch (error) {
    success = false;
    const endTime = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${endTime}] ✗ Admin dashboard cache maintenance failed: ${message}`);
  } finally {
    maintenanceInFlight = false;
  }

  return success;
}

export async function runAdminDashboardMaintenanceScheduler() {
  if (RUN_AS_DAEMON) {
    console.log(`Starting admin dashboard cache scheduler (interval: ${MAINTENANCE_INTERVAL_MS}ms)`);
    console.log("Press Ctrl+C to stop\n");

    // Run immediately on startup.
    void runMaintenanceOnce();

    // Then run on schedule.
    const timer = setInterval(() => {
      void runMaintenanceOnce();
    }, MAINTENANCE_INTERVAL_MS);

    // Graceful shutdown.
    process.on("SIGTERM", () => {
      clearInterval(timer);
      console.log("\nScheduler shutting down gracefully...");
      process.exit(0);
    });

    process.on("SIGINT", () => {
      clearInterval(timer);
      console.log("\nScheduler stopped");
      process.exit(0);
    });

    return true;
  }

  const ok = await runMaintenanceOnce();
  return ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ok = await runAdminDashboardMaintenanceScheduler();
  process.exit(ok ? 0 : 1);
}
