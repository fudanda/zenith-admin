ALTER TABLE audit_logs ADD COLUMN module varchar NOT NULL DEFAULT '', ADD COLUMN description varchar NOT NULL DEFAULT '', ADD COLUMN method varchar NOT NULL DEFAULT '', ADD COLUMN path varchar NOT NULL DEFAULT '', ADD COLUMN ip varchar NOT NULL DEFAULT '', ADD COLUMN user_agent varchar NOT NULL DEFAULT '', ADD COLUMN browser varchar NOT NULL DEFAULT '', ADD COLUMN os varchar NOT NULL DEFAULT '', ADD COLUMN request_body varchar NULL, ADD COLUMN duration_ms bigint NOT NULL DEFAULT 0, ADD COLUMN response_code bigint NOT NULL DEFAULT 200;
UPDATE audit_logs SET module=resource,description=operation;
ALTER TABLE login_logs ADD COLUMN event_type varchar NOT NULL DEFAULT 'login', ADD COLUMN user_agent varchar NOT NULL DEFAULT '', ADD COLUMN browser varchar NOT NULL DEFAULT '', ADD COLUMN os varchar NOT NULL DEFAULT '';
CREATE INDEX audit_logs_actor_created_at ON audit_logs(actor_id,created_at);
CREATE INDEX login_logs_user_created_at ON login_logs(user_id,created_at);
