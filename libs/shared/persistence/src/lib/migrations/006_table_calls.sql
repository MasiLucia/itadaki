-- A table asking for a waiter, the bill, or help with a question.
--
-- Its own table rather than a flag on the session: several calls happen over
-- one meal, staff need to see when each was raised, and the history is worth
-- keeping once handled.

CREATE TABLE IF NOT EXISTS table_calls (
  tenant_id       text        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  id              text        NOT NULL,
  session_id      text        NOT NULL,
  table_id        text        NOT NULL,
  reason          text        NOT NULL,
  status          text        NOT NULL DEFAULT 'PENDING',
  note            text        NOT NULL DEFAULT '',
  raised_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT call_reason_valid CHECK (reason IN ('WAITER', 'BILL', 'QUESTION')),
  CONSTRAINT call_status_valid CHECK (status IN ('PENDING', 'ACKNOWLEDGED'))
);

-- The staff screen only ever asks for what is still waiting.
CREATE INDEX IF NOT EXISTS table_calls_pending
  ON table_calls (tenant_id, raised_at) WHERE status = 'PENDING';

ALTER TABLE table_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON table_calls;
CREATE POLICY tenant_isolation ON table_calls
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON table_calls TO itadaki_app;
