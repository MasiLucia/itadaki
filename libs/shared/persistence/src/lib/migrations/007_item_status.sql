-- Per-dish kitchen state.
--
-- A ticket is not cooked as a unit: empanadas leave in six minutes while a
-- slow-roast is still in the oven. Holding one status for the whole order
-- forced staff to advance every dish together, and showed the diner a plate as
-- served while it was still being cooked.
--
-- Stored alongside the frozen item snapshots rather than inside them: the
-- snapshot is the price contract with the diner and must not be rewritten as
-- the kitchen works.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS item_status jsonb NOT NULL DEFAULT '[]';

-- Existing orders: every dish inherits the status the order already had, so
-- nothing in flight changes state during the migration.
UPDATE orders
   SET item_status = (
     SELECT jsonb_agg(jsonb_build_object('itemId', item->>'id', 'status', orders.status))
       FROM jsonb_array_elements(orders.items) AS item
   )
 WHERE item_status = '[]' AND jsonb_array_length(items) > 0;
