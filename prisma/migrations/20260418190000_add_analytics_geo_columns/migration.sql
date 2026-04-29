ALTER TABLE analytics_events
  ADD COLUMN geo_lat DECIMAL(9,6) NULL,
  ADD COLUMN geo_lng DECIMAL(9,6) NULL,
  ADD COLUMN geo_accuracy_m FLOAT NULL;

CREATE INDEX analytics_events_geo_created_idx
  ON analytics_events (created_at, geo_lat, geo_lng);
