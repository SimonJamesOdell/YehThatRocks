-- CreateTable: forum_threads
CREATE TABLE IF NOT EXISTS `forum_threads` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `section_id` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` INT NOT NULL,
  `is_pinned` TINYINT(1) NOT NULL DEFAULT 0,
  `is_locked` TINYINT(1) NOT NULL DEFAULT 0,
  `view_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_forum_threads_section` (`section_id`, `is_pinned` DESC, `created_at` DESC),
  KEY `idx_forum_threads_created` (`created_at` DESC),
  KEY `idx_forum_threads_user_id` (`user_id`),
  CONSTRAINT `forum_threads_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CreateTable: forum_posts
CREATE TABLE IF NOT EXISTS `forum_posts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `thread_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `content` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_forum_posts_thread` (`thread_id`, `created_at`),
  KEY `idx_forum_posts_user_id` (`user_id`),
  CONSTRAINT `forum_posts_thread_id_fkey` FOREIGN KEY (`thread_id`) REFERENCES `forum_threads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `forum_posts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
