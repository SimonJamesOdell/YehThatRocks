/**
 * Admin Dashboard Cache Scheduler
 * 
 * Runs in the background and periodically refreshes the admin dashboard cache.
 * This is designed to run as a background service in production or can be
 * invoked by a cron-like scheduler (e.g., in Docker or systemd).
 * 
 * Usage:
 * - Background service: node scripts/schedule-admin-dashboard-maintenance.js
 * - Docker: Add to entrypoint or as a separate service in docker-compose
 * - Cronjob: Run periodically via cron or equivalent scheduler
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Interval between maintenance runs (default: 5 minutes)
const MAINTENANCE_INTERVAL_MS = Number(process.env.ADMIN_DASHBOARD_MAINTENANCE_INTERVAL_MS || "300000");

// Whether to run as a background daemon (default: true for production)
const RUN_AS_DAEMON = process.env.ADMIN_DASHBOARD_RUN_AS_DAEMON !== "false";

function runMaintenance() {
  const startTime = new Date().toISOString();
  console.log(`[${startTime}] Starting admin dashboard cache maintenance...`);

  const maintainProcess = spawn("node", ["scripts/maintain-admin-dashboard-cache.js"], {
    cwd: path.join(__dirname, ".."),
  });

  let output = "";
  let errorOutput = "";

  maintainProcess.stdout?.on("data", (data) => {
    output += data.toString();
    process.stdout.write(data);
  });

  maintainProcess.stderr?.on("data", (data) => {
    errorOutput += data.toString();
    process.stderr.write(data);
  });

  maintainProcess.on("close", (code) => {
    const endTime = new Date().toISOString();
    if (code === 0) {
      console.log(`[${endTime}] ✓ Admin dashboard cache maintenance completed successfully`);
    } else {
      console.error(`[${endTime}] ✗ Admin dashboard cache maintenance failed with code ${code}`);
    }
  });

  maintainProcess.on("error", (err) => {
    console.error(`✗ Failed to spawn maintenance process: ${err.message}`);
  });
}

if (RUN_AS_DAEMON) {
  console.log(`Starting admin dashboard cache scheduler (interval: ${MAINTENANCE_INTERVAL_MS}ms)`);
  console.log("Press Ctrl+C to stop\n");

  // Run immediately on startup
  runMaintenance();

  // Then run on schedule
  setInterval(() => {
    runMaintenance();
  }, MAINTENANCE_INTERVAL_MS);

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("\nScheduler shutting down gracefully...");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log("\nScheduler stopped");
    process.exit(0);
  });
} else {
  // Run once and exit
  runMaintenance();
}
