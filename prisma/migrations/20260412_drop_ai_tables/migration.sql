-- AI feature was dropped. Remove legacy AI tables safely.
-- Drop child table first to avoid FK dependency issues.
DROP TABLE IF EXISTS `ai_track_votes`;
DROP TABLE IF EXISTS `ai_tracks`;
