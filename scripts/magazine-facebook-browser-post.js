#!/usr/bin/env node
"use strict";

// ===========================================================================
// magazine-facebook-browser-post.js — backward-compatibility wrapper
//
// This script is retained for backward compatibility with existing cron jobs
// and npm scripts. It delegates to the unified facebook-browser-post.js with
// --mode magazine, which supports all the same flags and env vars.
//
// All MAGAZINE_BROWSER_POST_* env vars are automatically read as fallbacks
// by the new unified script. No env var translation is needed.
// ===========================================================================

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const args = [
  path.join(__dirname, "facebook-browser-post.js"),
  "--mode", "magazine",
  ...process.argv.slice(2),
];

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
});

process.exit(result.status ?? 1);
