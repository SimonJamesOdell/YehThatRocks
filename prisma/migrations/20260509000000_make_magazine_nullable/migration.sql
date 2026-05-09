-- Make video_id and track_name nullable to support non-video articles
ALTER TABLE `magazine_articles` 
  MODIFY `track_name` VARCHAR(255) NULL,
  MODIFY `video_id` VARCHAR(32) NULL;
