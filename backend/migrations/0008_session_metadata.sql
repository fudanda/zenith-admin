ALTER TABLE sessions ADD COLUMN ip varchar NOT NULL DEFAULT '', ADD COLUMN client varchar NOT NULL DEFAULT 'web', ADD COLUMN browser varchar NOT NULL DEFAULT '', ADD COLUMN os varchar NOT NULL DEFAULT '', ADD COLUMN last_active_at timestamptz NOT NULL DEFAULT now();
UPDATE sessions SET last_active_at=created_at;
CREATE INDEX sessions_last_active_at ON sessions(last_active_at);
