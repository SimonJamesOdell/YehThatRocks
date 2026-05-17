export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function finiteNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function clampPercent(value: number): number {
  return clamp(value, 0, 100);
}

export function finitePercentOrNull(value: number | null | undefined): number | null {
  const numeric = finiteNumberOrNull(value);
  return numeric === null ? null : clampPercent(numeric);
}

export function readPositiveNumberEnv(name: string, fallback: number, min: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, parsed);
}

export function readPositiveIntEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(Math.floor(parsed), min, max);
}