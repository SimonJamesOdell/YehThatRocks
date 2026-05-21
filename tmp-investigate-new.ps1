$ErrorActionPreference = "Stop"
Set-Location "c:\Users\simon\yeh2"
$sshHost = if ($env:YTR_VPS_HOST) { $env:YTR_VPS_HOST } else { "root@206.189.122.114" }
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$localDump = "backups/live/yeh_live_stream_$ts.sql"
New-Item -ItemType Directory -Force backups/live | Out-Null
Write-Host "STEP1 host=$sshHost"
ssh $sshHost "cd /srv/yehthatrocks; docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db sh -lc 'mysqldump -u\"`$MYSQL_USER\" -p\"`$MYSQL_PASSWORD\" --single-transaction --no-tablespaces --routines --skip-triggers \"`$MYSQL_DATABASE\"'" > $localDump
if (!(Test-Path $localDump)) { throw "dump not created" }
$fi = Get-Item $localDump
Write-Host ("STEP2 dump=" + $fi.FullName + " size=" + $fi.Length)

docker compose up -d db | Out-Host
$dbCtr = (docker compose ps -q db).Trim()
if ([string]::IsNullOrWhiteSpace($dbCtr)) { throw "local db container missing" }
docker cp $localDump "${dbCtr}:/tmp/live_stream.sql" | Out-Host

docker compose exec -T db /bin/sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE IF EXISTS yeh; CREATE DATABASE yeh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"' | Out-Host
docker compose exec -T db /bin/sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot yeh < /tmp/live_stream.sql' | Out-Host
Write-Host "STEP3 restore complete"

Write-Host "===Q0 sanity==="
docker compose exec -T db /bin/sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"yeh\"; SELECT COUNT(*) FROM videos; SELECT COUNT(*) FROM site_videos;" yeh'

Write-Host "===Q1 approved totals==="
docker compose exec -T db /bin/sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Nse "SELECT (SELECT COUNT(*) FROM videos WHERE COALESCE(approved,0)=1) AS approved_total, (SELECT COUNT(*) FROM videos v WHERE COALESCE(v.approved,0)=1 AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id=v.id AND sv.status=\"available\")) AS approved_available_total, (SELECT COUNT(*) FROM videos v WHERE COALESCE(v.approved,0)=1 AND NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id=v.id AND sv.status=\"available\")) AS approved_without_available;" yeh'

Write-Host "===Q2 newest cutoff created_at top100==="
docker compose exec -T db /bin/sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Nse "SELECT created_at FROM videos v WHERE COALESCE(v.approved,0)=1 AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id=v.id AND sv.status=\"available\") ORDER BY v.created_at DESC, v.id DESC LIMIT 1 OFFSET 99;" yeh'

Write-Host "===Q3 recent approved older-than-cutoff count==="
docker compose exec -T db /bin/sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Nse "WITH cutoff AS ( SELECT created_at AS c FROM videos v WHERE COALESCE(v.approved,0)=1 AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id=v.id AND sv.status=\"available\") ORDER BY v.created_at DESC, v.id DESC LIMIT 1 OFFSET 99 ) SELECT COUNT(*) FROM videos v, cutoff WHERE COALESCE(v.approved,0)=1 AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id=v.id AND sv.status=\"available\") AND v.updated_at >= (UTC_TIMESTAMP() - INTERVAL 14 DAY) AND v.created_at < cutoff.c;" yeh'

Write-Host "===Q4 sample recent approved older-than-cutoff==="
docker compose exec -T db /bin/sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Nse "WITH cutoff AS ( SELECT created_at AS c FROM videos v WHERE COALESCE(v.approved,0)=1 AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id=v.id AND sv.status=\"available\") ORDER BY v.created_at DESC, v.id DESC LIMIT 1 OFFSET 99 ) SELECT v.id, v.videoId, LEFT(v.title,80), v.created_at, v.updated_at FROM videos v, cutoff WHERE COALESCE(v.approved,0)=1 AND EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id=v.id AND sv.status=\"available\") AND v.updated_at >= (UTC_TIMESTAMP() - INTERVAL 14 DAY) AND v.created_at < cutoff.c ORDER BY v.updated_at DESC, v.id DESC LIMIT 15;" yeh'

Write-Host "===Q5 latest approved with availability flag==="
docker compose exec -T db /bin/sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Nse "SELECT v.id, v.videoId, LEFT(v.title,70), v.created_at, v.updated_at, EXISTS(SELECT 1 FROM site_videos sv WHERE sv.video_id=v.id AND sv.status=\"available\") AS has_available FROM videos v WHERE COALESCE(v.approved,0)=1 ORDER BY v.updated_at DESC, v.id DESC LIMIT 20;" yeh'
