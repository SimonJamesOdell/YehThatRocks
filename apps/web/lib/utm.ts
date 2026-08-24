/**
 * UTM / attribution capture.
 *
 * The audit found that UTM parameters were only ever *emitted* (RSS feeds tag
 * their own outbound links) but never *captured* — so marketing channels could
 * not be attributed to signups. This module is the foundation: pure parsing,
 * serialization, and the stable storage key used to persist first-touch
 * attribution across navigation (see components/utm-capture.tsx).
 */

export const UTM_STORAGE_KEY = "ytr:utm-attribution";

export const UTM_PARAM_NAMES = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type UtmParamName = (typeof UTM_PARAM_NAMES)[number];

export type UtmParams = Partial<Record<UtmParamName, string>>;

/** Extract UTM params from a URL query string (with or without leading `?`). */
export function parseUtmParams(search: string): UtmParams {
  const params = new URLSearchParams(search);
  const result: UtmParams = {};
  for (const name of UTM_PARAM_NAMES) {
    const value = params.get(name)?.trim();
    if (value) {
      result[name] = value;
    }
  }
  return result;
}

/** True if any UTM param has a non-empty value. */
export function hasUtmParams(params: UtmParams): boolean {
  return Object.values(params).some((value) => typeof value === "string" && value.length > 0);
}

/** Serialize UTM params back into a query string (no leading `?`). */
export function serializeUtmParams(params: UtmParams): string {
  const qs = new URLSearchParams();
  for (const name of UTM_PARAM_NAMES) {
    const value = params[name];
    if (value) {
      qs.set(name, value);
    }
  }
  return qs.toString();
}
