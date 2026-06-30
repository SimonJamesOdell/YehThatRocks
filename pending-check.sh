#!/bin/bash
MYSQL_PASS=$(grep MYSQL_PASSWORD /srv/yehthatrocks/.env.production | cut -d= -f2-)

echo "=== Admin panel pending (excludes rejected_videos) ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e \
  "SELECT COUNT(*) AS admin_pending FROM videos WHERE (approved = 0 OR approved IS NULL) AND NOT EXISTS (SELECT 1 FROM rejected_videos rv WHERE rv.video_id = videoId);"

echo ""
echo "=== Rejected but still unapproved ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e \
  "SELECT COUNT(*) AS rejected_unapproved FROM videos WHERE (approved = 0 OR approved IS NULL) AND EXISTS (SELECT 1 FROM rejected_videos rv WHERE rv.video_id = videoId);"

echo ""
echo "=== The 12 unapproved videos with their rejection status ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e \
  "SELECT v.videoId, v.parsedArtist, v.parsedTrack, v.created_at, IF(rv.video_id IS NOT NULL, 'REJECTED', 'PENDING') AS status FROM videos v LEFT JOIN rejected_videos rv ON rv.video_id = v.videoId WHERE v.approved = 0 OR v.approved IS NULL ORDER BY v.created_at DESC LIMIT 12;"

echo ""
echo "=== Total in rejected_videos ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e \
  "SELECT COUNT(*) AS total_rejected FROM rejected_videos;"
