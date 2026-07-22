-- =============================================================================
-- 0002_stripe_payments.sql — support real Stripe payments
--
-- Run AFTER 0001_init.sql. Idempotent.
-- =============================================================================

alter table public.tiles
  add column if not exists payment_intent_id text unique,
  add column if not exists amount_paid     integer;

-- Partial index for Stripe lookups (refunds, audit, anti-fraud). Most tiles
-- in the archive are seeded; only paid ones carry a payment_intent_id.
create index if not exists tiles_payment_intent_idx
  on public.tiles (payment_intent_id)
  where payment_intent_id is not null;
