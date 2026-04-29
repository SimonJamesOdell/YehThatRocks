-- Fix MySQL user authentication plugin for Prisma compatibility
-- This script changes the user's password hashing from sha256_password to mysql_native_password

-- Set credentials before running this file.
-- Do not commit real values.
SET @app_user = '__SET_DB_USER__';
SET @app_password = '__SET_DB_PASSWORD__';
SET @app_host = '%';

SET @alter_stmt = CONCAT(
	'ALTER USER ''', REPLACE(@app_user, '''', ''''''), '''@''', REPLACE(@app_host, '''', ''''''),
	''' IDENTIFIED WITH mysql_native_password BY ''', REPLACE(@app_password, '''', ''''''), ''''
);
PREPARE stmt FROM @alter_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

FLUSH PRIVILEGES;

-- Verify the change
SET @verify_stmt = CONCAT(
	'SELECT user, host, plugin FROM mysql.user WHERE user = ''', REPLACE(@app_user, '''', ''''''), ''''
);
PREPARE stmt FROM @verify_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
