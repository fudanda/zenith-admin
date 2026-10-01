CREATE TABLE api_keys (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(64) NOT NULL, token_hash varchar(255) NOT NULL UNIQUE, token_prefix varchar(16) NOT NULL,
 permissions jsonb NOT NULL, expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_user_id ON api_keys(user_id);
ALTER TABLE audit_logs ADD COLUMN api_key_id integer;
ALTER TABLE file_storage_configs ADD COLUMN s3_region varchar(255) NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_endpoint varchar(255) NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_bucket varchar(255) NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_access_key_id varchar(255) NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_secret_cipher varchar(255) NOT NULL DEFAULT '';
ALTER TABLE file_storage_configs ADD COLUMN s3_force_path_style boolean NOT NULL DEFAULT false;
ALTER TABLE file_storage_configs ADD COLUMN base_path varchar(255) NOT NULL DEFAULT '';
