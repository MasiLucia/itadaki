-- Restaurants become real rows instead of free-text strings, and staff get
-- accounts. Until now any value in `?tenant=` created data for a tenant that
-- did not exist; the foreign keys below make that impossible.

CREATE TABLE IF NOT EXISTS tenants (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  slug        text        NOT NULL UNIQUE,
  currency    text        NOT NULL DEFAULT 'ARS',
  timezone    text        NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Every tenant referenced by existing data must exist before the keys land.
INSERT INTO tenants (id, name, slug)
SELECT DISTINCT tenant_id, tenant_id, tenant_id FROM products
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenants (id, name, slug)
SELECT DISTINCT tenant_id, tenant_id, tenant_id FROM categories
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'categories', 'products', 'modifier_groups', 'price_audit',
    'table_sessions', 'orders', 'bills', 'images'
  ] LOOP
    -- Orphan rows would block the constraint; there should be none, but a
    -- half-seeded database is a real possibility in development.
    EXECUTE format(
      'DELETE FROM %I WHERE tenant_id NOT IN (SELECT id FROM tenants)', target
    );
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', target, target || '_tenant_fk'
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id)
         REFERENCES tenants (id) ON DELETE CASCADE',
      target, target || '_tenant_fk'
    );
  END LOOP;
END $$;

-- Staff accounts. Diners stay anonymous: they never appear here.
CREATE TABLE IF NOT EXISTS staff_users (
  tenant_id     text        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  id            text        NOT NULL,
  email         text        NOT NULL,
  display_name  text        NOT NULL,
  -- scrypt output, never the password itself.
  password_hash text        NOT NULL,
  role          text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT staff_role_valid CHECK (role IN ('OWNER', 'MANAGER', 'KITCHEN', 'WAITER'))
);

-- One account per email across the whole platform: login has no tenant field,
-- so the address alone has to identify the person.
CREATE UNIQUE INDEX IF NOT EXISTS staff_email_unique
  ON staff_users (lower(email));

ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_users;
CREATE POLICY tenant_isolation ON staff_users
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Login happens before a tenant is known, so that lookup needs its own path.
-- This view is owned by the privileged role and exposes only what login needs.
CREATE OR REPLACE VIEW staff_login_lookup AS
  SELECT tenant_id, id, email, display_name, password_hash, role, active
  FROM staff_users;

GRANT SELECT ON staff_login_lookup TO itadaki_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO itadaki_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_users TO itadaki_app;

-- Tenants are the directory itself: readable by the app, not row-filtered.
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
