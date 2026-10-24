#!/usr/bin/env bash
#
# cf-attack-watch.sh — auto-toggle Cloudflare "Under Attack Mode" by origin load.
#
# Samples the 1-minute load average and flips the zone's security_level between
# `under_attack` (during a traffic surge) and a calm baseline (the rest of the
# time), so attack mode stays OFF in normal operation and only turns ON when
# the origin is actually under load. Run by a systemd timer (every ~2 min).
#
# Super Bot Fight Mode (`fight_mode`) is deliberately NOT touched here — it is
# safe to leave always-on because it only challenges obvious bots.
#
# Usage:
#   cf-attack-watch.sh              # normal run: evaluate + toggle if needed
#   cf-attack-watch.sh --dry-run    # log the decision without calling PATCH
#
# Config (env, e.g. via systemd EnvironmentFile):
#   CF_API_TOKEN      Cloudflare API token (Zone Settings:Edit + Read)
#   CF_ZONE_ID        zone id
#   ATTACK_LOAD       1-min load avg >= this  => enable under_attack  (default 2.5)
#   CALM_LOAD         1-min load avg <= this  => count as calm         (default 1.0)
#   CALM_SAMPLES      consecutive calm samples before reverting        (default 10)
#   BASELINE_LEVEL    security_level to restore when calm              (default high)
#   STATE_DIR         where the calm counter lives                     (default /var/lib/cf-attack-watch)
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

CF_API_TOKEN="${CF_API_TOKEN:-}"
CF_ZONE_ID="${CF_ZONE_ID:-}"
ATTACK_LOAD="${ATTACK_LOAD:-2.5}"
CALM_LOAD="${CALM_LOAD:-1.0}"
CALM_SAMPLES="${CALM_SAMPLES:-10}"
BASELINE_LEVEL="${BASELINE_LEVEL:-high}"
STATE_DIR="${STATE_DIR:-/var/lib/cf-attack-watch}"

if [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ZONE_ID" ]; then
  echo "cf-attack-watch: CF_API_TOKEN and CF_ZONE_ID must be set" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/calm-counter"
API="https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/settings/security_level"

log() { echo "[$(date -u +%FT%TZ)] cf-attack-watch: $*"; }

# numeric compare via awk (no bc dependency)
ge() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a+0 >= b+0)}'; }
le() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a+0 <= b+0)}'; }

load1="$(cut -d' ' -f1 /proc/loadavg)"

cur_json="$(curl -sf -H "Authorization: Bearer $CF_API_TOKEN" "$API")" || {
  log "ERROR: could not read current security_level from Cloudflare"
  exit 1
}
cur_level="$(printf '%s' "$cur_json" | grep -o '"value":"[a-z_]*"' | head -1 | cut -d'"' -f4)"
if [ -z "$cur_level" ]; then
  log "ERROR: could not parse security_level from response: $(printf '%.160s' "$cur_json")"
  exit 1
fi

calm=0
[ -f "$STATE_FILE" ] && calm="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
calm="${calm:-0}"

target=""
reason=""

if ge "$load1" "$ATTACK_LOAD"; then
  target="under_attack"
  reason="load1=$load1 >= $ATTACK_LOAD"
  echo 0 > "$STATE_FILE"
elif le "$load1" "$CALM_LOAD"; then
  calm=$((calm + 1))
  echo "$calm" > "$STATE_FILE"
  if [ "$calm" -ge "$CALM_SAMPLES" ]; then
    target="$BASELINE_LEVEL"
    reason="load1=$load1 <= $CALM_LOAD for $calm/$CALM_SAMPLES samples"
  else
    reason="calm ($calm/$CALM_SAMPLES), holding $cur_level"
  fi
else
  echo 0 > "$STATE_FILE"
  reason="load1=$load1 between $CALM_LOAD and $ATTACK_LOAD, holding $cur_level"
fi

log "load1=$load1 current=$cur_level reason=$reason"

if [ -n "$target" ] && [ "$target" != "$cur_level" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would set security_level $cur_level -> $target ($reason)"
  else
    if curl -sf -X PATCH \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"value\":\"$target\"}" "$API" >/dev/null; then
      log "SET security_level $cur_level -> $target ($reason)"
      echo 0 > "$STATE_FILE"
    else
      log "ERROR: failed to set security_level to $target"
      exit 1
    fi
  fi
elif [ -n "$target" ] && [ "$target" = "$cur_level" ]; then
  log "no-op: already at $target"
fi

exit 0
