-- El código de la mesa pasa de la sesión a la mesa.
--
-- Estaba en table_sessions, y eso lo hacía inútil contra el ataque que tenía
-- que frenar: la sesión no existe hasta que alguien escanea, así que el primero
-- en escanear entraba sin código y se quedaba con el que se acababa de generar.
-- Quien tuviera una foto del QR podía abrir la mesa desde su casa una y otra
-- vez, quedarse con el código cada vez, y dejar a los comensales reales sin
-- poder sentarse en su propia mesa.
--
-- En la mesa el código existe antes de que nadie escanee. Lo ve el mozo, que es
-- quien lo dice al sentar a la gente, y se renueva cuando la mesa se libera:
-- el de anoche no sirve hoy.
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS join_code text;

-- La búsqueda del QR pasa antes de confiar en el restaurante que el token
-- declara, así que va por esta función y no por la tabla — ver migración 009.
-- Ahora tiene que devolver también el código, porque unirse lo compara contra
-- el de la mesa.
--
-- CREATE OR REPLACE no puede cambiar el tipo de retorno de una función que ya
-- existe: hay que borrarla primero.
DROP FUNCTION IF EXISTS table_secret_lookup_fn(text, text);

CREATE FUNCTION table_secret_lookup_fn(p_tenant text, p_table text)
RETURNS TABLE (
  tenant_id  text,
  id         text,
  label      text,
  seats      integer,
  qr_secret  text,
  join_code  text
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
    SELECT t.tenant_id, t.id, t.label, t.seats, t.qr_secret, t.join_code
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

-- El de la sesión deja de usarse. La columna queda: borrarla mientras todavía
-- corre la versión anterior de la API rompería cada escritura de sesión, y una
-- columna que nadie escribe no molesta a nadie.
-- ponytail: DROP COLUMN table_sessions.join_code cuando no quede ninguna
-- instancia vieja en pie.
