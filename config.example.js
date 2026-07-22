// =============================================================
// config.js — runtime configuration for the Time Capsule Billboard
// =============================================================
// 1. Copy this file:
//        cp config.example.js config.js
//
// 2. Paste your Supabase project values from
//    supabase.com/dashboard → Project → Settings → API:
//        • Project URL
//        • anon public key
//
// 3. The page auto-detects a valid Supabase config and switches
//    from localStorage mode (each browser sees its own archive)
//    to shared mode (everyone sees the same global billboard,
//    with realtime updates).
//
// 4. If `config.js` is missing, or the values above are the
//    placeholders `YOUR-PROJECT` / `YOUR-ANON-KEY`, the app
//    gracefully falls back to the localStorage demo.
// =============================================================

window.__SUPABASE_URL__      = 'https://YOUR-PROJECT.supabase.co';
window.__SUPABASE_ANON_KEY__ = 'YOUR-ANON-KEY';

// Stripe — optional. Paste your publishable key (pk_test_... or pk_live_...)
// from https://dashboard.stripe.com/apikeys to enable real card payments.
// Leave as the placeholder to keep the in-browser mock checkout.
window.__STRIPE_PK__         = 'pk_test_YOUR-PUBLISHABLE-KEY';
