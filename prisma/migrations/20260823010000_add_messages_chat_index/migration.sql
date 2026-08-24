-- Chat message fetches filter by (room, videoId) and order by (created_at, id)
-- descending with LIMIT 20. Without an index every fetch scans the full table.
-- The composite index covers both query shapes:
--   global: room = 'global'  OR  (room IS NULL AND video_id IS NULL)
--   video:  room = 'video' AND video_id = ?
ALTER TABLE messages
  ADD INDEX idx_messages_room_videoid_created (room, video_id, created_at, id);
