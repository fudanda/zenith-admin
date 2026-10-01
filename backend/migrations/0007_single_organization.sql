-- Keep released migrations immutable. Refuse to merge tenant business data.
DO $$
DECLARE item record; found boolean;
BEGIN
  FOR item IN SELECT table_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'tenant_id'
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE tenant_id IS NOT NULL)', item.table_name) INTO found;
    IF found THEN
      RAISE EXCEPTION 'single organization upgrade refused: tenant-owned data exists in %', item.table_name;
    END IF;
  END LOOP;
END $$;

-- Revocation preserves credentials while invalidating the previous session model.
UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;
ALTER TABLE sessions DROP COLUMN tenant_view_id;
ALTER TABLE users DROP COLUMN tenant_id;
ALTER TABLE departments DROP COLUMN tenant_id;
ALTER TABLE positions DROP COLUMN tenant_id;
ALTER TABLE roles DROP COLUMN tenant_id;
ALTER TABLE user_groups DROP COLUMN tenant_id;
ALTER TABLE dicts DROP COLUMN tenant_id;
ALTER TABLE managed_files DROP COLUMN tenant_id;
ALTER TABLE upload_sessions DROP COLUMN tenant_id;
ALTER TABLE audit_logs DROP COLUMN tenant_id;
ALTER TABLE login_logs DROP COLUMN tenant_id;
DROP TABLE tenant_package_features;
DROP TABLE tenants;
DROP TABLE tenant_packages;

CREATE UNIQUE INDEX users_username ON users(username);
CREATE UNIQUE INDEX departments_code ON departments(code);
CREATE UNIQUE INDEX positions_code ON positions(code);
CREATE UNIQUE INDEX roles_code ON roles(code);
CREATE UNIQUE INDEX usergroup_code ON user_groups(code);
CREATE UNIQUE INDEX dict_code ON dicts(code);
CREATE INDEX auditlog_created_at ON audit_logs(created_at);
CREATE INDEX loginlog_created_at ON login_logs(created_at);
CREATE INDEX managedfile_created_at ON managed_files(created_at);

UPDATE roles SET name = '系统超级管理员' WHERE code = 'super_admin';
DELETE FROM menus WHERE name IN ('tenants', 'tenant_packages') OR path IN ('/system/tenants', '/system/tenant-packages');
