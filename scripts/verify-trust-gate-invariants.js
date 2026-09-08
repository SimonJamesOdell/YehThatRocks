#!/usr/bin/env node

// Domain: Internal human-trust defense (replaces Cloudflare bot-fight mode).
// Guards the account-creation gate and the tier/reputation/persistence modules
// so the defense cannot be silently removed during a refactor.

const {
  readFileStrict,
  mapRelativeFiles,
  assertFilesExist,
  assertContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = mapRelativeFiles(ROOT, {
  register: "apps/web/app/api/auth/register/route.ts",
  anonymous: "apps/web/app/api/auth/anonymous/route.ts",
  requireTrust: "apps/web/lib/require-human-trust.ts",
  trustTier: "apps/web/lib/trust-tier.ts",
  reputation: "apps/web/lib/trust-reputation.ts",
  botChallenge: "apps/web/app/api/bot-challenge/route.ts",
  proxy: "apps/web/proxy.ts",
  schema: "prisma/schema.prisma",
});

function main() {
  const failures = [];

  assertFilesExist(files, failures, ROOT);

  const register = readFileStrict(files.register, ROOT);
  const anonymous = readFileStrict(files.anonymous, ROOT);
  const requireTrust = readFileStrict(files.requireTrust, ROOT);
  const trustTier = readFileStrict(files.trustTier, ROOT);
  const reputation = readFileStrict(files.reputation, ROOT);
  const botChallenge = readFileStrict(files.botChallenge, ROOT);
  const proxy = readFileStrict(files.proxy, ROOT);
  const schema = readFileStrict(files.schema, ROOT);

  // Account creation must be gated behind the human-trust tiers.
  assertContains(register, "requireHumanTrustOrResponse", "register applies the trust gate", failures);
  assertContains(anonymous, "requireHumanTrustOrResponse", "anonymous account creation applies the trust gate", failures);

  // The gate helper must expose the machine-readable challenge code.
  assertContains(requireTrust, "TRUST_REQUIRED_CODE", "gate helper exposes TRUST_REQUIRED_CODE", failures);

  // The tier model must expose tier computation and resolution.
  assertContains(trustTier, "computeAccountTier", "computeAccountTier exists", failures);
  assertContains(trustTier, "resolveTrustTier", "resolveTrustTier exists", failures);

  // Reputation must be persisted and prunable.
  assertContains(reputation, "pruneExpiredReputation", "reputation prune exists", failures);
  assertContains(reputation, "REPUTATION_RETENTION_DAYS", "reputation retention constant exists", failures);
  assertContains(schema, "model ClientReputation", "ClientReputation schema model exists", failures);

  // PoW difficulty must be operator-tunable.
  assertContains(botChallenge, "POW_DIFFICULTY_BITS", "PoW difficulty is tunable", failures);

  // Attack-mode lever must exist in the proxy.
  assertContains(proxy, "ATTACK_MODE_ENABLED", "attack-mode lever exists", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "\nTrust-gate invariants FAILED:",
    successMessage: "\nAll trust-gate invariants passed.",
  });
}

main();
