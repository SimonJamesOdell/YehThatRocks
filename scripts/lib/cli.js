"use strict";

function normalizeFlagName(name) {
  const raw = String(name ?? "").trim();
  if (!raw) {
    return "";
  }

  return raw.startsWith("--") ? raw : `--${raw}`;
}

function hasFlag(name, argv = process.argv) {
  const flag = normalizeFlagName(name);
  if (!flag) {
    return false;
  }

  return argv.includes(flag);
}

function parseArg(name, fallback, argv = process.argv) {
  const normalized = normalizeFlagName(name);
  if (!normalized) {
    return fallback;
  }

  const prefix = `${normalized}=`;
  const raw = argv.find((arg) => arg.startsWith(prefix));
  if (!raw) {
    return fallback;
  }

  return raw.slice(prefix.length);
}

function asNumber(value, fallback = 0, options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  let next = numeric;
  if (typeof options.min === "number") {
    next = Math.max(options.min, next);
  }
  if (typeof options.max === "number") {
    next = Math.min(options.max, next);
  }

  return next;
}

module.exports = {
  asNumber,
  hasFlag,
  parseArg,
};
