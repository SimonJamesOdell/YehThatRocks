CREATE TABLE hidden_videos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  video_id VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY hidden_videos_user_video_unique (user_id, video_id),
  KEY hidden_videos_user_created_idx (user_id, created_at),
  KEY hidden_videos_video_idx (video_id)
);
