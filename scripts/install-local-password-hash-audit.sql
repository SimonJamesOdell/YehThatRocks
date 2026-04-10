DROP TRIGGER IF EXISTS yeh.users_password_hash_audit;
CREATE TRIGGER yeh.users_password_hash_audit
AFTER UPDATE ON yeh.users
FOR EACH ROW
INSERT INTO yeh.auth_audit_logs (user_id, email, action, success, ip_address, user_agent, detail)
SELECT
  NEW.id,
  NEW.email,
  'password-hash-db-update',
  1,
  '127.0.0.1',
  CURRENT_USER(),
  CONCAT(
    'Direct DB password_hash change detected; connection=',
    CONNECTION_ID(),
    '; old=',
    COALESCE(LEFT(OLD.password_hash, 20), 'NULL'),
    '; new=',
    COALESCE(LEFT(NEW.password_hash, 20), 'NULL')
  )
WHERE NOT (OLD.password_hash <=> NEW.password_hash);

DROP TRIGGER IF EXISTS yeh_dev.users_password_hash_audit;
CREATE TRIGGER yeh_dev.users_password_hash_audit
AFTER UPDATE ON yeh_dev.users
FOR EACH ROW
INSERT INTO yeh_dev.auth_audit_logs (user_id, email, action, success, ip_address, user_agent, detail)
SELECT
  NEW.id,
  NEW.email,
  'password-hash-db-update',
  1,
  '127.0.0.1',
  CURRENT_USER(),
  CONCAT(
    'Direct DB password_hash change detected; connection=',
    CONNECTION_ID(),
    '; old=',
    COALESCE(LEFT(OLD.password_hash, 20), 'NULL'),
    '; new=',
    COALESCE(LEFT(NEW.password_hash, 20), 'NULL')
  )
WHERE NOT (OLD.password_hash <=> NEW.password_hash);