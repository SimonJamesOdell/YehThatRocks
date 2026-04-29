CREATE TABLE watch_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  video_id VARCHAR(32) NOT NULL,
  watch_count INT NOT NULL DEFAULT 0,
  first_watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_position_sec INT NOT NULL DEFAULT 0,
  last_duration_sec INT NOT NULL DEFAULT 0,
  max_progress_percent FLOAT NOT NULL DEFAULT 0,
  UNIQUE KEY watch_history_user_video_unique (user_id, video_id),
  KEY watch_history_user_last_watched_idx (user_id, last_watched_at),
  KEY watch_history_video_idx (video_id)
);
