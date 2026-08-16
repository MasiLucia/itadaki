-- Invitaciones de un solo uso para sumarse a una mesa en curso.
--
-- El PIN lo da el mozo al sentar la mesa. Para el que llega tarde, obligar a
-- que alguien le dicte el PIN significa mostrarlo en pantalla, y ahí cualquiera
-- de la mesa de al lado lo lee. La invitación evita eso: la genera quien ya
-- está sentado, vale una sola vez y vence en minutos, así que fotografiarla
-- de reojo no sirve de nada.
--
-- Tabla propia y no una columna en la sesión: son varias por mesa, con su
-- propio ciclo de vida, y el "un solo uso" tiene que ser una escritura atómica
-- que no compita con las del carrito compartido.
CREATE TABLE IF NOT EXISTS session_invites (
  tenant_id   text        NOT NULL,
  code        text        NOT NULL,
  session_id  text        NOT NULL,
  -- Quién invitó. No se usa para decidir nada; sirve para explicar cómo entró
  -- alguien si después hay que reconstruir qué pasó en una mesa.
  invited_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  -- Null mientras nadie la usó. Es lo que hace el "un solo uso".
  used_at     timestamptz,
  PRIMARY KEY (tenant_id, code)
);

-- Canjear busca por código sin conocer la mesa todavía.
CREATE INDEX IF NOT EXISTS session_invites_code ON session_invites (code);

-- Las vencidas no sirven para nada y se acumulan de a una por invitado.
CREATE INDEX IF NOT EXISTS session_invites_expiry ON session_invites (expires_at);

-- Mismo aislamiento que el resto del esquema: cada restaurante ve lo suyo.
ALTER TABLE session_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_invites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON session_invites;
CREATE POLICY tenant_isolation ON session_invites
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'itadaki_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON session_invites TO itadaki_app;
  END IF;
END $$;
