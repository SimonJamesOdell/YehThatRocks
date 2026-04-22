CREATE TABLE `lyrics_cache` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `artist_name` VARCHAR(255) NOT NULL,
  `track_name` VARCHAR(255) NOT NULL,
  `normalized_artist` VARCHAR(255) NOT NULL,
  `normalized_track` VARCHAR(255) NOT NULL,
  `lyrics` LONGTEXT NULL,
  `source` VARCHAR(50) NULL,
  `source_record_id` INT NULL,
  `is_instrumental` BOOLEAN NOT NULL DEFAULT false,
  `is_unavailable` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `lyrics_cache_signature_key`(`normalized_artist`, `normalized_track`),
  INDEX `lyrics_cache_updated_at_idx`(`updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
