-- CreateIndex
CREATE INDEX `favourites_userid_videoId_idx` ON `favourites`(`userid`, `videoId`);

-- CreateIndex
CREATE INDEX `favourites_videoId_idx` ON `favourites`(`videoId`);
