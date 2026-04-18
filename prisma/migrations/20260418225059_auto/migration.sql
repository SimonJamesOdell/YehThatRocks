-- AlterTable
ALTER TABLE `analytics_events` ADD COLUMN `geo_accuracy_m` DOUBLE NULL,
    ADD COLUMN `geo_lat` DECIMAL(9, 6) NULL,
    ADD COLUMN `geo_lng` DECIMAL(9, 6) NULL;
