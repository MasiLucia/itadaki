-- Qué mozo atiende qué mesa.
--
-- Un salón de 20 mesas le llenaba la pantalla al mozo que atiende 6: veía los
-- pedidos de todas y tenía que buscar los suyos entre los del resto. Con el
-- reparto cargado, cada uno abre su app y ve su sector.
--
-- Vive aparte de restaurant_tables porque una mesa puede no estar asignada a
-- nadie —un salón chico no reparte— y porque el reparto cambia sin que la
-- mesa cambie. Con ON DELETE CASCADE por los dos lados: dar de baja a un mozo
-- libera sus mesas en vez de dejar filas apuntando a alguien que ya no está.
CREATE TABLE IF NOT EXISTS table_assignments (
  tenant_id   text        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  table_id    text        NOT NULL,
  staff_id    text        NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  -- Una mesa tiene un solo mozo: dos responsables es lo mismo que ninguno.
  PRIMARY KEY (tenant_id, table_id),
  FOREIGN KEY (tenant_id, table_id) REFERENCES restaurant_tables (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff_users (tenant_id, id) ON DELETE CASCADE
);

-- "Qué mesas son mías" es la consulta que corre cada vez que el salón refresca.
CREATE INDEX IF NOT EXISTS table_assignments_by_staff
  ON table_assignments (tenant_id, staff_id);

ALTER TABLE table_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON table_assignments;
CREATE POLICY tenant_isolation ON table_assignments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON table_assignments TO itadaki_app;
