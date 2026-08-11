-- Password reset requests.
--
-- Its own table rather than columns on staff_users: a request is an event with
-- a lifetime, and keeping the used ones is what lets a second click on the same
-- link be rejected instead of silently working again.

CREATE TABLE IF NOT EXISTS password_resets (
  -- sha256 of the token; the token itself only ever exists in the email.
  token_digest text        PRIMARY KEY,
  tenant_id    text        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id      text        NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);

CREATE INDEX IF NOT EXISTS password_resets_user
  ON password_resets (tenant_id, user_id);

-- Reset happens before anyone is signed in, so this table cannot be read
-- through a tenant-scoped connection. It is written and read by the app role
-- directly, and every row is found by a digest nobody can guess.
GRANT SELECT, INSERT, UPDATE, DELETE ON password_resets TO itadaki_app;
