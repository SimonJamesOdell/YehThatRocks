-- Cleanup bot traffic spike from 2026-07-22 09:00-10:00 UTC
-- Tencent Cloud bot scrape (43.172.0.0/15) — blocked at nginx at 09:50 UTC

-- 1. Remove raw analytics events from the spike hour
DELETE FROM analytics_events
WHERE created_at >= '2026-07-22 09:00:00'
  AND created_at < '2026-07-22 10:00:00';

-- 2. Remove the corrupted hourly rollup bucket
DELETE FROM admin_dashboard_analytics_hourly
WHERE bucket_start = '2026-07-22 09:00:00';

-- 3. Remove auth audit log entries from Tencent Cloud during the spike
DELETE FROM auth_audit_logs
WHERE ip_address LIKE '43.17%'
  AND created_at >= '2026-07-22 09:00:00'
  AND created_at < '2026-07-22 10:00:00';

-- 4. Invalidate dashboard cache so it regenerates from clean data
DELETE FROM admin_dashboard_cache WHERE id = 1;

-- Verify
SELECT 'analytics_events_09:00' AS label, COUNT(*) AS remaining FROM analytics_events WHERE created_at >= '2026-07-22 09:00:00' AND created_at < '2026-07-22 10:00:00';
SELECT 'hourly_rollup_09:00' AS label, COUNT(*) AS remaining FROM admin_dashboard_analytics_hourly WHERE bucket_start = '2026-07-22 09:00:00';
SELECT 'auth_logs_43_17_09:00' AS label, COUNT(*) AS remaining FROM auth_audit_logs WHERE ip_address LIKE '43.17%' AND created_at >= '2026-07-22 09:00:00' AND created_at < '2026-07-22 10:00:00';
SELECT 'today_hourly' AS label, DATE_FORMAT(created_at, '%Y-%m-%d %H:00') AS hr, COUNT(*) AS events FROM analytics_events WHERE created_at >= '2026-07-22 00:00:00' GROUP BY hr ORDER BY hr;
