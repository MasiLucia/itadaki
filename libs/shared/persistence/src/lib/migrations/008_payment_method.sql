-- How the table means to pay, asked when they request the bill.
--
-- Its own column rather than free text in `note`: the waiter needs to see at a
-- glance whether to carry the card reader, and a sentence is something you
-- read rather than something you spot.

ALTER TABLE table_calls
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE table_calls DROP CONSTRAINT IF EXISTS call_payment_valid;
ALTER TABLE table_calls
  ADD CONSTRAINT call_payment_valid
  CHECK (payment_method IS NULL OR payment_method IN ('CARD', 'CASH', 'UNDECIDED'));
