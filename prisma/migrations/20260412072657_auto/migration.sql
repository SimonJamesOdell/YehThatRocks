-- DropForeignKey
ALTER TABLE `ai_tracks` DROP FOREIGN KEY `ai_tracks_uploaded_by_fkey`;

-- DropForeignKey
ALTER TABLE `ai_track_votes` DROP FOREIGN KEY `ai_track_votes_track_id_fkey`;

-- DropForeignKey
ALTER TABLE `ai_track_votes` DROP FOREIGN KEY `ai_track_votes_user_id_fkey`;

-- DropTable
DROP TABLE `ai_tracks`;

-- DropTable
DROP TABLE `ai_track_votes`;
