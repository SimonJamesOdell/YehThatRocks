# Performance Improvement Roadmap — yehthatrocks.com

**Created**: 2026-07-12 17:49 UTC
**Updated**: 2026-07-21 16:50 UTC — Phases 2, 3a, 3b, 3c, 4, 5, 7 complete; schema drift fully resolved
**Status**: Active — Only Phase 6 (MySQL tuning) awaits Phase 1 slow-log data
**Sources**: 3 live `/api/status/performance` snapshots (Jul 12), VPS host metrics via SSH (Jul 12), **June 7 DB profiling report (131,701 slow log rows over 7 days)**, current live API telemetry + Docker stats (Jul 21)

## Detected Hotspots

| # | Hotspot | Severity | Status |
|---|---------|----------|--------|
| 1 | MySQL container CPU 97.95% | ~~CRITICAL~~ | **RESOLVED** — transient spike; current CPU 6.56% |
| 2 | Node.js heap near 74% pressure trigger (77%) | HIGH | Active — Phase 2 still needed |
| 3 | System memory pressure (70% RAM, 37.8% swap) | MODERATE | Active — Phase 6 addresses this |
| 4 | Load average 3.22 on ~2 vCPU | ~~MODERATE~~ | **RESOLVED** — current load 0.83 |
| 5 | Prisma telemetry blind spot (29 queries after 17.5h uptime) | HIGH | Active — Phase 4 still needed |
| 6 | Recent Node restart (13.5 min uptime) | ~~MODERATE~~ | **RESOLVED** — 17.5h uptime |
| 7 | No continuous monitoring on VPS | MODERATE | Active — Phase 5 still needed |
| 8 | Missing DB profiling report (slow query log OFF) | MODERATE | Active but downgraded — June 7 report provides actionable data |
| **9** | **Artist catalog full-scan bottleneck** | **CRITICAL** | **NEW** — 31,344 calls, 97,510 sec, 1.83B rows examined |
| **10** | **Schema-model index drift** | MODERATE | **NEW** — `idx_videos_parsed_artist_norm_fav_view_videoid_id` exists via manual migration but is absent from `schema.prisma` |
| **11** | **Site video availability scan** | HIGH | **NEW** — 5,540 calls, 572M rows examined |
| **12** | **Category artist cache write pressure** | MODERATE | **NEW** — heavy DELETE/INSERT cycle on cache refresh |

## New Evidence Summary (July 21 Refresh)

### Live VPS snapshot
- **Uptime**: 12 days | **Load**: 0.83 (healthy)
- **RAM**: 1967 MB total, 70% used, 37.8% swap (774 MB)
- **Docker**: web 268 MB (13.6%), db 731 MB (37.2%)
- **MySQL CPU**: 6.56% (was 97.95% on Jul 12 — resolved transient spike)
- **Node**: 17.5h uptime, RSS 245 MB, heap 142/184 MB (77%)

### June 7 DB Profiling Report (131,701 slow log rows, May 31 – Jun 7)
The #1 bottleneck is the **artist catalog queries** hitting `videos` via FORCE INDEX `idx_videos_parsed_artist_norm_fav_view_videoid_id`:

| Calls | Total Sec | Rows Examined | Query Pattern |
|-------|-----------|---------------|---------------|
| 31,344 | 97,510 | 1,827,760,264 | Artist list (no WHERE — full index scan) |
| 11,211 | 72,263 | 15,500,646 | Artist COUNT for pagination |
| 2,531 | 4,643 | 302,434,483 | Genre dominance (GROUP_CONCAT per artist) |
| 2,330 | 4,481 | 3,241,441 | Genre ROW_NUMBER OVER (PARTITION BY artist) |
| 5,361 | 1,427 | 8,594,112 | Artist thumbnail + genre |
| 5,540 | 1,351 | 572,784,934 | Site video availability EXISTS check |

**Root cause**: The artist catalog queries have no WHERE clause — they scan all ~58K videos every time. The index `idx_videos_parsed_artist_norm_fav_view_videoid_id` exists (created by migration `20260418153000`) and is being used, but it's a full index scan because there's no filter predicate. The `category_artist_runtime_cache` table already exists and is designed to materialize these results — but the cache population and invalidation strategy is causing write pressure (2,034 UPDATE calls, heavy DELETE/INSERT cycles) rather than eliminating the underlying scans.

## Phases

### Phase 1 — Enable Slow Query Log + Collect Fresh Baseline
**Zero code changes.** Enable slow query log at 100ms threshold via `deploy/start-db-profiling.sh`. Let run 24h. Export with `deploy/export-db-profiling.sh`.

- **Why**: The current slow log is OFF. State file is stale (May 31). We need fresh data to validate that the patterns from June 7 still apply.
- **Action**: `ssh root@206.189.122.114 "cd /srv/yehthatrocks && bash deploy/start-db-profiling.sh"`

### Phase 2 — Memory Guard Hardening
Lower RSS threshold from 400MB → 280MB. Add explicit `global.gc()` after cache relief. Log pre-relief heap state to `performance_telemetry_samples`.

- **File**: `apps/web/lib/memory-pressure-guard.ts`
- **Rationale**: Heap at 77% usage (142/184 MB), web container at 268 MB RSS. Guardrail should trigger earlier.

### Phase 3 — Artist Catalog Query Optimization (was "DB Index Analysis")
**The #1 performance problem.** 31,344 full index scans over 7 days examining 1.8 billion rows. The `category_artist_runtime_cache` already exists but the population queries still scan the full videos table each time a genre cache is rebuilt.

**Sub-phases:**

**3a — Cache population rewrite (low-risk, high-impact)**
Rewrite the cache population queries in `catalog-data-genres.ts` to avoid full index scans. Options:
- Replace the no-WHERE full scan with a paginated approach or incremental refresh
- Use `artist_stats` table (which already has per-artist metadata) as the primary source for artist list queries, falling back to video scan only for cache misses
- Add a WHERE clause that limits to videos with `approved = 1` and joined through `site_videos` (already filtered in most queries but not the cache population)

**Files**: `apps/web/lib/catalog-data-genres.ts`, `apps/web/lib/catalog-data-artists.ts`

**3b — Cache invalidation strategy**
The current cache refresh does DELETE all rows for a genre, then INSERT new rows. This causes write amplification and leaves a window where the genre page has no data. Switch to:
- Write to a staging table, then RENAME TABLE atomically
- Or use a versioned cache key pattern

**Files**: `apps/web/lib/catalog-data-genres.ts`

**3c — Add index on `playlistitems.playlist_id`** (if profiling confirms need)
This was in the original Phase 3. No evidence from the profiling report that playlist queries are slow — but worth checking after Phase 1 fresh data.

**File**: `prisma/schema.prisma` (additive only) + migration

### Phase 4 — Telemetry Survivability
SIGTERM/SIGINT handlers to persist Prisma totals before shutdown. Restore on boot so `totalsSinceBoot` survives restarts.

- **File**: `apps/web/lib/perf-sample-persistence.ts`
- **Rationale**: Still shows 29 queries after 17.5h uptime. The telemetry ring buffer is losing data on restarts and possibly on buffer wrap.

### Phase 5 — Continuous Monitoring Infrastructure
New systemd service+timer for `scripts/monitor-performance.js` (30s polling, 7-day CSV retention). Companion alert script for high-severity events.

- **Files**: New `deploy/systemd/yehthatrocks-perf-monitor.service` + `.timer`

### Phase 6 — MySQL Configuration Tuning (depends on Phase 1)
Review and adjust:
- `innodb_buffer_pool_size` — DB is using 731 MB on a 2 GB VPS. The buffer pool may be oversized, causing memory pressure and swap.
- `innodb_log_file_size` — may be too large for the workload
- Connection limits
- Query cache (likely already disabled in MySQL 8, verify)

### Phase 7 — Schema-Model Index Drift Fix
Add `idx_videos_parsed_artist_norm_fav_view_videoid_id` to `schema.prisma` so Prisma is aware of it. This prevents future `prisma migrate dev` from potentially dropping it.

- **File**: `prisma/schema.prisma`
- **Index**: `@@index([parsedArtistNorm, favourited, viewCount, videoId, id], map: "idx_videos_parsed_artist_norm_fav_view_videoid_id")`

### Phase 8 — Verification and Handoff
`npm run verify:invariants`, confirm API response shape unchanged, produce handoff doc.

## Dependency Chain
```
Phase 1 ──→ Phase 3c, Phase 6
Phase 2 (independent)
Phase 3a, 3b (independent — can start now with June 7 data)
Phase 4 (independent)
Phase 5 (independent)
Phase 7 (independent — additive schema change)
All ──→ Phase 8
```

## Removed Items (from original roadmap)

| Original Item | Reason |
|---------------|--------|
| Hotspot 1 (MySQL CPU 97.95%) | Transient spike resolved — current CPU 6.56% |
| Hotspot 4 (Load average 3.22) | Resolved — current load 0.83 |
| Hotspot 6 (Recent Node restart) | Resolved — 17.5h uptime |
| Phase 3 original (generic "add indexes from slow log") | Replaced by targeted Phase 3a/3b based on concrete profiling evidence |

## Constraints
- No changes to `deploy/` scripts, CI/CD, or build pipeline
- No UX/frontend/API response shape changes
- Invariant scripts must pass after all changes

## Key Architecture Notes
- `runtime-profiler.ts`: in-memory 5-min ring buffer, 3s cache TTL
- `perf-sample-persistence.ts`: writes to `performance_telemetry_samples` every 30s, 24h retention
- `admin-dashboard-health.ts`: host metrics every 2 min to `admin_host_metric_samples`
- `memory-pressure-guard.ts`: checks every 15s, fires at 74% heap or 400MB RSS
- `use-performance-metrics.ts`: client polls `/api/status/performance` at 2.5s when modal open
- `db-profiling-report-freshness.ts`: scans logs/ for `db-profiling-report-*.txt` files
- Slow query scripts: `deploy/start-db-profiling.sh`, `deploy/export-db-profiling.sh`
- `category_artist_runtime_cache`: materialized artist-per-genre cache, populated via full video scan, cleared per-genre on invalidation
- `idx_videos_parsed_artist_norm_fav_view_videoid_id`: exists in production (migration `20260418153000`) but NOT in `schema.prisma` — schema-model drift risk

## How to Resume
Say: "continue the performance roadmap" — the agent should read this file and pick up from the next pending phase. Phase 3a/3b are the highest-impact items and can start immediately.
