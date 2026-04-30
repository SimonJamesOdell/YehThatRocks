export function shouldScheduleRelatedBackfill(input: {
  enabled: boolean;
  offset: number;
  maxNewestOffset: number;
  now: number;
  lastStartedAt: number;
  minIntervalMs: number;
  hasInFlight: boolean;
  hasScheduled: boolean;
}) {
  if (!input.enabled) {
    return false;
  }

  if (input.offset > input.maxNewestOffset) {
    return false;
  }

  if (input.hasInFlight || input.hasScheduled) {
    return false;
  }

  if (input.now - input.lastStartedAt < input.minIntervalMs) {
    return false;
  }

  return true;
}

export function computeRelatedBackfillDelayMs(baseDelayMs: number, jitterMs: number, randomValue = Math.random()) {
  const safeBase = Math.max(0, Math.floor(baseDelayMs));
  const safeJitter = Math.max(0, Math.floor(jitterMs));
  const normalizedRandom = Math.max(0, Math.min(0.999999, Number.isFinite(randomValue) ? randomValue : 0));

  if (safeJitter === 0) {
    return safeBase;
  }

  return safeBase + Math.floor(normalizedRandom * safeJitter);
}
