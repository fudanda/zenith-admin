-- Menu fields present in the shared Zenith contract. The v4 snapshots are immutable.
ALTER TABLE menus
  ADD COLUMN query character varying NULL,
  ADD COLUMN is_external boolean NOT NULL DEFAULT false,
  ADD COLUMN embed boolean NOT NULL DEFAULT false,
  ADD COLUMN keep_alive boolean NOT NULL DEFAULT false;
