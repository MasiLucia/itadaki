-- Multi-tenant schema. Every table carries tenant_id and is protected by
-- row level security, so isolation does not depend on every query
-- remembering a WHERE clause.

CREATE TABLE IF NOT EXISTS categories (
  tenant_id     text        NOT NULL,
  id            text        NOT NULL,
  name          text        NOT NULL,
  sort_order    integer     NOT NULL DEFAULT 0,
  window_start  integer,
  window_end    integer,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS products (
  tenant_id             text        NOT NULL,
  id                    text        NOT NULL,
  category_id           text        NOT NULL,
  name                  text        NOT NULL,
  description           text        NOT NULL DEFAULT '',
  -- Prices are integer minor units, never floats.
  price_minor           bigint      NOT NULL,
  currency              text        NOT NULL,
  allergens             text[]      NOT NULL DEFAULT '{}',
  diets                 text[]      NOT NULL DEFAULT '{}',
  prep_minutes          integer     NOT NULL DEFAULT 10,
  available             boolean     NOT NULL DEFAULT true,
  station               text        NOT NULL,
  image_set             jsonb,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT price_non_negative CHECK (price_minor >= 0)
);

CREATE TABLE IF NOT EXISTS modifier_groups (
  tenant_id       text     NOT NULL,
  id              text     NOT NULL,
  product_id      text     NOT NULL,
  name            text     NOT NULL,
  min_selections  integer  NOT NULL DEFAULT 0,
  max_selections  integer  NOT NULL DEFAULT 1,
  modifiers       jsonb    NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

-- Auditable price history: who changed what, when, and from which value.
CREATE TABLE IF NOT EXISTS price_audit (
  id             bigserial   PRIMARY KEY,
  tenant_id      text        NOT NULL,
  product_id     text        NOT NULL,
  previous_minor bigint      NOT NULL,
  new_minor      bigint      NOT NULL,
  currency       text        NOT NULL,
  actor_id       text        NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS table_sessions (
  tenant_id   text        NOT NULL,
  id          text        NOT NULL,
  table_id    text        NOT NULL,
  status      text        NOT NULL,
  currency    text        NOT NULL,
  diners      jsonb       NOT NULL DEFAULT '[]',
  cart_lines  jsonb       NOT NULL DEFAULT '[]',
  opened_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- Only one open session per table: a second phone scanning the same QR must
-- land in the same cart.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_table
  ON table_sessions (tenant_id, table_id)
  WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS orders (
  tenant_id         text        NOT NULL,
  id                text        NOT NULL,
  client_request_id text        NOT NULL,
  session_id        text        NOT NULL,
  status            text        NOT NULL,
  currency          text        NOT NULL,
  items             jsonb       NOT NULL DEFAULT '[]',
  history           jsonb       NOT NULL DEFAULT '[]',
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- The database enforces idempotency: a replayed offline queue entry cannot
-- create a second ticket even if the application check races.
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency
  ON orders (tenant_id, client_request_id);

CREATE INDEX IF NOT EXISTS orders_active
  ON orders (tenant_id, status)
  WHERE status NOT IN ('DELIVERED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS bills (
  tenant_id    text        NOT NULL,
  id           text        NOT NULL,
  session_id   text        NOT NULL,
  currency     text        NOT NULL,
  -- OPEN follows the table as it keeps ordering; SETTLED is frozen.
  status       text        NOT NULL DEFAULT 'OPEN',
  lines        jsonb       NOT NULL DEFAULT '[]',
  participants jsonb       NOT NULL DEFAULT '[]',
  rates        jsonb       NOT NULL DEFAULT '[]',
  closed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- Existing installs: the table predates the column.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'OPEN';

CREATE UNIQUE INDEX IF NOT EXISTS one_bill_per_session
  ON bills (tenant_id, session_id);

CREATE TABLE IF NOT EXISTS images (
  tenant_id     text        NOT NULL,
  id            text        NOT NULL,
  original_path text        NOT NULL,
  params        jsonb       NOT NULL,
  image_set     jsonb       NOT NULL,
  alt           text        NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- Row level security. Every policy compares against app.tenant_id, which the
-- connection sets per request; a query that forgets the tenant returns nothing
-- rather than another restaurant's rows.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'categories', 'products', 'modifier_groups', 'price_audit',
    'table_sessions', 'orders', 'bills', 'images'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true))
       WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      target
    );
  END LOOP;
END $$;
