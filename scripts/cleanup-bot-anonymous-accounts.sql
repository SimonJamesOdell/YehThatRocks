-- =============================================================================
-- Cleanup: Bot-created anonymous accounts on yehthatrocks.com
-- =============================================================================
-- Strategy:
--   Delete anonymous accounts from IPs that created 3+ anonymous accounts
--   within a short period, where each account has exactly 1 session and
--   zero activity. This preserves any real user's anonymous account — a
--   real user would not be part of a cluster of 3+ bot-like accounts from
--   the same IP.
-- =============================================================================

-- STEP 1: Preview — list the accounts that will be deleted
-- Shows user details plus session/activity counts for verification.

SELECT
    u.id,
    u.screen_name,
    u.created_at,
    aal.ip_address,
    (SELECT COUNT(*) FROM auth_sessions s WHERE s.user_id = u.id) AS sessions,
    (SELECT COUNT(*) FROM favourites f WHERE f.userid = u.id) AS favs,
    (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id) AS msgs
FROM users u
JOIN auth_audit_logs aal ON aal.user_id = u.id
    AND aal.action = 'register'
    AND aal.success = 1
WHERE u.is_anonymous = 1
  AND aal.ip_address IN (
      -- IPs that created 3+ anonymous accounts (cluster detection)
      SELECT a.ip_address
      FROM auth_audit_logs a
      JOIN users bu ON bu.id = a.user_id AND bu.is_anonymous = 1
      WHERE a.action = 'register' AND a.success = 1
      GROUP BY a.ip_address
      HAVING COUNT(*) >= 3
  )
  AND (SELECT COUNT(*) FROM auth_sessions s WHERE s.user_id = u.id) = 1
  AND (SELECT COUNT(*) FROM favourites f WHERE f.userid = u.id) = 0
  AND (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id) = 0
ORDER BY aal.ip_address, u.created_at;

-- STEP 2: Delete (uncomment to execute — review STEP 1 output first)

/*
DELETE u, s, a
FROM users u
LEFT JOIN auth_sessions s ON s.user_id = u.id
LEFT JOIN auth_audit_logs a ON a.user_id = u.id
WHERE u.id IN (
    SELECT id FROM (
        SELECT u2.id
        FROM users u2
        JOIN auth_audit_logs aal2 ON aal2.user_id = u2.id
            AND aal2.action = 'register'
            AND aal2.success = 1
        WHERE u2.is_anonymous = 1
          AND aal2.ip_address IN (
              SELECT a3.ip_address
              FROM auth_audit_logs a3
              JOIN users bu3 ON bu3.id = a3.user_id AND bu3.is_anonymous = 1
              WHERE a3.action = 'register' AND a3.success = 1
              GROUP BY a3.ip_address
              HAVING COUNT(*) >= 3
          )
          AND (SELECT COUNT(*) FROM auth_sessions s3 WHERE s3.user_id = u2.id) = 1
          AND (SELECT COUNT(*) FROM favourites f3 WHERE f3.userid = u2.id) = 0
          AND (SELECT COUNT(*) FROM messages m3 WHERE m3.user_id = u2.id) = 0
    ) AS targets
);
*/
