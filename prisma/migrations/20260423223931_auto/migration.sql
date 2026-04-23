-- CreateTable
CREATE TABLE `rejected_videos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `video_id` VARCHAR(32) NOT NULL,
    `reason` VARCHAR(100) NOT NULL,
    `rejected_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX `rejected_videos_video_id_key`(`video_id`),
    INDEX `idx_rejected_videos_video_id`(`video_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `idx_videos_created_at_id` ON `videos`(`created_at` DESC, `id` DESC);
