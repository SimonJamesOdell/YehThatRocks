-- ============================================================================
-- Bot Account Cleanup Script
-- Run on production after review:
--   docker exec -i yehthatrocks-db-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" yeh < cleanup_bots.sql
-- ============================================================================

-- STEP 1: Identify all bot accounts with their evidence
-- Review this output before running STEP 2 (the DELETE statements)

SELECT '========== BOT IDENTIFICATION REPORT ==========' AS '';

-- 1a. RootEvidence scraper (confirmed bot UA)
SELECT u.id, u.screen_name, u.created_at, a.ip_address, 'RootEvidence scraper' AS reason
FROM users u
JOIN auth_audit_logs a ON a.user_id = u.id AND a.action = 'register' AND a.success = 1
WHERE a.user_agent LIKE '%RootEvidence%'
ORDER BY u.id;

-- 1b. Burst registrations: same IP created 3+ accounts within 30 seconds
SELECT u.id, u.screen_name, u.created_at, a.ip_address, 'Burst (3+ in 30s)' AS reason
FROM users u
JOIN auth_audit_logs a ON a.user_id = u.id AND a.action = 'register' AND a.success = 1
WHERE a.ip_address IN (
  SELECT ip_address
  FROM auth_audit_logs
  WHERE action = 'register' AND success = 1
    AND created_at >= '2026-07-18'
  GROUP BY ip_address
  HAVING COUNT(*) >= 3
     AND TIMESTAMPDIFF(SECOND, MIN(created_at), MAX(created_at)) <= 30
)
ORDER BY a.ip_address, u.created_at;

-- 1c. Facebook crawler IPs (AS32934)
SELECT u.id, u.screen_name, u.created_at, a.ip_address, 'Facebook crawler IP' AS reason
FROM users u
JOIN auth_audit_logs a ON a.user_id = u.id AND a.action = 'register' AND a.success = 1
WHERE a.ip_address IN (
  '173.252.127.1', '173.252.127.14', '31.13.115.114', '66.220.149.114',
  '173.252.127.2', '173.252.127.3', '173.252.127.4', '173.252.127.5',
  '31.13.115.1', '31.13.115.2', '66.220.149.1', '66.220.149.2'
)
ORDER BY u.id;

-- 1d. AWS/Linode cloud IPs with suspicious Android Chrome UA
SELECT u.id, u.screen_name, u.created_at, a.ip_address, 'Cloud IP + Android UA' AS reason
FROM users u
JOIN auth_audit_logs a ON a.user_id = u.id AND a.action = 'register' AND a.success = 1
WHERE a.user_agent LIKE '%Android%Chrome%Mobile%'
  AND (
    a.ip_address LIKE '34.%' OR a.ip_address LIKE '35.%' OR a.ip_address LIKE '44.%'
    OR a.ip_address LIKE '52.%' OR a.ip_address LIKE '54.%'
    OR a.ip_address LIKE '45.33.%' OR a.ip_address LIKE '45.56.%'
  )
ORDER BY u.id;

SELECT '========== END IDENTIFICATION REPORT ==========' AS '';
SELECT 'Review the accounts above, then run STEP 2 to delete them.' AS '';
SELECT 'WARNING: STEP 2 is destructive. Verify the IDs match the report.' AS '';

-- ============================================================================
-- STEP 2: DELETE (remove comments to execute)
-- ============================================================================

-- Collect all bot IDs into a temp table for clean deletion
/*
DROP TEMPORARY TABLE IF EXISTS _bot_user_ids;
CREATE TEMPORARY TABLE _bot_user_ids (user_id INT PRIMARY KEY);

-- Insert RootEvidence scraper bots
INSERT IGNORE INTO _bot_user_ids (user_id)
SELECT u.id FROM users u
JOIN auth_audit_logs a ON a.user_id = u.id AND a.action = 'register' AND a.success = 1
WHERE a.user_agent LIKE '%RootEvidence%';

-- Insert burst registration bots (3+ in 30 seconds from same IP)
INSERT IGNORE INTO _bot_user_ids (user_id)
SELECT u.id FROM users u
JOIN auth_audit_logs a ON a.user_id = u.id AND a.action = 'register' AND a.success = 1
WHERE a.ip_address IN (
  SELECT ip_address FROM auth_audit_logs
  WHERE action = 'register' AND success = 1 AND created_at >= '2026-07-18'
  GROUP BY ip_address
  HAVING COUNT(*) >= 3
     AND TIMESTAMPDIFF(SECOND, MIN(created_at), MAX(created_at)) <= 30
);

-- Insert Facebook crawler IP bots
INSERT IGNORE INTO _bot_user_ids (user_id)
SELECT u.id FROM users u
JOIN auth_audit_logs a ON a.user_id = u.id AND a.action = 'register' AND a.success = 1
WHERE a.ip_address IN (
  '173.252.127.1', '173.252.127.14', '31.13.115.114', '66.220.149.114',
  '173.252.127.2', '173.252.127.3', '173.252.127.4', '173.252.127.5',
  '31.13.115.1', '31.13.115.2', '66.220.149.1', '66.220.149.2'
);

-- Insert cloud IP bots with Android Chrome UA
INSERT IGNORE INTO _bot_user_ids (user_id)
SELECT u.id FROM users u
JOIN auth_audit_logs a ON a.user_id = u.id AND a.action = 'register' AND a.success = 1
WHERE a.user_agent LIKE '%Android%Chrome%Mobile%'
  AND (
    a.ip_address LIKE '34.%' OR a.ip_address LIKE '35.%' OR a.ip_address LIKE '44.%'
    OR a.ip_address LIKE '52.%' OR a.ip_address LIKE '54.%'
    OR a.ip_address LIKE '45.33.%' OR a.ip_address LIKE '45.56.%'
  );

-- Show what will be deleted
SELECT 'Accounts to delete:' AS '', COUNT(*) AS count FROM _bot_user_ids;
SELECT u.id, u.screen_name, u.created_at
FROM users u JOIN _bot_user_ids b ON u.id = b.user_id
ORDER BY u.id;

-- Delete dependent data first (no FK on these, but clean them up anyway)
DELETE FROM watch_history WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM hidden_videos WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM online WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM search_result_flags WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM user_admin_permissions WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM user_new_videos_preferences WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM user_player_preferences WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM user_seen_toggle_preferences WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM video_quality_flags WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM analytics_events WHERE user_id IN (SELECT user_id FROM _bot_user_ids);

-- Delete FK-constrained dependent data
DELETE FROM auth_sessions WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM email_verification_tokens WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM password_reset_tokens WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM forum_votes WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM forum_posts WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM forum_threads WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM forum_section_seen WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM magazine_article_comments WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM messages WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM playlistnames WHERE user_id IN (SELECT user_id FROM _bot_user_ids);
DELETE FROM auth_audit_logs WHERE user_id IN (SELECT user_id FROM _bot_user_ids);

-- Finally, delete the users
DELETE FROM users WHERE id IN (SELECT user_id FROM _bot_user_ids);

SELECT 'Cleanup complete.' AS '', ROW_COUNT() AS users_deleted;
DROP TEMPORARY TABLE IF EXISTS _bot_user_ids;
*/
