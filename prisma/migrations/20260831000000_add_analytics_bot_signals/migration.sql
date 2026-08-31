ALTER TABLE analytics_events
  ADD COLUMN ip_hash VARCHAR(64) NULL,
  ADD COLUMN user_agent VARCHAR(512) NULL,
  ADD COLUMN is_suspected_bot BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX analytics_events_is_suspected_bot_created_at_idx
  ON analytics_events (is_suspected_bot, created_at);
