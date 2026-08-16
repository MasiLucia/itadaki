-- Pagar en la caja.
--
-- Es el caso que el sistema no puede confirmar solo: nadie cobra en la mesa,
-- así que nada le avisa si la mesa pagó. El mozo tiene que decirlo antes de
-- liberarla, o queda ocupada por gente que ya se fue — o peor, se libera una
-- que todavía no pasó por la caja.
--
-- La restricción anterior sólo conocía los tres métodos originales, así que
-- guardar el nuevo fallaba en la base aunque la aplicación lo aceptara.

ALTER TABLE table_calls DROP CONSTRAINT IF EXISTS call_payment_valid;
ALTER TABLE table_calls
  ADD CONSTRAINT call_payment_valid
  CHECK (payment_method IS NULL OR payment_method IN ('CARD', 'CASH', 'COUNTER', 'UNDECIDED'));
