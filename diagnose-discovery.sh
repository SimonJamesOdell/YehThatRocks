#!/bin/bash
set -e

echo "=== DB Stats ==="
MYSQL_PASS=$(grep MYSQL_PASSWORD /srv/yehthatrocks/.env.production | cut -d= -f2-)

docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e "
SELECT COUNT(*) AS total_videos FROM videos;
SELECT COUNT(*) AS approved_videos FROM videos WHERE approved = 1;
SELECT COUNT(*) AS pending_videos FROM videos WHERE COALESCE(approved, 0) = 0;
SELECT videoId, parsedArtist, parsedTrack, approved, created_at FROM videos ORDER BY created_at DESC LIMIT 12;
"

echo ""
echo "=== Related links count ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e "
SELECT COUNT(*) AS total_related FROM related;
SELECT COUNT(DISTINCT videoId) AS videos_with_related FROM related;
"

echo ""
echo "=== Site videos status ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e "
SELECT status, COUNT(*) AS cnt FROM site_videos GROUP BY status;
"

echo ""
echo "=== Nginx daily-discovery hits ==="
grep 'daily-discovery' /var/log/nginx/access.log | tail -5 || echo "No daily-discovery hits found in nginx access log"

echo ""
echo "=== Nginx access log last 3 entries ==="
tail -3 /var/log/nginx/access.log

echo ""
echo "=== Docker web-1 logs: discovery-related ==="
docker logs yehthatrocks-web-1 2>&1 | grep -iE 'discovery|backfill|daily-discovery' | tail -10 || echo "No discovery logs found"

echo ""
echo "=== Check ENABLE_YOUTUBE_RELATED_DISCOVERY in running container ==="
docker exec yehthatrocks-web-1 sh -c 'echo "ENABLE_YOUTUBE_RELATED_DISCOVERY=$ENABLE_YOUTUBE_RELATED_DISCOVERY"'
docker exec yehthatrocks-web-1 sh -c 'echo "YOUTUBE_DATA_API_KEY set: $([ -n \"$YOUTUBE_DATA_API_KEY\" ] && echo YES || echo NO)"'

echo ""
echo "=== Systemd timers (project-related) ==="
systemctl list-timers --no-pager --all 2>&1 | grep -iE 'discovery|magazine|admin-dashboard|sitemap|yehthatrocks'

echo ""
echo "=== Daily-discovery systemd files ==="
ls -la /etc/systemd/system/daily-discovery* 2>&1 || echo "NO daily-discovery systemd files found"
echo ""
echo "=== Check for alternative scheduler/cron ==="
crontab -l 2>&1 || echo "No crontab"
ls -la /etc/cron.d/*yeh* /etc/cron.d/*discovery* 2>&1 || echo "No cron.d files for yeh/discovery"

echo ""
echo "=== Recent video approvals ==="
docker exec yehthatrocks-db-1 mysql -u yeh -p"$MYSQL_PASS" yeh -e "
SELECT videoId, parsedArtist, parsedTrack, created_at, updated_at FROM videos WHERE approved = 1 ORDER BY updated_at DESC LIMIT 10;
"
