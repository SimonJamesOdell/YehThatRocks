$ErrorActionPreference = "Stop"
$sshHost = if ($env:YTR_VPS_HOST) { $env:YTR_VPS_HOST } else { "root@206.189.122.114" }
Write-Output "STEP1 sshHost=$sshHost"

$remoteDumpRaw = ssh $sshHost 'set -e; cd /srv/yehthatrocks; TS=$(date -u +%Y%m%d-%H%M%S); OUT=/tmp/yeh_live_notrig_$TS.sql; docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db /bin/sh -c "MYSQL_PWD=\"$MYSQL_ROOT_PASSWORD\" exec mysqldump -uroot --single-transaction --no-tablespaces --routines --skip-triggers \"$MYSQL_DATABASE\"" > "$OUT"; wc -c "$OUT" >&2; echo "$OUT"'
$remoteDump = ($remoteDumpRaw | Select-Object -Last 1).Trim()
Write-Output "STEP2 remoteDump=$remoteDump"

New-Item -ItemType Directory -Path 'backups/live' -Force | Out-Null
$localDump = Join-Path 'backups/live' ([System.IO.Path]::GetFileName($remoteDump))
scp "${sshHost}:$remoteDump" "$localDump" | Out-Null
Get-Item $localDump | Select-Object @{n='STEP3 localDump';e={$_.FullName}}, @{n='bytes';e={$_.Length}}

Write-Output 'STEP4 docker compose up -d db'
docker compose up -d db

$dbCtr = (docker compose ps -q db).Trim()
Write-Output "STEP5 dbCtr=$dbCtr"
docker cp $localDump "${dbCtr}:/tmp/live_notrig.sql"

Write-Output 'STEP6 restore: recreate yeh'
docker compose exec -T db /bin/sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE IF EXISTS yeh; CREATE DATABASE yeh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"'
Write-Output 'STEP6 restore: import dump'
docker compose exec -T db /bin/sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot yeh < /tmp/live_notrig.sql'

Write-Output 'STEP7 verify tables/videos/site_videos counts'
docker compose exec -T db /bin/sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"yeh\"; SELECT COUNT(*) FROM videos; SELECT COUNT(*) FROM site_videos;" yeh'

$sql = @"
WITH available_flag AS (
  SELECT v.id, v.created_at, v.updated_at, v.approved,
         EXISTS(SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available') AS has_available
  FROM videos v
),
eligible AS (
  SELECT * FROM available_flag WHERE approved = 1 AND has_available = 1
),
cutoff AS (
  SELECT MIN(created_at) AS cutoff_created_at
  FROM (
    SELECT created_at FROM eligible ORDER BY created_at DESC LIMIT 100
  ) t
),
recent_old AS (
  SELECT e.*
  FROM eligible e
  CROSS JOIN cutoff c
  WHERE e.updated_at >= (UTC_TIMESTAMP() - INTERVAL 14 DAY)
    AND e.created_at < c.cutoff_created_at
)
SELECT 'A_approved_total', COUNT(*) FROM available_flag WHERE approved = 1;
SELECT 'A_approved_with_available', COUNT(*) FROM available_flag WHERE approved = 1 AND has_available = 1;
SELECT 'A_approved_without_available', COUNT(*) FROM available_flag WHERE approved = 1 AND has_available = 0;
SELECT 'B_cutoff_created_at', cutoff_created_at FROM cutoff;
SELECT 'C_recent14_eligible_created_before_cutoff', COUNT(*) FROM recent_old;
SELECT 'D_sample15_id_created_updated', id, created_at, updated_at FROM recent_old ORDER BY updated_at DESC LIMIT 15;
SELECT 'E_latest20_approved_with_has_available', v.id, v.created_at, v.updated_at, IF(EXISTS(SELECT 1 FROM site_videos sv WHERE sv.video_id=v.id AND sv.status='available'),1,0) AS has_available
FROM videos v
WHERE v.approved = 1
ORDER BY v.updated_at DESC
LIMIT 20;
"@
$tmpSql = Join-Path $PWD 'tmp_diag.sql'
Set-Content -Path $tmpSql -Value $sql -NoNewline
Write-Output 'STEP8 diagnostics output'
Get-Content $tmpSql | docker compose exec -T db /bin/sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N yeh'
