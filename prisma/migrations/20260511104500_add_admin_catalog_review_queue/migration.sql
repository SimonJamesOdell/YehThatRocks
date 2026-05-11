CREATE TABLE IF NOT EXISTS `admin_catalog_review_queue` (
  `video_id` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `enqueued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`video_id`),
  KEY `idx_admin_catalog_review_queue_enqueued_at` (`enqueued_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_catalog_review_queue_meta` (
  `id` INT NOT NULL,
  `initialized_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
