// ============================================================
// KALA — Auth (magic link via Supabase)
// ------------------------------------------------------------
// Thin wrappers so the UI never touches Supabase directly.
// When cloud is not configured, these are safe no-ops and the
// app runs in guest mode.
// ============================================================
import { supabase, cloudEnabled } from "./supabase";

// Email the user a sign-in code (and a backup magic link).
//
// We lead with a 6-digit code rather than relying on the link, because
// on iOS a home-screen PWA runs in its own context: tapping the email
// link always opens Safari, never the installed app, so the session
// lands in the wrong place and the home-screen app stays logged out.
// A code the user types in never leaves the app — so it works there.
//
// The email shows the code as long as the Supabase "Magic Link"
// template includes `{{ .Token }}` (see SUPABASE_SETUP.md). The link
// still works as a fallback when opened in the same browser.
//
// Returns { ok: true } or { ok: false, error }.
export async function sendMagicLink(email) {
  if (!cloudEnabled) return { ok: false, error: "Cloud not configured" };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Verify the 6-digit code the user typed in from their email.
// On success Supabase establishes the session in *this* context —
// which is exactly the home-screen PWA the user is looking at.
// Returns { ok: true, user } or { ok: false, error }.
export async function verifyEmailCode(email, token) {
  if (!cloudEnabled) return { ok: false, error: "Cloud not configured" };
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: String(token).trim(),
    type: "email",
  });
  return error ? { ok: false, error: error.message } : { ok: true, user: data?.user ?? null };
}

// Current signed-in user (or null).
export async function getUser() {
  if (!cloudEnabled) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

// Subscribe to auth changes. Returns an unsubscribe function.
export function onAuthChange(cb) {
  if (!cloudEnabled) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signOut() {
  if (!cloudEnabled) return;
  await supabase.auth.signOut();
}
