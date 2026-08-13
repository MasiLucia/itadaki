-- The role the API connects as.
--
-- Separate from the owner on purpose: row level security in FORCE mode does
-- not apply to a table's owner, so an app that connected as itadaki would
-- silently see every restaurant's rows. The migrations GRANT to this role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'itadaki_app') THEN
    CREATE ROLE itadaki_app LOGIN PASSWORD 'itadaki_app';
  END IF;
END $$;

GRANT CONNECT ON DATABASE itadaki TO itadaki_app;
GRANT USAGE ON SCHEMA public TO itadaki_app;
