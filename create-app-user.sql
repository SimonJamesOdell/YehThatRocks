-- Set credentials before running this file.
-- Do not commit real values.
SET @app_user = '__SET_DB_USER__';
SET @app_password = '__SET_DB_PASSWORD__';

SET @create_local = CONCAT(
	'CREATE USER IF NOT EXISTS ''', REPLACE(@app_user, '''', ''''''), '''@''localhost'' IDENTIFIED BY ''', REPLACE(@app_password, '''', ''''''), ''''
);
PREPARE stmt FROM @create_local;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @create_remote = CONCAT(
	'CREATE USER IF NOT EXISTS ''', REPLACE(@app_user, '''', ''''''), '''@''%'' IDENTIFIED BY ''', REPLACE(@app_password, '''', ''''''), ''''
);
PREPARE stmt FROM @create_remote;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @grant_local = CONCAT(
	'GRANT ALL PRIVILEGES ON yeh.* TO ''', REPLACE(@app_user, '''', ''''''), '''@''localhost'''
);
PREPARE stmt FROM @grant_local;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @grant_remote = CONCAT(
	'GRANT ALL PRIVILEGES ON yeh.* TO ''', REPLACE(@app_user, '''', ''''''), '''@''%'''
);
PREPARE stmt FROM @grant_remote;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

FLUSH PRIVILEGES;

SET @verify = CONCAT(
	'SELECT user, host, plugin FROM mysql.user WHERE user = ''', REPLACE(@app_user, '''', ''''''), ''''
);
PREPARE stmt FROM @verify;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
