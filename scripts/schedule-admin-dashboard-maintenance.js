#!/usr/bin/env node
/**
 * CommonJS/ESM-compatible launcher shim for schedule-admin-dashboard-maintenance.mjs.
 */

(async () => {
  try {
    const { runAdminDashboardMaintenanceScheduler } = await import("./schedule-admin-dashboard-maintenance.mjs");
    const ok = await runAdminDashboardMaintenanceScheduler();
    process.exit(ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to start admin dashboard scheduler: ${message}`);
    process.exit(1);
  }
})();
