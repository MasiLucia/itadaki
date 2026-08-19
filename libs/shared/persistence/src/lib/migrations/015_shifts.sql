-- Quién está trabajando ahora.
--
-- El reparto de mesas solo obligaba a rehacerlo en cada cambio de turno, y
-- quien sabe qué mozos entraron hoy es el mozo, no el encargado —que puede no
-- estar. Con esto el sector guardado es el habitual y se carga una vez: las
-- mesas de quien no entró quedan a la vista de todos, sin que nadie haga nada.
--
-- Una fila por mozo en turno, que se borra al salir. last_seen la corre cada
-- acción del salón, para que el que se fue sin salir caiga solo.
CREATE TABLE IF NOT EXISTS staff_shifts (
  tenant_id  text        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  staff_id   text        NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, staff_id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff_users (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_shifts;
CREATE POLICY tenant_isolation ON staff_shifts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_shifts TO itadaki_app;
