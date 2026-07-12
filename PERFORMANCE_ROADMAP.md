# Performance Improvement Roadmap — yehthatrocks.com

**Created**: 2026-07-12 17:49 UTC
**Status**: Paused — all phases pending
**Sources**: 3 live `/api/status/performance` snapshots + VPS host metrics via SSH

## Detected Hotspots (full report in session)

| # | Hotspot | Severity |
|---|---------|----------|
| 1 | MySQL container CPU 97.95% | CRITICAL |
| 2 | Node.js heap +51% in 70s (113→171 MB) | HIGH |
| 3 | System memory pressure (594 MB swap of 2 GB) | MODERATE |
| 4 | Load average 3.22 on ~2 vCPU | MODERATE |
| 5 | Prisma telemetry blind spot (0 queries after restart) | MODERATE |
| 6 | Recent Node restart (13.5 min uptime, server up 3d 7h) | MODERATE |
| 7 | No continuous monitoring on VPS | LOW |
| 8 | Missing DB profiling report (slow query log OFF) | LOW |

## Phases

### Phase 1 — Immediate Diagnostics
**Zero code changes.** Enable slow query log via `POST /api/admin/performance-samples`, deploy `scripts/monitor-performance.js` as systemd timer on VPS. Collect 24h data.

### Phase 2 — Memory Guard Hardening
Lower RSS threshold from 400MB → 280MB. Add explicit `global.gc()` after cache relief. Log pre-relief heap state to `performance_telemetry_samples`.

- **File**: `apps/web/lib/memory-pressure-guard.ts`

### Phase 3 — DB Index Analysis (depends on Phase 1)
Add missing index on `playlistitems.playlist_id`. Add any indexes indicated by slow query analysis.

- **File**: `prisma/schema.prisma` (additive only) + migration

### Phase 4 — Telemetry Survivability
SIGTERM/SIGINT handlers to persist Prisma totals before shutdown. Restore on boot so `totalsSinceBoot` survives restarts.

- **File**: `apps/web/lib/perf-sample-persistence.ts`

### Phase 5 — Continuous Monitoring Infrastructure
New systemd service+timer for `scripts/monitor-performance.js` (30s polling, 7-day CSV retention). Companion alert script for high-severity events.

- **Files**: New `deploy/systemd/yehthatrocks-perf-monitor.service` + `.timer`

### Phase 6 — MySQL Configuration Tuning (depends on Phase 1+3)
Review InnoDB buffer pool size, connection limits, query cache.

### Phase 7 — Verification and Handoff
`npm run verify:invariants`, confirm API response shape unchanged, produce handoff doc.

## Dependency Chain
```
Phase 1 ──→ Phase 3 ──→ Phase 6
Phase 2 (independent)
Phase 4 (independent)
Phase 5 (independent)
All ──→ Phase 7
```

## Constraints
- No changes to deploy/ scripts, CI/CD, or build pipeline
- No UX/frontend/API response shape changes
- Invariant scripts must pass after all changes

## Key Architecture Notes
- `runtime-profiler.ts`: in-memory 5-min ring buffer, 3s cache TTL
- `perf-sample-persistence.ts`: writes to `performance_telemetry_samples` every 30s, 24h retention
- `admin-dashboard-health.ts`: host metrics every 2 min to `admin_host_metric_samples`
- `memory-pressure-guard.ts`: checks every 15s, fires at 74% heap or 400MB RSS
- `use-performance-metrics.ts`: client polls `/api/status/performance` at 2.5s when modal open
- `db-profiling-report-freshness.ts`: scans logs/ for `db-profiling-report-*.txt` files
- Slow query scripts: `deploy/start-db-profiling.sh`, `deploy/export-db-profiling.sh` (not running)
- No systemd timer for `scripts/monitor-performance.js`

## How to Resume
Say: "continue the performance roadmap" — the agent should read this file (`PERFORMANCE_ROADMAP.md`) and pick up from Phase 1.
