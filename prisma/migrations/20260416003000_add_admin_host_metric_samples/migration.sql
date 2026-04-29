CREATE TABLE `admin_host_metric_samples` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `bucket_start` DATETIME(3) NOT NULL,
    `cpu_usage_percent` DOUBLE NULL,
    `cpu_average_usage_percent` DOUBLE NULL,
    `cpu_peak_core_usage_percent` DOUBLE NULL,
    `memory_usage_percent` DOUBLE NULL,
    `disk_usage_percent` DOUBLE NULL,
    `swap_usage_percent` DOUBLE NULL,
    `network_usage_percent` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_host_metric_samples_bucket_start_key`(`bucket_start`),
    INDEX `admin_host_metric_samples_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;