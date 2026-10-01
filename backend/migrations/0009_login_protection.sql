ALTER TABLE login_attempts ADD COLUMN username_hash varchar NOT NULL DEFAULT '';
CREATE INDEX login_attempts_username_hash ON login_attempts(username_hash);
DELETE FROM login_attempts;
