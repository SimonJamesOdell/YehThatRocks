import { prisma } from "@/lib/db";
import { BoundedMap } from "@/lib/bounded-map";
import { hashClientIp } from "@/lib/cf-headers";
import { getClientIp } from "@/lib/rate-limit";

/**
 * Durable client-reputation store keyed by IP hash.
 *
 * This is the persistence half of the human-trust gate. The warm-activity
 * signal lives in memory (synchronous, hot path) and is hydrated lazily from
 * the database, so reputation survives restarts and redeploys. Writes are
 * transition-only and flushed in batches rather than on every request.
 *
 * All database access is best-effort and guarded: if the DB is unreachable
 * (or DATABASE_URL is unset, as in unit tests) the gate still works from
 * memory alone, degrading to per-process behaviour.
 */

export const REPUTATION_RETENTION_DAYS = 180;
const RETENTION_MS = REPUTATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Mirrors the warm-activity semantics that assessHumanTrust previously kept
// in lib/trust.ts, so the durable record and the in-memory assessment stay
// consistent.
const ACTIVITY_WINDOW_MS = 30 * 60 * 1000;
const WARM_MIN_HITS = 2;
const WARM_MIN_SPAN_MS = 2 * 60 * 1000;

const FLUSH_INTERVAL_MS = 30_000;

export type ReputationRecord = {
  firstSeenAt: number;
  lastSeenAt: number;
  benignHits: number;
  warmAt: number | null;
  powSolvedAt: number | null;
  powSolves: number;
  deniedCount: number;
  lastDeniedAt: number | null;
  flagged: boolean;
  flagReason: string | null;
};

const memory = new BoundedMap<string, ReputationRecord>(20_000);
const dirty = new Set<string>();

/**
 * Safe access to the generated `prisma.clientReputation` delegate. When
 * DATABASE_URL is unset, `@/lib/db` returns a lazy proxy that throws on any
 * delegate access — this normalises both that case and a genuinely missing
 * delegate to null so callers stay memory-only.
 */
function clientReputationDelegate(): typeof prisma.clientReputation | null {
  try {
    return prisma.clientReputation ?? null;
  } catch {
    return null;
  }
}

function ipHashForRequest(request: Request): string {
  return hashClientIp(getClientIp(request));
}

function createRecord(now: number): ReputationRecord {
  return {
    firstSeenAt: now,
    lastSeenAt: now,
    benignHits: 0,
    warmAt: null,
    powSolvedAt: null,
    powSolves: 0,
    deniedCount: 0,
    lastDeniedAt: null,
    flagged: false,
    flagReason: null,
  };
}

function markDirty(ipHash: string): void {
  dirty.add(ipHash);
}

/**
 * Merge a persisted row into the in-memory record. Historical evidence (flag,
 * denials, prior solves) is restored; current-session counters are kept as the
 * maximum so a fire-and-forget hydration never clobbers a request that arrived
 * while the row was still loading.
 */
function mergePersistedRow(ipHash: string, row: {
  firstSeenAt: Date;
  lastSeenAt: Date;
  benignHits: number;
  warmAt: Date | null;
  powSolvedAt: Date | null;
  powSolves: number;
  deniedCount: number;
  lastDeniedAt: Date | null;
  flagged: boolean;
  flagReason: string | null;
}): void {
  const existing = memory.get(ipHash);

  if (!existing) {
    memory.set(ipHash, {
      firstSeenAt: row.firstSeenAt.getTime(),
      lastSeenAt: row.lastSeenAt.getTime(),
      benignHits: row.benignHits,
      warmAt: row.warmAt ? row.warmAt.getTime() : null,
      powSolvedAt: row.powSolvedAt ? row.powSolvedAt.getTime() : null,
      powSolves: row.powSolves,
      deniedCount: row.deniedCount,
      lastDeniedAt: row.lastDeniedAt ? row.lastDeniedAt.getTime() : null,
      flagged: row.flagged,
      flagReason: row.flagReason,
    });
    return;
  }

  existing.flagged = existing.flagged || row.flagged;
  existing.flagReason = existing.flagReason ?? row.flagReason;
  existing.deniedCount = Math.max(existing.deniedCount, row.deniedCount);
  existing.powSolves = Math.max(existing.powSolves, row.powSolves);
  existing.benignHits = Math.max(existing.benignHits, row.benignHits);
  existing.lastSeenAt = Math.max(existing.lastSeenAt, row.lastSeenAt.getTime());
  existing.powSolvedAt = existing.powSolvedAt ?? (row.powSolvedAt ? row.powSolvedAt.getTime() : null);
  existing.lastDeniedAt = existing.lastDeniedAt ?? (row.lastDeniedAt ? row.lastDeniedAt.getTime() : null);
  existing.warmAt = existing.warmAt ?? (row.warmAt ? row.warmAt.getTime() : null);
}

/** Fire-and-forget hydration of a client's persisted reputation. */
export function hydrateReputation(ipHash: string): void {
  if (memory.has(ipHash)) {
    return;
  }

  const delegate = clientReputationDelegate();
  if (!delegate) {
    return;
  }

  void delegate
    .findUnique({ where: { ipHash } })
    .then((row) => {
      if (row) {
        mergePersistedRow(ipHash, row);
      }
    })
    .catch(() => undefined);
}

/** Record a benign (read-only) request for the client's IP. */
export function recordBenignActivity(request: Request): void {
  const ipHash = ipHashForRequest(request);
  const now = Date.now();

  if (!memory.has(ipHash)) {
    hydrateReputation(ipHash);
  }

  const rec = memory.get(ipHash);
  if (!rec || now - rec.firstSeenAt > ACTIVITY_WINDOW_MS) {
    const fresh = createRecord(now);
    fresh.benignHits = 1;
    memory.set(ipHash, fresh);
    markDirty(ipHash);
    return;
  }

  rec.lastSeenAt = now;
  rec.benignHits += 1;

  if (rec.warmAt == null && rec.benignHits >= WARM_MIN_HITS && now - rec.firstSeenAt >= WARM_MIN_SPAN_MS) {
    rec.warmAt = now;
  }

  markDirty(ipHash);
}

export function isWarm(request: Request): boolean {
  const rec = memory.get(ipHashForRequest(request));
  if (!rec) {
    return false;
  }

  const now = Date.now();
  if (now - rec.lastSeenAt > ACTIVITY_WINDOW_MS) {
    return false;
  }

  return rec.benignHits >= WARM_MIN_HITS && now - rec.firstSeenAt >= WARM_MIN_SPAN_MS;
}

export function isFlagged(request: Request): boolean {
  return memory.get(ipHashForRequest(request))?.flagged === true;
}

/** Record a successful proof-of-work solve for the client's IP. */
export function recordPowSolved(request: Request): void {
  const ipHash = ipHashForRequest(request);
  const now = Date.now();

  if (!memory.has(ipHash)) {
    hydrateReputation(ipHash);
  }

  const rec = memory.get(ipHash) ?? createRecord(now);
  rec.powSolvedAt = now;
  rec.powSolves += 1;
  memory.set(ipHash, rec);
  markDirty(ipHash);
}

/** Record a denied sensitive action (trust gate refused) for the client's IP. */
export function recordDenied(request: Request): void {
  const ipHash = ipHashForRequest(request);
  const now = Date.now();

  if (!memory.has(ipHash)) {
    hydrateReputation(ipHash);
  }

  const rec = memory.get(ipHash) ?? createRecord(now);
  rec.deniedCount += 1;
  rec.lastDeniedAt = now;
  memory.set(ipHash, rec);
  markDirty(ipHash);
}

/** Mark a client's IP as flagged with a human-readable reason. */
export function flagIp(request: Request, reason: string): void {
  const ipHash = ipHashForRequest(request);
  const now = Date.now();

  const rec = memory.get(ipHash) ?? createRecord(now);
  rec.flagged = true;
  rec.flagReason = reason;
  memory.set(ipHash, rec);
  markDirty(ipHash);
}

/** Batch-upsert every dirty record into the database. Best-effort. */
export async function flushReputationWrites(): Promise<void> {
  if (dirty.size === 0) {
    return;
  }

  const pending: Array<[string, ReputationRecord]> = [];
  for (const ipHash of dirty) {
    const rec = memory.get(ipHash);
    if (rec) {
      pending.push([ipHash, rec]);
    }
  }
  dirty.clear();

  const delegate = clientReputationDelegate();
  if (!delegate || pending.length === 0) {
    return;
  }

  await Promise.allSettled(
    pending.map(([ipHash, rec]) =>
      delegate.upsert({
        where: { ipHash },
        update: {
          lastSeenAt: new Date(rec.lastSeenAt),
          benignHits: rec.benignHits,
          warmAt: rec.warmAt != null ? new Date(rec.warmAt) : null,
          powSolvedAt: rec.powSolvedAt != null ? new Date(rec.powSolvedAt) : null,
          powSolves: rec.powSolves,
          deniedCount: rec.deniedCount,
          lastDeniedAt: rec.lastDeniedAt != null ? new Date(rec.lastDeniedAt) : null,
          flagged: rec.flagged,
          flagReason: rec.flagReason,
        },
        create: {
          ipHash,
          firstSeenAt: new Date(rec.firstSeenAt),
          lastSeenAt: new Date(rec.lastSeenAt),
          benignHits: rec.benignHits,
          warmAt: rec.warmAt != null ? new Date(rec.warmAt) : null,
          powSolvedAt: rec.powSolvedAt != null ? new Date(rec.powSolvedAt) : null,
          powSolves: rec.powSolves,
          deniedCount: rec.deniedCount,
          lastDeniedAt: rec.lastDeniedAt != null ? new Date(rec.lastDeniedAt) : null,
          flagged: rec.flagged,
          flagReason: rec.flagReason,
        },
      }).catch(() => undefined),
    ),
  );
}

/** Delete reputation rows older than the retention window. Best-effort. */
export async function pruneExpiredReputation(): Promise<number> {
  const delegate = clientReputationDelegate();
  if (!delegate) {
    return 0;
  }

  const cutoff = new Date(Date.now() - RETENTION_MS);

  try {
    const result = await delegate.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });
    return result.count;
  } catch {
    return 0;
  }
}

// ── Write-behind flush ────────────────────────────────────────────────────
let flushTimerStarted = false;

function startFlushTimer(): void {
  if (flushTimerStarted) {
    return;
  }
  flushTimerStarted = true;

  const timer = setInterval(() => {
    void flushReputationWrites();
  }, FLUSH_INTERVAL_MS);

  if (typeof timer !== "undefined" && "unref" in timer) {
    timer.unref();
  }

  process.once("beforeExit", () => {
    void flushReputationWrites();
  });
}

if (process.env.NODE_ENV !== "test" && process.env.DATABASE_URL) {
  startFlushTimer();
}
