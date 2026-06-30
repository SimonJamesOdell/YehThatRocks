#!/bin/bash
MYSQL_PASS=$(grep MYSQL_PASSWORD /srv/yehthatrocks/.env.production | cut -d= -f2-)

echo "=== Related links count (before trigger ~15,813) ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e \
  "SELECT COUNT(*) AS total_related FROM related;"

echo ""
echo "=== Videos without related links (available for seeding) ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e \
  "SELECT COUNT(*) AS videos_without_related FROM videos v WHERE COALESCE(v.approved, 0) = 1 AND NOT EXISTS (SELECT 1 FROM related r WHERE r.videoId = v.videoId) AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available');"

echo ""
echo "=== Recent video imports (last 10 minutes) ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e \
  "SELECT videoId, parsedArtist, parsedTrack, created_at FROM videos WHERE created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE) ORDER BY created_at DESC LIMIT 20;"

echo ""
echo "=== YouTube API usage today ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e \
  "SELECT endpoint, SUM(units) AS total_units, COUNT(*) AS calls, MAX(created_at) AS last_call FROM api_usage_log WHERE provider='youtube' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) GROUP BY endpoint;" 2>/dev/null || echo "api_usage_log table not found or empty"

echo ""
echo "=== Latest related links (last 5) ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e \
  "SELECT r.videoId, r.relatedVideoId, r.created_at FROM related r ORDER BY r.created_at DESC LIMIT 5;"
