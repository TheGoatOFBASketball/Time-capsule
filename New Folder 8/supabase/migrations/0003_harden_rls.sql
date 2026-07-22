-- =============================================================================
-- 0003_harden_rls.sql — production hardening for real payments
--
-- Run in the Supabase SQL editor AFTER you've verified end-to-end that:
--   1) 0002_stripe_payments.sql ran cleanly
--   2) The Stripe webhook endpoint receives and inserts tile rows
--      successfully (you can test by triggering a test event from the
--      Stripe dashboard and observing a row appear in public.tiles)
--
-- This drops the "demo-phase" INSERT policy that lets any anonymous browser
-- write a row directly. After this migration:
--
--   • anon / authenticated  →  INSERT denied (RLS denies the row)
--   • service_role          →  INSERT unrestricted (used by the Stripe webhook)
--   • sealed: the only path a tile can enter the archive is via a verified
--     Stripe payment_intent.succeeded webhook.
-- =============================================================================

drop policy if exists "tiles_insert_for_anon" on public.tiles;

create policy "tiles_no_anon_insert"
  on public.tiles for insert
  to anon, authenticated
  using (false);
