-- CreateTable
CREATE TABLE IF NOT EXISTS `hidden_videos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `video_id` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hidden_videos_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `hidden_videos_video_id_idx`(`video_id`),
    UNIQUE INDEX `hidden_videos_user_id_video_id_key`(`user_id`, `video_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
