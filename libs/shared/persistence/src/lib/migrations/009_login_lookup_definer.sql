-- Que el login funcione en una base administrada.
--
-- Buscar la cuenta al iniciar sesión pasa antes de saber de qué restaurante
-- es la persona, así que esa consulta no puede estar filtrada por
-- app.tenant_id: si lo estuviera, nadie podría entrar nunca.
--
-- Hasta acá eso se resolvía con una vista, apoyándose en que su dueño fuera un
-- rol distinto del que consulta. En Render, Neon o Supabase el proveedor
-- entrega un solo usuario que es dueño de todo y no es superusuario, con lo
-- cual `FORCE ROW LEVEL SECURITY` también le aplica: la vista devolvía cero
-- filas y el login rechazaba credenciales correctas.
--
-- Con FORCE, ni siquiera el dueño escapa a la política, y `row_security = off`
-- no lo cambia: ese ajuste sólo vale para quien podría saltearla. Así que en
-- vez de intentar esquivar el filtrado, se agrega una política que describe
-- exactamente el único acceso legítimo sin tenant — buscar una cuenta por su
-- dirección al iniciar sesión — y la función queda como la única puerta.
--
-- Expone únicamente lo que el login necesita y nada más: no recibe el tenant
-- como parámetro, no permite listar la tabla, y devuelve como mucho la fila
-- que coincide con ese email. El hash sale de acá porque verificar la
-- contraseña es justamente lo que hace el que llama.

DROP VIEW IF EXISTS staff_login_lookup CASCADE;

-- El único acceso a staff_users que no lleva restaurante.
--
-- La política reusa app.tenant_id, el mismo parámetro que ya usa el resto del
-- esquema, con un valor reservado que la aplicación nunca fija: sólo lo pone
-- la función de abajo, y sólo mientras dura la llamada. Un parámetro nuevo no
-- sirve — Postgres no deja que un usuario sin privilegios lo declare.
--
-- Restringida a SELECT: iniciar sesión lee, nunca escribe.
DROP POLICY IF EXISTS login_lookup ON staff_users;
CREATE POLICY login_lookup ON staff_users
  FOR SELECT
  USING (current_setting('app.tenant_id', true) = '__login__');

CREATE OR REPLACE FUNCTION staff_login_lookup_fn(p_email text)
RETURNS TABLE (
  tenant_id     text,
  id            text,
  email         text,
  display_name  text,
  password_hash text,
  role          text,
  active        boolean
)
-- plpgsql y no sql a propósito: una función `LANGUAGE sql` se valida contra
-- las políticas vigentes en el momento de crearla, antes de que su propio
-- `SET row_security = off` tenga efecto, y la creación falla. plpgsql planifica
-- la consulta recién en la primera ejecución, cuando el ajuste ya rige.
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anterior text := current_setting('app.tenant_id', true);
BEGIN
  -- Habilita la política de arriba, y sólo mientras dura esta consulta.
  -- Va acá y no en la firma de la función porque un usuario sin privilegios
  -- no puede declarar un parámetro con SET; set_config sí está permitido.
  PERFORM set_config('app.tenant_id', '__login__', true);

  RETURN QUERY
    SELECT s.tenant_id, s.id, s.email, s.display_name, s.password_hash, s.role, s.active
    FROM staff_users s
    WHERE lower(s.email) = lower(p_email)
      AND s.active
    LIMIT 1;

  -- La conexión vuelve a ver su restaurante como antes de la llamada.
  PERFORM set_config('app.tenant_id', COALESCE(anterior, ''), true);
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'itadaki_app') THEN
    GRANT EXECUTE ON FUNCTION staff_login_lookup_fn(text) TO itadaki_app;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- Lo mismo para el QR de las mesas.
--
-- Verificar un código escaneado también pasa antes de saber de qué restaurante
-- se trata: el token dice a qué mesa dice pertenecer, y recién comprobando la
-- firma contra el secreto de esa mesa se le cree. Esa consulta tenía el mismo
-- problema que el login — una vista que dependía de que su dueño fuera otro
-- rol — y en una base administrada devolvía cero filas, con lo cual ningún QR
-- funcionaba.
--
-- A diferencia del login, acá el restaurante sí viene como parámetro: el
-- token lo declara. Igual no se le cree hasta verificar la firma, y por eso la
-- función devuelve el secreto de esa única mesa y nada más.

DROP VIEW IF EXISTS table_secret_lookup CASCADE;

DROP POLICY IF EXISTS qr_lookup ON restaurant_tables;
CREATE POLICY qr_lookup ON restaurant_tables
  FOR SELECT
  USING (current_setting('app.tenant_id', true) = '__login__');

CREATE OR REPLACE FUNCTION table_secret_lookup_fn(p_tenant text, p_table text)
RETURNS TABLE (
  tenant_id  text,
  id         text,
  label      text,
  seats      integer,
  qr_secret  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anterior text := current_setting('app.tenant_id', true);
BEGIN
  PERFORM set_config('app.tenant_id', '__login__', true);

  RETURN QUERY
    SELECT t.tenant_id, t.id, t.label, t.seats, t.qr_secret
    FROM restaurant_tables t
    WHERE t.tenant_id = p_tenant
      AND t.id = p_table
    LIMIT 1;

  PERFORM set_config('app.tenant_id', COALESCE(anterior, ''), true);
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'itadaki_app') THEN
    GRANT EXECUTE ON FUNCTION table_secret_lookup_fn(text, text) TO itadaki_app;
  END IF;
END $$;
