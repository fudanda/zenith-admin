CREATE TABLE api_keys (
 id integer PRIMARY KEY AUTOINCREMENT,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, token_hash text NOT NULL UNIQUE, token_prefix text NOT NULL,
 permissions json NOT NULL, expires_at datetime, revoked_at datetime, last_used_at datetime,
 created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX api_keys_user_id ON api_keys(user_id);
ALTER TABLE audit_logs ADD COLUMN api_key_id integer;
ALTER TABLE file_storage_configs ADD COLUMN s3_region text NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_endpoint text NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_bucket text NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_access_key_id text NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_secret_cipher text NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_force_path_style bool NOT NULL DEFAULT false;
ALTER TABLE file_storage_configs ADD COLUMN base_path text NOT NULL DEFAULT '';
