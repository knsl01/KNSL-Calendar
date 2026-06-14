// ============================================================
// KALA — Auth (magic link via Supabase)
// ------------------------------------------------------------
// Thin wrappers so the UI never touches Supabase directly.
// When cloud is not configured, these are safe no-ops and the
// app runs in guest mode.
// ============================================================
import { supabase, cloudEnabled } from "./supabase";

// Send a magic link to the user's email.
// Returns { ok: true } or { ok: false, error }.
export async function sendMagicLink(email) {
  if (!cloudEnabled) return { ok: false, error: "Cloud not configured" };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
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
