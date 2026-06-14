// ============================================================
// KALA — Storage layer
// ------------------------------------------------------------
// A single, swappable persistence interface. Today it uses a
// browser-backed key/value store (window.storage in the host,
// localStorage as a fallback). When you're ready for cloud sync,
// implement the same three functions against Supabase and nothing
// else in the app has to change.
// ============================================================

const STORE_KEY = "kala-state-v1";

// In Anthropic's artifact host, window.storage exists. In a normal
// browser (Vercel), we fall back to localStorage with the same shape.
function backend() {
  if (typeof window === "undefined") return null;
  if (window.storage) return window.storage;
  // localStorage shim matching window.storage's async-ish API
  return {
    async get(k) {
      const v = window.localStorage.getItem(k);
      if (v == null) throw new Error("not found");
      return { key: k, value: v };
    },
    async set(k, v) {
      window.localStorage.setItem(k, v);
      return { key: k, value: v };
    },
    async delete(k) {
      window.localStorage.removeItem(k);
      return { key: k, deleted: true };
    },
  };
}

export async function loadState() {
  const store = backend();
  if (!store) return null;
  try {
    const res = await store.get(STORE_KEY);
    return res ? JSON.parse(res.value) : null;
  } catch {
    return null; // key missing or parse error → fresh start
  }
}

export async function saveState(state) {
  const store = backend();
  if (!store) return;
  try {
    await store.set(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("KALA save failed", e);
  }
}

export async function clearState() {
  const store = backend();
  if (!store) return;
  try {
    await store.delete(STORE_KEY);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------
// SUPABASE MIGRATION (when ready):
//   import { createClient } from "@supabase/supabase-js";
//   const sb = createClient(
//     import.meta.env.VITE_SUPABASE_URL,
//     import.meta.env.VITE_SUPABASE_ANON_KEY
//   );
//   export async function loadState() {
//     const { data: { user } } = await sb.auth.getUser();
//     if (!user) return null;
//     const { data } = await sb.from("states")
//       .select("data").eq("user_id", user.id).single();
//     return data?.data ?? null;
//   }
//   ...same for saveState / clearState (upsert / delete by user_id).
// Keep this interface identical and the rest of the app won't change.
// ------------------------------------------------------------
