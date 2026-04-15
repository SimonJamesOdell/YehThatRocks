-- AlterTable
ALTER TABLE `videos` ADD COLUMN `parsed_artist_norm` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `artists` ADD COLUMN `artist_name_norm` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `idx_videos_parsed_artist_norm` ON `videos`(`parsed_artist_norm`);

-- CreateIndex
CREATE INDEX `idx_artists_artist_name_norm` ON `artists`(`artist_name_norm`);
