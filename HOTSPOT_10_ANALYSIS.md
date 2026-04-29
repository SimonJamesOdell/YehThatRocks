# HOTSPOT 10: MySQL Slow Query Log Configuration Analysis

## Current State

### Configuration
- **slow_query_log**: OFF (disabled by default)
- **long_query_time**: 0.2s (200ms)
- **min_examined_row_limit**: 0 (no row limit)
- **log_output**: TABLE (mysql.slow_log table)

### Code Locations
- Constants: [apps/web/app/api/admin/performance-samples/route.ts](apps/web/app/api/admin/performance-samples/route.ts#L15-L17)
  - SLOW_LOG_LONG_QUERY_TIME = 0.2
  - SLOW_LOG_MIN_EXAMINED_ROW_LIMIT = 0
  - SLOW_LOG_OUTPUT = "TABLE"
  
- Deploy Scripts:
  - [deploy/start-db-profiling.sh](deploy/start-db-profiling.sh) - Enables slow query logging on demand
  - [deploy/export-db-profiling.sh](deploy/export-db-profiling.sh) - Exports and analyzes slow queries

### Current Limitations

1. **High Threshold (200ms)**
   - Misses performance issues in 50-200ms range
   - Only captures severe outliers
   - Many problematic queries fall below threshold
   
2. **Manual Activation Required**
   - Slow query log is OFF by default
   - Must run deploy script to enable
   - Temporary capture windows only
   - No continuous monitoring

3. **Performance Telemetry Sampling**
   - Application-level sampling every 30 seconds
   - Limited granularity
   - Misses transient spikes
   - No full query log coverage

## Problem Statement

**Issue**: Slow query log disabled with high threshold prevents effective performance diagnostics
- **Root Cause**: Conservative default settings to avoid overhead
- **Impact**: Limited visibility into mid-range performance issues
- **Severity**: LOW (diagnostic only, non-user-facing)

## Proposed Improvements

### 1. Lower Default Threshold
- **Current**: 0.2s (200ms)
- **Proposed**: 0.05s (50ms) or 0.1s (100ms)
- **Benefit**: Captures more performance issues
- **Trade-off**: More log volume (~3-5x), slight performance overhead

### 2. Make Thresholds Configurable
- Add environment variables for granular control
- Allow easy tuning based on environment (dev/staging/prod)
- Support multiple profiles (aggressive/balanced/conservative)

### 3. Improve Documentation
- Create guidance on optimal settings for different scenarios
- Document performance impact of different thresholds
- Provide runbooks for common profiling tasks

### 4. Enhanced Monitoring
- Option to enable slow query logging on schedule
- Better integration with admin dashboard
- Real-time threshold adjustment

## Performance Impact Analysis

### Query Log Volume Estimates
Based on typical application behavior:

| long_query_time | Estimated Queries/Hour | Log Size/Hour | Daily Size |
|-----------------|--------|-----------|---------|
| 0.5s (strict) | ~50 | ~200KB | ~5MB |
| 0.2s (current) | ~150 | ~600KB | ~14MB |
| 0.1s (recommended) | ~400 | ~1.6MB | ~38MB |
| 0.05s (aggressive) | ~1000 | ~4MB | ~96MB |

### Storage Requirements
- MySQL slow_log table: Auto-managed, can be rotated
- 24-hour retention: ~38MB at 0.1s threshold (manageable)
- Archive after export: Keeps disk usage bounded

### Performance Overhead
- Writing to mysql.slow_log table: <1% CPU impact
- Query analysis during profiling: <2% overhead
- Acceptable for diagnostic purposes

## Implementation Strategy

1. **Phase 1**: Lower default threshold to 0.1s (100ms)
   - Balance between visibility and overhead
   - Capture most performance issues
   
2. **Phase 2**: Make thresholds environment-configurable
   - Support SLOW_QUERY_LONG_TIME_THRESHOLD env var
   - Allow per-environment tuning
   
3. **Phase 3**: Enhanced monitoring (optional, future)
   - Scheduled slow query captures
   - Better admin UI integration

## Next Steps

✅ Document current state (this file)
→ Create tests showing threshold effectiveness
→ Implement configurable thresholds
→ Update deploy scripts
→ Update admin API with improved settings
→ Document optimal configurations for different scenarios
