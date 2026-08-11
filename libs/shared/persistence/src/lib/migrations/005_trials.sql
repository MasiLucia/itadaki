-- Free trial per restaurant.
--
-- Two columns rather than a subscriptions table: there are no plans, invoices
-- or renewals yet, and inventing that structure before billing exists would be
-- guessing at a shape we do not know.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false;

-- Restaurants that existed before trials keep full access: a null deadline
-- reads as active, so a migration never locks out an existing customer.
