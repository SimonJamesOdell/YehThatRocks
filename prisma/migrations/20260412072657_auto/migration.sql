-- AI feature was dropped. Remove legacy AI tables safely and idempotently.
DROP TABLE IF EXISTS `ai_track_votes`;
DROP TABLE IF EXISTS `ai_tracks`;
