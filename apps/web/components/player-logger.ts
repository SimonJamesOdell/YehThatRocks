import { PLAYER_DEBUG_ENABLED, FLOW_DEBUG_ENABLED } from "@/components/player-constants";

export function logPlayerDebug(event: string, detail?: Record<string, unknown>) {
  if (!PLAYER_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[player] ${event}${payload}`);
}

export function logFlow(event: string, detail?: Record<string, unknown>) {
  if (!FLOW_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[flow/player] ${event}${payload}`);
}
