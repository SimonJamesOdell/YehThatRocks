import { NextRequest } from "next/server";

/**
 * Cloudflare request signals available to origin servers behind CF proxy.
 * These headers are set by Cloudflare and forwarded to the origin.
 */
export interface CfHeaders {
  /** Real client IP as seen by Cloudflare */
  connectingIp: string | null;
  /** Two-letter country code (ISO 3166-1 alpha-2) */
  ipCountry: string | null;
  /** Unique request ID (includes Cloudflare datacenter code) */
  ray: string | null;
  /** JSON object with scheme, http protocol, etc. */
  visitor: string | null;
  /** Threat score 0-100 (0=bot, 100=human) — requires CF Pro or higher */
  threatScore: number | null;
  /** Bot Management score 1-99 (1=definitely bot, 99=definitely human) — requires CF Enterprise */
  botScore: number | null;
  /** JA3 TLS fingerprint hash — can identify bot clients even with spoofed UA */
  ja3Hash: string | null;
}

/**
 * Extract Cloudflare request signals from a NextRequest.
 * All fields are null when the request does not pass through Cloudflare.
 */
export function extractCfHeaders(request: NextRequest): CfHeaders {
  const threatScoreRaw = request.headers.get("CF-Threat-Score");
  const botScoreRaw = request.headers.get("CF-Bot-Score");

  return {
    connectingIp: request.headers.get("CF-Connecting-IP") ?? null,
    ipCountry: request.headers.get("CF-IPCountry") ?? null,
    ray: request.headers.get("CF-Ray") ?? null,
    visitor: request.headers.get("CF-Visitor") ?? null,
    threatScore: threatScoreRaw != null ? Number(threatScoreRaw) : null,
    botScore: botScoreRaw != null ? Number(botScoreRaw) : null,
    ja3Hash: request.headers.get("CF-JA3-Hash") ?? null,
  };
}

/**
 * Build a short diagnostic summary string from CF headers.
 * Safe to log — no user-identifiable data beyond country-level geo.
 */
export function cfHeadersSummary(headers: CfHeaders): string {
  const parts: string[] = [];
  if (headers.connectingIp) parts.push(`ip=${headers.connectingIp}`);
  if (headers.ipCountry) parts.push(`country=${headers.ipCountry}`);
  if (headers.ray) parts.push(`ray=${headers.ray}`);
  if (headers.botScore != null) parts.push(`bot=${headers.botScore}`);
  else if (headers.threatScore != null) parts.push(`threat=${headers.threatScore}`);
  if (headers.ja3Hash) parts.push(`ja3=${headers.ja3Hash}`);
  return parts.join(" ");
}

/**
 * Returns true if the request is very likely a bot based on Cloudflare signals.
 * Conservative — only flags requests with strong bot evidence.
 */
export function isCfIdentifiedBot(headers: CfHeaders): boolean {
  // CF Bot Management: score 1-30 is considered "likely bot"
  if (headers.botScore != null && headers.botScore <= 30) {
    return true;
  }

  // CF Threat Score: 0 is "definitely bot"
  if (headers.threatScore != null && headers.threatScore === 0) {
    return true;
  }

  return false;
}

/**
 * Returns true if the request is suspicious but not definitively a bot.
 * Use for diagnostic logging, not blocking.
 */
export function isCfSuspicious(headers: CfHeaders): boolean {
  // Bot score in the grey zone
  if (headers.botScore != null && headers.botScore <= 50) {
    return true;
  }

  return false;
}
