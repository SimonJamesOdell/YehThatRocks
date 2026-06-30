-- AlterTable: forum_threads — add track battle video columns
ALTER TABLE `forum_threads`
  ADD COLUMN `video1_id` VARCHAR(11) NULL AFTER `view_count`,
  ADD COLUMN `video2_id` VARCHAR(11) NULL AFTER `video1_id`;

-- CreateTable: forum_votes
CREATE TABLE IF NOT EXISTS `forum_votes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `thread_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `vote` TINYINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_forum_vote_thread_user` (`thread_id`, `user_id`),
  KEY `idx_forum_votes_thread` (`thread_id`),
  KEY `fk_forum_votes_user` (`user_id`),
  CONSTRAINT `fk_forum_votes_thread` FOREIGN KEY (`thread_id`) REFERENCES `forum_threads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_forum_votes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
