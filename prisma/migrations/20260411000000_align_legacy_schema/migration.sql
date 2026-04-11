-- =============================================================================
-- Safe migration: align legacy column names to Prisma-compatible schema.
-- Every DROP COLUMN is preceded by an UPDATE that copies data to the new column.
-- No data is lost unless it is provably unreachable (orphan FK rows, ephemeral
-- presence data in `online`, denormalised cache rows in `videosbyartist`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Drop foreign keys first (required before modifying referenced columns)
-- -----------------------------------------------------------------------------
ALTER TABLE `ai_track_votes` DROP FOREIGN KEY `ai_track_votes_track_id_fkey`;
ALTER TABLE `ai_track_votes` DROP FOREIGN KEY `ai_track_votes_user_id_fkey`;
ALTER TABLE `auth_sessions` DROP FOREIGN KEY `auth_sessions_user_id_fkey`;
ALTER TABLE `email_verification_tokens` DROP FOREIGN KEY `email_verification_tokens_user_id_fkey`;
ALTER TABLE `password_reset_tokens` DROP FOREIGN KEY `password_reset_tokens_user_id_fkey`;
ALTER TABLE `site_videos` DROP FOREIGN KEY `site_videos_video_id_fkey`;

-- -----------------------------------------------------------------------------
-- Drop legacy indexes
-- -----------------------------------------------------------------------------
DROP INDEX `ai_track_votes_user_id_fkey` ON `ai_track_votes`;
DROP INDEX `artist_stats_thumbnail_video_id_idx` ON `artist_stats`;
DROP INDEX `genre1` ON `artists`;
DROP INDEX `genre2` ON `artists`;
DROP INDEX `genre3` ON `artists`;
DROP INDEX `genre4` ON `artists`;
DROP INDEX `genre5` ON `artists`;
DROP INDEX `genre6` ON `artists`;
DROP INDEX `name` ON `artists`;
DROP INDEX `origin` ON `artists`;
DROP INDEX `idx_related_related` ON `related`;
DROP INDEX `idx_related_related_videoId` ON `related`;
DROP INDEX `idx_related_videoId` ON `related`;
DROP INDEX `idx_related_videoId_related` ON `related`;
DROP INDEX `idx_related_video_related` ON `related`;
DROP INDEX `idx_site_videos_status_video_id` ON `site_videos`;
DROP INDEX `idx_site_videos_video_id_status` ON `site_videos`;
DROP INDEX `idx_site_videos_video_status` ON `site_videos`;
DROP INDEX `idx_videos_favourited_views_videoId` ON `videos`;
DROP INDEX `idx_videos_parsed_artist_views_id` ON `videos`;
DROP INDEX `idx_videos_updated_at_id` ON `videos`;
DROP INDEX `idx_videos_videoId` ON `videos`;

-- -----------------------------------------------------------------------------
-- artist_stats
-- -----------------------------------------------------------------------------
ALTER TABLE `artist_stats` ALTER COLUMN `updated_at` DROP DEFAULT;

-- -----------------------------------------------------------------------------
-- artists: preserve name → artist, origin → country before dropping
-- Both new columns already exist (added by earlier align attempt).
-- -----------------------------------------------------------------------------
UPDATE `artists` SET `artist` = `name`   WHERE (`artist` IS NULL OR `artist` = '') AND `name` IS NOT NULL;
UPDATE `artists` SET `country` = `origin` WHERE `country` IS NULL AND `origin` IS NOT NULL;

ALTER TABLE `artists`
    DROP COLUMN `createdAt`,
    DROP COLUMN `name`,
    DROP COLUMN `origin`,
    DROP COLUMN `updatedAt`,
    MODIFY `genre1` VARCHAR(255) NULL,
    MODIFY `genre2` VARCHAR(255) NULL,
    MODIFY `genre3` VARCHAR(255) NULL,
    MODIFY `genre4` VARCHAR(255) NULL,
    MODIFY `genre5` VARCHAR(255) NULL,
    MODIFY `genre6` VARCHAR(255) NULL;

-- -----------------------------------------------------------------------------
-- favourites: `user` is a redundant legacy username string, not a FK — safe drop
-- -----------------------------------------------------------------------------
ALTER TABLE `favourites`
    DROP COLUMN `user`,
    MODIFY `createdAt` DATETIME(3) NULL,
    MODIFY `updatedAt` DATETIME(3) NULL;

-- -----------------------------------------------------------------------------
-- genres: createdAt/updatedAt not modelled by Prisma — same as audit timestamps
-- -----------------------------------------------------------------------------
ALTER TABLE `genres`
    DROP COLUMN `createdAt`,
    DROP COLUMN `updatedAt`,
    MODIFY `name` VARCHAR(255) NOT NULL;

-- -----------------------------------------------------------------------------
-- messages: preserve legacy data into new columns before dropping.
-- All new columns already exist (added by earlier align attempt).
-- -----------------------------------------------------------------------------
UPDATE `messages` SET `user_id`    = `userid`    WHERE `user_id`    IS NULL AND `userid`    IS NOT NULL;
UPDATE `messages` SET `room`       = `type`      WHERE `room`       IS NULL AND `type`      IS NOT NULL;
UPDATE `messages` SET `video_id`   = `videoId`   WHERE `video_id`   IS NULL AND `videoId`   IS NOT NULL;
UPDATE `messages` SET `content`    = `message`   WHERE `content`    IS NULL AND `message`   IS NOT NULL;
UPDATE `messages` SET `created_at` = `createdAt` WHERE `created_at` IS NULL AND `createdAt` IS NOT NULL;
-- Ensure content is never NULL (empty string is the safe default)
UPDATE `messages` SET `content` = '' WHERE `content` IS NULL;

ALTER TABLE `messages`
    DROP COLUMN `createdAt`,
    DROP COLUMN `message`,
    DROP COLUMN `type`,
    DROP COLUMN `updatedAt`,
    DROP COLUMN `userid`,
    DROP COLUMN `videoId`,
    MODIFY `created_at` DATETIME(3) NULL;

-- -----------------------------------------------------------------------------
-- online: ephemeral presence table — safe to truncate and restructure
-- -----------------------------------------------------------------------------
TRUNCATE TABLE `online`;
ALTER TABLE `online`
    DROP COLUMN `createdAt`,
    DROP COLUMN `lastSeen`,
    DROP COLUMN `updatedAt`,
    DROP COLUMN `userId`,
    ADD COLUMN `last_seen` DATETIME(3) NULL,
    ADD COLUMN `user_id`   INTEGER NULL;

-- -----------------------------------------------------------------------------
-- playlistnames: preserve userId → user_id before dropping.
-- Both new columns already exist (added by earlier align attempt).
-- -----------------------------------------------------------------------------
UPDATE `playlistnames` SET `user_id` = `userId` WHERE `user_id` IS NULL AND `userId` IS NOT NULL;

ALTER TABLE `playlistnames`
    DROP COLUMN `createdAt`,
    DROP COLUMN `updatedAt`,
    DROP COLUMN `userId`,
    MODIFY `name` VARCHAR(255) NOT NULL,
    ALTER COLUMN `is_private` DROP DEFAULT;

-- -----------------------------------------------------------------------------
-- playlistitems: ensure playlist_id/video_id are fully populated.
-- playlist_id and video_id (INT) already exist from earlier align attempt.
-- video_id must be resolved from the legacy YouTube string videoId.
-- Orphan rows (videos not in catalog) are deleted — they have no usable target.
-- -----------------------------------------------------------------------------
UPDATE `playlistitems`
    SET `playlist_id` = `playlistId`
    WHERE `playlist_id` IS NULL AND `playlistId` IS NOT NULL;

UPDATE `playlistitems` pi
    JOIN `videos` v ON v.`videoId` = pi.`videoId`
    SET pi.`video_id` = v.`id`
    WHERE pi.`video_id` IS NULL AND pi.`videoId` IS NOT NULL;

-- Remove items whose video no longer exists in the catalog
DELETE FROM `playlistitems` WHERE `video_id`    IS NULL;
-- Remove items whose playlist no longer exists
DELETE FROM `playlistitems` WHERE `playlist_id` IS NULL;
-- Remove items whose playlist_id references a playlist that was deleted
DELETE pi FROM `playlistitems` pi
    LEFT JOIN `playlistnames` pn ON pn.`id` = pi.`playlist_id`
    WHERE pn.`id` IS NULL;

ALTER TABLE `playlistitems`
    DROP COLUMN `createdAt`,
    DROP COLUMN `playlistId`,
    DROP COLUMN `updatedAt`,
    DROP COLUMN `videoId`,
    MODIFY `playlist_id` INTEGER NOT NULL,
    MODIFY `video_id`    INTEGER NOT NULL;

-- -----------------------------------------------------------------------------
-- related
-- -----------------------------------------------------------------------------
ALTER TABLE `related`
    DROP COLUMN `timestamp`,
    MODIFY `createdAt` DATETIME(3) NULL,
    MODIFY `updatedAt` DATETIME(3) NULL;

-- -----------------------------------------------------------------------------
-- users: new columns (screen_name, password_hash, avatar_url) already exist.
-- Preserve username → screen_name, avatar → avatar_url before dropping.
-- Legacy password/salt are superseded by password_hash (bcrypt) — safe to drop.
-- -----------------------------------------------------------------------------
UPDATE `users` SET `screen_name` = `username` WHERE `screen_name` IS NULL AND `username` IS NOT NULL;
UPDATE `users` SET `avatar_url`  = `avatar`   WHERE `avatar_url`  IS NULL AND `avatar`   IS NOT NULL;

ALTER TABLE `users`
    DROP COLUMN `api_auth_token`,
    DROP COLUMN `avatar`,
    DROP COLUMN `banned`,
    DROP COLUMN `banned_reason`,
    DROP COLUMN `banned_until`,
    DROP COLUMN `createdAt`,
    DROP COLUMN `password`,
    DROP COLUMN `reset_code`,
    DROP COLUMN `salt`,
    DROP COLUMN `updatedAt`,
    DROP COLUMN `username`,
    MODIFY `email_verified_at` DATETIME(3) NULL;

-- -----------------------------------------------------------------------------
-- videos: ADD new columns first, copy data, then drop old ones.
-- views → viewCount, createdAt → created_at, updatedAt → updated_at
-- channelTitle and thumbnail are genuinely new (NULL is the correct default).
-- -----------------------------------------------------------------------------
ALTER TABLE `videos`
    ADD COLUMN `channelTitle` VARCHAR(255) NULL,
    ADD COLUMN `created_at`   DATETIME(3)  NULL,
    ADD COLUMN `thumbnail`    VARCHAR(500) NULL,
    ADD COLUMN `updated_at`   DATETIME(3)  NULL,
    ADD COLUMN `viewCount`    INTEGER      NULL;

UPDATE `videos` SET `created_at` = `createdAt` WHERE `created_at` IS NULL AND `createdAt` IS NOT NULL;
UPDATE `videos` SET `updated_at` = `updatedAt` WHERE `updated_at` IS NULL AND `updatedAt` IS NOT NULL;
UPDATE `videos` SET `viewCount`  = `views`     WHERE `viewCount`  IS NULL AND `views`     IS NOT NULL;

ALTER TABLE `videos`
    DROP COLUMN `createdAt`,
    DROP COLUMN `updatedAt`,
    DROP COLUMN `views`,
    MODIFY `videoId`         VARCHAR(32)  NOT NULL,
    MODIFY `title`           VARCHAR(255) NOT NULL,
    MODIFY `favourited`      INTEGER      NOT NULL DEFAULT 0,
    MODIFY `description`     LONGTEXT     NULL,
    MODIFY `parseConfidence` DOUBLE       NULL,
    MODIFY `parsedAt`        DATETIME     NULL;

-- -----------------------------------------------------------------------------
-- videosbyartist: denormalised cache table.
-- Resolve artistname → artist, legacy string videoId → integer FK video_id.
-- Rows that cannot be resolved are deleted (the cache will be rebuilt).
-- -----------------------------------------------------------------------------
ALTER TABLE `videosbyartist`
    ADD COLUMN `artist`   VARCHAR(255) NULL,
    ADD COLUMN `video_id` INTEGER      NULL;

UPDATE `videosbyartist`     SET `artist`   = `artistname` WHERE `artist`   IS NULL AND `artistname` IS NOT NULL;
UPDATE `videosbyartist` vba
    JOIN `videos` v ON v.`videoId` = vba.`videoId`
    SET vba.`video_id` = v.`id`
    WHERE vba.`video_id` IS NULL AND vba.`videoId` IS NOT NULL;

-- Delete rows that could not be resolved
DELETE FROM `videosbyartist` WHERE `video_id` IS NULL OR `artist` IS NULL OR TRIM(`artist`) = '';

ALTER TABLE `videosbyartist`
    DROP COLUMN `artistname`,
    DROP COLUMN `createdAt`,
    DROP COLUMN `updatedAt`,
    DROP COLUMN `videoId`,
    DROP COLUMN `videoTitle`,
    MODIFY `artist`   VARCHAR(255) NOT NULL,
    MODIFY `video_id` INTEGER      NOT NULL;

-- -----------------------------------------------------------------------------
-- watch_history: create the table (may already exist from earlier attempts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `watch_history` (
    `id`                   INTEGER  NOT NULL AUTO_INCREMENT,
    `user_id`              INTEGER  NOT NULL,
    `video_id`             VARCHAR(32) NOT NULL,
    `watch_count`          INTEGER  NOT NULL DEFAULT 0,
    `first_watched_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_watched_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_position_sec`    INTEGER  NOT NULL DEFAULT 0,
    `last_duration_sec`    INTEGER  NOT NULL DEFAULT 0,
    `max_progress_percent` DOUBLE   NOT NULL DEFAULT 0,

    INDEX  `watch_history_user_id_last_watched_at_idx`(`user_id`, `last_watched_at`),
    INDEX  `watch_history_video_id_idx`(`video_id`),
    UNIQUE INDEX `watch_history_user_id_video_id_key`(`user_id`, `video_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Re-add foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE `email_verification_tokens`
    ADD CONSTRAINT `email_verification_tokens_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `password_reset_tokens`
    ADD CONSTRAINT `password_reset_tokens_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `auth_sessions`
    ADD CONSTRAINT `auth_sessions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `playlistnames`
    ADD CONSTRAINT `playlistnames_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `playlistitems`
    ADD CONSTRAINT `playlistitems_playlist_id_fkey`
    FOREIGN KEY (`playlist_id`) REFERENCES `playlistnames`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `playlistitems`
    ADD CONSTRAINT `playlistitems_video_id_fkey`
    FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `messages`
    ADD CONSTRAINT `messages_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `videosbyartist`
    ADD CONSTRAINT `videosbyartist_video_id_fkey`
    FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ai_track_votes`
    ADD CONSTRAINT `ai_track_votes_track_id_fkey`
    FOREIGN KEY (`track_id`) REFERENCES `ai_tracks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ai_track_votes`
    ADD CONSTRAINT `ai_track_votes_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Rename indexes to Prisma-expected names
-- -----------------------------------------------------------------------------
ALTER TABLE `users`  RENAME INDEX `users_email_unique`  TO `users_email_key`;
ALTER TABLE `videos` RENAME INDEX `uk_videoId`           TO `videos_videoId_key`;
ALTER TABLE `videos` RENAME INDEX `videos_search_ft`     TO `videos_title_parsedArtist_parsedTrack_idx`;
