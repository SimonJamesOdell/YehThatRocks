-- CreateTable
CREATE TABLE `analytics_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `event_type` VARCHAR(32) NOT NULL,
    `visitor_id` VARCHAR(64) NOT NULL,
    `session_id` VARCHAR(64) NOT NULL,
    `is_new_visitor` BOOLEAN NOT NULL DEFAULT false,
    `user_id` INTEGER NULL,
    `video_id` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `analytics_events_created_at_idx`(`created_at`),
    INDEX `analytics_events_visitor_id_idx`(`visitor_id`),
    INDEX `analytics_events_session_id_idx`(`session_id`),
    INDEX `analytics_events_event_type_created_at_idx`(`event_type`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
