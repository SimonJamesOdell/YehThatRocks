-- Manually exclude specific analytics/auth rows from downstream traffic rollups
-- so an admin can deterministically clean up a false traffic spike by dragging
-- graph handles. The bot classifier never touches this flag.
ALTER TABLE analytics_events
  ADD COLUMN manually_excluded BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE auth_audit_logs
  ADD COLUMN manually_excluded BOOLEAN NOT NULL DEFAULT false;
