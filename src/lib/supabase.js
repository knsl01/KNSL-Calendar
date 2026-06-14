// ============================================================
// KALA — Supabase client
// ------------------------------------------------------------
// A single shared client. If env vars are missing (e.g. during
// first local runs before you've set up Supabase), `supabase`
// is null and the app gracefully falls back to local storage.
// ============================================================
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true, // handles the magic-link redirect
        },
      })
    : null;

// True when Supabase is configured. The app uses this to decide
// between cloud sync and on-device storage.
export const cloudEnabled = !!supabase;
