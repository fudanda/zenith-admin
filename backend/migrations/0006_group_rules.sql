-- Dynamic group rules and the last successful materialization time.
ALTER TABLE user_groups
  ADD COLUMN member_rule jsonb NULL,
  ADD COLUMN rule_synced_at timestamptz NULL;
