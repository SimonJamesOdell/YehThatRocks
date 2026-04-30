const MAX_FINGERPRINT_LENGTH = 180;

export function normalizePrismaQueryFingerprint(query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return "SQL.UNKNOWN";
  }

  const normalized = trimmed
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "?")
    .replace(/"(?:""|[^"])*"/g, "?")
    .replace(/\b0x[0-9A-Fa-f]+\b/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\bIN\s*\((?:\s*\?(?:\s*,\s*\?)*\s*)\)/gi, "IN (?)")
    .replace(/\bVALUES\s*\((?:[^()]|\([^)]*\))*\)(?:\s*,\s*\((?:[^()]|\([^)]*\))*\))*/gi, "VALUES (...)")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (normalized.length <= MAX_FINGERPRINT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_FINGERPRINT_LENGTH - 3)}...`;
}
