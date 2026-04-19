-- CreateIndex
CREATE INDEX `related_videoId_related_idx` ON `related`(`videoId`, `related`);

-- CreateIndex
CREATE INDEX `related_related_videoId_idx` ON `related`(`related`, `videoId`);
