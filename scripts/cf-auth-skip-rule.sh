#!/usr/bin/env bash
#
# cf-auth-skip-rule.sh — install a Cloudflare WAF "skip" rule so signed-in
# users never see the Under Attack Mode / Security Level browser challenge.
#
# The app marks signed-in sessions with httpOnly `ytr_access` / `ytr_refresh`
# cookies. Cloudflare terminates TLS and can see the Cookie header, so a WAF
# custom rule can skip the Security Level challenge for requests carrying those
# cookies. The origin still verifies the JWTs, so a forged cookie only bypasses
# the Cloudflare challenge — it never bypasses authentication.
#
# This is the missing half of `cf-attack-watch.sh`: that watcher flips the zone
# to `security_level=under_attack` when the origin is loaded, which challenges
# EVERY visitor (including logged-in admins) when their `cf_clearance` expires.
# With this skip rule in place, the challenge only applies to cookie-less
# (unknown) clients; signed-in humans pass straight through.
#
# Idempotent: running it repeatedly is safe.
#
# Usage:
#   bash scripts/cf-auth-skip-rule.sh             # install/verify the rule
#   bash scripts/cf-auth-skip-rule.sh --dry-run   # print what would change
#
# Config (env):
#   CF_API_TOKEN   Cloudflare API token — needs Zone WAF:Edit + Zone WAF:Read
#                  (NOT the cf-attack-watch token, which only has Zone Settings).
#   CF_ZONE_ID     zone id
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

CF_API_TOKEN="${CF_API_TOKEN:-}"
CF_ZONE_ID="${CF_ZONE_ID:-}"

if [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ZONE_ID" ]; then
  echo "cf-auth-skip-rule: CF_API_TOKEN and CF_ZONE_ID must be set" >&2
  exit 1
fi

log() { echo "[$(date -u +%FT%TZ)] cf-auth-skip-rule: $*"; }

API_BASE="https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID"
PHASE="http_request_firewall_custom"

# Cloudflare rules language: http.cookie is the full Cookie header value.
# The origin re-verifies both JWTs, so matching on the cookie NAMES here is a
# cheap, safe bypass of the Cloudflare challenge only.
RULE_JSON='{
  "action": "skip",
  "action_parameters": {
    "products": ["securityLevel"]
  },
  "expression": "(http.cookie contains \"ytr_access=\" or http.cookie contains \"ytr_refresh=\")",
  "description": "Skip Security Level challenge for signed-in users (ytr_access/ytr_refresh)"
}'

# 1. Resolve the entry point ruleset id for the custom-rules phase.
entry_json="$(curl -sf -H "Authorization: Bearer $CF_API_TOKEN" \
  "$API_BASE/rulesets/phases/$PHASE/entrypoint" 2>/dev/null || true)"
ruleset_id="$(printf '%s' "$entry_json" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"

if [ -z "$ruleset_id" ]; then
  # No entry point ruleset exists yet — create it containing just this rule.
  log "no custom-rules entry point ruleset; creating one with the skip rule"
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would PUT the $PHASE entrypoint with the skip rule"
    exit 0
  fi
  curl -sf -X PUT "$API_BASE/rulesets/phases/$PHASE/entrypoint" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"rules\":[$RULE_JSON]}" >/dev/null
  log "created skip rule"
  exit 0
fi

# 2. Idempotency check: skip if a rule matching the same cookies already exists.
rules_json="$(curl -sf -H "Authorization: Bearer $CF_API_TOKEN" \
  "$API_BASE/rulesets/$ruleset_id" 2>/dev/null || true)"
if printf '%s' "$rules_json" | grep -qF "ytr_access="; then
  log "skip rule already present in ruleset $ruleset_id — nothing to do"
  exit 0
fi

# 3. Append the skip rule to the existing entry point ruleset.
log "adding skip rule to ruleset $ruleset_id"
if [ "$DRY_RUN" = "1" ]; then
  log "DRY-RUN: would POST the skip rule to ruleset $ruleset_id"
  exit 0
fi
curl -sf -X POST "$API_BASE/rulesets/$ruleset_id/rules" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$RULE_JSON" >/dev/null
log "skip rule installed"
