-- AlterTable
ALTER TABLE `videos` ADD COLUMN `genre_norm` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `idx_videos_genre_norm_approved_fav` ON `videos`(`genre_norm`, `approved`, `favourited` DESC);

-- Backfill genre_norm from existing genre column
UPDATE `videos`
SET `genre_norm` = LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`genre`, '-', ' '), '_', ' '), '/', ' '), '.', ' '), ',', ' ')))
WHERE `genre` IS NOT NULL AND TRIM(`genre`) <> '';
