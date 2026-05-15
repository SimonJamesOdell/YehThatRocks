#!/usr/bin/env node
/**
 * CommonJS launcher shim for maintain-admin-dashboard-cache.mjs.
 *
 * Keeps existing command paths stable while avoiding MODULE_TYPELESS_PACKAGE_JSON
 * warnings from ESM syntax in .js files.
 */

(async () => {
  try {
    const { maintainAdminDashboardCache } = await import("./maintain-admin-dashboard-cache.mjs");
    await maintainAdminDashboardCache();
  } catch (error) {
    console.error("✗ Error maintaining admin dashboard cache:", error);
    process.exit(1);
  }
})();
